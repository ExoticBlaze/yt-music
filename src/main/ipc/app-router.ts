import { handlePluginActions } from './plugin-actions';
import { handleDeveloperActions } from './developer-actions';
import { app, ipcMain } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/constants/ipc';
import { playbackSchema, playerCommandSchema } from '../../shared/types/music';
import { settingsSchema } from '../../shared/types/settings';
import { shortcutConflicts } from '../windows/shortcuts';
import { appRequestSchema } from './schemas';
import type { AppServices } from './context';

export function registerIPC(services: AppServices): void {
  const {
    desktop,
    settings,
    music,
    player,
    plugins,
    overlay,
    snapshot,
    executeCommand,
    broadcast,
    settingsChanged,
  } = services;
  const trusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, id: number) =>
    event.sender.id === id && event.senderFrame === event.sender.mainFrame;
  ipcMain.on(IPC.musicState, (event, input) => {
    if (
      !trusted(event, desktop.music.webContents.id) ||
      event.senderFrame?.url.startsWith('https://music.youtube.com/') !== true
    )
      return;
    const parsed = playbackSchema.safeParse(input);
    if (parsed.success) music.update(parsed.data);
  });
  ipcMain.on(IPC.accountState, (event, input) => {
    if (
      !trusted(event, desktop.music.webContents.id) ||
      !event.senderFrame?.url.startsWith('https://music.youtube.com/')
    )
      return;
    const parsed = z.enum(['unknown', 'signedIn', 'signedOut']).safeParse(input);
    if (parsed.success && parsed.data !== 'unknown' && parsed.data !== desktop.account) {
      desktop.account = parsed.data;
      broadcast();
    }
  });
  ipcMain.on(IPC.volumePreference, (event, input) => {
    if (
      !trusted(event, desktop.music.webContents.id) ||
      !event.senderFrame?.url.startsWith('https://music.youtube.com/')
    )
      return;
    const parsed = z
      .object({ volume: z.number().min(0).max(1), muted: z.boolean() })
      .safeParse(input);
    if (!parsed.success) return;
    void settings
      .update((current) => ({ ...current, playback: { ...current.playback, ...parsed.data } }))
      .then(broadcast)
      .catch((error) =>
        services.logger.log('youtube-integration', String(error), undefined, 'error'),
      );
  });
  ipcMain.on(IPC.nativeLyricsAction, (event, input) => {
    if (
      !trusted(event, desktop.music.webContents.id) ||
      !event.senderFrame?.url.startsWith('https://music.youtube.com/')
    )
      return;
    const parsed = z
      .object({
        pluginId: z.string(),
        action: z.string().max(150),
        value: z.union([z.string().max(100000), z.number().finite(), z.boolean()]).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return;
    const { pluginId, action, value } = parsed.data;
    const panel = overlay
      .get()
      .panels.find((item) => item.pluginId === pluginId && item.placement === 'native-lyrics');
    if (
      panel?.nodes.some(
        (node) =>
          ('action' in node && node.action === action) ||
          (node.type === 'lyrics' && node.seekAction === action),
      )
    )
      plugins.action(pluginId, action, value);
  });
  ipcMain.on(IPC.playerResult, (event, input) => {
    if (!trusted(event, desktop.music.webContents.id)) return;
    const parsed = z
      .object({ id: z.string().uuid(), ok: z.boolean(), error: z.string().max(1000).optional() })
      .safeParse(input);
    if (parsed.success) player.result(parsed.data);
  });
  ipcMain.handle(IPC.app, async (event, input: unknown) => {
    if (
      !trusted(event, desktop.window.webContents.id) ||
      !event.senderFrame?.url.startsWith('ytm-app://app/renderer/')
    )
      throw new Error('Untrusted sender');
    if (JSON.stringify(input).length > 1000000)
      throw new Error('Application request exceeds quota');
    const request = appRequestSchema.parse(input);
    switch (request.type) {
      case 'toast':
        overlay.toast(request.text);
        return;
      case 'snapshot':
        return snapshot();
      case 'signIn':
        return desktop.openSignIn();
      case 'signOut':
        return desktop.openSignOut();
      case 'player':
        if (
          request.command.type === 'openQueue' ||
          request.command.type === 'openPlayerPage' ||
          request.command.type === 'openUpNext' ||
          request.command.type === 'openArtist'
        )
          overlay.view('music');
        return player.command(playerCommandSchema.parse(request.command));
      case 'settings': {
        const next = settingsSchema.parse(request.settings);
        const changedTheme = next.appearance.theme !== settings.get().appearance.theme;
        const conflicts = shortcutConflicts(next.shortcuts);
        if (conflicts.length) throw new Error(`Shortcut conflict: ${conflicts.join('; ')}`);
        await settings.update((current) => ({ ...next, plugins: current.plugins }));
        if (changedTheme) await services.themes.select(next.appearance.theme);
        app.setLoginItemSettings({ openAtLogin: next.general.launchAtLogin });
        settingsChanged();
        broadcast();
        return;
      }
      case 'view':
        if (request.view === 'debug' && !settings.get().developer.enabled)
          throw new Error('Enable Developer Mode first');
        overlay.view(request.view);
        return;
      case 'panel':
        overlay.open(z.string().parse(request.pluginId), z.string().parse(request.id));
        return;
      case 'pluginAction': {
        const contribution = z
          .object({
            pluginId: z.string(),
            action: z.string().max(150),
            value: z.union([z.string().max(100000), z.number().finite(), z.boolean()]).optional(),
          })
          .parse(request);
        plugins.action(contribution.pluginId, contribution.action, contribution.value);
        return;
      }
      case 'command':
        return executeCommand(z.string().parse(request.id));
      case 'plugin':
      case 'install':
        return handlePluginActions(request, services);
      case 'developer':
        return handleDeveloperActions(request, services);
      case 'layout':
        desktop.setMode(z.enum(['none', 'panel', 'full']).parse(request.mode));
        return;
      case 'navigation': {
        const action = z.enum(['back', 'forward', 'reload', 'home']).parse(request.action);
        const contents = desktop.music.webContents;
        if (action === 'back' && contents.navigationHistory.canGoBack())
          contents.navigationHistory.goBack();
        if (action === 'forward' && contents.navigationHistory.canGoForward())
          contents.navigationHistory.goForward();
        if (action === 'reload') contents.reload();
        if (action === 'home') await contents.loadURL('https://music.youtube.com');
        return;
      }
      case 'window': {
        const action = z.enum(['minimize', 'maximize', 'close']).parse(request.action);
        if (action === 'minimize') desktop.window.minimize();
        if (action === 'maximize')
          desktop.window.isMaximized() ? desktop.window.unmaximize() : desktop.window.maximize();
        if (action === 'close') desktop.window.close();
        return;
      }
      default:
        throw new Error('Unknown application request');
    }
  });
}
