import { BrowserWindow, WebContentsView, session, nativeImage, dialog, type Input } from 'electron';
import { join } from 'node:path';
import { secureNavigation, isAccountNavigation, openExternal } from './navigation';
import type { AppSnapshot } from '../../shared/types/bridge';
import { IPC } from '../../shared/constants/ipc';
import {
  TITLE_BAR_HEIGHT,
  EXTENSION_DOCK_HEIGHT,
  PANEL_WIDTH,
} from '../../shared/constants/layout';

export class DesktopWindow {
  readonly window: BrowserWindow;
  readonly music: WebContentsView;
  readonly toast: WebContentsView;
  private toastId = 0;
  private toastTimer?: NodeJS.Timeout;
  private sidebarWidth = 0;
  private mode: 'none' | 'panel' | 'full' = 'none';
  private quitting = false;
  private accountWindow?: BrowserWindow;
  private recovering = new Set<number>();
  onStatus: (message: string) => void = () => {};
  account: AppSnapshot['account'] = 'unknown';
  onShortcut: (input: Input) => boolean = () => false;

  constructor(root: string, closeToTray: () => boolean) {
    this.window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 880,
      minHeight: 600,
      title: 'YTMusic+',
      backgroundColor: '#090909',
      frame: false,
      icon: nativeImage.createFromPath(join(root, 'assets/icon.png')),
      webPreferences: {
        preload: join(root, 'preload/preload.cjs'),
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const musicSession = session.fromPartition('persist:youtube-music');
    musicSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    musicSession.setPermissionCheckHandler(() => false);
    this.music = new WebContentsView({
      webPreferences: {
        preload: join(root, 'preload/music.cjs'),
        backgroundThrottling: false,
        session: musicSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    this.window.contentView.addChildView(this.music);
    this.toast = new WebContentsView({
      webPreferences: {
        preload: join(root, 'preload/toast.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    this.toast.setBackgroundColor('#00000000');
    this.toast.setVisible(false);
    this.toast.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.toast.webContents.on('will-navigate', (event) => event.preventDefault());
    this.window.contentView.addChildView(this.toast);
    secureNavigation(this.music.webContents, {
      signIn: (url) => this.openSignIn(url),
      popup: (window, url) => this.trackAccountWindow(window, url),
    });
    this.music.webContents.on(
      'unresponsive',
      () => void this.recover(this.window, this.music.webContents),
    );
    this.music.webContents.on('render-process-gone', (_event, details) => {
      if (!this.quitting)
        this.onStatus(`Music page stopped (${details.reason}). Use Reload to recover.`);
    });
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', (event) => event.preventDefault());
    this.window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    this.window.on('resize', () => this.layout());
    this.window.on('close', (event) => {
      if (!this.quitting && closeToTray()) {
        event.preventDefault();
        this.window.hide();
      }
    });
    this.window.on('closed', () => {
      clearTimeout(this.toastTimer);
      this.accountWindow?.destroy();
      this.music.webContents.close();
      this.toast.webContents.close();
    });
    for (const contents of [this.window.webContents, this.music.webContents]) {
      contents.on('before-input-event', (event, input) => {
        if (this.onShortcut(input)) event.preventDefault();
      });
    }
    this.layout();
  }

  openSignIn(
    url = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F',
  ): void {
    if (!isAccountNavigation(url)) throw new Error('Unsupported account page');
    this.openAccount(url, 'Sign in');
  }

  openSignOut(): void {
    this.openAccount(
      'https://www.youtube.com/logout?next=https%3A%2F%2Fmusic.youtube.com%2F',
      'Sign out',
    );
  }

  private openAccount(url: string, title: string): void {
    if (this.accountWindow && !this.accountWindow.isDestroyed()) {
      this.accountWindow.show();
      this.accountWindow.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 520,
      height: 760,
      minWidth: 440,
      minHeight: 600,
      parent: this.window,
      title: `YTMusic+ · ${title}`,
      autoHideMenuBar: true,
      backgroundColor: '#fff',
      webPreferences: {
        session: this.music.webContents.session,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    this.trackAccountWindow(window, url);
    void window
      .loadURL(url)
      .catch(() => this.onStatus('Account page could not load. Close it and try again.'));
  }

  private trackAccountWindow(window: BrowserWindow, initialURL: string): void {
    this.accountWindow = window;
    let visitedAccount =
      isAccountNavigation(initialURL) || new URL(initialURL).pathname === '/logout';
    secureNavigation(window.webContents);
    window.webContents.on('unresponsive', () => void this.recover(window, window.webContents));
    window.webContents.on('did-navigate', (_event, url) => {
      visitedAccount ||= isAccountNavigation(url);
      if (visitedAccount && new URL(url).origin === 'https://music.youtube.com') window.close();
    });
    window.on('closed', () => {
      if (this.accountWindow === window) this.accountWindow = undefined;
      if (!this.quitting && !this.music.webContents.isDestroyed() && visitedAccount) {
        this.music.webContents.reload();
        this.onStatus('Account window closed. YouTube Music is refreshing.');
      }
    });
  }

  private async recover(window: BrowserWindow, contents: Electron.WebContents): Promise<void> {
    if (this.recovering.has(contents.id) || this.quitting) return;
    this.recovering.add(contents.id);
    try {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Page stopped responding',
        message: 'This page stopped responding. Reload it to try again.',
        detail:
          'For persistent graphics freezes, start YTMusic+ with --safe-renderer. Google may also restrict embedded sign-in; the browser option opens the regular website.',
        buttons: ['Reload page', 'Open YouTube Music in browser', 'Keep waiting'],
        cancelId: 2,
      });
      if (contents.isDestroyed()) return;
      if (result.response === 0) contents.reload();
      if (result.response === 1) await openExternal('https://music.youtube.com');
    } finally {
      this.recovering.delete(contents.id);
    }
  }

  async load(): Promise<void> {
    await this.window.loadURL('ytm-app://app/renderer/index.html');
    await this.toast.webContents.loadURL('ytm-app://app/renderer/toast.html');
  }
  loadMusic(): void {
    void this.music.webContents.loadURL('https://music.youtube.com').catch(() => {});
  }
  setMode(mode: typeof this.mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.layout();
    if (mode === 'full') this.window.webContents.focus();
  }
  setSidebar(enabled: boolean): void {
    const width = enabled ? 64 : 0;
    if (this.sidebarWidth === width) return;
    this.sidebarWidth = width;
    this.layout();
  }
  private layout(): void {
    const [width = 1440, height = 960] = this.window.getContentSize();
    this.music.setVisible(this.mode !== 'full');
    this.music.setBounds({
      x: this.sidebarWidth,
      y: TITLE_BAR_HEIGHT,
      width:
        this.mode === 'panel'
          ? Math.max(400, width - PANEL_WIDTH - this.sidebarWidth)
          : width - this.sidebarWidth,
      height: Math.max(100, height - TITLE_BAR_HEIGHT - EXTENSION_DOCK_HEIGHT),
    });
    const toastWidth = Math.min(580, width - 80);
    this.toast.setBounds({
      x: Math.round((width - toastWidth) / 2),
      y: height - EXTENSION_DOCK_HEIGHT - 68,
      width: toastWidth,
      height: 56,
    });
  }
  send(snapshot: AppSnapshot): void {
    if (this.window.isDestroyed()) return;
    this.window.webContents.send(IPC.snapshot, snapshot);
    const toast = snapshot.overlay.toast;
    if (toast && toast.id !== this.toastId) {
      this.toastId = toast.id;
      this.toast.webContents.send(IPC.toastMessage, {
        text: toast.text,
        accent: snapshot.settings.appearance.accent,
      });
      this.toast.setVisible(true);
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        if (!this.window.isDestroyed()) this.toast.setVisible(false);
      }, 5000);
    }
  }
  show(): void {
    this.window.show();
    this.window.focus();
  }
  prepareQuit(): void {
    this.quitting = true;
  }
  quit(): void {
    this.prepareQuit();
    this.window.close();
  }
}
