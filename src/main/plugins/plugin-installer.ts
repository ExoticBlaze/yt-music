import AdmZip from 'adm-zip';
import { cp, mkdir, readFile, readdir, lstat, realpath, rm, rename, stat } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateManifest, type PluginManifest } from '../../shared/types/plugin';

const maxBytes = 20_000_000;
export function safePackagePath(root: string, relative: string): string {
  if (
    relative.includes('\\') ||
    relative.includes(':') ||
    relative.split('/').includes('..') ||
    relative.startsWith('/')
  )
    throw new Error('Unsafe plugin package path');
  const target = resolve(root, relative);
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw new Error('Unsafe plugin package path');
  return target;
}
export async function validateTree(root: string): Promise<void> {
  let bytes = 0;
  let count = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Plugin packages cannot contain symbolic links');
      if (++count > 500) throw new Error('Plugin package has too many files');
      if (info.isDirectory()) await walk(path);
      else {
        bytes += info.size;
        if (bytes > maxBytes) throw new Error('Plugin package exceeds 20 MB');
      }
    }
  }
  await walk(root);
}
export class PluginInstaller {
  constructor(private readonly pluginsRoot: string) {}
  async install(
    source: string,
    confirm: (manifest: PluginManifest) => Promise<boolean>,
  ): Promise<PluginManifest | null> {
    await mkdir(this.pluginsRoot, { recursive: true });
    const staging = join(this.pluginsRoot, `.stage-${randomUUID()}`);
    await mkdir(staging);
    try {
      await unpackPackage(source, staging);
      let packageRoot = staging;
      if (!(await stat(join(packageRoot, 'manifest.json')).catch(() => null))) {
        const children = await readdir(staging);
        if (children.length !== 1 || !children[0])
          throw new Error('manifest.json must be at the package root');
        packageRoot = join(staging, children[0]);
      }
      const manifest = validateManifest(
        JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8')),
      );
      const entry = safePackagePath(packageRoot, manifest.main);
      const resolved = await realpath(entry);
      if (!resolved.startsWith(`${resolve(packageRoot)}${sep}`))
        throw new Error('Entry point is outside package');
      const target = join(this.pluginsRoot, manifest.id);
      if (await stat(target).catch(() => null))
        throw new Error(`Plugin ${manifest.id} is already installed`);
      if (!(await confirm(manifest))) return null;
      await rename(packageRoot, target);
      return manifest;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  async uninstall(id: string): Promise<void> {
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) throw new Error('Invalid plugin ID');
    const path = safePackagePath(this.pluginsRoot, id);
    if (basename(path) !== id) throw new Error('Invalid plugin path');
    await rm(path, { recursive: true, force: true });
  }
}
export async function unpackPackage(source: string, staging: string): Promise<void> {
  const sourceInfo = await lstat(source);
  if (sourceInfo.isSymbolicLink()) throw new Error('Package source cannot be a symbolic link');
  if (sourceInfo.isDirectory()) {
    await validateTree(source);
    await cp(source, staging, { recursive: true });
  } else {
    if (sourceInfo.size > maxBytes || !source.toLowerCase().endsWith('.zip'))
      throw new Error('Select a package folder or ZIP under 20 MB');
    const zip = new AdmZip(await readFile(source));
    const entries = zip.getEntries();
    if (entries.length > 500) throw new Error('ZIP contains too many entries');
    let total = 0;
    const seen = new Set<string>();
    for (const entry of entries) {
      safePackagePath(staging, entry.entryName);
      if (seen.has(entry.entryName.toLowerCase())) throw new Error('Duplicate ZIP path');
      seen.add(entry.entryName.toLowerCase());
      if (((entry.attr >>> 16) & 0xf000) === 0xa000)
        throw new Error('Symbolic links are not allowed');
      total += entry.header.size;
      if (total > maxBytes) throw new Error('Expanded ZIP exceeds 20 MB');
    }
    zip.extractAllTo(staging, false, false);
  }
  await validateTree(staging);
}
