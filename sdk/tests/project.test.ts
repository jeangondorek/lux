import { describe, expect, test } from 'bun:test';
import { createClient, createProjectClient } from '../src/project';

describe('Lux project client', () => {
	test('createClient(url, key) creates a project client with auth namespace', () => {
		const client = createClient('http://localhost:3957/v1/project', 'lux_pub_test');

		expect(client.url).toBe('http://localhost:3957/v1/project');
		expect(client.key).toBe('lux_pub_test');
		expect(client.auth).toBeDefined();
	});

	test('project requests send apikey and bearer project key', async () => {
		let seen: { url: string; headers: Record<string, string>; body?: any } | null = null;
		const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
			seen = {
				url: String(input),
				headers: init?.headers as Record<string, string>,
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			};
			return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
		};

		const client = createProjectClient({
			url: 'http://localhost:3957/v1/project/',
			key: 'lux_sec_test',
			fetch: fetchImpl as typeof fetch,
		});

		const result = await client.exec(['PING']);

		expect(result).toEqual({ data: { result: 'OK' }, error: null });
		expect(seen?.url).toBe('http://localhost:3957/v1/project/exec');
		expect(seen?.headers.apikey).toBe('lux_sec_test');
		expect(seen?.headers.Authorization).toBe('Bearer lux_sec_test');
		expect(seen?.body).toEqual({ command: ['PING'] });
	});

	test('default fetch is bound for browser project requests', async () => {
		const originalFetch = globalThis.fetch;
		let receiver: unknown;
		globalThis.fetch = (async function (this: unknown) {
			receiver = this;
			return new Response(JSON.stringify({ result: 'PONG' }), { status: 200 });
		}) as typeof fetch;
		try {
			const client = createClient('http://localhost:3957/v1/project', 'lux_pub_test');
			await client.ping();
			expect(receiver).toBe(globalThis);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('project requests prefer the signed-in user bearer token', async () => {
		let seen: { headers: Record<string, string> } | null = null;
		const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
			seen = { headers: init?.headers as Record<string, string> };
			return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
		};

		const client = createProjectClient({
			url: 'http://localhost:3957/v1/project',
			key: 'lux_pub_test',
			fetch: fetchImpl as typeof fetch,
			auth: {
				autoRefreshToken: false,
			},
		});

		await client.auth.setSession({
			access_token: 'user-jwt',
			refresh_token: 'refresh',
			expires_in: 3600,
			token_type: 'bearer',
			user: { id: 'usr_1', email: 'user@example.com' },
		});
		const result = await client.table('messages').select();

		expect(result.error).toBeNull();
		expect(result.data).toEqual([]);
		expect(seen?.headers.apikey).toBe('lux_pub_test');
		expect(seen?.headers.Authorization).toBe('Bearer user-jwt');
	});

	test('project requests use authToken option as bearer token', async () => {
		let seen: { headers: Record<string, string> } | null = null;
		const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
			seen = { headers: init?.headers as Record<string, string> };
			return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
		};

		const client = createProjectClient({
			url: 'http://localhost:3957/v1/project',
			key: 'lux_pub_test',
			fetch: fetchImpl as typeof fetch,
			auth: {
				authToken: 'existing-user-jwt',
			},
		});

		const result = await client.exec(['PING']);

		expect(result.error).toBeNull();
		expect(seen?.headers.apikey).toBe('lux_pub_test');
		expect(seen?.headers.Authorization).toBe('Bearer existing-user-jwt');
	});

	test('table where clauses normalize compact comparison operators', async () => {
		const seen: string[] = [];
		const fetchImpl = async (input: RequestInfo | URL) => {
			seen.push(String(input));
			return new Response(JSON.stringify({ result: [] }), { status: 200 });
		};

		const client = createProjectClient({
			url: 'http://localhost:3957/v1/project',
			key: 'lux_sec_test',
			fetch: fetchImpl as typeof fetch,
		});

		await client.table('messages').select({ where: 'id=1', limit: 10 });
		await client.table('messages').select({ where: 'created_at>=1780000000' });

		expect(seen).toEqual([
			'http://localhost:3957/v1/project/tables/messages?where=id+%3D+1&limit=10',
			'http://localhost:3957/v1/project/tables/messages?where=created_at+%3E%3D+1780000000',
		]);
	});

	test('project request errors return data/error envelopes', async () => {
		const fetchImpl = async () => {
			return new Response(JSON.stringify({ error: 'Secret key required' }), { status: 403 });
		};

		const client = createProjectClient({
			url: 'http://localhost:3957/v1/project',
			key: 'lux_pub_test',
			fetch: fetchImpl as typeof fetch,
		});

		const result = await client.table('messages').select();

		expect(result.data).toBeNull();
		expect(result.error).toEqual({
			code: 'LUX_PROJECT_REQUEST_ERROR',
			message: 'Secret key required',
			details: {
				status: 403,
				payload: { error: 'Secret key required' },
			},
		});
	});

	test('auth options are threaded into the project auth client', async () => {
		const storage = new Map<string, string>();
		const client = createClient('http://localhost:3957/v1/project', 'lux_pub_test', {
			auth: {
				persistSession: true,
				autoRefreshToken: false,
				storageKey: 'project.session',
				storage: {
					getItem: (key) => storage.get(key) ?? null,
					setItem: (key, value) => storage.set(key, value),
					removeItem: (key) => storage.delete(key),
				},
			},
		});

		await client.auth.setSession({
			access_token: 'access',
			refresh_token: 'refresh',
			expires_in: 3600,
			token_type: 'bearer',
			user: { id: 'usr_1', email: 'user@example.com' },
		});

		expect(storage.has('project.session')).toBe(true);
	});

	test('OAuth callback session can drive publishable data calls after secret grants', async () => {
		const calls: Array<{ url: string; method?: string; headers: Record<string, string>; body?: any }> = [];
		const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method;
			const headers = init?.headers as Record<string, string>;
			const body = init?.body ? JSON.parse(String(init.body)) : undefined;
			calls.push({ url, method, headers, body });

			if (url.endsWith('/auth/v1/user')) {
				return new Response(JSON.stringify({ user: { id: 'usr_oauth', email: 'oauth@example.com' } }), { status: 200 });
			}
			if (url.endsWith('/auth/v1/admin/grants')) {
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			if (url.endsWith('/tables/oauth_messages') && method === 'POST') {
				return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
			}
			if (url.endsWith('/tables/oauth_messages?limit=10')) {
				return new Response(JSON.stringify({
					result: [{ id: 1, owner: 'oauth@example.com', body: 'hello' }],
				}), { status: 200 });
			}
			return new Response(JSON.stringify({ error: `unexpected ${method} ${url}` }), { status: 500 });
		};

		const storage = new Map<string, string>();
		const userClient = createClient('http://localhost:3957/v1/project', 'lux_pub_test', {
			fetch: fetchImpl as typeof fetch,
			auth: {
				persistSession: true,
				autoRefreshToken: false,
				storage: {
					getItem: (key) => storage.get(key) ?? null,
					setItem: (key, value) => storage.set(key, value),
					removeItem: (key) => storage.delete(key),
				},
			},
		});
		const secretClient = createClient('http://localhost:3957/v1/project', 'lux_sec_test', {
			fetch: fetchImpl as typeof fetch,
			auth: { persistSession: false, autoRefreshToken: false },
		});

		const sessionResult = await userClient.auth.consumeOAuthRedirect(
			'http://localhost:6199/#access_token=user-jwt&refresh_token=refresh-token&token_type=bearer&expires_in=3600',
		);
		const session = sessionResult.data!.session!;
		const readGrant = await secretClient.auth.grantCapability(session.user.id, 'table.oauth_messages.read');
		const writeGrant = await secretClient.auth.grantCapability(session.user.id, 'table.oauth_messages.write');
		const insertResult = await userClient.table('oauth_messages').insert({
			body: 'hello',
			owner: session!.user.email,
			created_at: '2026-06-01T17:37:29.825Z',
		});
		const rows = await userClient.table<{ id: number; owner: string; body: string }>('oauth_messages').select({ limit: 10 });

		expect(sessionResult.error).toBeNull();
		expect(readGrant.error).toBeNull();
		expect(writeGrant.error).toBeNull();
		expect(session?.user).toEqual({ id: 'usr_oauth', email: 'oauth@example.com' });
		expect(insertResult.error).toBeNull();
		expect(rows).toEqual({
			data: [{ id: 1, owner: 'oauth@example.com', body: 'hello' }],
			error: null,
		});
		expect(calls.map((call) => call.url)).toEqual([
			'http://localhost:3957/v1/project/auth/v1/user',
			'http://localhost:3957/v1/project/auth/v1/admin/grants',
			'http://localhost:3957/v1/project/auth/v1/admin/grants',
			'http://localhost:3957/v1/project/tables/oauth_messages',
			'http://localhost:3957/v1/project/tables/oauth_messages?limit=10',
		]);
		expect(calls[0].headers.Authorization).toBe('Bearer user-jwt');
		expect(calls[1].headers.apikey).toBe('lux_sec_test');
		expect(calls[1].headers.Authorization).toBeUndefined();
		expect(calls[3].headers.apikey).toBe('lux_pub_test');
		expect(calls[3].headers.Authorization).toBe('Bearer user-jwt');
	});
});
