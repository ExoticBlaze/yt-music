import { Peer, type DataConnection } from 'peerjs';
import { RoomRegistry, type RoomSocket } from '../server/rooms';
import {
  emptyRoom,
  roomClientMessageSchema,
  roomServerMessageSchema,
  type RoomClientMessage,
  type RoomSnapshot,
} from '../src/shared/types/rooms';
import { createPeerInvite } from '../src/shared/types/room-invite';
import { peerHelloSchema, type PeerInvite } from '../src/shared/types/peer-rooms';

const label = 'ytmusic-plus-room-v1';
export const peerConnectionError = (type?: string): string =>
  type === 'peer-unavailable'
    ? 'The host is offline or this invite has expired. Ask for a fresh invite.'
    : type === 'webrtc'
      ? 'Could not establish a WebRTC connection. Your network may block P2P or the TURN fallback. Try another network.'
      : 'Cannot reach the PeerJS connection service. Check your internet connection and try again.';

export function decodePeerData(input: unknown): unknown {
  if (typeof input !== 'string' || input.length > 50000) throw new Error('Invalid room data');
  return JSON.parse(input);
}

export function authorizePeerHello(
  input: unknown,
  invite: PeerInvite,
): Extract<RoomClientMessage, { type: 'join' }> {
  const hello = peerHelloSchema.parse(input);
  if (
    hello.secret !== invite.secret ||
    hello.message.type !== 'join' ||
    hello.message.code.replace('-', '') !== invite.code.replace('-', '')
  )
    throw new Error('This invite is invalid or expired');
  return hello.message;
}

// Runs only in the first-party, isolated WebRTC window, never in the music page
// or a third-party plugin. Every remote action still passes the room's role checks.
export class PeerRoomTransport {
  private peer?: Peer;
  private registry?: RoomRegistry;
  private local?: RoomSocket;
  private current = emptyRoom();
  private invitation?: PeerInvite;
  private connection?: DataConnection;
  private connections = new Set<DataConnection>();
  private name = '';
  private resumeToken?: string;
  private stopped = false;
  private host = false;
  private retry?: ReturnType<typeof setTimeout>;
  private signalRetry?: ReturnType<typeof setTimeout>;
  private ping?: ReturnType<typeof setInterval>;
  private attempt = 0;
  private pendingFailure?: (error: Error) => void;
  private opening?: Promise<void>;
  constructor(
    private readonly updated: (value: RoomSnapshot) => void,
    private readonly createPeer: (id: string) => Peer = (id) =>
      new Peer(id, { host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 0 }),
  ) {}

  private publish(): void {
    this.updated({
      ...structuredClone(this.current),
      transport: 'peerjs',
      internetHost: this.host,
      invite: this.current.code && this.invitation ? createPeerInvite(this.invitation) : undefined,
    });
  }

  private async open(): Promise<void> {
    this.opening ??= new Promise<void>((resolve, reject) => {
      this.current.connection = 'Synchronizing';
      this.publish();
      const peer = this.createPeer(`ytmp-${crypto.randomUUID()}`);
      this.peer = peer;
      const timeout = setTimeout(() => reject(new Error(peerConnectionError())), 25000);
      this.pendingFailure = reject;
      peer.on('open', () => {
        clearTimeout(timeout);
        clearTimeout(this.signalRetry);
        this.current.error = undefined;
        if (this.current.code) this.publish();
        resolve();
      });
      peer.on('error', (error) => {
        const failure = new Error(peerConnectionError(error.type));
        if (!this.current.code) this.pendingFailure?.(failure);
        if (this.current.code && error.type === 'peer-unavailable' && !this.host) return;
        this.current.error = failure.message;
        this.publish();
      });
      peer.on('disconnected', () => {
        if (this.stopped) return;
        clearTimeout(this.signalRetry);
        this.signalRetry = setTimeout(() => {
          if (!this.stopped && peer.disconnected && !peer.destroyed) peer.reconnect();
        }, 1200);
      });
      peer.on('connection', (connection) => this.accept(connection));
      peer.on('call', (call) => call.close());
      peer.on('close', () => {
        clearTimeout(timeout);
        if (!this.stopped) {
          this.pendingFailure?.(new Error(peerConnectionError()));
          this.current.connection = 'Disconnected';
          this.current.error =
            'The P2P room stopped. Start a new internet room or ask the host for a fresh invite.';
          this.publish();
        }
      });
    });
    await this.opening;
  }

