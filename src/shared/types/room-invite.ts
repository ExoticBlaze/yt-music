const invalid = () => new Error('Paste a complete YTMusic+ invite copied from the room.');
import { peerInviteSchema, type PeerInvite } from './peer-rooms';

function publicRelay(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== 'wss:' ||
    url.username ||
    url.password ||
    url.hash ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw invalid();
  return url.href;
}

export function createRoomInvite(relay: string, code: string): string {
  if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(code)) throw invalid();
  const invite = new URL('ytmusic-plus://room');
  invite.searchParams.set('relay', publicRelay(relay));
  invite.searchParams.set('code', code);
  return invite.href;
}

export function createPeerInvite(value: PeerInvite): string {
  const parsed = peerInviteSchema.parse(value);
  const invite = new URL('ytmusic-plus://room');
  invite.searchParams.set('peer', parsed.peerId);
  invite.searchParams.set('code', parsed.code);
  invite.searchParams.set('secret', parsed.secret);
  return invite.href;
}

export function parseRoomInvite(
  raw: string,
): PeerInvite | { kind: 'relay'; relay: string; code: string } {
  try {
    if (raw.length > 2048) throw invalid();
    const invite = new URL(raw.trim());
    const params = invite.searchParams;
    if (
      invite.protocol !== 'ytmusic-plus:' ||
      invite.host !== 'room' ||
      (invite.pathname !== '' && invite.pathname !== '/') ||
      invite.username ||
      invite.password ||
      invite.hash ||
      params.getAll('code').length !== 1
    )
      throw invalid();
    const code = (params.get('code') ?? '').toUpperCase();
    if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(code)) throw invalid();
    if (params.has('peer')) {
      if (
        [...params.keys()].length !== 3 ||
        params.getAll('peer').length !== 1 ||
        params.getAll('secret').length !== 1
      )
        throw invalid();
      return peerInviteSchema.parse({
        kind: 'peerjs',
        peerId: params.get('peer'),
        code,
        secret: params.get('secret'),
      });
    }
    if ([...params.keys()].length !== 2 || params.getAll('relay').length !== 1) throw invalid();
    return { kind: 'relay', relay: publicRelay(params.get('relay') ?? ''), code };
  } catch {
    throw invalid();
  }
}
