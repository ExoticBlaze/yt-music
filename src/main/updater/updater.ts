import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { Logger } from '../logging/logger';

export class UpdateService {
  constructor(
    private readonly window: BrowserWindow,
    private readonly logger: Logger,
    private readonly notify: (text: string) => void,
  ) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('error', (error) => {
      logger.log('application', `Updater: ${error.message}`, undefined, 'error');
      notify('Update check failed. See exported logs.');
    });
  }
  async check(): Promise<void> {
    const feed = process.env.YTM_UPDATE_URL;
    if (!app.isPackaged || !feed) {
      this.notify('Updates are not configured. Release maintainers can set an HTTPS update feed.');
      return;
    }
    const url = new URL(feed);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Update feed must use HTTPS without embedded credentials');
    autoUpdater.setFeedURL({ provider: 'generic', url: url.href });
    const result = await autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      this.notify('YTMusic+ is up to date.');
      return;
    }
    const answer = await dialog.showMessageBox(this.window, {
      title: 'Update available',
      message: `Download YTMusic+ ${result.updateInfo.version}?`,
      buttons: ['Later', 'Download'],
      cancelId: 0,
    });
    if (answer.response !== 1) return;
    await autoUpdater.downloadUpdate();
    this.logger.log('application', 'Update downloaded');
    const install = await dialog.showMessageBox(this.window, {
      title: 'Update ready',
      message: 'Restart to install the update?',
      buttons: ['Later', 'Restart'],
      cancelId: 0,
    });
    if (install.response === 1) autoUpdater.quitAndInstall();
  }
}
