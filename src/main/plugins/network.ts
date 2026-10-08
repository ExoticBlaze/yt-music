import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.includes(':'))
    return (
      normalized === '::1' ||
      normalized === '::' ||
      /^(fc|fd|fe[89ab]|ff)/.test(normalized) ||
      normalized.startsWith('::ffff:')
    );
  const [a = 0, b = 0] = normalized.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
export async function pluginFetch(
  domains: string[],
  raw: string,
  options?: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string }> {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    isIP(url.hostname) ||
    !domains.includes(url.hostname)
  )
    throw new Error('Plugin network domain is not allowed');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((value) => isPrivateAddress(value.address)))
    throw new Error('Private network addresses are not allowed');
  const headers: Record<string, string> = { 'User-Agent': 'YTMusicPlus/1.0.0' };
  for (const [key, value] of Object.entries(options?.headers ?? {})) {
    if (['accept', 'content-type'].includes(key.toLowerCase())) headers[key] = value;
  }
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: options?.method ?? 'GET',
        headers,
        agent: false,
        family: address.family,
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      },
      (response) => {
        const status = response.statusCode ?? 500;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new Error('Plugin network redirects are not allowed'));
          return;
        }
        let length = 0;
        const parts: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 2_000_000) {
            request.destroy(new Error('Plugin response exceeds 2 MB'));
          } else parts.push(chunk);
        });
        response.on('end', () => resolve({ status, body: Buffer.concat(parts).toString('utf8') }));
        response.on('error', reject);
      },
    );
    const timer = setTimeout(() => request.destroy(new Error('Plugin request timed out')), 10000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    request.end(options?.body);
  });
}
