import { build } from 'esbuild';
import { mkdir, cp, readdir } from 'node:fs/promises';

export async function buildPlugin(name) {
  if (!/^[a-z][a-z0-9-]+$/.test(name)) throw new Error('Invalid plugin directory');
  await mkdir(`dist/plugins/${name}`, { recursive: true });
  await cp(`plugins/${name}/manifest.json`, `dist/plugins/${name}/manifest.json`);
  await build({
    bundle: true,
    sourcemap: true,
    target: 'es2022',
    logLevel: 'info',
    entryPoints: [`plugins/${name}/src/index.ts`],
    outfile: `dist/plugins/${name}/index.js`,
    platform: 'browser',
    format: 'esm',
  });
}
export async function buildPlugins() {
  for (const directory of await readdir('plugins', { withFileTypes: true }))
    if (directory.isDirectory()) await buildPlugin(directory.name);
}
