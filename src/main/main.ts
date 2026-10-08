import { app, globalShortcut, Menu, Notification } from 'electron';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DesktopWindow } from './windows/desktop-window';
import { registerAppScheme, serveApp } from './windows/protocol';
import { JsonStore } from './settings/json-store';
import { settingsSchema, migrateSettings } from '../shared/types/settings';
import { MusicContext } from './music/context';
import { PlayerService } from './music/player-service';
import { IPC } from '../shared/constants/ipc';
import { Logger } from './logging/logger';
import { createTray } from './tray/tray';
import { PluginHost } from './plugins/plugin-host';
import { CapabilityBroker } from './plugins/capability-broker';
import { OverlayRegistry } from './plugins/overlay-registry';
import { PluginInstaller } from './plugins/plugin-installer';
import { appearanceCSS } from './settings/appearance';
import { matchesShortcut } from './windows/shortcuts';
import type { AppSnapshot } from '../shared/types/bridge';
import { RoomService } from './networking/room-service';
import { DiscordRPC } from './presence/discord-rpc';
import { ThemeService } from './settings/theme-service';
import { UpdateService } from './updater/updater';
import { registerIPC } from './ipc/app-router';
import { runElectronSmoke } from '../../tests/electron/smoke';
import { AdBlockService } from './blocking/ad-block-service';
import { runFeatureSmoke } from '../../tests/electron/feature-smoke';
import { runLivePlayback } from '../../tests/electron/live-playback';
import { CrossfadeService } from './music/crossfade-service';
import { runCrossfadeSmoke } from '../../tests/electron/crossfade-smoke';
import { runAdblockSmoke } from '../../tests/electron/adblock-smoke';
import { runRoomPeer, runRoomsSmoke } from '../../tests/electron/rooms-smoke';

registerAppScheme();
if (process.argv.includes('--safe-renderer')) app.disableHardwareAcceleration();
const smoke = process.argv.includes('--smoke-test');
const roomPeerCode = smoke
  ? process.argv.find((value) => value.startsWith('--rooms-peer='))?.slice('--rooms-peer='.length)
  : undefined;
