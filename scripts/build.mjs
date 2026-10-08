import { build } from 'esbuild';
import { mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { buildPlugins } from './build-plugins.mjs';

await mkdir('dist', { recursive: true });
const shared = { bundle: true, sourcemap: true, target: 'es2022', logLevel: 'info' };
await build({
  ...shared,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main/main.cjs',
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
for (const entry of ['preload', 'music', 'plugin', 'toast']) {
  if (!existsSync(`src/preload/${entry}.ts`)) continue;
  await build({
    ...shared,
    entryPoints: [`src/preload/${entry}.ts`],
    outfile: `dist/preload/${entry}.cjs`,
    platform: 'browser',
    format: 'cjs',
    external: ['electron'],
  });
}
await build({
  ...shared,
  entryPoints: ['src/main/blocking/filter-worker.ts'],
  outfile: 'dist/main/filter-worker.cjs',
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
for (const entry of ['renderer', 'plugin-runtime']) {
  if (!existsSync(`src/${entry}/index.ts`)) continue;
  await build({
    ...shared,
    entryPoints: [`src/${entry}/index.ts`],
    outfile: `dist/${entry}/index.js`,
    platform: 'browser',
    format: 'esm',
  });
  await cp(`src/${entry}/index.html`, `dist/${entry}/index.html`);
}
await cp('src/renderer/style.css', 'dist/renderer/style.css');
await rm('dist/renderer/player.css', { force: true });
await cp('src/renderer/toast.css', 'dist/renderer/toast.css');
await cp('src/renderer/toast.html', 'dist/renderer/toast.html');
await cp('assets', 'dist/assets', { recursive: true });
await buildPlugins();
if (existsSync('server/index.ts'))
  await build({
    ...shared,
    entryPoints: ['server/index.ts'],
    outfile: 'dist/server/index.cjs',
    platform: 'node',
    format: 'cjs',
    packages: 'external',
  });
