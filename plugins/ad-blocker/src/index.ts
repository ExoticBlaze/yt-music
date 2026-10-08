import type { YTMusicPlugin } from '../../../plugin-sdk/index';

const cosmeticCSS =
  'ytmusic-display-ad-renderer, ytmusic-companion-ad-renderer, ytmusic-promoted-sparkles-web-renderer, ytmusic-player-page #companion-ad { display: none !important; }';

const plugin: YTMusicPlugin = {
  async activate(context) {
    let enabled = (await context.storage.get<boolean>('enabled')) !== false;
    let status = await context.blocking.enable(enabled);
    let updating = false;
    const toggle = context.ui.action(async (value) => {
      enabled = Boolean(value);
      status = await context.blocking.enable(enabled);
      await context.storage.set('enabled', enabled);
      await context.ui.applyCSS(enabled ? cosmeticCSS : '');
      await render();
    });
    const update = context.ui.action(async () => {
      if (updating) return;
      updating = true;
      await render();
      try {
        status = await context.blocking.updateFilters();
        await context.ui.createToast('Ad blocking filters updated.');
      } catch (error) {
        await context.ui.createToast(String(error));
      } finally {
        updating = false;
        await render();
      }
    });
    async function render(): Promise<void> {
      await context.ui.updatePanel({
        id: 'ad-blocker',
        title: 'Ad Blocker',
        subtitle: 'FEWER DISTRACTIONS',
        nodes: [
          {
            type: 'toggle',
            id: 'blocking-enabled',
            label: 'Block ads',
            value: enabled,
            action: toggle,
          },
          {
            type: 'text',
            text: `${status.filteredResponses.toLocaleString()} player responses filtered · ${status.skippedAds.toLocaleString()} playback ads skipped`,
            tone: 'normal',
          },
          {
            type: 'text',
            text: `${status.blockedRequests.toLocaleString()} advertising requests blocked this session`,
            tone: 'normal',
          },
          {
            type: 'text',
            text: `${status.filterCount.toLocaleString()} rules · ${status.source}`,
            tone: 'muted',
          },
          {
            type: 'button',
            label: updating ? 'Updating filters…' : 'Update EasyList filters',
            action: update,
            disabled: updating || !enabled,
          },
          {
            type: 'text',
            text: 'Blocks ad requests and filters playback ads before songs start. Ads that still load are skipped when the player allows it. Changes apply immediately; reload to refresh already cached player responses.',
            tone: 'muted',
          },
        ],
      });
    }
    await context.ui.applyCSS(enabled ? cosmeticCSS : '');
    await render();
    const open = async () => {
      status = await context.blocking.status();
      await render();
      await context.ui.openPanel('ad-blocker');
    };
    context.ui.addMenuItem({
      id: 'ad-blocker.open',
      label: 'Ad Blocker',
      icon: 'shield',
      onClick: open,
    });
    context.commands.register({
      id: 'ad-blocker.settings',
      name: 'Ad Blocker Settings',
      execute: open,
    });
  },
};
export default plugin;
