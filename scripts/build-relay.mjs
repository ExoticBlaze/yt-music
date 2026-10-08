import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

// Export only the relay and its own dependencies. Desktop profiles, credentials,
// music data, Electron and development files never enter this hosting package.
const application = JSON.parse(await readFile('package.json', 'utf8'));
const sourceLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const directory = join('release', application.version, 'listen-together-relay');
await mkdir(directory, { recursive: true });
await build({
  entryPoints: ['server/index.ts'],
  outfile: join(directory, 'relay.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  logLevel: 'info',
});
const dependencies = Object.fromEntries(
  ['ws', 'zod'].map((name) => [name, sourceLock.packages[`node_modules/${name}`].version]),
);
const manifest = {
  name: 'ytmusic-plus-room-relay',
  version: application.version,
  private: true,
  description: 'Listen Together room metadata relay for YTMusic+',
  license: 'MIT',
  scripts: { start: 'node relay.cjs' },
  engines: { node: '>=22.12.0' },
  dependencies,
};
await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
const packages = {
  '': {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    engines: manifest.engines,
    dependencies,
  },
};
for (const name of Object.keys(dependencies))
  packages[`node_modules/${name}`] = sourceLock.packages[`node_modules/${name}`];
await writeFile(
  join(directory, 'package-lock.json'),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages,
    },
    null,
    2,
  ) + '\n',
);
await copyFile('server/render.yaml', join(directory, 'render.yaml'));
await copyFile('server/HOSTING.md', join(directory, 'README.md'));
await copyFile('LICENSE', join(directory, 'LICENSE'));
console.log(`Relay-only hosting package: ${directory}`);
