import type { YTMusicPlugin, PresenceActivity, UINode } from '../../../plugin-sdk/index';

interface PresenceSettings {
  clientId: string;
  showSong: boolean;
  showArtist: boolean;
  showAlbum: boolean;
  showElapsed: boolean;
  hidePrivate: boolean;
  privateSession: boolean;
}
const plugin: YTMusicPlugin = {
  async activate(context) {
    let settings: PresenceSettings = {
      clientId: '',
      showSong: true,
      showArtist: true,
      showAlbum: false,
      showElapsed: true,
      hidePrivate: true,
      privateSession: false,
      ...(await context.storage.get<Partial<PresenceSettings>>('settings')),
    };
    let status = 'Add your Discord application ID to connect.';
    let lastSent = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const actions = Object.fromEntries(
      Object.keys(settings).map((key) => [
        key,
        context.ui.action(async (value) => {
          settings = {
            ...settings,
            [key]: key === 'clientId' ? String(value).trim() : Boolean(value),
          };
          await context.storage.set('settings', settings);
          lastSent = 0;
          await update();
          await render();
        }),
      ]),
    );
    async function render(): Promise<void> {
      const nodes: UINode[] = [
        { type: 'text', text: status, tone: 'muted' },
        {
          type: 'input',
          id: 'discord-id',
          label: 'Application ID',
          value: settings.clientId,
          placeholder: 'Discord Developer Portal → Application ID',
          action: actions.clientId!,
        },
      ];
      for (const [id, label] of [
        ['showSong', 'Show song'],
        ['showArtist', 'Show artist'],
        ['showAlbum', 'Show album'],
        ['showElapsed', 'Show elapsed time'],
        ['hidePrivate', 'Hide private sessions'],
        ['privateSession', 'Private session (this device)'],
      ] as const)
        nodes.push({ type: 'toggle', id, label, value: settings[id], action: actions[id]! });
      nodes.push({
        type: 'text',
        text: 'Uses Discord desktop IPC. No Discord login token is required. Create an application in the Discord Developer Portal and paste its public ID.',
        tone: 'muted',
      });
      await context.ui.updatePanel({
        id: 'presence',
        title: 'Discord Presence',
        subtitle: 'SHARE WHAT MOVES YOU',
        nodes,
      });
    }
    async function update(): Promise<void> {
      if (stopped) return;
      if (!/^\d{17,22}$/.test(settings.clientId)) {
        status = 'Enter a valid public Discord application ID.';
        await render();
        return;
      }
      if (Date.now() - lastSent < 15000) {
        clearTimeout(timer);
        timer = setTimeout(() => void update(), 15000 - (Date.now() - lastSent));
        return;
      }
      const state = await context.player.getPlaybackState();
      const track = state.track;
      let activity: PresenceActivity | null = null;
      if (track && !(settings.hidePrivate && settings.privateSession)) {
        activity = {
          details: settings.showSong ? track.title.slice(0, 128) : 'Listening on YouTube Music',
          state: [
            settings.showArtist ? track.artist : '',
            settings.showAlbum ? track.album : '',
            !state.playing ? 'Paused' : '',
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 128),
        };
        if (settings.showElapsed && state.playing) {
          const start = Math.floor(Date.now() / 1000 - track.position);
          activity.timestamps = { start, end: start + Math.round(track.duration) };
        }
        if (track.artwork)
          activity.assets = {
            large_image: track.artwork,
            large_text: (track.album ?? track.title).slice(0, 128),
          };
        if (track.videoId)
          activity.buttons = [
            {
              label: 'Listen on YouTube Music',
              url: `https://music.youtube.com/watch?v=${track.videoId}`,
            },
          ];
      }
      try {
        await context.presence.set(settings.clientId, activity);
        lastSent = Date.now();
        status = activity ? 'Connected · presence is up to date.' : 'Connected · presence hidden.';
      } catch (error) {
        status = String(error);
        lastSent = Date.now();
      }
      await render();
    }
    for (const name of ['trackChanged', 'playbackStarted', 'playbackPaused'] as const)
      context.onCleanup(context.events.on(name, update));
    const retry = setInterval(() => {
      void update();
    }, 30000);
    context.onCleanup(() => {
      stopped = true;
      clearInterval(retry);
      clearTimeout(timer);
      if (/^\d{17,22}$/.test(settings.clientId))
        void context.presence.set(settings.clientId, null).catch(() => {});
    });
    await render();
    context.ui.addMenuItem({
      id: 'presence-settings',
      label: 'Discord Presence settings',
      onClick: () => context.ui.openPanel('presence'),
    });
    context.commands.register({
      id: 'presence.private',
      name: 'Toggle Discord Private Session',
      execute: async () => {
        settings.privateSession = !settings.privateSession;
        await context.storage.set('settings', settings);
        lastSent = 0;
        await update();
        await context.ui.createToast(
          settings.privateSession ? 'Private session enabled.' : 'Private session disabled.',
        );
      },
    });
    void update();
  },
};
export default plugin;
