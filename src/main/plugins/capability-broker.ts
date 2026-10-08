import { clipboard, dialog, Notification, type BrowserWindow } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { JsonStore } from '../settings/json-store';
import { settingsSchema, type AppSettings } from '../../shared/types/settings';
import { requirePermission, type PluginManifest } from '../../shared/types/plugin';
import type { PluginCall } from '../../shared/types/plugin-rpc';
import type { MusicContext } from '../music/context';
import type { PlayerService } from '../music/player-service';
import type { PluginStorage, JsonValue } from './plugin-storage';
import type { OverlayRegistry } from './overlay-registry';
import type { Logger } from '../logging/logger';
import { pluginFetch } from './network';
import type { RoomClientMessage, RoomSnapshot } from '../../shared/types/rooms';
import type { PresenceActivity } from '../../../plugin-sdk/index';
import { shortcutConflicts } from '../windows/shortcuts';
import type { BlockingStatus } from '../../shared/types/blocking';
import type { CrossfadeConfig, CrossfadeStatus } from '../../shared/types/crossfade';

export interface PluginCapabilities {
  manifest: PluginManifest;
  grants: string[];
  storage: PluginStorage;
}
export interface NativeServices {
  presence(id: string, clientId: string, activity: PresenceActivity | null): Promise<void>;
  roomSend(
    id: string,
    message: RoomClientMessage,
    callback: (snapshot: RoomSnapshot) => void,
  ): Promise<void>;
  roomDisconnect(id: string): void;
  themesList(): Promise<{ id: string; name: string }[]>;
  themesSelect(id: string): Promise<void>;
  themesImport(): Promise<void>;
  blockingStatus(id: string): BlockingStatus;
  blockingEnable(id: string, enabled: boolean): Promise<BlockingStatus>;
  blockingUpdate(id: string): Promise<BlockingStatus>;
  crossfadeStatus(id: string): CrossfadeStatus;
  crossfadeConfigure(id: string, value: CrossfadeConfig): CrossfadeStatus;
}
export class CapabilityBroker {
  constructor(
    private readonly music: MusicContext,
    private readonly player: PlayerService,
    private readonly settings: JsonStore<AppSettings>,
    private readonly overlay: OverlayRegistry,
    private readonly logger: Logger,
    private readonly window: BrowserWindow,
    private readonly native: Partial<NativeServices>,
    private readonly changed: () => void,
    private readonly sendEvent: (id: string, name: string, payload: unknown) => void,
  ) {}

