import { readFile } from 'node:fs/promises';
import { valid, prerelease } from 'semver';

const packageFile = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageFile.version;
if (!valid(version) || prerelease(version))
  throw new Error('Releases must use a stable semver version');
if (process.env.RELEASE_TAG !== `v${version}`)
  throw new Error(`Release tag must be v${version} to match package.json`);

const displayVersion = await readFile(
  new URL('../src/shared/constants/version.ts', import.meta.url),
  'utf8',
);
if (!displayVersion.includes(`APP_VERSION = '${version}'`))
  throw new Error('APP_VERSION must match package.json before releasing');

const lockfile = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);
if (lockfile.version !== version || lockfile.packages[''].version !== version)
  throw new Error('package-lock.json must match package.json before releasing');

console.log(`Release v${version} validated`);
