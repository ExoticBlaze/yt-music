import { createRelay } from './relay';

const port = Number(process.env.YTM_ROOM_PORT ?? process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid YTM_ROOM_PORT');
const host = process.env.YTM_ROOM_HOST ?? '127.0.0.1';
const relay = createRelay({ port, host });
relay.server.on('listening', () => console.log(`YTMusic+ room relay listening on ${host}:${port}`));
relay.server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void relay.close().then(() => process.exit());
  });
