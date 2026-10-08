import { shell, type WebContents, type BrowserWindow } from 'electron';

export function isAccountNavigation(raw: string): boolean {
  if (!allowedNavigation(raw)) return false;
  return ['accounts.google.com', 'consent.google.com', 'consent.youtube.com'].includes(
    new URL(raw).hostname,
  );
}

export function allowedNavigation(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      [
        'music.youtube.com',
        'www.youtube.com',
        'accounts.google.com',
        'accounts.youtube.com',
        'consent.youtube.com',
        'consent.google.com',
      ].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export async function openExternal(raw: string): Promise<void> {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Unsupported external URL');
  await shell.openExternal(url.href);
}
export function secureNavigation(
  contents: WebContents,
  options: {
    signIn?: (url: string) => void;
    popup?: (window: BrowserWindow, url: string) => void;
  } = {},
): void {
  contents.on('will-navigate', (event, url) => {
    if (options.signIn && isAccountNavigation(url)) {
      event.preventDefault();
      options.signIn(url);
      return;
    }
    if (!allowedNavigation(url)) {
      event.preventDefault();
      void openExternal(url).catch(() => {});
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (options.signIn && isAccountNavigation(url)) {
      event.preventDefault();
      options.signIn(url);
      return;
    }
    if (!allowedNavigation(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (allowedNavigation(url))
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 760,
          title: 'YTMusic+ · Account',
          autoHideMenuBar: true,
          webPreferences: {
            session: contents.session,
            preload: '',
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    void openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  contents.on('did-create-window', (window, details) => {
    if (options.popup) options.popup(window, details.url);
    else secureNavigation(window.webContents);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
