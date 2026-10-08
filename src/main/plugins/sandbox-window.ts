import { BrowserWindow, net, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger } from '../logging/logger';

export function createPluginWindow(
  root: string,
  directory: string,
  id: string,
  logger: Logger,
  crashed: (message: string) => void,
): BrowserWindow {
  const isolatedSession = session.fromPartition(`plugin-${id}-${randomUUID()}`);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith('ytm-plugin://host/') }),
  );
  isolatedSession.protocol.handle('ytm-plugin', async (request) => {
    const url = new URL(request.url);
    const runtime = url.pathname.startsWith('/runtime/');
    const base = runtime ? join(root, 'plugin-runtime') : directory;
    const relative = decodeURIComponent(url.pathname.replace(/^\/(runtime|package)\//, ''));
    const target = resolve(base, relative);
    if (
      url.hostname !== 'host' ||
      !/^\/(runtime|package)\//.test(url.pathname) ||
      !target.startsWith(`${resolve(base)}${sep}`) ||
      !(runtime ? /\.(html|js)$/.test(target) : /\.(js|css|json)$/.test(target))
    )
      return new Response('Forbidden', { status: 403 });
    const physical = await realpath(target).catch(() => '');
    if (!physical.startsWith(`${resolve(base)}${sep}`))
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(physical).href);
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: isolatedSession,
      preload: join(root, 'preload/plugin.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, detail) =>
    crashed(`Plugin process exited: ${detail.reason}`),
  );
  window.webContents.on('console-message', (event) =>
    logger.log('plugins', event.message, id, event.level === 'error' ? 'error' : 'info'),
  );
  return window;
}
