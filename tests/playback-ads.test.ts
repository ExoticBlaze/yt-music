import { describe, expect, it } from 'vitest';
import { prunePlayerAds, canFinishPlaybackAd } from '../src/shared/blocking/player-response';

describe('playback ad filtering', () => {
  const response = () => ({
    playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' },
    videoDetails: { videoId: 'abcdefghijk', title: 'Selected song' },
    streamingData: { licenseInfos: [{ drmFamily: 'WIDEVINE' }], formats: [{ url: 'untouched' }] },
    playerAds: [{}],
    adPlacements: [{}],
    adSlots: [{}],
    adBreakHeartbeatParams: 'ad-only',
  });

  it('removes only playback ad instructions, preserving access checks and native media', () => {
    const value = response();
    const {
      playerAds: _a,
      adPlacements: _b,
      adSlots: _c,
      adBreakHeartbeatParams: _d,
      ...content
    } = value;
    const result = prunePlayerAds(value);
    expect(result.value).toBe(value);
    expect(result.removed).toBe(4);
    expect(value).toEqual(content);
    expect(prunePlayerAds(value).removed).toBe(0);
  });

  it('handles initial, nested and serialized player responses without a general tree walk', () => {
    const value = {
      responses: [{ playerResponse: response() }],
      PLAYER_VARS: { player_response: JSON.stringify(response()) },
      unrelated: response(),
    };
    expect(prunePlayerAds(value).removed).toBe(8);
    expect(value.responses[0]?.playerResponse).not.toHaveProperty('adPlacements');
    expect(JSON.parse(value.PLAYER_VARS.player_response)).not.toHaveProperty('adSlots');
    expect(value.unrelated.adPlacements).toEqual([{}]);
    expect(prunePlayerAds({ playerAds: [{}], adSlots: [{}] }).removed).toBe(0);
  });

  it('leaves malformed strings, frozen responses, primitives and cyclic envelopes usable', () => {
    const frozen = Object.freeze(response());
    expect(prunePlayerAds(frozen)).toEqual({ value: frozen, removed: 0 });
    const serialized = Object.freeze({ player_response: JSON.stringify(response()) });
    expect(prunePlayerAds(serialized)).toEqual({ value: serialized, removed: 0 });
    for (const value of [null, undefined, false, 7, 'text'])
      expect(prunePlayerAds(value).value).toBe(value);
    const cyclic: Record<string, unknown> = { player_response: '{invalid', response: response() };
    cyclic.args = cyclic;
    expect(prunePlayerAds(cyclic).removed).toBe(4);
    expect(cyclic.player_response).toBe('{invalid');
    const deep = {
      response: {
        response: {
          response: {
            response: {
              response: { response: { response: { response: { response: response() } } } },
            },
          },
        },
      },
    };
    expect(prunePlayerAds(deep).removed).toBe(0);
  });
});

describe('native playback ad fallback', () => {
  const ad = { showing: true, paused: false, duration: 15, position: 0, contentDuration: 210 };
  it('finishes a positively identified playing ad, without selecting another track', () => {
    expect(canFinishPlaybackAd(ad)).toBe(true);
  });
  it('leaves paused media, songs with a stale ad marker and invalid durations alone', () => {
    for (const change of [
      { showing: false },
      { paused: true },
      { duration: 210 },
      { duration: Infinity },
      { duration: 0 },
      { duration: 3600 },
      { position: 14.99 },
      { position: NaN },
    ]) {
      expect(canFinishPlaybackAd({ ...ad, ...change })).toBe(false);
    }
  });
});
