import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../src/main/settings/json-store';
import { migrateSettings, settingsSchema } from '../src/shared/types/settings';
import { PluginStorage } from '../src/main/plugins/plugin-storage';

const directories: string[] = [];
async function temporary(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'ytm-test-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
describe('settings storage and migrations', () => {
  it('preserves concurrent read-modify-write changes', async () => {
    const path = join(await temporary(), 'updates.json');
    const store = new JsonStore(path, migrateSettings, settingsSchema.parse({}));
    await Promise.all([
      store.update((current) => {
        current.general.closeToTray = false;
        return current;
      }),
      store.update((current) => {
        current.appearance.accent = '#ffffff';
        return current;
      }),
    ]);
    expect(store.get().general.closeToTray).toBe(false);
    expect(store.get().appearance.accent).toBe('#ffffff');
  });
  it('round-trips typed settings and keeps reads isolated', async () => {
    const path = join(await temporary(), 'settings.json');
    const store = new JsonStore(path, migrateSettings, settingsSchema.parse({}));
    await store.load();
    const copy = store.get();
    copy.general.closeToTray = false;
    expect(store.get().general.closeToTray).toBe(true);
    await store.set(copy);
    const next = new JsonStore(path, migrateSettings, settingsSchema.parse({}));
    expect((await next.load()).general.closeToTray).toBe(false);
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1);
  });
  it('migrates version zero and refuses future or corrupt documents', async () => {
    expect(migrateSettings({ version: 0, closeToTray: false }).general.closeToTray).toBe(false);
    expect(() => migrateSettings({ version: 99 })).toThrow('newer');
    const path = join(await temporary(), 'bad.json');
    await writeFile(path, '{broken');
    await expect(
      new JsonStore(path, migrateSettings, settingsSchema.parse({})).load(),
    ).rejects.toThrow();
  });
  it('adds volume defaults to older settings and retains volume across restarts', async () => {
    expect(migrateSettings({ version: 1, playback: { mediaKeys: false } }).playback).toEqual({
      mediaKeys: false,
      volume: 1,
      muted: false,
    });
    const path = join(await temporary(), 'volume.json');
    const store = new JsonStore(path, migrateSettings, settingsSchema.parse({}));
    await store.update((current) => ({
      ...current,
      playback: { ...current.playback, volume: 0.42, muted: true },
    }));
    const restarted = new JsonStore(path, migrateSettings, settingsSchema.parse({}));
    expect((await restarted.load()).playback).toEqual({
      mediaKeys: true,
      volume: 0.42,
      muted: true,
    });
  });
  it('serializes concurrent plugin writes and isolates plugin namespaces', async () => {
    const directory = await temporary();
    const a = new PluginStorage(join(directory, 'a.json'));
    const b = new PluginStorage(join(directory, 'b.json'));
    await Promise.all([a.load(), b.load()]);
    await Promise.all([a.set('offset', 150), a.set('fontSize', 28)]);
    expect(a.get('offset')).toBe(150);
    expect(a.get('fontSize')).toBe(28);
    expect(b.get('offset')).toBeUndefined();
    await a.set('offset', undefined);
    expect(a.get('offset')).toBeUndefined();
    await expect(a.set('__proto__', {})).rejects.toThrow('Reserved');
  });
});
