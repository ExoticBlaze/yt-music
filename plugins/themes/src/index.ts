import type { YTMusicPlugin } from '../../../plugin-sdk/index';

const plugin: YTMusicPlugin = {
  async activate(context) {
    let appearance = (await context.settings.get()).appearance;
    const choose = context.ui.action(async (value) => {
      await context.themes.select(String(value));
      appearance = (await context.settings.get()).appearance;
      await render();
    });
    const accent = context.ui.action(async (value) => {
      if (!/^#[0-9a-f]{6}$/i.test(String(value))) {
        await context.ui.createToast('Use a six-digit hex color, such as #ff434f.');
        return;
      }
      await context.settings.updateAppearance({ accent: String(value) });
      appearance.accent = String(value);
    });
    const install = context.ui.action(async () => {
      try {
        await context.themes.importPackage();
        await render();
      } catch (error) {
        await context.ui.createToast(String(error));
      }
    });
    async function render(): Promise<void> {
      const themes = await context.themes.list();
      await context.ui.updatePanel({
        id: 'themes',
        title: 'Themes',
        subtitle: 'SET THE MOOD',
        nodes: [
          { type: 'text', text: 'A familiar experience, in your own colors.', tone: 'muted' },
          {
            type: 'select',
            id: 'theme',
            label: 'Theme',
            value: appearance.theme,
            options: themes.map((value) => ({ value: value.id, label: value.name })),
            action: choose,
          },
          {
            type: 'input',
            id: 'accent',
            label: 'Accent',
            value: appearance.accent,
            action: accent,
          },
          { type: 'button', label: 'Import theme ZIP or folder', action: install, primary: true },
          {
            type: 'text',
            text: 'More controls are available in Settings → Appearance. Theme packages use a manifest and a CSS file.',
            tone: 'muted',
          },
        ],
      });
    }
    await render();
    context.ui.addMenuItem({
      id: 'themes-settings',
      label: 'Change theme',
      onClick: () => context.ui.openPanel('themes'),
    });
    context.commands.register({
      id: 'themes.open',
      name: 'Change Theme',
      execute: () => context.ui.openPanel('themes'),
    });
  },
};
export default plugin;
