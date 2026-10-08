import { dialog, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { settingsSchema } from '../../shared/types/settings';
import type { AppRequest } from '../../shared/types/bridge';
import type { AppServices } from './context';
export async function handleDeveloperActions(
  request: Extract<AppRequest, { type: 'developer' }>,
  services: AppServices,
): Promise<void> {
  const { desktop, plugins, settings, logger, updater, broadcast } = services;
  const pluginsDirectory = plugins.userDirectory;
  {
    const action = z
      .enum([
        'reloadPlugins',
        'devtools',
        'musicDevtools',
        'exportLogs',
        'pluginsFolder',
        'importCss',
        'checkUpdates',
      ])
      .parse(request.action);
    if (
      ['reloadPlugins', 'devtools', 'musicDevtools'].includes(action) &&
      !settings.get().developer.enabled
    )
      throw new Error('Enable Developer Mode first');
    if (action === 'reloadPlugins') await plugins.reloadAll();
    if (action === 'devtools') desktop.window.webContents.openDevTools({ mode: 'detach' });
    if (action === 'musicDevtools') desktop.music.webContents.openDevTools({ mode: 'detach' });
    if (action === 'pluginsFolder') await shell.openPath(pluginsDirectory);
    if (action === 'exportLogs') {
      const choice = await dialog.showSaveDialog(desktop.window, {
        defaultPath: 'ytmusic-plus-logs.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (choice.filePath)
        await writeFile(choice.filePath, JSON.stringify(logger.entries, null, 2));
    }
    if (action === 'importCss') {
      const choice = await dialog.showOpenDialog(desktop.window, {
        properties: ['openFile'],
        filters: [{ name: 'CSS', extensions: ['css'] }],
      });
      if (choice.filePaths[0]) {
        const content = await readFile(choice.filePaths[0], 'utf8');
        const next = settings.get();
        next.appearance.customCss = content;
        next.appearance.cssEnabled = true;
        await settings.set(settingsSchema.parse(next));
        broadcast();
      }
    }
    if (action === 'checkUpdates') await updater.check();
    return;
  }
}
