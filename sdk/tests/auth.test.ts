import { describe, expect, test } from 'bun:test';
import { LuxAuthClient, type LuxAuthStorage } from '../src/auth';

function memoryStorage(seed: Record<string, string> = {}): LuxAuthStorage & { data: Map<string, string> } {
	const data = new Map(Object.entries(seed));
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
		removeItem: (key) => {
			data.delete(key);
		},
	};
}

function session(overrides: Record<string, unknown> = {}) {
	return {
		access_token: 'access-token',
		refresh_token: 'refresh-token',
		expires_in: 3600,
		token_type: 'bearer' as const,
		user: { id: 'usr_123', email: 'user@example.com' },
		...overrides,
	};
}

describe('LuxAuthClient session state', () => {
	test('persists, restores, and clears sessions through storage', async () => {
		const storage = memoryStorage();
		const auth = new LuxAuthClient({
			persistSession: true,
			autoRefreshToken: false,
			storage,
			storageKey: 'lux.test.session',
		});

		await auth.setSession(session());
		expect(storage.data.has('lux.test.session')).toBe(true);

		const restored = new LuxAuthClient({
			persistSession: true,
			autoRefreshToken: false,
			storage,
			storageKey: 'lux.test.session',
		});
		expect((await restored.getSession()).data?.session?.access_token).toBe('access-token');

		await restored.clearSession();
		expect((await restored.getSession()).data?.session).toBeNull();
		expect(storage.data.has('lux.test.session')).toBe(false);
	});

	test('emits auth state changes', async () => {
		const auth = new LuxAuthClient({ persistSession: false, autoRefreshToken: false });
		const events: string[] = [];
		const subscription = auth.onAuthStateChange((event, nextSession) => {
			events.push(`${event}:${nextSession ? 'session' : 'none'}`);
		});

		await Promise.resolve();
		await auth.setSession(session());
		await auth.clearSession();
		subscription.unsubscribe();

		expect(events).toContain('INITIAL_SESSION:none');
		expect(events).toContain('SESSION_UPDATED:session');
		expect(events).toContain('SIGNED_OUT:none');
	});

	test('signInWithPassword stores returned session and sends project apikey', async () => {
		const storage = memoryStorage();
		let seen: { url: string; headers: Record<string, string>; body: any } | null = null;
		const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
			seen = {
				url: String(input),
				headers: init?.headers as Record<string, string>,
				body: JSON.parse(String(init?.body)),
			};
			return new Response(JSON.stringify(session({ access_token: 'signed-in' })), { status: 200 });
		};

		const auth = new LuxAuthClient({
			httpUrl: 'http://localhost:3957/v1/project',
			apiKey: 'lux_pub_test',
			fetch: fetchImpl as typeof fetch,
			persistSession: true,
			autoRefreshToken: false,
			storage,
		});

		const next = await auth.signInWithPassword({ email: 'user@example.com', password: 'password' });

		expect(next.data?.session?.access_token).toBe('signed-in');
		expect(next.data?.user?.id).toBe('usr_123');
		expect(next.error).toBeNull();
		expect((await auth.getSession()).data?.session?.access_token).toBe('signed-in');
		expect(seen?.url).toBe('http://localhost:3957/v1/project/auth/v1/token');
		expect(seen?.headers.apikey).toBe('lux_pub_test');
		expect(seen?.body).toEqual({
			grant_type: 'password',
			email: 'user@example.com',
			password: 'password',
		});
	});

	test('getUser uses the stored bearer token', async () => {
		let authorization = '';
		const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
			authorization = String((init?.headers as Record<string, string>).Authorization || '');
			return new Response(JSON.stringify({ user: { id: 'usr_123', email: 'user@example.com' } }), { status: 200 });
		};
		const auth = new LuxAuthClient({
			httpUrl: 'http://localhost:3957/v1/project',
			fetch: fetchImpl as typeof fetch,
			persistSession: false,
			autoRefreshToken: false,
		});
		await auth.setSession(session({ access_token: 'stored-token' }));

		const user = await auth.getUser();

		expect(user.data?.user?.id).toBe('usr_123');
		expect(user.error).toBeNull();
		expect(authorization).toBe('Bearer stored-token');
	});

	test('default fetch is bound for browser auth requests', async () => {
		const originalFetch = globalThis.fetch;
		let receiver: unknown;
		globalThis.fetch = (async function (this: unknown) {
			receiver = this;
			return new Response(JSON.stringify({ user: { id: 'usr_123', email: 'user@example.com' } }), { status: 200 });
		}) as typeof fetch;
		try {
			const auth = new LuxAuthClient({
				httpUrl: 'http://localhost:3957/v1/project',
				authToken: 'stored-token',
				persistSession: false,
				autoRefreshToken: false,
			});
			await auth.getUser();
			expect(receiver).toBe(globalThis);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('signInWithOAuth builds project authorize URL without forcing redirect', async () => {
		const auth = new LuxAuthClient({
			httpUrl: 'http://localhost:3957/v1/project',
			persistSession: false,
			autoRefreshToken: false,
		});

		const result = await auth.signInWithOAuth({
			provider: 'github',
			redirectTo: 'http://localhost:5173/callback',
			skipRedirect: true,
		});

		expect(result.data?.url).toBe(
			'http://localhost:3957/v1/project/auth/v1/authorize?provider=github&redirect_to=http%3A%2F%2Flocalhost%3A5173%2Fcallback',
		);
		expect(result.error).toBeNull();
	});

	test('consumeOAuthRedirect stores access, refresh, and loaded user from hash', async () => {
		const storage = memoryStorage();
		let authorization = '';
		const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
			authorization = String((init?.headers as Record<string, string>).Authorization || '');
			return new Response(JSON.stringify({ user: { id: 'usr_oauth', email: 'oauth@example.com' } }), { status: 200 });
		};
		const auth = new LuxAuthClient({
			httpUrl: 'http://localhost:3957/v1/project',
			fetch: fetchImpl as typeof fetch,
			persistSession: true,
			autoRefreshToken: false,
			storage,
		});

		const result = await auth.consumeOAuthRedirect(
			'http://localhost:5173/callback#access_token=access&refresh_token=refresh&token_type=bearer&expires_in=3600',
		);

		expect(result.data?.session?.access_token).toBe('access');
		expect(result.data?.session?.refresh_token).toBe('refresh');
		expect(result.data?.user).toEqual({ id: 'usr_oauth', email: 'oauth@example.com' });
		expect(result.error).toBeNull();
		expect(authorization).toBe('Bearer access');
		expect(storage.data.has('lux.auth.session')).toBe(true);
	});
});
