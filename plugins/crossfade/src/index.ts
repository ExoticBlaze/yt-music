import type { YTMusicPlugin, CrossfadeConfig } from '../../../plugin-sdk/index';

const plugin: YTMusicPlugin = {
  async activate(context) {
    const stored = await context.storage.get<CrossfadeConfig>('config');
    let config: CrossfadeConfig = {
      enabled: stored?.enabled !== false,
      seconds:
        Number.isInteger(stored?.seconds) && stored!.seconds >= 0 && stored!.seconds <= 12
          ? stored!.seconds
          : 5,
    };
    let status = await context.audio.crossfade.configure(config);
    let active = true;
    context.onCleanup(async () => {
      active = false;
      await context.audio.crossfade.configure({ ...config, enabled: false });
    });
    const update = async (value: Partial<CrossfadeConfig>) => {
      config = { ...config, ...value };
      status = await context.audio.crossfade.configure(config);
      await context.storage.set('config', config);
      await render();
    };
    const toggle = context.ui.action(
      (value) => update({ enabled: Boolean(value) }),
      'crossfade.toggle',
    );
    const duration = context.ui.action(
      (value) => update({ seconds: Math.max(0, Math.min(12, Math.round(Number(value) || 0))) }),
      'crossfade.duration',
    );
    async function render(): Promise<void> {
      if (!active) return;
      await context.ui.updatePanel({
        id: 'crossfade',
        title: 'Crossfade',
        subtitle: 'SMOOTHER TRANSITIONS',
        nodes: [
          {
            type: 'toggle',
            id: 'crossfade-enabled',
            label: 'Crossfade between songs',
            value: config.enabled,
            action: toggle,
          },
          {
            type: 'range',
            id: 'crossfade-seconds',
            label: `Fade length · ${config.seconds} ${config.seconds === 1 ? 'second' : 'seconds'}`,
            min: 0,
            max: 12,
            step: 1,
            value: config.seconds,
            action: duration,
          },
          {
            type: 'text',
            text:
              status.message ??
              {
                off: 'Crossfade is off.',
                waiting: 'Waiting for the end of a song.',
                preparing: 'Preparing the next transition…',
                ready: 'Ready to blend into the next song.',
                crossfading: 'Blending songs…',
              }[status.phase],
            tone: 'accent',
          },
          {
            type: 'text',
            text: 'Blends the end of each song into the next. Pausing, seeking or skipping cancels the fade. Repeat one, ads and live streams use normal playback.',
            tone: 'muted',
          },
        ],
      });
    }
    const open = async () => {
      status = await context.audio.crossfade.status();
      await render();
      await context.ui.openPanel('crossfade');
    };
    context.ui.addPlayerButton({
      id: 'crossfade.open',
      icon: 'crossfade',
      label: 'Crossfade',
      tooltip: 'Crossfade settings',
      onClick: open,
    });
    context.ui.addMenuItem({
      id: 'crossfade.menu',
      icon: 'crossfade',
      label: 'Crossfade',
      onClick: open,
    });
    context.commands.register({
      id: 'crossfade.settings',
      name: 'Crossfade Settings',
      execute: open,
    });
    await render();
    const timer = setInterval(() => {
      void context.audio.crossfade
        .status()
        .then(async (next) => {
          if (!active || JSON.stringify(next) === JSON.stringify(status)) return;
          status = next;
          await render();
        })
        .catch((error) => context.log(String(error)));
    }, 2000);
    context.onCleanup(() => clearInterval(timer));
  },
};
export default plugin;
