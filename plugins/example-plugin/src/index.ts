import type { YTMusicPlugin } from '../../../plugin-sdk/index';
import { loadGreeting } from './settings';
import { makePanel } from './panel';

const plugin: YTMusicPlugin = {
  async activate(context) {
    const greeting = await loadGreeting(context);
    context.ui.createPanel(makePanel(context, greeting));
    const open = () => context.ui.openPanel('playground');
    context.ui.addPlayerButton({
      id: 'playground-button',
      label: 'Playground',
      icon: 'puzzle',
      tooltip: 'Explore the plugin SDK',
      onClick: open,
    });
    context.commands.register({
      id: 'playground.open',
      name: 'Open Plugin Playground',
      execute: open,
    });
    context.ui.addSidebarItem({ id: 'playground-sidebar', label: 'Playground', onClick: open });
    context.ui.addMenuItem({
      id: 'playground-menu',
      label: 'Show greeting',
      onClick: () => context.ui.createToast(greeting),
    });
    context.ui.addContextMenuItem({
      id: 'playground-copy',
      label: 'Copy current song',
      onClick: async () => {
        const track = await context.player.getCurrentTrack();
        if (track) await context.clipboard.writeText(`${track.title} — ${track.artist}`);
      },
    });
    context.onCleanup(
      context.events.on('trackChanged', (track) => {
        context.log(`Track changed: ${track?.title ?? 'none'}`);
      }),
    );
  },
};
export default plugin;
