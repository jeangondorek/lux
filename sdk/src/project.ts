import { LuxAuthClient, type LuxAuthOptions } from './auth';
import type { LuxResult } from './types';
import { err, ok, toLuxError } from './utils';

export interface LuxProjectOptions {
	url: string;
	key: string;
	fetch?: typeof fetch;
	auth?: Omit<LuxAuthOptions, 'httpUrl' | 'apiKey' | 'fetch'>;
}

export interface LuxTableColumn {
	name: string;
	type: 'STR' | 'INT' | 'FLOAT' | 'BOOL' | 'TIMESTAMP' | 'UUID';
	primaryKey?: boolean;
	unique?: boolean;
	notNull?: boolean;
	references?: string;
	onDelete?: string;
}

export interface LuxVectorSearchOptions {
	vector: number[];
	k?: number;
	filter?: string;
	filter_value?: string;
}

type QueryValue = string | number | boolean | null;

export class LuxProjectClient {
	readonly url: string;
	readonly key: string;
	readonly auth: LuxAuthClient;
	private fetchImpl: typeof fetch;

	constructor(options: LuxProjectOptions) {
		this.url = options.url.replace(/\/+$/, '');
		this.key = options.key;
		this.fetchImpl = resolveFetch(options.fetch);
		this.auth = new LuxAuthClient({
			...options.auth,
			httpUrl: this.url,
			apiKey: this.key,
			fetch: this.fetchImpl,
		});
	}

	table<T extends Record<string, unknown> = Record<string, unknown>>(name: string): LuxProjectTable<T> {
		return new LuxProjectTable<T>(this, name);
	}

	async ping(): Promise<LuxResult<unknown>> {
		return this.request('GET', '/ping');
	}

	async createTable(name: string, columns: Array<string | LuxTableColumn>): Promise<LuxResult<unknown>> {
		return this.request('POST', '/tables', { name, columns });
	}

	async exec(command: string | string[]): Promise<LuxResult<unknown>> {
		return this.request('POST', '/exec', { command });
	}

	async vectorSet(key: string, vector: number[], metadata?: Record<string, unknown>): Promise<LuxResult<unknown>> {
		return this.request('POST', `/vectors/${encodeURIComponent(key)}`, { vector, metadata });
	}

	async vectorSearch(options: LuxVectorSearchOptions): Promise<LuxResult<unknown>> {
		return this.request('POST', '/vectors/search', {
			vector: options.vector,
			k: options.k ?? 10,
			filter: options.filter,
			filter_value: options.filter_value,
		});
	}

	async tsAdd(key: string, value: number, options?: { timestamp?: number | '*'; labels?: Record<string, string>; retention?: number }): Promise<LuxResult<unknown>> {
		return this.request('POST', `/ts/${encodeURIComponent(key)}`, {
			timestamp: options?.timestamp ?? '*',
			value,
			labels: options?.labels,
			retention: options?.retention,
		});
	}

	async tsRange(key: string, options?: { from?: number | '-'; to?: number | '+'; count?: number }): Promise<LuxResult<unknown>> {
		const params = new URLSearchParams();
		if (options?.from != null) params.set('from', String(options.from));
		if (options?.to != null) params.set('to', String(options.to));
		if (options?.count != null) params.set('count', String(options.count));
		const query = params.toString();
		return this.request('GET', `/ts/${encodeURIComponent(key)}${query ? `?${query}` : ''}`);
	}

	async request<T = unknown>(method: string, path: string, body?: unknown): Promise<LuxResult<T>> {
		try {
			const accessToken = await this.auth.getAccessToken();
			const headers: Record<string, string> = {
				Accept: 'application/json',
				apikey: this.key,
				Authorization: `Bearer ${accessToken ?? this.key}`,
			};
			const init: RequestInit = { method, headers };
			if (body !== undefined) {
				headers['Content-Type'] = 'application/json';
				init.body = JSON.stringify(body);
			}

			const response = await this.fetchImpl(`${this.url}${path}`, init);
			const text = await response.text();
			const payload = text ? JSON.parse(text) : {};
			if (!response.ok) {
				return err(
					'LUX_PROJECT_REQUEST_ERROR',
					payload?.error || `Lux request failed with HTTP ${response.status}`,
					{ status: response.status, payload },
				);
			}
			return ok(payload as T);
		} catch (error) {
			return err('LUX_PROJECT_REQUEST_ERROR', 'Lux request failed', toLuxError(error));
		}
	}
}

export class LuxProjectTable<T extends Record<string, unknown>> {
	constructor(private client: LuxProjectClient, private name: string) {}

	async select(options?: { where?: string; order?: string; limit?: number }): Promise<LuxResult<T[]>> {
		const params = new URLSearchParams();
		if (options?.where) params.set('where', normalizeWhere(options.where));
		if (options?.order) params.set('order', options.order);
		if (options?.limit != null) params.set('limit', String(options.limit));
		const query = params.toString();
		const result = await this.client.request('GET', `/tables/${encodeURIComponent(this.name)}${query ? `?${query}` : ''}`);
		if (result.error) return result as LuxResult<T[]>;
		return ok(unwrapRows<T>(result.data));
	}

	async insert(row: Partial<T> & Record<string, QueryValue>): Promise<LuxResult<unknown>> {
		return this.client.request('POST', `/tables/${encodeURIComponent(this.name)}`, row);
	}

	async update(where: string, patch: Partial<T> & Record<string, QueryValue>): Promise<LuxResult<unknown>> {
		return this.client.request('PATCH', `/tables/${encodeURIComponent(this.name)}?where=${encodeURIComponent(normalizeWhere(where))}`, patch);
	}

	async delete(where: string): Promise<LuxResult<unknown>> {
		return this.client.request('DELETE', `/tables/${encodeURIComponent(this.name)}?where=${encodeURIComponent(normalizeWhere(where))}`);
	}

	async count(): Promise<LuxResult<number>> {
		const result = await this.client.request('GET', `/tables/${encodeURIComponent(this.name)}/count`);
		if (result.error) return result as LuxResult<number>;
		return ok(unwrapResult<number>(result.data) ?? 0);
	}
}

function unwrapRows<T>(payload: unknown): T[] {
	if (Array.isArray(payload)) return payload as T[];
	if (payload && typeof payload === 'object' && Array.isArray((payload as any).result)) {
		return (payload as any).result as T[];
	}
	return [];
}

function unwrapResult<T>(payload: unknown): T | undefined {
	if (payload && typeof payload === 'object' && 'result' in payload) {
		return (payload as any).result as T;
	}
	return payload as T;
}

function normalizeWhere(where: string): string {
	return where.trim().replace(/\s*(>=|<=|!=|=|>|<)\s*/g, ' $1 ');
}

export function createProjectClient(options: LuxProjectOptions): LuxProjectClient {
	return new LuxProjectClient(options);
}

export function createClient(url: string, key: string, options: Omit<LuxProjectOptions, 'url' | 'key'> = {}): LuxProjectClient {
	return new LuxProjectClient({ ...options, url, key });
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
	const candidate = fetchImpl ?? globalThis.fetch;
	if (!candidate) {
		throw new Error('Lux project client requires a fetch implementation');
	}
	if (typeof globalThis !== 'undefined' && candidate === globalThis.fetch) {
		return candidate.bind(globalThis) as typeof fetch;
	}
	return candidate;
}
