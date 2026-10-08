import type { YTMusicPlugin, RoomSnapshot, UINode } from '../../../plugin-sdk/index';
import { emptyRoom, canControl } from '../../../src/shared/types/room-state';
import { expectedPosition, calculateDrift } from '../../../client/synchronization';

const plugin: YTMusicPlugin = {
  async activate(context) {
    let room: RoomSnapshot = emptyRoom();
    let code = '';
    let newSong = '';
    let queuePage = 0;
    const queuePageSize = 20;
    let syncStatus = 'Disconnected';
    let lastPublished = 0;
    let suppressUntil = 0;
    let lastCorrection = 0;
    let lastSignature = '';
    let busy = false;
    let active = true;
    let pendingTrack: { id: string; since: number } | null = null;
    let settings = (await context.settings.get()).rooms;
    const role = () =>
      room.participants.find((value) => value.id === room.selfId)?.role ?? 'listener';
    const send: typeof context.rooms.send = async (message) => {
      try {
        await context.rooms.send(message);
      } catch (error) {
        syncStatus = 'Disconnected';
        await context.ui.createToast(String(error));
        await render();
      }
    };
    const guarded = (callback: () => Promise<void>) => async () => {
      try {
        await callback();
      } catch (error) {
        await context.ui.createToast(String(error));
      }
    };
    const actions = {
      create: context.ui.action(async () => {
        await send({ type: 'create', name: settings.displayName });
      }),
      code: context.ui.action((value) => {
        code = String(value).trim().toUpperCase();
      }),
      join: context.ui.action(async () => {
        if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(code)) {
          await context.ui.createToast('Enter a six-character room code, such as ABC-123.');
          return;
        }
        await send({ type: 'join', code, name: settings.displayName });
      }),
      copy: context.ui.action(guarded(() => context.clipboard.writeText(room.code ?? ''))),
      leave: context.ui.action(async () => {
        await send({ type: 'leave' });
        await context.rooms.disconnect();
        room = emptyRoom();
        syncStatus = 'Disconnected';
        await context.player.setPlaybackRate(1).catch(() => {});
        await render();
      }),
      promote: context.ui.action(async (value) => {
        const participant = room.participants.find((item) => item.id === value);
        if (participant)
          await send({
            type: 'promote',
            participantId: participant.id,
            role: participant.role === 'dj' ? 'listener' : 'dj',
          });
      }),
      kick: context.ui.action(async (value) => {
        await send({ type: 'kick', participantId: String(value) });
      }),
      play: context.ui.action(
        guarded(async () => {
          await context.player.togglePlay();
          await publish(true);
        }),
      ),
      next: context.ui.action(
        guarded(async () => {
          const queue = room.playback?.queue ?? [];
          const index = queue.indexOf(room.playback?.trackId ?? '');
          const next = queue[index + 1];
          if (next) await send({ type: 'track-change', trackId: next, timestamp: Date.now() });
          else {
            await context.player.next();
            await publish(true);
          }
        }),
      ),
      previous: context.ui.action(
        guarded(async () => {
          const queue = room.playback?.queue ?? [];
          const index = queue.indexOf(room.playback?.trackId ?? '');
          const previous = queue[Math.max(0, index - 1)];
          if (previous)
            await send({ type: 'track-change', trackId: previous, timestamp: Date.now() });
          else {
            await context.player.previous();
            await publish(true);
          }
        }),
      ),
      song: context.ui.action((value) => {
        newSong = String(value).trim();
      }),
      add: context.ui.action(async () => {
        let id = newSong;
        try {
          if (id.startsWith('https:')) id = new URL(id).searchParams.get('v') ?? '';
        } catch {}
        if (!/^[\w-]{11}$/.test(id)) {
          await context.ui.createToast('Enter a YouTube video ID or a YouTube Music song link.');
          return;
        }
        const queue = room.playback?.queue ?? [];
        if (queue.length >= 500) {
          await context.ui.createToast('The shared queue is full (500 songs).');
          return;
        }
        queuePage = Math.floor(queue.length / queuePageSize);
        await send({
          type: 'queue',
          trackIds: [...queue, id],
        });
        newSong = '';
        await render();
      }),
      queueBack: context.ui.action(async () => {
        queuePage = Math.max(0, queuePage - 1);
        await render();
      }),
      queueForward: context.ui.action(async () => {
        queuePage++;
        await render();
      }),
      queuePlay: context.ui.action(async (value) => {
        await send({ type: 'track-change', trackId: String(value), timestamp: Date.now() });
      }),
      djPlayback: context.ui.action(async (value) => {
        await send({
          type: 'permissions',
          permissions: { ...room.permissions, djPlayback: Boolean(value) },
        });
      }),
      djSeek: context.ui.action(async (value) => {
        await send({
          type: 'permissions',
          permissions: { ...room.permissions, djSeek: Boolean(value) },
        });
      }),
      djQueue: context.ui.action(async (value) => {
        await send({
          type: 'permissions',
          permissions: { ...room.permissions, djQueue: Boolean(value) },
        });
      }),
    };
    async function render(): Promise<void> {
      if (!active) return;
      const state = await context.player.getPlaybackState();
      const nodes: UINode[] = [
        {
          type: 'text',
          text: 'Share the moment. Everyone listens through their own YouTube Music account.',
          tone: 'muted',
        },
      ];
      let relayHost = 'Choose a valid relay address in Settings → Listen Together';
      let localRelay = false;
      try {
        const relayURL = new URL(settings.server);
        relayHost = relayURL.host;
        localRelay = ['127.0.0.1', 'localhost', '[::1]'].includes(relayURL.hostname);
      } catch {}
      nodes.push({
        type: 'text',
        text: localRelay
          ? 'Local room on this computer. To invite friends on other computers, choose the same reachable wss:// relay in Settings → Listen Together.'
          : `Room relay: ${relayHost}`,
        tone: 'muted',
      });
      if (!room.code)
        nodes.push(
          { type: 'button', label: 'Create room', primary: true, action: actions.create },
          {
            type: 'input',
            id: 'room-code',
            label: 'Room code',
            value: code,
            placeholder: 'ABC-123',
            action: actions.code,
          },
          { type: 'button', label: 'Join room', action: actions.join },
        );
      else {
        nodes.push(
          { type: 'code', text: room.code },
          { type: 'text', text: `${room.connection} · ${syncStatus}` },
          {
            type: 'participants',
            participants: room.participants,
            promoteAction: role() === 'host' ? actions.promote : undefined,
            kickAction: role() === 'host' ? actions.kick : undefined,
          },
          {
            type: 'text',
            text: state.track
              ? `Playing: ${state.track.title} — ${state.track.artist}`
              : 'Waiting for the host to play a song.',
            tone: 'muted',
          },
          { type: 'button', label: 'Copy invite code', action: actions.copy },
          { type: 'button', label: 'Leave room', action: actions.leave },
        );
        if (canControl(role(), 'playback', room.permissions))
          nodes.push({ type: 'button', label: 'Play / pause', action: actions.play });
        if (canControl(role(), 'queue', room.permissions)) {
          nodes.push(
            { type: 'button', label: 'Previous', action: actions.previous },
            { type: 'button', label: 'Next', action: actions.next },
            {
              type: 'input',
              id: 'room-song',
              label: 'Add song',
              value: newSong,
              placeholder: 'YouTube Music song URL or ID',
              action: actions.song,
            },
            { type: 'button', label: 'Add to shared queue', action: actions.add },
          );
        }
        const queue = room.playback?.queue ?? [];
        if (queue.length) {
          const pageCount = Math.ceil(queue.length / queuePageSize);
          queuePage = Math.min(queuePage, pageCount - 1);
          nodes.push(
            { type: 'divider' },
            { type: 'text', text: `Shared queue · ${queue.length} songs`, tone: 'muted' },
          );
          for (const id of queue.slice(queuePage * queuePageSize, (queuePage + 1) * queuePageSize))
            nodes.push({
              type: 'button',
              label: `${id === room.playback?.trackId ? '▶ ' : ''}${state.queue.find((track) => track.videoId === id)?.title ?? id}`,
              action: context.ui.action(
                () => send({ type: 'track-change', trackId: id, timestamp: Date.now() }),
                `queue-${id}`,
              ),
              disabled: !canControl(role(), 'queue', room.permissions),
            });
          if (pageCount > 1)
            nodes.push(
              { type: 'text', text: `Queue page ${queuePage + 1} of ${pageCount}`, tone: 'muted' },
              {
                type: 'button',
                label: 'Previous queue page',
                action: actions.queueBack,
                disabled: queuePage === 0,
              },
              {
                type: 'button',
                label: 'Next queue page',
                action: actions.queueForward,
                disabled: queuePage === pageCount - 1,
              },
            );
        }
        if (role() === 'host')
          nodes.push(
            { type: 'divider' },
            { type: 'text', text: 'DJ permissions', tone: 'muted' },
            {
              type: 'toggle',
              id: 'dj-playback',
              label: 'Play / pause',
              value: room.permissions.djPlayback,
              action: actions.djPlayback,
            },
            {
              type: 'toggle',
              id: 'dj-seek',
              label: 'Seek',
              value: room.permissions.djSeek,
              action: actions.djSeek,
            },
            {
              type: 'toggle',
              id: 'dj-queue',
              label: 'Tracks & queue',
              value: room.permissions.djQueue,
              action: actions.djQueue,
            },
          );
      }
      if (room.error) nodes.push({ type: 'text', text: room.error, tone: 'error' });
      await context.ui.updatePanel({
        id: 'rooms',
        title: 'Listen Together',
        subtitle: 'BETTER IN GOOD COMPANY',
        nodes,
      });
    }
    async function publish(force = false): Promise<void> {
      const snapshot = room;
      if (
        !active ||
        !room.code ||
        room.connection !== 'Connected' ||
        !canControl(role(), 'playback', room.permissions) ||
        Date.now() < suppressUntil
      )
        return;
      const state = await context.player.getPlaybackState();
      if (!active || room !== snapshot) return;
      const signature = `${state.track?.videoId}:${state.playing}`;
      if (!force && signature === lastSignature && Date.now() - lastPublished < 5000) return;
      if (!state.track?.videoId) return;
      if (
        state.track.videoId !== room.playback?.trackId &&
        !canControl(role(), 'queue', room.permissions)
      )
        return;
      lastPublished = Date.now();
      lastSignature = signature;
      await send({
        type: 'playback-state',
        trackId: state.track.videoId,
        playlistId: state.track.playlistId,
        playing: state.playing,
        position: state.track.position,
        timestamp: Date.now(),
      });
    }
    async function synchronize(): Promise<void> {
      if (!active || busy || !room.playback?.trackId || room.connection !== 'Connected') return;
      busy = true;
      const snapshot = room;
      try {
        const state = await context.player.getPlaybackState();
        if (!active || room !== snapshot) return;
        const target = room.playback;
        if (state.track?.videoId !== target.trackId) {
          if (pendingTrack?.id === target.trackId) {
            if (Date.now() - pendingTrack.since > 15000) {
              syncStatus = 'Out of Sync';
              room.error =
                'The exact song could not be opened. Check availability in your YouTube Music account.';
              await render();
            }
            return;
          }
          pendingTrack = { id: target.trackId!, since: Date.now() };
          suppressUntil = Date.now() + 16000;
          syncStatus = 'Synchronizing';
          await render();
          if (!active || room !== snapshot) return;
          await context.player.openTrack(target.trackId!, target.playlistId);
          return;
        }
        if (pendingTrack) {
          pendingTrack = null;
          suppressUntil = Date.now() + 2000;
        }
        const expected = expectedPosition(target, Date.now() + room.clockOffset);
        if (state.playing !== target.playing) {
          suppressUntil = Date.now() + 2000;
          if (target.playing) await context.player.play();
          else await context.player.pause();
          if (!active || room !== snapshot) return;
        }
        const correction = calculateDrift(state.track.position, expected, target.playing, {
          ignore: settings.ignoreDrift,
          seek: Math.max(settings.ignoreDrift + 0.05, settings.seekDrift),
          softRate: 0.02,
        });
        if (correction.type === 'seek' && Date.now() - lastCorrection > 3000) {
          suppressUntil = Date.now() + 2000;
          lastCorrection = Date.now();
          await context.player.seek(correction.position);
          await context.player.setPlaybackRate(1);
          syncStatus = 'Synchronizing';
        } else if (correction.type === 'rate') {
          await context.player.setPlaybackRate(correction.rate);
          syncStatus = 'Synchronizing';
        } else {
          await context.player.setPlaybackRate(1);
          syncStatus = 'Synced ✓';
        }
      } catch (error) {
        if (active && room === snapshot) {
          syncStatus = 'Out of Sync';
          room.error = String(error);
        }
      } finally {
        busy = false;
      }
    }
    context.onCleanup(
      context.rooms.onUpdate(async (next) => {
        const joinedRoom = next.code !== room.code;
        const joinedCode = next.code;
        if (joinedRoom) queuePage = 0;
        room = next;
        await synchronize();
        await render();
        if (joinedRoom && joinedCode && active && room.code === joinedCode && role() === 'host') {
          const state = await context.player.getPlaybackState();
          const trackIds = state.queue
            .map((track) => track.videoId)
            .filter((id): id is string => !!id);
          // The native queue can already be loaded before a room is created,
          // so no queueChanged event will arrive to initialize the shared queue.
          if (active && room.code === joinedCode && trackIds.length)
            await send({ type: 'queue', trackIds });
        }
        if (role() === 'host' && !room.playback?.trackId) await publish(true);
      }),
    );
    context.onCleanup(
      context.events.on('settingsChanged', (next) => {
        settings = next.rooms;
      }),
    );
    for (const event of ['trackChanged', 'playbackStarted', 'playbackPaused'] as const)
      context.onCleanup(context.events.on(event, () => publish(true)));
    context.onCleanup(
      context.events.on('queueChanged', async (queue) => {
        if (room.code && canControl(role(), 'queue', room.permissions)) {
          const trackIds = queue.map((track) => track.videoId).filter((id): id is string => !!id);
          if (trackIds.length) await send({ type: 'queue', trackIds });
        }
      }),
    );
    context.onCleanup(
      context.events.on('positionChanged', async (position) => {
        if (
          !room.playback ||
          !room.code ||
          Date.now() < suppressUntil ||
          !canControl(role(), 'seek', room.permissions)
        )
          return;
        const snapshot = room;
        const state = await context.player.getPlaybackState();
        // Leaving or joining a room invalidates reads already in flight.
        if (!active || room !== snapshot) return;
        if (
          state.track?.videoId === room.playback.trackId &&
          Math.abs(position - expectedPosition(room.playback, Date.now() + room.clockOffset)) > 1.5
        )
          await send({ type: 'seek', position, timestamp: Date.now() });
      }),
    );
    const timer = setInterval(() => {
      void (role() === 'host' ? publish() : synchronize()).catch((error) =>
        context.log(String(error)),
      );
    }, 2000);
    context.onCleanup(async () => {
      active = false;
      clearInterval(timer);
      await context.rooms.disconnect().catch(() => {});
      if (room.code) await context.player.setPlaybackRate(1).catch(() => {});
    });
    await render();
    const open = () => context.ui.openPanel('rooms');
    context.ui.addPlayerButton({
      id: 'rooms-button',
      label: 'Listen Together',
      icon: 'rooms',
      onClick: open,
    });
    context.commands.register({
      id: 'rooms.create',
      name: 'Create Listen Together Room',
      execute: async () => {
        await open();
        await send({ type: 'create', name: settings.displayName });
      },
    });
    context.commands.register({
      id: 'rooms.join',
      name: 'Join Listen Together Room',
      execute: open,
    });
  },
};
export default plugin;