  async startHost(name: string): Promise<void> {
    this.host = true;
    this.name = name;
    await this.open();
    if (this.stopped) throw new Error('P2P room cancelled');
    const secret = crypto.randomUUID().replaceAll('-', '');
    this.registry = new RoomRegistry();
    this.local = {
      readyState: 1,
      close: () => {},
      send: (data) => {
        const message = roomServerMessageSchema.parse(decodePeerData(data));
        if (message.type === 'welcome')
          this.invitation = {
            kind: 'peerjs',
            peerId: this.peer!.id,
            code: message.snapshot.code!,
            secret,
          };
        this.receive(data);
      },
    };
    this.registry.receive(this.local, { type: 'create', name });
  }

  async join(invite: PeerInvite, name: string): Promise<void> {
    this.invitation = invite;
    this.name = name;
    await this.open();
    if (this.stopped) throw new Error('P2P room cancelled');
    await this.connectToHost();
  }

  private accept(connection: DataConnection): void {
    if (
      !this.host ||
      this.stopped ||
      !this.invitation ||
      connection.label !== label ||
      connection.serialization !== 'json' ||
      this.connections.size >= 49
    ) {
      connection.close();
      return;
    }
    this.connections.add(connection);
    let authenticated = false;
    let count = 0;
    let resetAt = Date.now();
    const socket: RoomSocket = {
      get readyState() {
        return connection.open ? 1 : 3;
      },
      send: (value) => {
        if (connection.open) void connection.send(value);
      },
      close: (code) => {
        if (code === 4003 && connection.open)
          void connection.send(JSON.stringify({ type: 'ended', reason: 'removed' }));
        connection.close({ flush: true });
      },
    };
    const timeout = setTimeout(() => connection.close(), 10000);
    connection.on('data', (data) => {
      try {
        if (Date.now() - resetAt >= 1000) {
          count = 0;
          resetAt = Date.now();
        }
        if (++count > 20) throw new Error('Room rate limit');
        const input = decodePeerData(data);
        if (!authenticated) {
          const hello = authorizePeerHello(input, this.invitation!);
          authenticated = true;
          clearTimeout(timeout);
          this.registry!.receive(socket, hello);
        } else {
          const message = roomClientMessageSchema.parse(input);
          if (message.type === 'create' || message.type === 'join')
            throw new Error('Join a room using its invite');
          this.registry!.receive(socket, message);
        }
      } catch {
        if (connection.open)
          void connection.send(JSON.stringify({ type: 'ended', reason: 'invalid-invite' }));
        connection.close({ flush: true });
      }
    });
    connection.on('error', () => connection.close());
    connection.on('close', () => {
      clearTimeout(timeout);
      this.connections.delete(connection);
      this.registry?.disconnect(socket);
    });
  }

