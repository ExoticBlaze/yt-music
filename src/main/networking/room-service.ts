import { WebSocketRoomTransport } from '../../../client/websocket-transport';
import type { RoomClientMessage, RoomSnapshot } from '../../shared/types/rooms';
import type { AppSettings } from '../../shared/types/settings';
import type { Logger } from '../logging/logger';
import { LocalRelay, usesBundledRelay } from './local-relay';

export class RoomService {
  private transports = new Map<string, { url: string; transport: WebSocketRoomTransport }>();
  private readonly localRelay = new LocalRelay();
  constructor(
    private readonly settings: () => AppSettings,
    private readonly logger: Logger,
  ) {}
  async send(
    id: string,
    message: RoomClientMessage,
    update: (snapshot: RoomSnapshot) => void,
  ): Promise<void> {
    const configuredURL = this.settings().rooms.server;
    const url = usesBundledRelay(configuredURL) ? 'ws://127.0.0.1:8787' : configuredURL;
    if (
      this.settings().rooms.autoStartLocal &&
      (message.type === 'create' || message.type === 'join')
    )
      await this.localRelay.ensure(url);
    let entry = this.transports.get(id);
    if (entry && entry.url !== url) {
      entry.transport.disconnect();
      this.transports.delete(id);
      entry = undefined;
    }
    if (!entry) {
      entry = {
        url,
        transport: new WebSocketRoomTransport(url, update, (message) =>
          this.logger.log('listen-together', message, id),
        ),
      };
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
  disconnect(id: string): void {
    this.transports.get(id)?.transport.disconnect();
    this.transports.delete(id);
  }
  async close(): Promise<void> {
    for (const id of [...this.transports.keys()]) this.disconnect(id);
    await this.localRelay.close();
  }
}
