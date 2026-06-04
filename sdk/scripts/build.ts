import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

await rm(join(root, 'dist'), { recursive: true, force: true });

run(['tsc', '-p', 'tsconfig.cjs.json']);
run(['tsc', '-p', 'tsconfig.esm.json']);
run(['tsc', '-p', 'tsconfig.types.json']);

await writeFile(join(root, 'dist/cjs/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
await writeFile(join(root, 'dist/esm/package.json'), JSON.stringify({ type: 'module' }, null, 2));
await patchEsmImports(join(root, 'dist/esm'));

function run(args: string[]) {
	const result = Bun.spawnSync(args, {
		cwd: root,
		stdout: 'inherit',
		stderr: 'inherit',
	});
	if (!result.success) {
		process.exit(result.exitCode || 1);
	}
}

async function patchEsmImports(dir: string) {
	const entries = new Bun.Glob('**/*.js').scan({ cwd: dir });
	for await (const entry of entries) {
		const path = join(dir, entry);
		const source = await Bun.file(path).text();
		const patched = source
			.replace(/from '(\.[^']+)'/g, (_match, specifier) => `from '${withJs(specifier)}'`)
			.replace(/from "(\.[^"]+)"/g, (_match, specifier) => `from "${withJs(specifier)}"`)
			.replace(/import\('(\.[^']+)'\)/g, (_match, specifier) => `import('${withJs(specifier)}')`)
			.replace(/import\("(\.[^"]+)"\)/g, (_match, specifier) => `import("${withJs(specifier)}")`);
		if (patched !== source) {
			await writeFile(path, patched);
		}
	}
}

function withJs(specifier: string) {
	if (specifier.endsWith('.js') || specifier.endsWith('.json')) return specifier;
	return `${specifier}.js`;
}
