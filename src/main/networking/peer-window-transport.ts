import { BrowserWindow, ipcMain, net, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { IPC } from '../../shared/constants/ipc';
import {
  peerCommandSchema,
  type PeerInvite,
  type PeerRequest,
} from '../../shared/types/peer-rooms';
import {
  emptyRoom,
  roomSnapshotSchema,
  type RoomClientMessage,
  type RoomSnapshot,
} from '../../shared/types/rooms';

export interface PeerRoomSession {
  startHost(name: string): Promise<void>;
  join(invite: PeerInvite, name: string): Promise<void>;
  send(message: RoomClientMessage): Promise<void>;
  close(): Promise<void>;
}

const origin = 'ytm-peer://host/index.html';
const replySchema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  error: z.string().max(500).optional(),
});
export class PeerWindowTransport implements PeerRoomSession {
  private readonly window: BrowserWindow;
  private readonly loaded: Promise<void>;
  private closed = false;
  private closing = false;
  private pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    root: string,
    private readonly updated: (value: RoomSnapshot) => void,
  ) {
    const isolated = session.fromPartition(`peer-room-${randomUUID()}`);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const ownAsset =
        url.protocol === 'ytm-peer:' &&
        url.hostname === 'host' &&
        ['/index.html', '/index.js'].includes(url.pathname);
      const signaling =
        ['https:', 'wss:'].includes(url.protocol) &&
        url.hostname === '0.peerjs.com' &&
        ['', '443'].includes(url.port);
      callback({ cancel: !ownAsset && !signaling });
    });
    isolated.protocol.handle('ytm-peer', (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'host' || !['/index.html', '/index.js'].includes(url.pathname))
        return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(join(root, 'peer-runtime', url.pathname.slice(1))).href);
    });
    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: isolated,
        preload: join(root, 'preload/peer.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', (event) => event.preventDefault());
    this.window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    this.window.webContents.on('render-process-gone', () => this.fail());
    this.window.webContents.on('unresponsive', () => this.fail());
    this.window.on('closed', () => {
      this.closed = true;
      ipcMain.off(IPC.peerReply, this.onReply);
      ipcMain.off(IPC.peerState, this.onState);
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('P2P room cancelled'));
      }
      this.pending.clear();
      if (!this.closing)
        this.updated({
          ...emptyRoom(),
          error: 'The P2P room stopped. Start a new internet room or rejoin using an invite.',
        });
    });
    ipcMain.on(IPC.peerReply, this.onReply);
    ipcMain.on(IPC.peerState, this.onState);
    this.loaded = this.window.loadURL(origin);
    void this.loaded.catch(() => this.fail());
  }
  private trusted(event: Electron.IpcMainEvent): boolean {
    return (
      !this.closed &&
      event.sender === this.window.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame?.url === origin
    );
  }
  private onReply = (event: Electron.IpcMainEvent, input: unknown) => {
    if (!this.trusted(event)) return;
    const result = replySchema.safeParse(input);
    if (!result.success) return;
    const pending = this.pending.get(result.data.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(result.data.id);
    if (result.data.ok) pending.resolve();
    else pending.reject(new Error(result.data.error ?? 'P2P room request failed'));
  };
  private onState = (event: Electron.IpcMainEvent, input: unknown) => {
    if (!this.trusted(event) || JSON.stringify(input).length > 50000) return;
    const state = roomSnapshotSchema.safeParse(input);
    if (state.success) this.updated(state.data);
  };
  private fail(): void {
    if (!this.closed && !this.window.isDestroyed()) this.window.destroy();
  }
  private async request(value: PeerRequest, timeout = 45000): Promise<void> {
    await this.loaded;
    if (this.closed) throw new Error('P2P room cancelled');
    const request = peerCommandSchema.parse({ ...value, id: randomUUID() });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(
          new Error(
            'The P2P connection timed out. Check your network and ask the host for a fresh invite.',
          ),
        );
      }, timeout);
      this.pending.set(request.id, { resolve, reject, timer });
      this.window.webContents.send(IPC.peerCommand, request);
    });
  }
  startHost(name: string): Promise<void> {
    return this.request({ type: 'host', name });
  }
  join(invite: PeerInvite, name: string): Promise<void> {
    return this.request({ type: 'join', invite, name });
  }
  send(message: RoomClientMessage): Promise<void> {
    return this.request({ type: 'send', message }, 5000);
  }
  async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    await this.request({ type: 'disconnect' }, 1500).catch(() => {});
    this.fail();
  }
}
