import { createClient, type LuxProjectOptions } from './project';
import type { LuxSchema } from './types';

export interface LuxBrowserClientOptions extends Omit<LuxProjectOptions, 'url' | 'key'> {}

export function createBrowserClient<DB extends Record<string, object> = LuxSchema>(
	url: string,
	key: string,
	options: LuxBrowserClientOptions = {},
) {
	return createClient<DB>(url, key, {
		...options,
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			...(options.auth ?? {}),
		},
	});
}
