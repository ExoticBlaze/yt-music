import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { Logger } from '../src/main/logging/logger';
import { settingsSchema, migrateSettings } from '../src/shared/types/settings';
import packageFile from '../package.json';

const electron = vi.hoisted(() => ({
  app: { isPackaged: true },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('electron', () => electron);
vi.mock('electron-updater', () => ({
  autoUpdater: Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  }),
}));

import { autoUpdater } from 'electron-updater';
import { UpdateService } from '../src/main/updater/updater';

const checkForUpdates = vi.mocked(autoUpdater.checkForUpdates);
const downloadUpdate = vi.mocked(autoUpdater.downloadUpdate);
const quitAndInstall = vi.mocked(autoUpdater.quitAndInstall);
const available = () =>
  ({ isUpdateAvailable: true, updateInfo: { version: '1.5.0' } }) as Awaited<
    ReturnType<typeof autoUpdater.checkForUpdates>
  >;
const noUpdate = () =>
  ({ isUpdateAvailable: false, updateInfo: { version: '1.4.4' } }) as Awaited<
    ReturnType<typeof autoUpdater.checkForUpdates>
  >;
let service: UpdateService;
let notify: ReturnType<typeof vi.fn<(text: string) => void>>;
let log: ReturnType<typeof vi.fn>;
let prepareInstall: ReturnType<typeof vi.fn<() => Promise<void>>>;
let destroyed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubEnv('YTM_UPDATE_URL', '');
  vi.stubEnv('APPIMAGE', '/tmp/YTMusic.AppImage');
  electron.app.isPackaged = true;
  electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
  checkForUpdates.mockResolvedValue(noUpdate());
  downloadUpdate.mockResolvedValue(['installer.exe']);
  notify = vi.fn();
  log = vi.fn();
  prepareInstall = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  destroyed = vi.fn().mockReturnValue(false);
  service = new UpdateService(
    { isDestroyed: destroyed } as unknown as BrowserWindow,
    { log } as unknown as Logger,
    notify,
    prepareInstall,
  );
});

afterEach(() => {
  service.dispose();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('GitHub application updates', () => {
  it('embeds the repository provider and migrates the automatic-update preference', () => {
    expect(packageFile.build.publish).toMatchObject({
      provider: 'github',
      owner: 'ExoticBlaze',
      repo: 'yt-music',
      releaseType: 'draft',
    });
    expect(settingsSchema.parse({}).general.autoUpdates).toBe(true);
    expect(
      migrateSettings({ version: 1, general: { closeToTray: false } }).general.autoUpdates,
    ).toBe(true);
    expect(migrateSettings({ version: 0 }).general.autoUpdates).toBe(true);
    expect(settingsSchema.parse({ general: { autoUpdates: false } }).general.autoUpdates).toBe(
      false,
    );
    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(autoUpdater.allowPrerelease).toBe(false);
    expect(autoUpdater.allowDowngrade).toBe(false);
  });

  it('checks after startup and every six hours without resetting on unrelated settings changes', async () => {
    service.configure(true);
    await vi.advanceTimersByTimeAsync(10_000);
    service.configure(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 15_000);
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('stops timers when disabled and resumes them when enabled again', async () => {
    service.configure(true);
    service.configure(false);
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
    expect(checkForUpdates).not.toHaveBeenCalled();
    service.configure(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    service.dispose();
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('downloads automatically, keeps Later ready, and finishes cleanup before installation', async () => {
    checkForUpdates.mockResolvedValue(available());
    service.configure(true);
    await service.check(true);
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(quitAndInstall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    let finishCleanup!: () => void;
    prepareInstall.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    electron.dialog.showMessageBox.mockResolvedValue({ response: 1 });
    const installing = service.check();
    await Promise.resolve();
    expect(prepareInstall).toHaveBeenCalledTimes(1);
    expect(quitAndInstall).not.toHaveBeenCalled();
    finishCleanup();
    await installing;
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
    expect(quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
  });

  it('asks before a manual download when automatic updates are disabled', async () => {
    checkForUpdates.mockResolvedValue(available());
    await service.check();
    expect(downloadUpdate).not.toHaveBeenCalled();
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await service.check();
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('serializes repeated checks and downloads', async () => {
    let finishCheck!: (result: ReturnType<typeof available>) => void;
    checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );
    service.configure(true);
    const first = service.check(true);
    const second = service.check();
    expect(first).toBe(second);
    finishCheck(available());
    await first;
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('keeps offline background errors quiet and allows a manual retry', async () => {
    const error = new Error('offline');
    checkForUpdates.mockImplementationOnce(async () => {
      autoUpdater.emit('error', error);
      throw error;
    });
    service.configure(true);
    await service.check(true);
    expect(notify).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    await service.check();
    expect(notify).toHaveBeenCalledWith('YTMusic+ is up to date.');
  });

  it('reports manual download failures and retries instead of offering an invalid installation', async () => {
    checkForUpdates.mockResolvedValue(available());
    downloadUpdate.mockRejectedValueOnce(new Error('checksum mismatch'));
    service.configure(true);
    await service.check();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Could not update'));
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(quitAndInstall).not.toHaveBeenCalled();
    await service.check();
    expect(downloadUpdate).toHaveBeenCalledTimes(2);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('does not start a background download if disabled during a check', async () => {
    let finishCheck!: (result: ReturnType<typeof available>) => void;
    checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );
    service.configure(true);
    const checking = service.check(true);
    service.configure(false);
    finishCheck(available());
    await checking;
    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('suppresses a restart dialog after shutdown during a download', async () => {
    checkForUpdates.mockResolvedValue(available());
    let finishDownload!: (files: string[]) => void;
    downloadUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDownload = resolve;
        }),
    );
    service.configure(true);
    const downloading = service.check(true);
    await Promise.resolve();
    service.dispose();
    autoUpdater.emit('error', new Error('shutdown network error'));
    finishDownload(['installer.exe']);
    await downloading;
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(quitAndInstall).not.toHaveBeenCalled();
    expect(autoUpdater.listenerCount('error')).toBe(0);
  });

  it('does not update development builds or misreport unsupported installs as current', async () => {
    electron.app.isPackaged = false;
    service.configure(true);
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
    await service.check();
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Development builds'));
    electron.app.isPackaged = true;
    checkForUpdates.mockResolvedValue(null);
    await service.check();
    expect(notify).toHaveBeenCalledWith('Automatic updates are unavailable for this installation.');
  });

  it.each(['http://updates.example.com', 'https://user:pass@updates.example.com', 'invalid'])(
    'rejects an unsafe feed override: %s',
    async (feed) => {
      vi.stubEnv('YTM_UPDATE_URL', feed);
      await service.check();
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('Could not update'));
    },
  );

  it('retains the optional HTTPS feed override', async () => {
    vi.stubEnv('YTM_UPDATE_URL', 'https://updates.example.com/releases');
    await service.check();
    expect(autoUpdater.setFeedURL).toHaveBeenCalledExactlyOnceWith({
      provider: 'generic',
      url: 'https://updates.example.com/releases',
    });
  });
});
