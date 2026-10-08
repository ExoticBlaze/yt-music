import { ipcMain, type Session, type WebContents, type IpcMainEvent } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/constants/ipc';
import { FiltersEngine } from '@ghostery/adblocker';
import { Worker } from 'node:worker_threads';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { BlockingStatus } from '../../shared/types/blocking';
import { FALLBACK_FILTERS, shouldBlock } from './rules';

export class AdBlockService {
  private owners = new Set<string>();
  private engine = FiltersEngine.parse(FALLBACK_FILTERS);
  private filterCount = this.engine.getFilters().networkFilters.length;
  private blockedRequests = 0;
  private filteredResponses = 0;
  private skippedAds = 0;
  private pages = new Map<
    WebContents,
    { documentId: string; filteredResponses: number; skippedAds: number }
  >();
  private source = 'Built-in rules';
  private lastUpdated: string | null = null;
  private loading?: Promise<void>;
  private updating?: Promise<void>;
  private worker?: Worker;

  constructor(
    private readonly session: Session,
    private readonly root: string,
    private readonly cache: string,
  ) {
    ipcMain.on(IPC.adBlockState, this.bootstrap);
    ipcMain.on(IPC.adBlockStats, this.report);
    session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        const source = details.webContents?.getURL() || details.referrer;
        const cancel =
          this.owners.size > 0 &&
          shouldBlock(this.engine, details.url, source, details.resourceType);
        if (cancel) this.blockedRequests++;
        callback({ cancel });
      },
    );
  }

  private trusted(event: IpcMainEvent): boolean {
    return (
      event.sender.session === this.session &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame.url.startsWith('https://music.youtube.com/')
    );
  }
  private bootstrap = (event: IpcMainEvent): void => {
    event.returnValue = this.trusted(event) && this.owners.size > 0;
    if (!this.trusted(event) || this.pages.has(event.sender)) return;
    this.pages.set(event.sender, { documentId: '', filteredResponses: 0, skippedAds: 0 });
    event.sender.once('destroyed', () => this.pages.delete(event.sender));
  };
  private report = (event: IpcMainEvent, input: unknown): void => {
    if (!this.trusted(event) || !this.owners.size) return;
    const parsed = z
      .object({
        documentId: z.string().uuid(),
        filteredResponses: z.number().int().min(0).max(100000),
        skippedAds: z.number().int().min(0).max(100000),
      })
      .safeParse(input);
    if (!parsed.success) return;
    const next = parsed.data;
    const previous = this.pages.get(event.sender);
    const same = previous?.documentId === next.documentId;
    this.filteredResponses += Math.max(
      0,
      Math.min(1000, next.filteredResponses - (same ? previous.filteredResponses : 0)),
    );
    this.skippedAds += Math.max(
      0,
      Math.min(1000, next.skippedAds - (same ? previous.skippedAds : 0)),
    );
    this.pages.set(event.sender, next);
  };
  private configurePages(): void {
    for (const contents of this.pages.keys())
      if (!contents.isDestroyed()) contents.send(IPC.adBlockConfigure, this.owners.size > 0);
  }

  status(id: string): BlockingStatus {
    return {
      enabled: this.owners.has(id),
      blockedRequests: this.blockedRequests,
      filteredResponses: this.filteredResponses,
      skippedAds: this.skippedAds,
      filterCount: this.filterCount,
      source: this.source,
      lastUpdated: this.lastUpdated,
    };
  }

  async enable(id: string, enabled: boolean): Promise<BlockingStatus> {
    if (enabled) {
      this.owners.add(id);
      this.configurePages();
      this.loading ??= this.load().catch(() => {
        this.source = 'Built-in rules (EasyList unavailable)';
      });
      await this.loading;
    } else this.remove(id);
    return this.status(id);
  }

  remove(id: string): void {
    this.owners.delete(id);
    this.configurePages();
  }

  private async load(): Promise<void> {
    let list: string;
    try {
      list = await readFile(join(this.cache, 'easylist.txt'), 'utf8');
    } catch {
      list = await readFile(join(this.root, 'assets/adblock/easylist.txt'), 'utf8');
    }
    await this.compile(list);
    this.source = 'EasyList + built-in rules';
  }

  private async compile(list: string): Promise<void> {
    if (Buffer.byteLength(list) > 4_000_000) throw new Error('Filter list exceeds 4 MB');
    await new Promise<void>((resolve, reject) => {
      const worker = new Worker(join(this.root, 'main/filter-worker.cjs'), {
        workerData: `${FALLBACK_FILTERS}\n${list}`,
      });
      this.worker = worker;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.worker = undefined;
        void worker.terminate();
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('Filter compilation timed out')), 15000);
      worker.once('error', finish);
      worker.once('exit', (code) => {
        if (!settled) finish(new Error(`Filter worker exited (${code})`));
      });
      worker.once('message', (value: { bytes: Uint8Array; count: number }) => {
        try {
          this.engine = FiltersEngine.deserialize(value.bytes);
          this.filterCount = value.count;
          finish();
        } catch (error) {
          finish(error as Error);
        }
      });
    });
  }

  async update(id: string): Promise<BlockingStatus> {
    if (!this.owners.has(id)) throw new Error('Enable blocking before updating filters');
    await this.loading;
    this.updating ??= this.download().finally(() => {
      this.updating = undefined;
    });
    await this.updating;
    return this.status(id);
  }

  private async download(): Promise<void> {
    const response = await fetch('https://easylist.to/easylist/easylist.txt', {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok || !response.body)
      throw new Error('EasyList could not be downloaded. Existing filters remain active.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 4_000_000) {
          await reader.cancel();
          throw new Error('Filter list exceeds 4 MB');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const list = Buffer.concat(chunks).toString('utf8');
    if (!list.startsWith('[Adblock')) throw new Error('Invalid EasyList response');
    await this.compile(list);
    await mkdir(this.cache, { recursive: true });
    await writeFile(join(this.cache, 'easylist.txt.tmp'), list, 'utf8');
    await rename(join(this.cache, 'easylist.txt.tmp'), join(this.cache, 'easylist.txt'));
    this.source = 'EasyList + built-in rules';
    this.lastUpdated = new Date().toISOString();
  }

  close(): void {
    this.owners.clear();
    this.configurePages();
    ipcMain.removeListener(IPC.adBlockState, this.bootstrap);
    ipcMain.removeListener(IPC.adBlockStats, this.report);
    this.pages.clear();
    void this.worker?.terminate();
    this.session.webRequest.onBeforeRequest(null);
  }
}
