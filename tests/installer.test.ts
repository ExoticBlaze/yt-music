import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { PluginInstaller, safePackagePath } from '../src/main/plugins/plugin-installer';

describe('package installation', () => {
  it('rejects path escapes including Windows drive and alternate stream paths', () => {
    for (const value of [
      '../index.js',
      '/index.js',
      'C:/private.js',
      'foo\\index.js',
      'file.js:stream',
    ])
      expect(() => safePackagePath('/safe', value)).toThrow();
  });
  it('installs approved ZIPs, rejects duplicates and uninstalls within the plugin root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ytm-install-'));
    const packages = join(root, 'plugins');
    await mkdir(packages);
    try {
      const archive = new AdmZip();
      const manifest = {
        id: 'local-plugin',
        name: 'Local',
        version: '1.0.0',
        description: '',
        author: 'Test',
        main: 'index.js',
        permissions: [],
      };
      archive.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
      archive.addFile('index.js', Buffer.from('export default { activate() {} }'));
      const path = join(root, 'plugin.zip');
      await writeFile(path, archive.toBuffer());
      const installer = new PluginInstaller(packages);
      expect(await installer.install(path, async () => false)).toBeNull();
      expect((await installer.install(path, async () => true))?.id).toBe('local-plugin');
      await expect(installer.install(path, async () => true)).rejects.toThrow('already installed');
      await installer.uninstall('local-plugin');
      expect(await stat(join(packages, 'local-plugin')).catch(() => null)).toBeNull();
      await expect(installer.uninstall('../escape')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
