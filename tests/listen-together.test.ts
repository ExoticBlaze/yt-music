import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin from '../plugins/listen-together/src/index';
import type { PluginContext, RoomSnapshot } from '../plugin-sdk';
import type { PlaybackState } from '../src/shared/types/music';
import { emptyPlayback } from '../src/shared/types/playback-state';
import { emptyRoom } from '../src/shared/types/room-state';
import { settingsSchema } from '../src/shared/types/settings';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Listen Together room transitions', () => {
  it.each(['positionChanged', 'playbackStarted'])(
    'discards a pending %s update after leaving the room',
    async (event) => {
      vi.useFakeTimers();
      const state: PlaybackState = {
        ...emptyPlayback(),
        track: {
          title: 'Test track',
          artist: 'Test artist',
          videoId: 'abcdefghijk',
          position: 10,
          duration: 180,
        },
      };
      const getPlaybackState = vi.fn().mockResolvedValue(state);
      const send = vi.fn().mockResolvedValue(undefined);
      const callbacks = new Map<string, (value: unknown) => void | Promise<void>>();
      let updateRoom!: (room: RoomSnapshot) => void | Promise<void>;
      const context = {
        settings: { get: async () => settingsSchema.parse({}) },
        player: {
          getPlaybackState,
          setPlaybackRate: vi.fn().mockResolvedValue(undefined),
        },
        ui: {
          action: vi.fn().mockReturnValue('test-action'),
          updatePanel: vi.fn().mockResolvedValue(undefined),
          addPlayerButton: vi.fn(),
        },
        commands: { register: vi.fn() },
        rooms: {
          send,
          onUpdate: (callback: typeof updateRoom) => {
            updateRoom = callback;
            return () => {};
          },
        },
        events: {
          on: (name: string, callback: (value: unknown) => void | Promise<void>) => {
            callbacks.set(name, callback);
            return () => callbacks.delete(name);
          },
        },
        onCleanup: vi.fn(),
      } as unknown as PluginContext;
      await plugin.activate(context);
      await updateRoom({
        ...emptyRoom(),
        connection: 'Connected',
        code: 'ABC-123',
        selfId: 'host',
        participants: [{ id: 'host', name: 'Host', role: 'host' }],
        playback: {
          trackId: 'abcdefghijk',
          playing: false,
          position: 10,
          timestamp: Date.now(),
          queue: [],
          revision: 1,
        },
      });

      let resolveRead!: (value: PlaybackState) => void;
      getPlaybackState.mockReturnValueOnce(
        new Promise<PlaybackState>((resolve) => {
          resolveRead = resolve;
        }),
      );
      const pending = callbacks.get(event)!(30);
      await updateRoom(emptyRoom());
      resolveRead(state);

      await expect(Promise.resolve(pending)).resolves.toBeUndefined();
      expect(send).not.toHaveBeenCalled();
    },
  );
});
