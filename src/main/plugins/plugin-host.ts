import { ipcMain, type BrowserWindow } from 'electron';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { IPC } from '../../shared/constants/ipc';
import {
  validateManifest,
  type PluginInfo,
  type PluginManifest,
  type Permission,
} from '../../shared/types/plugin';
import { pluginCallSchema } from '../../shared/types/plugin-rpc';
import { PluginStorage } from './plugin-storage';
import type { CapabilityBroker } from './capability-broker';
import type { Logger } from '../logging/logger';
import type { OverlayRegistry } from './overlay-registry';
import type { JsonStore } from '../settings/json-store';
import type { AppSettings } from '../../shared/types/settings';
import type { MusicContext } from '../music/context';
import { manifestDigest } from './manifest-digest';
import { createPluginWindow } from './sandbox-window';

interface HostedPlugin extends PluginInfo {
  directory: string;
  storage: PluginStorage;
  window?: BrowserWindow;
  started?: () => void;
  failed?: (error: Error) => void;
  stopped?: () => void;
  heartbeat: number;
  calls: number;
  rateReset: number;
  watcher?: FSWatcher;
  reloadTimer?: NodeJS.Timeout;
}
export class PluginHost {
  private plugins = new Map<string, HostedPlugin>();
  private senders = new Map<number, HostedPlugin>();
  private broker?: CapabilityBroker;
  private transitions = new Map<string, Promise<void>>();
  private readonly healthTimer: NodeJS.Timeout;
  constructor(
    private readonly root: string,
    readonly userDirectory: string,
    private readonly dataDirectory: string,
    private readonly settings: JsonStore<AppSettings>,
    private readonly overlay: OverlayRegistry,
    private readonly logger: Logger,
    private readonly changed: () => void,
  ) {
    ipcMain.handle(IPC.pluginReady, (event) => this.sender(event).manifest);
    ipcMain.handle(IPC.pluginCall, async (event, input: unknown) => {
      const plugin = this.sender(event);
      if (Date.now() - plugin.rateReset >= 1000) {
        plugin.calls = 0;
        plugin.rateReset = Date.now();
      }
      if (++plugin.calls > 60) throw new Error('Plugin capability rate limit exceeded');
      if (JSON.stringify(input).length > 250000) throw new Error('Plugin message is too large');
      const request = pluginCallSchema.parse(input);
      return this.broker?.handle(
        { manifest: plugin.manifest, grants: plugin.granted, storage: plugin.storage },
        request,
      );
    });
    ipcMain.on(IPC.pluginHealth, (event, input: unknown) => {
      let plugin: HostedPlugin;
      try {
        plugin = this.sender(event);
      } catch {
        return;
      }
      const parsed = z
        .object({
          status: z.enum(['enabled', 'stopped', 'heartbeat', 'error']),
          error: z.string().max(2000).optional(),
        })
        .safeParse(input);
      if (!parsed.success) return;
      const health = parsed.data;
      plugin.heartbeat = Date.now();
      if (health.status === 'enabled') {
        plugin.status = 'enabled';
        plugin.started?.();
        this.changed();
      }
      if (health.status === 'stopped') plugin.stopped?.();
      if (health.status === 'error') this.crash(plugin, health.error ?? 'Plugin crashed');
    });
    this.healthTimer = setInterval(() => {
      for (const plugin of this.plugins.values()) {
        if (plugin.status !== 'enabled' || !plugin.window) continue;
        if (Date.now() - plugin.heartbeat > 15000) this.crash(plugin, 'Plugin stopped responding');
        else plugin.window.webContents.send(IPC.pluginLifecycle, 'ping');
      }
    }, 5000);
  }
  attachBroker(broker: CapabilityBroker): void {
    this.broker = broker;
  }
  private sender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): HostedPlugin {
    const plugin = this.senders.get(event.sender.id);
    if (
      !plugin ||
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame?.url.startsWith('ytm-plugin://host/runtime/') ||
      !['starting', 'enabled'].includes(plugin.status)
    )
      throw new Error('Untrusted plugin sender');
    return plugin;
  }
  list(): PluginInfo[] {
    const order = [
      'lyrics',
      'listen-together',
      'discord-presence',
      'themes',
      'custom-css',
      'ad-blocker',
      'crossfade',
      'example-plugin',
    ];
    return [...this.plugins.values()]
      .sort(
        (a, b) =>
          (order.indexOf(a.manifest.id) < 0 ? 100 : order.indexOf(a.manifest.id)) -
          (order.indexOf(b.manifest.id) < 0 ? 100 : order.indexOf(b.manifest.id)),
      )
      .map(({ manifest, builtin, status, error, granted }) => ({
        manifest,
        builtin,
        status,
        error,
        granted,
      }));
  }
  directory(id: string): string {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error('Unknown plugin');
    return plugin.directory;
  }
  async scan(): Promise<void> {
    for (const [directory, builtin] of [
      [join(this.root, 'plugins'), true],
      [this.userDirectory, false],
    ] as const) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        try {
          const packageDirectory = join(directory, entry.name);
          const manifest = validateManifest(
            JSON.parse(await readFile(join(packageDirectory, 'manifest.json'), 'utf8')),
          );
          if (this.plugins.has(manifest.id)) {
            if (this.plugins.get(manifest.id)?.directory !== packageDirectory)
              this.logger.log(
                'plugin-manager',
                `Duplicate plugin ID: ${manifest.id}`,
                undefined,
                'error',
              );
            continue;
          }
          const stored = this.settings.get().plugins[manifest.id];
          const granted = builtin
            ? manifest.permissions
            : manifest.permissions.filter(
                (permission) =>
                  stored?.manifestDigest === manifestDigest(manifest) &&
                  stored.grants.includes(permission),
              );
          const storage = new PluginStorage(join(this.dataDirectory, `${manifest.id}.json`));
          await storage.load();
          this.plugins.set(manifest.id, {
            manifest,
            builtin,
            granted,
            storage,
            directory: packageDirectory,
            status: 'disabled',
            heartbeat: Date.now(),
            rateReset: Date.now(),
            calls: 0,
          });
        } catch (error) {
          this.logger.log(
            'plugin-manager',
            `Cannot load ${entry.name}: ${String(error)}`,
            undefined,
            'error',
          );
        }
      }
    }
    this.changed();
  }
  async startDefaults(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      const preference = this.settings.get().plugins[plugin.manifest.id];
      if (
        preference?.enabled ??
        (plugin.builtin && !['discord-presence', 'example-plugin'].includes(plugin.manifest.id))
      )
        await this.enable(plugin.manifest.id).catch(() => {});
    }
  }
  private transition(id: string, operation: () => Promise<void>): Promise<void> {
    const pending = (this.transitions.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.transitions.set(id, pending);
    void pending
      .finally(() => {
        if (this.transitions.get(id) === pending) this.transitions.delete(id);
      })
      .catch(() => {});
    return pending;
  }
  enable(id: string): Promise<void> {
    return this.transition(id, () => this.enableNow(id));
  }
  private async enableNow(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error('Unknown plugin');
    if (plugin.status === 'enabled' || plugin.status === 'starting') return;
    const currentManifest = validateManifest(
      JSON.parse(await readFile(join(plugin.directory, 'manifest.json'), 'utf8')),
    );
    if (currentManifest.id !== id) throw new Error('Plugin ID cannot change during reload');
    if (manifestDigest(currentManifest) !== manifestDigest(plugin.manifest) && !plugin.builtin)
      plugin.granted = [];
    plugin.manifest = currentManifest;
    if (plugin.manifest.permissions.some((permission) => !plugin.granted.includes(permission)))
      throw new Error('Approve all declared permissions before enabling this plugin');
    const entryPath = await realpath(join(plugin.directory, plugin.manifest.main));
    if (
      !entryPath.startsWith(`${resolve(plugin.directory)}${sep}`) ||
      !(await stat(entryPath)).isFile()
    )
      throw new Error('Invalid plugin entry point');
    plugin.error = undefined;
    plugin.status = 'starting';
    plugin.heartbeat = Date.now();
    const window = createPluginWindow(this.root, plugin.directory, id, this.logger, (message) =>
      this.crash(plugin, message),
    );
    plugin.window = window;
    this.senders.set(window.webContents.id, plugin);
    const ready = new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => this.crash(plugin, 'Plugin activation timed out'), 10000);
      plugin.started = () => {
        clearTimeout(timer);
        resolveReady();
      };
      plugin.failed = (error) => {
        clearTimeout(timer);
        rejectReady(error);
      };
    });
    this.changed();
    await window
      .loadURL('ytm-plugin://host/runtime/index.html')
      .catch((error) => this.crash(plugin, String(error)));
    await ready;
    await this.persist(plugin, true);
    this.watchPlugin(plugin);
  }
  private async persist(plugin: HostedPlugin, enabled: boolean): Promise<void> {
    await this.settings.update((settings) => {
      settings.plugins[plugin.manifest.id] = {
        enabled,
        grants: plugin.granted,
        manifestDigest: manifestDigest(plugin.manifest),
      };
      return settings;
    });
  }
  private crash(plugin: HostedPlugin, message: string): void {
    if (plugin.status === 'error' || plugin.status === 'disabled') return;
    plugin.status = 'error';
    plugin.error = message;
    plugin.failed?.(new Error(message));
    this.logger.log('plugins', message, plugin.manifest.id, 'error');
    this.destroy(plugin);
    this.overlay.toast(`${plugin.manifest.name} crashed. Reload or disable it in Plugins.`);
    this.changed();
  }
  private destroy(plugin: HostedPlugin): void {
    if (plugin.window) {
      this.senders.delete(plugin.window.webContents.id);
      plugin.window.destroy();
      plugin.window = undefined;
    }
    plugin.watcher?.close();
    plugin.watcher = undefined;
    clearTimeout(plugin.reloadTimer);
    this.overlay.remove(plugin.manifest.id);
    this.onDestroyed(plugin.manifest.id);
  }
  onDestroyed: (id: string) => void = () => {};
  disable(id: string): Promise<void> {
    return this.transition(id, () => this.disableNow(id));
  }
  private async disableNow(id: string, persist = true): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error('Unknown plugin');
    if (plugin.window && plugin.status === 'enabled') {
      await new Promise<void>((resolveStopped) => {
        const timer = setTimeout(resolveStopped, 1000);
        plugin.stopped = () => {
          clearTimeout(timer);
          resolveStopped();
        };
        plugin.window!.webContents.send(IPC.pluginLifecycle, 'stop');
      });
    }
    plugin.status = 'disabled';
    plugin.error = undefined;
    this.destroy(plugin);
    if (persist) await this.persist(plugin, false);
    this.changed();
  }
  reload(id: string): Promise<void> {
    return this.transition(id, async () => {
      await this.disableNow(id);
      await this.enableNow(id);
    });
  }
  async reloadAll(): Promise<void> {
    for (const plugin of this.plugins.values())
      if (plugin.status !== 'disabled') await this.reload(plugin.manifest.id).catch(() => {});
  }
  async forget(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (plugin?.builtin) throw new Error('Built-in plugins can be disabled');
    await this.disable(id);
    this.plugins.delete(id);
    this.changed();
  }
  approve(manifest: PluginManifest): void {
    const plugin = this.plugins.get(manifest.id);
    if (plugin) plugin.granted = manifest.permissions;
  }
  async refresh(id: string): Promise<PluginInfo> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error('Unknown plugin');
    const manifest = validateManifest(
      JSON.parse(await readFile(join(plugin.directory, 'manifest.json'), 'utf8')),
    );
    if (manifest.id !== id) throw new Error('Plugin ID cannot change');
    if (!plugin.builtin && manifestDigest(manifest) !== manifestDigest(plugin.manifest))
      plugin.granted = [];
    plugin.manifest = manifest;
    this.changed();
    return this.list().find((value) => value.manifest.id === id)!;
  }
  settingsChanged(settings: AppSettings): void {
    for (const plugin of this.plugins.values()) {
      if (plugin.granted.includes('settings.read'))
        this.event(plugin.manifest.id, 'settingsChanged', { ...settings, plugins: {} });
      plugin.watcher?.close();
      plugin.watcher = undefined;
      if (plugin.status === 'enabled') this.watchPlugin(plugin);
    }
  }
  async verifyIsolation(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin?.window) throw new Error('Plugin not running');
    const result = (await plugin.window.webContents.executeJavaScript(
      '({require: typeof require, process: typeof process, electron: typeof electron})',
    )) as Record<string, string>;
    if (Object.values(result).some((value) => value !== 'undefined'))
      throw new Error('Node/Electron leaked into plugin renderer');
    if (!plugin.granted.includes('network')) {
      const denied = await plugin.window.webContents.executeJavaScript(
        'window.pluginBridge.call({type: "network.fetch", url: "https://example.com"}).then(() => false, () => true)',
      );
      if (!denied) throw new Error('Missing network permission was not enforced');
    }
    const blocked = await plugin.window.webContents.executeJavaScript(
      'fetch("https://example.com").then(() => false, () => true)',
    );
    if (!blocked) throw new Error('Direct plugin networking escaped CSP');
  }
  inspect(id: string): void {
    if (!this.settings.get().developer.enabled) throw new Error('Enable Developer Mode first');
    this.plugins.get(id)?.window?.webContents.openDevTools({ mode: 'detach' });
  }
  action(id: string, action: string, value?: string | number | boolean): void {
    const plugin = this.plugins.get(id);
    if (plugin?.status === 'enabled')
      plugin.window?.webContents.send(IPC.pluginAction, action, value);
  }
  event(id: string, name: string, value: unknown): void {
    const plugin = this.plugins.get(id);
    if (plugin?.status === 'enabled') plugin.window?.webContents.send(IPC.pluginEvent, name, value);
  }
  bindMusic(music: MusicContext): void {
    for (const name of [
      'trackChanged',
      'playbackStarted',
      'playbackPaused',
      'playbackStopped',
      'positionChanged',
      'volumeChanged',
      'queueChanged',
      'navigationChanged',
      'likeStateChanged',
      'stateChanged',
    ] as const) {
      music.on(name, (value) => {
        for (const plugin of this.plugins.values()) {
          const permission: Permission = name === 'queueChanged' ? 'queue.read' : 'player.read';
          if (!plugin.granted.includes(permission)) continue;
          if (name === 'stateChanged' && !plugin.granted.includes('queue.read'))
            this.event(plugin.manifest.id, name, { ...music.getState(), queue: [] });
          else this.event(plugin.manifest.id, name, value);
        }
      });
    }
  }
  private watchPlugin(plugin: HostedPlugin): void {
    if (plugin.builtin && plugin.directory.includes(`.asar${sep}`)) return;
    if (!this.settings.get().developer.enabled || !this.settings.get().developer.watchPlugins)
      return;
    plugin.watcher = watch(plugin.directory, { recursive: true }, () => {
      clearTimeout(plugin.reloadTimer);
      plugin.reloadTimer = setTimeout(
        () =>
          void this.reload(plugin.manifest.id).catch((error) =>
            this.logger.log('plugin-manager', String(error), plugin.manifest.id, 'error'),
          ),
        400,
      );
    });
  }
  async shutdown(): Promise<void> {
    clearInterval(this.healthTimer);
    await Promise.all(
      [...this.plugins.keys()].map((id) => this.transition(id, () => this.disableNow(id, false))),
    );
  }
}
