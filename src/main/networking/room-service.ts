import { WebSocketRoomTransport } from '../../../client/websocket-transport';
import type { RoomClientMessage, RoomSnapshot } from '../../shared/types/rooms';
import type { AppSettings } from '../../shared/types/settings';
import type { Logger } from '../logging/logger';
import { LocalRelay, usesBundledRelay } from './local-relay';
import { parseRoomInvite } from '../../shared/types/room-invite';
import type { PeerRoomSession } from './peer-window-transport';

export class RoomService {
  private transports = new Map<string, { url: string; transport: WebSocketRoomTransport }>();
  private readonly localRelay = new LocalRelay();
  private peers = new Map<string, PeerRoomSession>();
  private starts = new Map<string, Promise<void>>();
  private generation = new Map<string, number>();
  private closing = false;
  constructor(
    private readonly settings: () => AppSettings,
    private readonly logger: Logger,
    private readonly peerFactory?: (update: (snapshot: RoomSnapshot) => void) => PeerRoomSession,
  ) {}
  async send(
    id: string,
    message: RoomClientMessage,
    update: (snapshot: RoomSnapshot) => void,
  ): Promise<void> {
    if (message.type === 'create' || message.type === 'join') await this.disconnect(id);
    const peer = this.peers.get(id);
    if (peer) {
      await peer.send(message);
      return;
    }
    const configuredURL = this.transports.get(id)?.url ?? this.settings().rooms.server;
    const url = usesBundledRelay(configuredURL) ? 'ws://127.0.0.1:8787' : configuredURL;
    if (
      this.settings().rooms.autoStartLocal &&
      (message.type === 'create' || message.type === 'join')
    )
      await this.localRelay.ensure(url);
    await this.sendTo(id, message, update, url);
  }

  private async sendTo(
    id: string,
    message: RoomClientMessage,
    update: (snapshot: RoomSnapshot) => void,
    url: string,
  ): Promise<void> {
    if (this.closing) throw new Error('Rooms are shutting down');
    let entry = this.transports.get(id);
    if (entry && entry.url !== url) {
      entry.transport.disconnect();
      this.transports.delete(id);
      entry = undefined;
    }
    if (!entry) {
      const transport = new WebSocketRoomTransport(
        url,
        (snapshot) => {
          if (this.transports.get(id)?.transport !== transport) return;
          update({
            ...snapshot,
            inviteURL: url.startsWith('wss:') ? url : undefined,
            invite: undefined,
            internetHost: false,
            transport: 'websocket',
          });
        },
        (message) => this.logger.log('listen-together', message, id),
      );
      entry = { url, transport };
      this.transports.set(id, entry);
    }
    try {
      await entry.transport.send(message);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED')
        throw new Error(
          usesBundledRelay(url)
            ? 'The local relay is not running. Enable “Start local relay automatically” in Settings → Listen Together, or run npm run server.'
            : 'Cannot reach the room relay. Check its address in Settings → Listen Together and make sure the server is online.',
        );
      throw error;
    }
  }
  startInternet(id: string, name: string, update: (snapshot: RoomSnapshot) => void): Promise<void> {
    if (this.starts.has(id)) return this.starts.get(id)!;
    const version = (this.generation.get(id) ?? 0) + 1;
    this.generation.set(id, version);
    const pending = this.startPeer(id, name, update, version).finally(() => {
      if (this.starts.get(id) === pending) this.starts.delete(id);
    });
    this.starts.set(id, pending);
    return pending;
  }

  private async startPeer(
    id: string,
    name: string,
    update: (snapshot: RoomSnapshot) => void,
    version: number,
  ): Promise<void> {
    await this.dispose(id);
    const current = () => !this.closing && this.generation.get(id) === version;
    if (!current()) throw new Error('Internet room cancelled');
    if (!this.peerFactory) throw new Error('P2P rooms are unavailable in this build');
    const peer = this.peerFactory((value) => {
      if (current() && this.peers.get(id) === peer) update(value);
    });
    this.peers.set(id, peer);
    try {
      await peer.startHost(name);
      if (!current()) throw new Error('Internet room cancelled');
    } catch (error) {
      if (this.peers.get(id) === peer) await this.dispose(id);
      throw error;
    }
  }

  async joinInvite(
    id: string,
    invite: string,
    name: string,
    update: (snapshot: RoomSnapshot) => void,
  ): Promise<void> {
    const parsed = parseRoomInvite(invite);
    await this.disconnect(id);
    if (parsed.kind === 'relay') {
      await this.sendTo(id, { type: 'join', code: parsed.code, name }, update, parsed.relay);
      return;
    }
    if (!this.peerFactory || this.closing) throw new Error('P2P rooms are unavailable');
    const version = this.generation.get(id);
    const peer = this.peerFactory((value) => {
      if (this.generation.get(id) === version && this.peers.get(id) === peer) update(value);
    });
    this.peers.set(id, peer);
    try {
      await peer.join(parsed, name);
    } catch (error) {
      if (this.peers.get(id) === peer) await this.dispose(id);
      throw error;
    }
  }

  async disconnect(id: string): Promise<void> {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    await this.dispose(id);
  }

  private async dispose(id: string): Promise<void> {
    const peer = this.peers.get(id);
    this.peers.delete(id);
    this.transports.get(id)?.transport.disconnect();
    this.transports.delete(id);
    await peer?.close();
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const id of new Set([
      ...this.transports.keys(),
      ...this.peers.keys(),
      ...this.starts.keys(),
    ]))
      await this.disconnect(id);
    await Promise.allSettled(this.starts.values());
    await this.localRelay.close();
  }
}
