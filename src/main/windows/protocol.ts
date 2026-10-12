import { protocol, net } from 'electron';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'ytm-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'ytm-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'ytm-peer', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}
export function serveApp(root: string): void {
  protocol.handle('ytm-app', (request) => {
    const url = new URL(request.url);
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (
      url.hostname !== 'app' ||
      !path.startsWith(`${resolve(root)}${sep}`) ||
      !/\.(html|js|css|png|svg)$/.test(path)
    )
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(path).href);
  });
}