  private connectToHost(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.stopped || !this.peer || !this.invitation) {
        reject(new Error('P2P room cancelled'));
        return;
      }
      const connection = this.peer.connect(this.invitation.peerId, {
        label,
        serialization: 'json',
        reliable: true,
      });
      this.connection = connection;
      this.pendingFailure = reject;
      let joined = false;
      const timeout = setTimeout(() => {
        connection.close();
        reject(new Error(peerConnectionError('webrtc')));
      }, 30000);
      connection.on('open', () => {
        if (this.stopped || this.connection !== connection) {
          connection.close();
          return;
        }
        void connection.send(
          JSON.stringify({
            type: 'hello',
            secret: this.invitation!.secret,
            message: {
              type: 'join',
              code: this.invitation!.code,
              name: this.name,
              resumeToken: this.resumeToken,
            },
          }),
        );
        void this.detectRoute(connection);
      });
      connection.on('data', (data) => {
        if (this.connection !== connection || this.stopped) return;
        try {
          const input = decodePeerData(data) as { type?: string; reason?: string };
          if (input.type === 'ended') {
            clearTimeout(timeout);
            this.ended(
              input.reason === 'removed'
                ? 'You were removed from the room.'
                : input.reason === 'host-left'
                  ? 'The host closed the room. Ask for a fresh invite.'
                  : 'This invite is invalid or expired. Ask for a fresh invite.',
            );
            reject(new Error(this.current.error));
            return;
          }
          const message = roomServerMessageSchema.parse(input);
          this.receive(data);
          if (message.type === 'welcome') {
            joined = true;
            this.attempt = 0;
            clearTimeout(timeout);
            clearInterval(this.ping);
            this.ping = setInterval(() => {
              if (connection.open)
                void connection.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
            }, 5000);
            void connection.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
            resolve();
          } else if (message.type === 'error' && !joined) {
            clearTimeout(timeout);
            reject(new Error(message.message));
          }
        } catch {
          connection.close();
          reject(new Error('The host sent invalid room data'));
        }
      });
      connection.on('error', () => {
        clearTimeout(timeout);
        reject(new Error(peerConnectionError('webrtc')));
      });
      connection.on('close', () => {
        clearTimeout(timeout);
        if (this.connection !== connection || this.stopped) return;
        clearInterval(this.ping);
        reject(new Error('P2P connection closed'));
        if (this.current.code && this.attempt < 5) {
          this.current.connection = 'Reconnecting';
          this.current.error = 'Reconnecting to the host…';
          this.publish();
          clearTimeout(this.retry);
          this.retry = setTimeout(
            () => void this.connectToHost().catch(() => {}),
            Math.min(1000 * 2 ** this.attempt++, 8000),
          );
        } else {
          this.current.connection = 'Disconnected';
          this.current.error = peerConnectionError('peer-unavailable');
          this.publish();
        }
      });
    });
  }

  private receive(data: unknown): void {
    const message = roomServerMessageSchema.parse(decodePeerData(data));
    if (message.type === 'welcome' || message.type === 'snapshot') {
      this.current = {
        ...message.snapshot,
        clockOffset: this.current.clockOffset,
        peerRoute: this.current.peerRoute,
      };
      if (message.type === 'welcome') this.resumeToken = message.resumeToken;
      this.publish();
    } else if (message.type === 'pong')
      this.current.clockOffset = message.serverTime - (message.sentAt + Date.now()) / 2;
    else {
      this.current.error = message.message;
      this.publish();
    }
  }

  private async detectRoute(connection: DataConnection): Promise<void> {
    const stats = await connection.peerConnection?.getStats().catch(() => undefined);
    if (!stats || this.connection !== connection || this.stopped) return;
    stats.forEach((item) => {
      if (item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) {
        this.current.peerRoute = [
          stats.get(item.localCandidateId),
          stats.get(item.remoteCandidateId),
        ].some((value) => value?.candidateType === 'relay')
          ? 'relay'
          : 'direct';
      }
    });
    this.publish();
  }

  async send(input: RoomClientMessage): Promise<void> {
    const message = roomClientMessageSchema.parse(input);
    if (this.stopped || this.current.connection !== 'Connected')
      throw new Error('The P2P room is disconnected. Rejoin using a fresh invite.');
    if (message.type === 'create' || message.type === 'join')
      throw new Error('Use Start internet room or paste an invite');
    if (this.host) this.registry!.receive(this.local!, message);
    else {
      if (!this.connection?.open) throw new Error('Reconnecting to the host…');
      await this.connection.send(JSON.stringify(message));
    }
    if (message.type === 'leave') await this.disconnect();
  }

  private ended(error: string): void {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.signalRetry);
    clearInterval(this.ping);
    this.peer?.destroy();
    this.current = { ...emptyRoom(), error };
    this.publish();
  }

  async disconnect(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.pendingFailure?.(new Error('P2P room cancelled'));
    clearTimeout(this.retry);
    clearTimeout(this.signalRetry);
    clearInterval(this.ping);
    if (this.host)
      for (const connection of this.connections)
        if (connection.open)
          void connection.send(JSON.stringify({ type: 'ended', reason: 'host-left' }));
    if (this.connections.size) await new Promise((resolve) => setTimeout(resolve, 80));
    this.registry?.close();
    this.peer?.destroy();
    this.current = emptyRoom();
    this.publish();
  }
}
