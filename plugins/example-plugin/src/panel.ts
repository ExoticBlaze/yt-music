import type { PluginContext, PanelDefinition } from '../../../plugin-sdk/index';

export function makePanel(context: PluginContext, greeting: string): PanelDefinition {
  return {
    id: 'playground',
    title: 'Plugin Playground',
    subtitle: 'YOUR FIRST EXTENSION',
    nodes: [
      { type: 'text', text: greeting },
      {
        type: 'input',
        id: 'greeting',
        label: 'Your greeting',
        value: greeting,
        action: context.ui.action(async (value) => {
          await context.storage.set('greeting', String(value));
          await context.ui.updatePanel(makePanel(context, String(value)));
        }),
      },
      {
        type: 'button',
        label: 'Show desktop notification',
        action: context.ui.action(() => context.notifications.show('YTMusic+', greeting)),
      },
      {
        type: 'button',
        label: 'Copy current track',
        action: context.ui.action(async () => {
          const track = await context.player.getCurrentTrack();
          await context.clipboard.writeText(
            track ? `${track.title} — ${track.artist}` : 'Nothing playing',
          );
        }),
      },
      {
        type: 'button',
        label: 'Play / pause',
        action: context.ui.action(() => context.player.togglePlay()),
      },
    ],
  };
}
