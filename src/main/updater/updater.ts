import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { Logger } from '../logging/logger';

const STARTUP_DELAY = 15_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

export class UpdateService {
  private enabled = false;
  private disposed = false;
  private configured = false;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private task?: Promise<void>;
  private downloadedVersion?: string;
  private lastError: unknown;
  private readonly onError = (error: Error) => this.logError(error);

  constructor(
    private readonly window: BrowserWindow,
    private readonly logger: Logger,
    private readonly notify: (text: string) => void,
    private readonly prepareInstall: () => Promise<void>,
  ) {
    // Own the download flow so manual checks can still ask when automatic updates are off.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('error', this.onError);
  }

  configure(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.clearTimers();
    if (!enabled || !this.supported()) return;
    this.startupTimer = setTimeout(() => void this.check(true), STARTUP_DELAY);
    this.interval = setInterval(() => void this.check(true), CHECK_INTERVAL);
    this.startupTimer.unref();
    this.interval.unref();
  }

  check(background = false): Promise<void> {
    if (this.disposed || (background && !this.enabled)) return Promise.resolve();
    if (!this.supported()) {
      if (!background)
        this.notify(
          app.isPackaged
            ? 'Run the installed AppImage to use automatic updates.'
            : 'Updates are available in the installed app. Development builds do not update themselves.',
        );
      return Promise.resolve();
    }
    if (this.task) {
      if (!background) this.notify('An update check or download is already in progress.');
      return this.task;
    }
    this.task = this.runCheck(background)
      .catch((error: unknown) => {
        this.logError(error);
        // Offline startup and missing releases should not interrupt music playback.
        if (!background && !this.disposed)
          this.notify(
            'Could not update YTMusic+. Try again later or export logs from Advanced settings.',
          );
      })
      .finally(() => {
        this.task = undefined;
      });
    return this.task;
  }

  private supported(): boolean {
    return app.isPackaged && (process.platform !== 'linux' || !!process.env.APPIMAGE);
  }

  private async runCheck(background: boolean): Promise<void> {
    if (this.downloadedVersion) {
      if (!background) await this.promptRestart();
      return;
    }
    if (!this.configured) {
      const feed = process.env.YTM_UPDATE_URL;
      if (feed) {
        const url = new URL(feed);
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error('Update feed must use HTTPS without embedded credentials');
        autoUpdater.setFeedURL({ provider: 'generic', url: url.href });
      }
      // Otherwise electron-updater reads the GitHub provider embedded by electron-builder.
      this.configured = true;
    }
    const result = await autoUpdater.checkForUpdates();
    if (this.disposed || (background && !this.enabled)) return;
    if (!result) {
      if (!background) this.notify('Automatic updates are unavailable for this installation.');
      return;
    }
    if (!result.isUpdateAvailable) {
      if (!background) this.notify('YTMusic+ is up to date.');
      return;
    }
    const version = result.updateInfo.version;
    if (!background && !this.enabled) {
      const answer = await dialog.showMessageBox(this.window, {
        title: 'Update available',
        message: `Download YTMusic+ ${version}?`,
        buttons: ['Later', 'Download'],
        defaultId: 1,
        cancelId: 0,
      });
      if (answer.response !== 1 || this.disposed) return;
    }
    this.notify(`Downloading YTMusic+ ${version} in the background…`);
    const files = await autoUpdater.downloadUpdate();
    if (!files.length) throw new Error('Updater did not return a downloaded application package');
    this.downloadedVersion = version;
    this.logger.log('application', `Update ${version} downloaded`);
    if (!this.disposed && (!background || this.enabled)) await this.promptRestart();
  }

  private async promptRestart(): Promise<void> {
    if (this.window.isDestroyed()) return;
    const install = await dialog.showMessageBox(this.window, {
      title: 'Update ready',
      message: `YTMusic+ ${this.downloadedVersion} is ready to install.`,
      detail:
        'Restart now to install it. Choose Later to keep listening, then use Check for updates when you are ready.',
      buttons: ['Later', 'Restart and install'],
      defaultId: 0,
      cancelId: 0,
    });
    if (install.response !== 1 || this.disposed) return;
    // Release plugins, room connections and close-to-tray windows before starting the installer.
    await this.prepareInstall();
    autoUpdater.quitAndInstall(false, true);
  }

  private logError(error: unknown): void {
    if (error === this.lastError) return;
    this.lastError = error;
    this.logger.log('application', `Updater: ${String(error)}`, undefined, 'error');
  }

  private clearTimers(): void {
    clearTimeout(this.startupTimer);
    clearInterval(this.interval);
    this.startupTimer = undefined;
    this.interval = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.clearTimers();
    // A pending request may still emit an error during shutdown.
    if (this.task) void this.task.then(() => autoUpdater.removeListener('error', this.onError));
    else autoUpdater.removeListener('error', this.onError);
  }
}