if (smoke) app.setPath('userData', resolve('.smoke-data', ...(roomPeerCode ? ['room-peer'] : [])));
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.ytmusicplus.desktop');
      const root = resolve(__dirname, '..');
      serveApp(root);
      const logger = new Logger(join(app.getPath('userData'), 'logs'));
      const settings = new JsonStore(
        join(app.getPath('userData'), 'settings.json'),
        migrateSettings,
        settingsSchema.parse({}),
      );
      try {
        await settings.load();
      } catch (error) {
        logger.log('application', String(error), undefined, 'error');
        throw error;
      }
      if (process.argv.includes('--development')) {
        const next = settings.get();
        next.developer.enabled = true;
        await settings.set(next);
      }
      const music = new MusicContext();
      const desktop = new DesktopWindow(root, () => settings.get().general.closeToTray);
      const player = new PlayerService(desktop.music.webContents);
      let status = 'Connecting to YouTube Music';
      let plugins: PluginHost;
      let css = '';
      let previousSettings = '';
      let nativeLyricsSignature = '';
      let volumeSignature = '';
      let crossfade: CrossfadeService | undefined;
      const overlay = new OverlayRegistry(() => broadcast());
      const snapshot = (): AppSnapshot => ({
        settings: settings.get(),
        music: music.getState(),
        account: desktop.account,
        status,
        plugins: plugins?.list() ?? [],
        overlay: overlay.get(),
        logs: settings.get().developer.enabled ? logger.entries.slice(-100) : [],
      });
      const broadcast = () => {
        if (desktop.window.isDestroyed()) return;
        const serializedSettings = JSON.stringify(settings.get());
        if (previousSettings !== serializedSettings) {
          previousSettings = serializedSettings;
          plugins?.settingsChanged(settings.get());
        }
        const nextCSS = appearanceCSS(settings.get(), [...overlay.styles.values()]);
        if (css !== nextCSS) {
          css = nextCSS;
          desktop.music.webContents.send(IPC.musicStyle, css);
        }
        desktop.window.setOpacity(settings.get().appearance.transparency);
        const ui = overlay.get();
        desktop.setSidebar(
          ui.activeView === 'music' && ui.contributions.some((value) => value.slot === 'sidebar'),
        );
        const activePanel = ui.panels.find(
          (value) => `${value.pluginId}:${value.id}` === ui.activePanel,
        );
        desktop.setMode(
          ui.activeView === 'music'
            ? activePanel?.kind === 'modal'
              ? 'full'
              : ui.activePanel && activePanel?.placement !== 'native-lyrics'
                ? 'panel'
                : 'none'
            : 'full',
        );
        desktop.send(snapshot());
        const volume = {
          volume: settings.get().playback.volume,
          muted: settings.get().playback.muted,
        };
        const nextVolumeSignature = JSON.stringify(volume);
        if (nextVolumeSignature !== volumeSignature) {
          volumeSignature = nextVolumeSignature;
          desktop.music.webContents.send(IPC.musicVolume, volume);
          crossfade?.volume();
        }
        const lyrics = ui.panels.find((value) => value.placement === 'native-lyrics');
        const nativeLyrics = {
          panel: lyrics ?? null,
          open: activePanel?.placement === 'native-lyrics',
        };
        const nextLyricsSignature = JSON.stringify(nativeLyrics);
        if (nextLyricsSignature !== nativeLyricsSignature) {
          nativeLyricsSignature = nextLyricsSignature;
          desktop.music.webContents.send(IPC.nativeLyrics, nativeLyrics);
        }
      };
      const pluginsDirectory = join(app.getPath('userData'), 'plugins');
      await mkdir(pluginsDirectory, { recursive: true });
      plugins = new PluginHost(
        root,
        pluginsDirectory,
        join(app.getPath('userData'), 'plugin-data'),
        settings,
        overlay,
        logger,
        broadcast,
      );
      const rooms = new RoomService(() => settings.get(), logger);
      crossfade = new CrossfadeService(
        root,
        desktop.music.webContents,
        player,
        music,
        () => settings.get().playback,
      );
      const blocker = new AdBlockService(
        desktop.music.webContents.session,
        root,
        join(app.getPath('userData'), 'adblock'),
      );
      desktop.onStatus = (message) => {
        status = message;
        logger.log('youtube-integration', message);
        broadcast();
      };
      const presence = new Map<string, DiscordRPC>();
      const themes = new ThemeService(
        join(app.getPath('userData'), 'themes'),
        settings,
        desktop.window,
        broadcast,
      );
      const updater = new UpdateService(desktop.window, logger, (text) => overlay.toast(text));
      const broker = new CapabilityBroker(
        music,
        player,
        settings,
        overlay,
        logger,
        desktop.window,
        {
          roomSend: (id, message, callback) => rooms.send(id, message, callback),
          roomDisconnect: (id) => rooms.disconnect(id),
          presence: async (id, clientId, activity) => {
            let rpc = presence.get(id);
            if (!rpc) {
              rpc = new DiscordRPC();
              presence.set(id, rpc);
            }
            await rpc.set(clientId, activity);
          },
          themesList: () => themes.list(),
          themesSelect: (id) => themes.select(id),
          themesImport: () => themes.importPackage(),
          blockingStatus: (id) => blocker.status(id),
          blockingEnable: (id, enabled) => blocker.enable(id, enabled),
          blockingUpdate: (id) => blocker.update(id),
          crossfadeStatus: (id) => crossfade!.status(id),
          crossfadeConfigure: (id, value) => crossfade!.configure(id, value),
        },
        broadcast,
        (id, name, value) => plugins.event(id, name, value),
      );
      plugins.attachBroker(broker);
      plugins.bindMusic(music);
      plugins.onDestroyed = (id) => {
        crossfade!.remove(id);
        blocker.remove(id);
        rooms.disconnect(id);
        presence.get(id)?.close();
        presence.delete(id);
      };
      const installer = new PluginInstaller(pluginsDirectory);
      const executeCommand = async (id: string) => {
        if (id === 'app.palette') {
          overlay.view('palette');
          return;
        }
        if (id === 'app.plugins') {
          overlay.view('plugins');
          return;
        }
        if (id === 'app.settings') {
          overlay.view('settings');
          return;
        }
        if (id === 'app.reloadPlugins') {
          await plugins.reloadAll();
          return;
        }
        const contribution = overlay.get().contributions.find((value) => value.id === id);
        if (!contribution) throw new Error('Command unavailable; enable its plugin first');
        plugins.action(contribution.pluginId, contribution.action);
      };
      desktop.onShortcut = (input) => {
        if (
          input.type === 'keyDown' &&
          input.key === 'Escape' &&
          (overlay.get().activeView !== 'music' || overlay.get().activePanel)
        ) {
          overlay.view('music');
          return true;
        }
        if (settings.get().developer.enabled && matchesShortcut(input, 'Ctrl+Shift+R')) {
          void plugins.reloadAll();
          return true;
        }
        const bindings = {
          ...Object.fromEntries(
            overlay
              .get()
              .contributions.filter((value) => value.shortcut)
              .map((value) => [value.id, value.shortcut!]),
          ),
          ...settings.get().shortcuts,
        };
        for (const [id, shortcut] of Object.entries(bindings))
          if (shortcut && matchesShortcut(input, shortcut)) {
            void executeCommand(id).catch((error) => overlay.toast(String(error)));
            return true;
          }
        return false;
      };
      registerIPC({
        desktop,
        settings,
        music,
        player,
        plugins,
        overlay,
        installer,
        logger,
        updater,
        themes,
        snapshot,
        executeCommand,
        broadcast,
        settingsChanged: () => {
          updateMediaKeys();
          updateMenu();
        },
      });
      desktop.music.webContents.on('did-finish-load', () => {
        status = 'YouTube Music';
        css = '';
        nativeLyricsSignature = '';
        volumeSignature = '';
        broadcast();
      });
      desktop.music.webContents.on(
        'did-fail-load',
        (_event, code, description, _url, mainFrame) => {
          if (mainFrame && code !== -3) {
            status = `Unable to load YouTube Music: ${description}`;
            broadcast();
          }
        },
      );
      music.on('stateChanged', broadcast);
      const command = (type: 'togglePlay' | 'next' | 'previous') =>
        void player
          .command({ type })
          .catch((error) => logger.log('youtube-integration', String(error), undefined, 'error'));
      const tray = createTray(root, {
        show: () => desktop.show(),
        toggle: () => command('togglePlay'),
        next: () => command('next'),
        quit: () => {
          desktop.quit();
          app.quit();
        },
      });
      const updateMediaKeys = () => {
        globalShortcut.unregisterAll();
        if (!settings.get().playback.mediaKeys) return;
        for (const [key, type] of [
          ['MediaPlayPause', 'togglePlay'],
          ['MediaNextTrack', 'next'],
          ['MediaPreviousTrack', 'previous'],
        ] as const)
          globalShortcut.register(key, () => command(type));
      };
      const updateMenu = () =>
        Menu.setApplicationMenu(
          Menu.buildFromTemplate([
            {
              label: 'YTMusic+',
              submenu: [
                { label: 'Settings', click: () => overlay.view('settings') },
                { label: 'Plugins', click: () => overlay.view('plugins') },
                { label: 'Quit', click: () => app.quit() },
              ],
            },
            ...(settings.get().developer.enabled
              ? [
                  {
                    label: 'Developer',
                    submenu: [
                      {
                        label: 'Reload YouTube Music',
                        click: () => desktop.music.webContents.reload(),
                      },
                      {
                        label: 'Reload Plugins',
                        accelerator: 'CommandOrControl+Shift+R',
                        click: () => void plugins.reloadAll(),
                      },
                      {
                        label: 'Plugin Inspector / MusicContext',
                        click: () => overlay.view('debug'),
                      },
                      {
                        label: 'Open DevTools',
                        click: () => desktop.window.webContents.openDevTools({ mode: 'detach' }),
                      },
                    ],
                  },
                ]
              : []),
          ]),
        );
      updateMediaKeys();
      updateMenu();
      music.on('trackChanged', (track) => {
        if (
          track &&
          settings.get().notifications.trackChanges &&
          settings.get().notifications.enabled &&
          Notification.isSupported()
        )
          new Notification({ title: track.title, body: track.artist }).show();
      });
      app.on('second-instance', () => desktop.show());
      app.on('activate', () => desktop.show());
      let shuttingDown = false;
      let shutdownComplete = false;
      app.on('before-quit', (event) => {
        if (shutdownComplete) return;
        event.preventDefault();
        if (shuttingDown) return;
        shuttingDown = true;
        void (async () => {
          try {
            await plugins.shutdown();
            await rooms.close();
          } catch (error) {
            logger.log('application', String(error), undefined, 'error');
          } finally {
            crossfade?.dispose();
            blocker.close();
            tray.destroy();
            globalShortcut.unregisterAll();
            player.dispose();
            shutdownComplete = true;
            if (!desktop.window.isDestroyed()) desktop.quit();
            app.quit();
          }
        })();
      });
      await desktop.load();
      await plugins.scan();
      await plugins.startDefaults();
      broadcast();
      desktop.loadMusic();
      logger.log('application', 'YTMusic+ started');
      if (smoke) {
        if (roomPeerCode) {
          await runRoomPeer(desktop, music, plugins, overlay, roomPeerCode);
          return;
        }
        if (process.argv.includes('--rooms-only')) {
          await runRoomsSmoke(desktop, music, plugins, overlay);
          app.quit();
          return;
        }
        if (process.argv.includes('--adblock-only')) {
          desktop.window.show();
          await runAdblockSmoke(desktop, blocker, plugins, music);
          app.quit();
          return;
        }
        if (process.argv.includes('--crossfade-only')) {
          desktop.window.show();
          desktop.music.webContents.setAudioMuted(true);
          await desktop.music.webContents.loadURL('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
          for (let attempt = 0; attempt < 100; attempt++) {
            const state = music.getState();
            if (
              state.playing &&
              state.track?.videoId === 'dQw4w9WgXcQ' &&
              state.track.duration > 100
            )
              break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          await runCrossfadeSmoke(desktop, crossfade, music, plugins, overlay);
          app.quit();
          return;
        }
        if (process.argv.includes('--safe-renderer')) {
          if (app.isHardwareAccelerationEnabled())
            throw new Error('Software rendering flag was ignored');
          console.log('SAFE_RENDERER_OK: hardware acceleration disabled');
        }
        await runElectronSmoke(
          desktop,
          plugins,
          overlay,
          join(app.getPath('userData'), 'screenshots'),
        );
        await runLivePlayback(
          desktop,
          music,
          overlay,
          join(app.getPath('userData'), 'screenshots'),
        );
        await runCrossfadeSmoke(desktop, crossfade, music, plugins, overlay);
        await runFeatureSmoke(
          desktop,
          plugins,
          blocker,
          overlay,
          join(app.getPath('userData'), 'screenshots'),
        );
        await runAdblockSmoke(desktop, blocker, plugins, music);
        app.quit();
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
app.on('window-all-closed', () => app.quit());
