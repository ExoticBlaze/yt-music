import { createRelay } from '../../../server/relay';

export function usesBundledRelay(raw: string): boolean {
  const url = new URL(raw);
  return (
    url.protocol === 'ws:' &&
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.port === '8787' &&
    url.pathname === '/' &&
    !url.search &&
    !url.username &&
    !url.password
  );
}

export class LocalRelay {
  private relay?: ReturnType<typeof createRelay>;
  private starting?: Promise<void>;

  ensure(raw: string): Promise<void> {
    if (!usesBundledRelay(raw) || this.relay) return Promise.resolve();
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const relay = createRelay({ port: 8787, host: '127.0.0.1' });
    try {
      await new Promise<void>((resolve, reject) => {
        const listening = () => {
          relay.server.off('error', failed);
          resolve();
        };
        const failed = (error: Error) => {
          relay.server.off('listening', listening);
          reject(error);
        };
        relay.server.once('listening', listening);
        relay.server.once('error', failed);
      });
      this.relay = relay;
    } catch (error) {
      await relay.close().catch(() => {});
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      try {
        const response = await fetch('http://127.0.0.1:8787/', {
          signal: AbortSignal.timeout(2000),
        });
        const value = (await response.json()) as { service?: string; version?: number };
        if (value.service === 'YTMusic+ synchronization relay' && value.version === 1) return;
      } catch {}
      throw new Error(
        'Port 8787 is occupied by another application. Choose a relay URL in Settings → Listen Together.',
      );
    }
  }

  async close(): Promise<void> {
    await this.starting?.catch(() => {});
    const relay = this.relay;
    this.relay = undefined;
    await relay?.close();
  }
}
