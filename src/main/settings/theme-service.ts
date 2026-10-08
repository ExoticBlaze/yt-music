import { dialog, type BrowserWindow } from 'electron';
import { mkdir, readdir, readFile, stat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { safePackagePath, unpackPackage } from '../plugins/plugin-installer';
import type { AppSettings } from '../../shared/types/settings';
import type { JsonStore } from './json-store';

const themeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  type: z.literal('theme'),
  css: z.string().regex(/^[\w./-]+\.css$/),
});
const builtins = [
  { id: 'youtube', name: 'YouTube Music' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'amethyst', name: 'Amethyst' },
];
export class ThemeService {
  constructor(
    private readonly directory: string,
    private readonly settings: JsonStore<AppSettings>,
    private readonly window: BrowserWindow,
    private readonly changed: () => void,
  ) {}
  async list(): Promise<{ id: string; name: string }[]> {
    const themes = [...builtins];
    for (const entry of await readdir(this.directory, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const manifest = await readFile(join(this.directory, entry.name, 'manifest.json'), 'utf8')
        .then((value) => themeSchema.parse(JSON.parse(value)))
        .catch(() => null);
      if (manifest && manifest.id === entry.name)
        themes.push({ id: manifest.id, name: manifest.name });
    }
    return themes;
  }
  async select(id: string): Promise<void> {
    let css = '';
    if (!builtins.some((value) => value.id === id)) {
      const root = safePackagePath(this.directory, id);
      const manifest = themeSchema.parse(
        JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')),
      );
      const cssPath = safePackagePath(root, manifest.css);
      if ((await stat(cssPath)).size > 100000) throw new Error('Theme CSS exceeds 100 KB');
      css = await readFile(cssPath, 'utf8');
    }
    await this.settings.update((settings) => {
      settings.appearance.theme = id;
      settings.appearance.themeCss = css;
      return settings;
    });
    this.changed();
  }
  async importPackage(): Promise<void> {
    const kind = await dialog.showMessageBox(this.window, {
      title: 'Import theme',
      message: 'Choose a theme package',
      buttons: ['Cancel', 'ZIP', 'Folder'],
      cancelId: 0,
    });
    if (!kind.response) return;
    const choice = await dialog.showOpenDialog(this.window, {
      properties: [kind.response === 2 ? 'openDirectory' : 'openFile'],
      filters: kind.response === 1 ? [{ name: 'Theme ZIP', extensions: ['zip'] }] : undefined,
    });
    const source = choice.filePaths[0];
    if (!source) return;
    await mkdir(this.directory, { recursive: true });
    const staging = safePackagePath(this.directory, `.stage-${randomUUID()}`);
    await mkdir(staging);
    try {
      await unpackPackage(source, staging);
      let root = staging;
      if (!(await stat(join(root, 'manifest.json')).catch(() => null))) {
        const children = await readdir(root);
        if (children.length !== 1 || !children[0]) throw new Error('Theme manifest is missing');
        root = join(root, children[0]);
      }
      const manifest = themeSchema.parse(
        JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')),
      );
      if ((await this.list()).some((value) => value.id === manifest.id))
        throw new Error('Theme ID already exists');
      const css = safePackagePath(root, manifest.css);
      if ((await stat(css)).size > 100000) throw new Error('Theme CSS exceeds 100 KB');
      const answer = await dialog.showMessageBox(this.window, {
        type: 'warning',
        title: 'Trust theme CSS',
        message: `Install ${manifest.name}?`,
        detail:
          'CSS can change the webpage and request external images or fonts. Only install themes from authors you trust.',
        buttons: ['Cancel', 'Install'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response === 1) {
        await rename(root, safePackagePath(this.directory, manifest.id));
        await this.select(manifest.id);
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
