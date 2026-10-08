// Only remove advertising instructions. Playback, access checks, media and
// license information stay in the native player's response, untouched.
export function prunePlayerAds<T>(
  value: T,
  parse: typeof JSON.parse = JSON.parse,
): { value: T; removed: number } {
  const adKeys = ['playerAds', 'adPlacements', 'adSlots', 'adBreakHeartbeatParams'];
  const envelopes = [
    'playerResponse',
    'player_response',
    'response',
    'responses',
    'PLAYER_VARS',
    'args',
  ];
  const visited = new WeakSet<object>();
  let budget = 200;
  let removed = 0;
  const visit = (input: unknown, depth: number): void => {
    if (!input || typeof input !== 'object' || depth > 8 || budget-- <= 0 || visited.has(input))
      return;
    visited.add(input);
    if (Array.isArray(input)) {
      for (const item of input.slice(0, 50)) visit(item, depth + 1);
      return;
    }
    const record = input as Record<string, unknown>;
    if ('playabilityStatus' in record || 'videoDetails' in record || 'streamingData' in record) {
      for (const key of adKeys)
        if (Object.hasOwn(record, key) && Reflect.deleteProperty(record, key)) removed++;
    }
    for (const key of envelopes) {
      const child = record[key];
      if (
        key === 'player_response' &&
        typeof child === 'string' &&
        child.length <= 2_000_000 &&
        child.trimStart().startsWith('{')
      ) {
        try {
          const parsed: unknown = parse(child);
          const before = removed;
          visit(parsed, depth + 1);
          if (removed !== before && !Reflect.set(record, key, JSON.stringify(parsed)))
            removed = before;
        } catch {
          /* Preserve non-JSON and malformed native values. */
        }
      } else visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return { value, removed };
}

export function canFinishPlaybackAd(ad: {
  showing: boolean;
  paused: boolean;
  duration: number;
  position: number;
  contentDuration?: number;
}): boolean {
  return (
    ad.showing &&
    !ad.paused &&
    Number.isFinite(ad.duration) &&
    ad.duration > 0 &&
    ad.duration <= 1800 &&
    Number.isFinite(ad.position) &&
    ad.position < ad.duration - 0.05 &&
    !(ad.contentDuration && Math.abs(ad.contentDuration - ad.duration) < 1)
  );
}
