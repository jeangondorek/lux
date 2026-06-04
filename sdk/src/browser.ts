import { createClient, type LuxProjectOptions } from './project';

export interface LuxBrowserClientOptions extends Omit<LuxProjectOptions, 'url' | 'key'> {}

export function createBrowserClient(
	url: string,
	key: string,
	options: LuxBrowserClientOptions = {},
) {
	return createClient(url, key, {
		...options,
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			...(options.auth ?? {}),
		},
	});
}
