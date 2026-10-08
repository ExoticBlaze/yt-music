import type { AppSettings } from '../../shared/types/settings';
import type { AppSnapshot, AppRequest } from '../../shared/types/bridge';
import { APP_VERSION } from '../../shared/constants/version';
import { element, button, field, input, select, toggle, sectionTitle } from '../components/dom';

export const categories = [
  'General',
  'Appearance',
  'Playback',
  'Plugins',
  'Listen Together',
  'Notifications',
  'Advanced',
  'Developer',
] as const;
export type SettingsCategory = (typeof categories)[number];
export function renderSettings(
  snapshot: AppSnapshot,
  category: SettingsCategory,
  changeCategory: (category: SettingsCategory) => void,
  request: (value: AppRequest) => void,
): HTMLElement {
  const root = element('div', 'settings-page');
  const sidebar = element('nav', 'settings-nav');
  sidebar.append(element('span', 'eyebrow', 'SETTINGS'));
  for (const name of categories)
    sidebar.append(
      button(
        name,
        () => changeCategory(name),
        `settings-tab ${category === name ? 'selected' : ''}`,
      ),
    );
  const content = element('div', 'settings-content');
  content.append(element('h1', '', category));
  const settings = snapshot.settings;
  const update = (mutate: (value: AppSettings) => void) => {
    const next = structuredClone(settings);
    mutate(next);
    request({ type: 'settings', settings: next });
  };
  const group = element('div', 'settings-group');
  switch (category) {
    case 'General':
      content.append(
        sectionTitle(
          'A home for your music',
          'Your Google account stays in the normal, persistent YouTube Music session.',
        ),
        element('p', 'muted app-version', `YTMusic+ ${APP_VERSION}`),
      );
      group.append(
        field(
          'Keep playing in the tray',
          toggle(settings.general.closeToTray, (value) =>
            update((next) => {
              next.general.closeToTray = value;
            }),
          ),
          'Closing the window keeps the app running.',
        ),
        field(
          'Launch at login',
          toggle(settings.general.launchAtLogin, (value) =>
            update((next) => {
              next.general.launchAtLogin = value;
            }),
          ),
        ),
      );
      break;
    case 'Appearance': {
      content.append(
        sectionTitle('Set the mood', 'Themes use a small set of stable YTMusic+ CSS variables.'),
      );
      group.append(
        field(
          'Theme',
          select(
            settings.appearance.theme,
            [
              { value: 'youtube', label: 'YouTube Music' },
              { value: 'midnight', label: 'Midnight' },
              { value: 'amethyst', label: 'Amethyst' },
            ],
            (value) =>
              update((next) => {
                next.appearance.theme = value as AppSettings['appearance']['theme'];
              }),
          ),
        ),
        field(
          'Accent color',
          input(
            settings.appearance.accent,
            (value) =>
              update((next) => {
                next.appearance.accent = value;
              }),
            'color',
          ),
        ),
        field(
          'Background image URL',
          input(settings.appearance.background, (value) =>
            update((next) => {
              next.appearance.background = value;
            }),
          ),
        ),
        field(
          'Animations',
          toggle(settings.appearance.animations, (value) =>
            update((next) => {
              next.appearance.animations = value;
            }),
          ),
        ),
      );
      const opacity = input(
        String(settings.appearance.transparency),
        (value) =>
          update((next) => {
            next.appearance.transparency = Number(value);
          }),
        'number',
      );
      opacity.min = '0.6';
      opacity.max = '1';
      opacity.step = '0.05';
      group.append(field('Window opacity', opacity));
      const blur = input(
        String(settings.appearance.blur),
        (value) =>
          update((next) => {
            next.appearance.blur = Number(value);
          }),
        'number',
      );
      blur.min = '0';
      blur.max = '30';
      group.append(field('Surface blur', blur));
      content.append(
        group,
        sectionTitle(
          'Custom CSS',
          'Applied immediately to YouTube Music. Treat CSS from others as trusted content.',
        ),
      );
      content.append(
        field(
          'Enable custom CSS',
          toggle(settings.appearance.cssEnabled, (value) =>
            update((next) => {
              next.appearance.cssEnabled = value;
            }),
          ),
        ),
      );
      const editor = element('textarea', 'code-editor');
      editor.id = 'custom-css-editor';
      editor.spellcheck = false;
      editor.value = settings.appearance.customCss;
      editor.placeholder = ':root {\n  --ytmusic-plus-accent: #ff434f;\n}';
      editor.setAttribute('aria-label', 'Custom CSS editor');
      let timer: ReturnType<typeof setTimeout>;
      editor.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            update((next) => {
              next.appearance.customCss = editor.value;
            }),
          300,
        );
      };
      content.append(
        editor,
        button(
          'Open CSS file',
          () => request({ type: 'developer', action: 'importCss' }),
          'button secondary',
        ),
        button('Reset CSS', () =>
          update((next) => {
            next.appearance.customCss = '';
            next.appearance.cssEnabled = false;
          }),
        ),
      );
      root.append(sidebar, content);
      return root;
    }
    case 'Playback':
      content.append(
        sectionTitle('Stay in control', 'Playback runs through the normal YouTube Music player.'),
      );
      group.append(
        field(
          'Global media keys',
          toggle(settings.playback.mediaKeys, (value) =>
            update((next) => {
              next.playback.mediaKeys = value;
            }),
          ),
        ),
      );
      content.append(
        group,
        sectionTitle(
          'Keyboard shortcuts',
          'Conflicting shortcuts are rejected when you save. Use Ctrl on Windows and Linux.',
        ),
      );
      for (const [id, accelerator] of Object.entries(settings.shortcuts))
        content.append(
          field(
            id,
            input(accelerator, (value) =>
              update((next) => {
                next.shortcuts[id] = value;
              }),
            ),
          ),
        );
      root.append(sidebar, content);
      return root;
    case 'Plugins':
      content.append(
        sectionTitle(
          'Build your own experience',
          `${snapshot.plugins.filter((value) => value.status === 'enabled').length} plugins enabled.`,
        ),
        button(
          'Manage plugins →',
          () => request({ type: 'view', view: 'plugins' }),
          'button primary',
        ),
        button('Open plugins folder', () =>
          request({ type: 'developer', action: 'pluginsFolder' }),
        ),
      );
      break;
    case 'Listen Together': {
      content.append(
        sectionTitle(
          'Good music is better together',
          'The default local relay starts when you create or join a room. Friends on other computers need the same reachable wss:// relay. Audio stays in each person’s session.',
        ),
      );
      const server = input(settings.rooms.server, (value) =>
        update((next) => {
          next.rooms.server = value;
        }),
      );
      server.id = 'room-server';
      group.append(
        field('Relay WebSocket URL', server),
        field(
          'Start local relay automatically',
          toggle(settings.rooms.autoStartLocal, (value) =>
            update((next) => {
              next.rooms.autoStartLocal = value;
            }),
          ),
        ),
        field(
          'Display name',
          input(settings.rooms.displayName, (value) =>
            update((next) => {
              next.rooms.displayName = value;
            }),
          ),
        ),
      );
      for (const key of ['ignoreDrift', 'seekDrift'] as const) {
        const control = input(
          String(settings.rooms[key]),
          (value) =>
            update((next) => {
              next.rooms[key] = Number(value);
            }),
          'number',
        );
        control.step = '0.05';
        group.append(
          field(
            key === 'ignoreDrift' ? 'Ignore drift below (seconds)' : 'Seek above (seconds)',
            control,
          ),
        );
      }
      break;
    }
    case 'Notifications':
      group.append(
        field(
          'Desktop notifications',
          toggle(settings.notifications.enabled, (value) =>
            update((next) => {
              next.notifications.enabled = value;
            }),
          ),
        ),
        field(
          'Notify on track changes',
          toggle(settings.notifications.trackChanges, (value) =>
            update((next) => {
              next.notifications.trackChanges = value;
            }),
          ),
        ),
      );
      break;
    case 'Advanced':
      content.append(
        sectionTitle(
          'Diagnostics & updates',
          'Settings are written atomically and migrated on startup.',
        ),
      );
      group.append(
        button(
          'Export logs',
          () => request({ type: 'developer', action: 'exportLogs' }),
          'button secondary',
        ),
        button(
          'Check for updates',
          () => request({ type: 'developer', action: 'checkUpdates' }),
          'button secondary',
        ),
        element(
          'p',
          'muted',
          'Release updates require a configured HTTPS feed and signed application packages.',
        ),
      );
      break;
    case 'Developer':
      group.append(
        field(
          'Developer Mode',
          toggle(settings.developer.enabled, (value) =>
            update((next) => {
              next.developer.enabled = value;
            }),
          ),
        ),
        field(
          'Watch compiled plugin files',
          toggle(settings.developer.watchPlugins, (value) =>
            update((next) => {
              next.developer.watchPlugins = value;
            }),
          ),
        ),
      );
      if (settings.developer.enabled)
        group.append(
          button(
            'Reload plugins · Ctrl+Shift+R',
            () => request({ type: 'developer', action: 'reloadPlugins' }),
            'button secondary',
          ),
          button(
            'Open application DevTools',
            () => request({ type: 'developer', action: 'devtools' }),
            'button secondary',
          ),
          button(
            'Open YouTube Music DevTools',
            () => request({ type: 'developer', action: 'musicDevtools' }),
            'button secondary',
          ),
          button(
            'MusicContext, events & logs →',
            () => request({ type: 'view', view: 'debug' }),
            'button primary',
          ),
        );
  }
  content.append(group);
  root.append(sidebar, content);
  return root;
}
