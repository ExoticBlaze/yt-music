import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { roomClientMessageSchema } from '../src/shared/types/rooms';
import { RoomRegistry } from './rooms';

export function createRelay(options: { port?: number; host?: string } = {}): {
  server: ReturnType<typeof createServer>;
  close: () => Promise<void>;
} {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ service: 'YTMusic+ synchronization relay', version: 1 }));
  });
  const sockets = new WebSocketServer({ server, maxPayload: 65536, perMessageDeflate: false });
  // HTTP bind errors are handled by the relay owner; ws also forwards them.
  sockets.on('error', () => {});
  const rooms = new RoomRegistry();
  const connectionsByAddress = new Map<string, number>();
  sockets.on('connection', (socket, request) => {
    const address = request.socket.remoteAddress ?? 'unknown';
    const count = connectionsByAddress.get(address) ?? 0;
    if (count >= 20 || sockets.clients.size > 2000) {
      socket.close(1013, 'Relay connection limit');
      return;
    }
    connectionsByAddress.set(address, count + 1);
    let messages = 0;
    let lastReset = Date.now();
    let alive = true;
    let violations = 0;
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 20000);
    socket.on('message', (data) => {
      if (Date.now() - lastReset >= 1000) {
        messages = 0;
        lastReset = Date.now();
      }
      if (++messages > 20) {
        socket.close(1008, 'Rate limit');
        return;
      }
      try {
        const message = roomClientMessageSchema.safeParse(JSON.parse(data.toString()));
        if (!message.success) throw new Error('Invalid room protocol');
        rooms.receive(socket, message.data);
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid room message' }));
        if (++violations >= 3) socket.close(1008, 'Invalid protocol');
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearInterval(heartbeat);
      rooms.disconnect(socket);
      const remaining = (connectionsByAddress.get(address) ?? 1) - 1;
      if (remaining > 0) connectionsByAddress.set(address, remaining);
      else connectionsByAddress.delete(address);
    });
  });
  server.listen(options.port ?? 8787, options.host ?? '127.0.0.1');
  return {
    server,
    close: () =>
      new Promise((resolveClosed, rejectClosed) => {
        for (const socket of sockets.clients) socket.terminate();
        rooms.close();
        sockets.close(() =>
          server.close((error) => (error ? rejectClosed(error) : resolveClosed())),
        );
      }),
  };
}
