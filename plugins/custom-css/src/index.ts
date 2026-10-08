import type { YTMusicPlugin } from '../../../plugin-sdk/index';

const plugin: YTMusicPlugin = {
  async activate(context) {
    let appearance = (await context.settings.get()).appearance;
    const save = async (value: Partial<typeof appearance>) => {
      await context.settings.updateAppearance(value);
    };
    const enabled = context.ui.action((value) => save({ cssEnabled: Boolean(value) }));
    const css = context.ui.action((value) => save({ customCss: String(value) }));
    const reset = context.ui.action(() => save({ customCss: '', cssEnabled: false }));
    const open = context.ui.action(async () => {
      const file = await context.filesystem.importText(['css']);
      if (file) await save({ customCss: file.text, cssEnabled: true });
    });
    async function render(): Promise<void> {
      await context.ui.updatePanel({
        id: 'css',
        title: 'Custom CSS',
        subtitle: 'YOUR FINISHING TOUCH',
        nodes: [
          {
            type: 'text',
            text: 'Changes apply immediately. You can also edit under Settings → Appearance → Custom CSS.',
            tone: 'muted',
          },
          {
            type: 'toggle',
            id: 'css-enabled',
            label: 'Enable',
            value: appearance.cssEnabled,
            action: enabled,
          },
          {
            type: 'input',
            id: 'css-source',
            label: 'CSS',
            value: appearance.customCss,
            placeholder: ':root { --ytmusic-plus-accent: #ff434f; }',
            multiline: true,
            action: css,
          },
          { type: 'button', label: 'Open CSS file', action: open },
          { type: 'button', label: 'Reset', action: reset },
        ],
      });
    }
    context.onCleanup(
      context.events.on('settingsChanged', async (settings) => {
        appearance = settings.appearance;
        await context.ui.applyCSS(appearance.cssEnabled ? appearance.customCss : '');
        await render();
      }),
    );
    await context.ui.applyCSS(appearance.cssEnabled ? appearance.customCss : '');
    await render();
    context.ui.addMenuItem({
      id: 'css-settings',
      label: 'Custom CSS',
      onClick: () => context.ui.openPanel('css'),
    });
    context.commands.register({
      id: 'css.open',
      name: 'Edit Custom CSS',
      execute: () => context.ui.openPanel('css'),
    });
  },
};
export default plugin;
