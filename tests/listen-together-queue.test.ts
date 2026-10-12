import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin from '../plugins/listen-together/src/index';
import type { PluginContext, RoomSnapshot, PanelDefinition } from '../plugin-sdk';
import { emptyRoom } from '../src/shared/types/room-state';
import { emptyPlayback } from '../src/shared/types/playback-state';
import { settingsSchema } from '../src/shared/types/settings';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function fixture() {
  vi.useFakeTimers();
  const ids = Array.from({ length: 51 }, (_, i) => String(i).padStart(11, '0'));
  const state = {
    ...emptyPlayback(),
    queue: ids.map((videoId) => ({
      videoId,
      title: `Song ${videoId}`,
      artist: 'Artist',
      duration: 180,
      position: 0,
    })),
  };
  const getPlaybackState = vi.fn().mockResolvedValue(state);
  const send = vi.fn().mockResolvedValue(undefined);
  const startInternet = vi.fn().mockResolvedValue(undefined);
  const joinInvite = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const writeText = vi.fn().mockResolvedValue(undefined);
  const actions = new Map<string, (value?: string | number | boolean) => void | Promise<void>>();
  let panel: PanelDefinition | undefined;
  let updateRoom!: (room: RoomSnapshot) => void | Promise<void>;
  const room: RoomSnapshot = {
    ...emptyRoom(),
    connection: 'Connected',
    code: 'ABC-123',
    selfId: 'host',
    participants: [{ id: 'host', name: 'Host', role: 'host' }],
    playback: {
      trackId: null,
      playing: false,
      position: 0,
      timestamp: Date.now(),
      queue: [],
      revision: 0,
    },
  };
  const context = {
    settings: { get: async () => settingsSchema.parse({}) },
    player: { getPlaybackState },
    rooms: {
      send,
      startInternet,
      joinInvite,
      disconnect,
      onUpdate: (callback: typeof updateRoom) => {
        updateRoom = callback;
        return () => {};
      },
    },
    ui: {
      action: (
        callback: (value?: string | number | boolean) => void | Promise<void>,
        id?: string,
      ) => {
        const key = id ?? `test-${actions.size}`;
        actions.set(key, callback);
        return key;
      },
      updatePanel: async (value: PanelDefinition) => {
        panel = value;
      },
      addPlayerButton: vi.fn(),
      createToast: vi.fn(),
    },
    events: { on: () => () => {} },
    commands: { register: vi.fn() },
    clipboard: { writeText },
    onCleanup: vi.fn(),
  } as unknown as PluginContext;
  await plugin.activate(context);
  const action = async (label: string, value?: string | number | boolean) => {
    const node = panel?.nodes.find((node) => 'label' in node && node.label === label);
    if (!node || !('action' in node)) throw new Error(`Missing action: ${label}`);
    await actions.get(node.action)!(value);
  };
  return {
    ids,
    state,
    getPlaybackState,
    send,
    startInternet,
    joinInvite,
    disconnect,
    writeText,
    room,
    updateRoom,
    action,
    panel: () => panel,
  };
}

describe('Listen Together shared queue', () => {
  it('initializes a new room from the native queue already loaded before joining', async () => {
    const f = await fixture();
    await f.updateRoom(f.room);
    expect(f.send).toHaveBeenCalledExactlyOnceWith({ type: 'queue', trackIds: f.ids });
  });

  it('makes a newly added song visible beyond the first twenty entries and allows paging', async () => {
    const f = await fixture();
    await f.updateRoom({ ...f.room, playback: { ...f.room.playback!, queue: f.ids } });
    await f.action('Add song', 'https://music.youtube.com/watch?v=abcdefghijk');
    await f.action('Add to shared queue');
    const queued = [...f.ids, 'abcdefghijk'];
    expect(f.send).toHaveBeenLastCalledWith({ type: 'queue', trackIds: queued });
    await f.updateRoom({ ...f.room, playback: { ...f.room.playback!, queue: queued } });
    expect(f.panel()?.nodes).toContainEqual(
      expect.objectContaining({ type: 'button', action: 'queue-abcdefghijk' }),
    );
    expect(f.panel()?.nodes).toContainEqual(
      expect.objectContaining({ type: 'text', text: 'Queue page 3 of 3' }),
    );
    await f.action('Previous queue page');
    expect(f.panel()?.nodes).toContainEqual(
      expect.objectContaining({ type: 'text', text: 'Queue page 2 of 3' }),
    );
    expect(f.panel()?.nodes).not.toContainEqual(
      expect.objectContaining({ action: 'queue-abcdefghijk' }),
    );
    await f.action('Next queue page');
    expect(f.panel()?.nodes).toContainEqual(
      expect.objectContaining({ action: 'queue-abcdefghijk' }),
    );
  });

  it('discards initial queue reads after leaving the room', async () => {
    const f = await fixture();
    let resolveRead!: (value: typeof f.state) => void;
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const read = new Promise((resolve) => {
      resolveRead = resolve;
    });
    f.getPlaybackState.mockResolvedValueOnce(f.state).mockImplementationOnce(() => {
      readStarted();
      return read;
    });
    const pending = f.updateRoom(f.room);
    await started;
    await f.updateRoom(emptyRoom());
    resolveRead(f.state);
    await pending;
    expect(f.send).not.toHaveBeenCalled();
  });
});

describe('Listen Together internet controls', () => {
  it('starts through the managed host capability and copies the full P2P invite', async () => {
    const f = await fixture();
    await f.action('Start internet room');
    expect(f.startInternet).toHaveBeenCalledExactlyOnceWith('Music lover');
    const invite =
      'ytmusic-plus://room?peer=ytmp-12345678-1234-4234-8234-123456789abc&code=ABC-123&secret=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await f.updateRoom({
      ...f.room,
      internetHost: true,
      transport: 'peerjs',
      invite,
    });
    await f.action('Copy invite');
    expect(f.writeText).toHaveBeenCalledExactlyOnceWith(invite);
  });
  it('preserves a pasted invite instead of uppercasing its address and uses automatic joining', async () => {
    const f = await fixture();
    const invite =
      'ytmusic-plus://room?relay=wss%3A%2F%2Frooms.example.com%2F%3Fkey%3DCaseSensitive&code=ABC-123';
    await f.action('Invite or room code', invite);
    await f.action('Join room');
    expect(f.joinInvite).toHaveBeenCalledExactlyOnceWith(invite, 'Music lover');
    expect(f.send).not.toHaveBeenCalled();
  });
  it('prevents duplicate startup and offers cancellation while the P2P connection is pending', async () => {
    const f = await fixture();
    let resolve!: () => void;
    f.startInternet.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const pending = f.action('Start internet room');
    await vi.waitFor(() => expect(f.startInternet).toHaveBeenCalledTimes(1));
    expect(f.panel()?.nodes).toContainEqual(
      expect.objectContaining({ label: 'Start internet room', disabled: true }),
    );
    await f.action('Start internet room');
    expect(f.startInternet).toHaveBeenCalledTimes(1);
    await f.action('Cancel');
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    resolve();
    await pending;
    expect(f.panel()?.nodes).not.toContainEqual(expect.objectContaining({ label: 'Cancel' }));
  });
});
