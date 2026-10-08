import { FiltersEngine, Request, type RequestType } from '@ghostery/adblocker';

export const FALLBACK_FILTERS = `
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||adservice.google.com^
||ads.youtube.com^
||youtube.com/pagead/
||youtube.com/api/stats/ads
||music.youtube.com/pagead/
`;

export function shouldBlock(
  engine: FiltersEngine,
  url: string,
  sourceUrl: string,
  type: RequestType,
): boolean {
  try {
    const source = new URL(sourceUrl);
    const target = new URL(url);
    if (
      source.origin !== 'https://music.youtube.com' ||
      !['http:', 'https:'].includes(target.protocol)
    )
      return false;
    if (type === 'mainFrame' || type === 'media') return false;
    if (
      ['accounts.google.com', 'consent.google.com', 'consent.youtube.com'].includes(target.hostname)
    )
      return false;
    if (target.hostname === 'googlevideo.com' || target.hostname.endsWith('.googlevideo.com'))
      return false;
    return engine.match(Request.fromRawDetails({ url, sourceUrl, type })).match;
  } catch {
    return false;
  }
}