  async handle(plugin: PluginCapabilities, request: PluginCall): Promise<unknown> {
    const { manifest, grants, storage } = plugin;
    const require = (permission: Parameters<typeof requirePermission>[2]) =>
      requirePermission(manifest, grants, permission);
    switch (request.type) {
      case 'player.state': {
        require('player.read');
        const state = this.music.getState();
        if (!grants.includes('queue.read')) state.queue = [];
        return state;
      }
      case 'player.command':
        require('player.control');
        return this.player.command(request.command);
      case 'queue.read':
        require('queue.read');
        return this.music.getState().queue;
      case 'queue.play':
        require('queue.modify');
        return this.player.command({ type: 'playQueueItem', index: request.index });
      case 'storage.get':
        require('settings.read');
        return storage.get(request.key);
      case 'storage.set':
        require('settings.write');
        return storage.set(request.key, request.value as JsonValue);
      case 'storage.remove':
        require('settings.write');
        return storage.set(request.key, undefined);
      case 'settings.read': {
        require('settings.read');
        const settings = this.settings.get();
        settings.plugins = {};
        return settings;
      }
      case 'settings.appearance': {
        require('settings.write');
        require('ui.inject');
        await this.settings.update((settings) =>
          settingsSchema.parse({
            ...settings,
            appearance: { ...settings.appearance, ...request.value },
          }),
        );
        this.changed();
        return;
      }
      case 'ui.panel':
        require(
          request.panel.kind === 'overlay' || request.panel.placement === 'native-lyrics'
            ? 'ui.inject'
            : 'ui.overlay',
        );
        this.overlay.panel({
          ...request.panel,
          kind: request.panel.kind ?? 'panel',
          pluginId: manifest.id,
        });
        return;
      case 'ui.contribution': {
        require(
          request.contribution.slot === 'sidebar' || request.contribution.slot === 'player'
            ? 'ui.inject'
            : 'ui.overlay',
        );
        if (request.contribution.id.startsWith('app.'))
          throw new Error('The app. command namespace is reserved');
        const existing = this.overlay.get().contributions;
        if (
          existing.some(
            (value) => value.id === request.contribution.id && value.pluginId !== manifest.id,
          )
        )
          throw new Error('Contribution ID already registered by another plugin');
        const shortcuts = {
          ...Object.fromEntries(
            existing
              .filter((value) => value.shortcut && value.id !== request.contribution.id)
              .map((value) => [value.id, value.shortcut!]),
          ),
          ...(request.contribution.shortcut
            ? { [request.contribution.id]: request.contribution.shortcut }
            : {}),
          ...this.settings.get().shortcuts,
        };
        const conflicts = shortcutConflicts(shortcuts);
        if (conflicts.length) this.overlay.toast(`Shortcut conflict: ${conflicts.join('; ')}`);
        this.overlay.contribution({ ...request.contribution, pluginId: manifest.id });
        return;
      }
      case 'ui.open':
        require('ui.overlay');
        this.overlay.open(manifest.id, request.id);
        return;
      case 'ui.remove':
        this.overlay.remove(manifest.id, request.id);
        return;
      case 'ui.toast':
        require('ui.overlay');
        this.overlay.toast(request.text);
        return;
      case 'ui.css':
        require('ui.inject');
        this.overlay.styles.set(manifest.id, request.css);
        this.changed();
        return;
      case 'network.fetch':
        require('network');
        return pluginFetch(manifest.networkDomains, request.url, request.options);
      case 'notification':
        require('notifications');
        if (this.settings.get().notifications.enabled && Notification.isSupported())
          new Notification({ title: request.title, body: request.body }).show();
        return;
      case 'clipboard':
        require('clipboard');
        clipboard.writeText(request.text);
        return;
      case 'filesystem.import': {
        require('filesystem');
        const selection = await dialog.showOpenDialog(this.window, {
          title: `${manifest.name}: import text`,
          properties: ['openFile'],
          filters: [{ name: 'Text files', extensions: request.extensions }],
        });
        const path = selection.filePaths[0];
        if (!path || selection.canceled) return null;
        if ((await stat(path)).size > 1_000_000)
          throw new Error('Import must be smaller than 1 MB');
        return { name: basename(path), text: await readFile(path, 'utf8') };
      }
      case 'presence':
        require('presence');
        if (!this.native.presence) throw new Error('Presence is unavailable on this host');
        return this.native.presence(manifest.id, request.clientId, request.activity);
      case 'rooms.send':
        require('rooms');
        if (!this.native.roomSend) throw new Error('Rooms are unavailable on this host');
        return this.native.roomSend(manifest.id, request.message, (snapshot) =>
          this.sendEvent(manifest.id, 'roomUpdated', snapshot),
        );
      case 'rooms.disconnect':
        require('rooms');
        this.native.roomDisconnect?.(manifest.id);
        return;
      case 'blocking.status':
        require('web.blocking');
        return this.native.blockingStatus?.(manifest.id);
      case 'blocking.enable':
        require('web.blocking');
        return this.native.blockingEnable?.(manifest.id, request.enabled);
      case 'blocking.update':
        require('web.blocking');
        return this.native.blockingUpdate?.(manifest.id);
      case 'crossfade.status':
        require('audio.crossfade');
        return this.native.crossfadeStatus?.(manifest.id);
      case 'crossfade.configure':
        require('audio.crossfade');
        require('player.control');
        if (!this.native.crossfadeConfigure)
          throw new Error('Crossfade is unavailable on this host');
        return this.native.crossfadeConfigure(manifest.id, request.value);
      case 'themes.list':
        require('ui.inject');
        return this.native.themesList?.() ?? [];
      case 'themes.select':
        require('ui.inject');
        return this.native.themesSelect?.(request.id);
      case 'themes.import':
        require('filesystem');
        require('ui.inject');
        return this.native.themesImport?.();
      case 'log':
        this.logger.log('plugins', request.message, manifest.id);
        return;
    }
  }
}
