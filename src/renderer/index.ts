import type { AppSnapshot, AppRequest } from '../shared/types/bridge';
import { APP_VERSION } from '../shared/constants/version';
import { element, button, preserveFocus } from './components/dom';
import { icon } from './components/icons';
import { renderPlugins } from './plugin-manager';
import { renderSettings, type SettingsCategory } from './settings';
import { renderPanel } from './overlay/panels';

const header = document.querySelector<HTMLElement>('#titlebar')!;
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const dock = document.querySelector<HTMLElement>('#dock')!;
let snapshot: AppSnapshot;
let musicReceived = performance.now();
let musicSignature = '';
let selectedPlugin: string | null = null;
let category: SettingsCategory = 'General';
let layoutSignature = '';
let dockSignature = '';
let cleanupPanel = () => {};
const request = (value: AppRequest) => {
  void window.ytmusic.request(value).catch((error) => toast(String(error)));
};
function toast(text: string): void {
  void window.ytmusic.request({ type: 'toast', text: text.slice(0, 500) }).catch(console.error);
}
header.innerHTML =
  '<strong><span class="brand-play">▶</span> YTMusic<span>+</span></strong><div class="navigation"><button id="back" aria-label="Back">‹</button><button id="forward" aria-label="Forward">›</button></div><span class="caption">YOUR MUSIC. MORE POSSIBILITIES.</span><div id="header-actions"></div><div class="window-controls"><button id="minimize" aria-label="Minimize">−</button><button id="maximize" aria-label="Maximize">□</button><button id="close" aria-label="Close">×</button></div>';
document.title = `YTMusic+ ${APP_VERSION}`;
header.querySelector('strong')!.title = document.title;
for (const action of ['minimize', 'maximize', 'close'] as const)
  document.getElementById(action)!.onclick = () => request({ type: 'window', action });
for (const action of ['back', 'forward'] as const)
  document.getElementById(action)!.onclick = () => request({ type: 'navigation', action });
const headerActions = document.querySelector('#header-actions')!;
const reload = button('⟳', () => request({ type: 'navigation', action: 'reload' }));
reload.setAttribute('aria-label', 'Reload YouTube Music');
reload.title = 'Reload YouTube Music';
document.querySelector('.navigation')!.append(reload);
for (const [view, name, glyph] of [
  ['music', 'Music', 'home'],
  ['plugins', 'Plugins', 'puzzle'],
  ['settings', 'Settings', 'settings'],
  ['palette', 'Search commands · Ctrl+K', 'search'],
] as const) {
  const value = button('', () => request({ type: 'view', view }), 'header-action');
  value.title = name;
  value.setAttribute('aria-label', name);
  value.append(icon(glyph));
  if (view !== 'palette') value.append(element('span', '', name));
  headerActions.append(value);
}
const account = button(
  'Sign in',
  () => request({ type: snapshot?.account === 'signedIn' ? 'signOut' : 'signIn' }),
  'header-action account-action',
);
account.title = 'Open Google account sign-in';
headerActions.append(account);
function render(value: AppSnapshot): void {
  snapshot = value;
  account.hidden = value.account === 'unknown';
  account.textContent = value.account === 'signedIn' ? 'Sign out' : 'Sign in';
  account.title =
    value.account === 'signedIn' ? 'Sign out of YouTube Music' : 'Open Google account sign-in';
  const nextMusicSignature = JSON.stringify(value.music);
  if (musicSignature !== nextMusicSignature) {
    musicSignature = nextMusicSignature;
    musicReceived = performance.now();
  }
  document.documentElement.style.setProperty('--accent', value.settings.appearance.accent);
  document.documentElement.dataset.theme = value.settings.appearance.theme;
  const ui = value.overlay;
  const activePanel = ui.panels.find((item) => `${item.pluginId}:${item.id}` === ui.activePanel);
  const signature = JSON.stringify({
    view: ui.activeView,
    panel: activePanel,
    sidebar: ui.contributions.filter((item) => item.slot === 'sidebar'),
    plugins: value.plugins,
    settings: value.settings,
    selectedPlugin,
    category,
  });
  if (signature !== layoutSignature) {
    layoutSignature = signature;
    preserveFocus(workspace, () => {
      cleanupPanel();
      cleanupPanel = () => {};
      workspace.replaceChildren();
      workspace.className = ui.activeView === 'music' ? 'music-workspace' : 'full-workspace';
      if (ui.activeView === 'plugins')
        workspace.append(
          renderPlugins(value, request, selectedPlugin, (id) => {
            selectedPlugin = id;
            layoutSignature = '';
            render(snapshot);
          }),
        );
      if (ui.activeView === 'settings')
        workspace.append(
          renderSettings(
            value,
            category,
            (name) => {
              category = name;
              layoutSignature = '';
              render(snapshot);
            },
            request,
          ),
        );
      if (ui.activeView === 'debug') {
        const root = element('div', 'page');
        root.append(
          element('h1', '', 'MusicContext'),
          element(
            'p',
            'muted',
            'Normalized player state, active events, permissions and isolated plugin logs.',
          ),
          element('pre', 'code-block debug-state'),
        );
        workspace.append(root);
      }
      if (ui.activeView === 'palette') workspace.append(renderPalette());
      const panel = ui.panels.find((item) => `${item.pluginId}:${item.id}` === ui.activePanel);
      if (panel && panel.placement !== 'native-lyrics' && ui.activeView === 'music') {
        const rendered = renderPanel(
          panel,
          () => ({ state: snapshot.music, received: musicReceived }),
          () => request({ type: 'panel', pluginId: panel.pluginId, id: panel.id }),
        );
        cleanupPanel = rendered.dispose;
        workspace.append(rendered.element);
      }
      if (ui.activeView === 'music') {
        const entries = ui.contributions.filter((item) => item.slot === 'sidebar');
        if (entries.length) {
          const sidebar = element('nav', 'extension-sidebar');
          sidebar.setAttribute('aria-label', 'Plugin sidebar');
          for (const item of entries) {
            const control = button('', () =>
              request({ type: 'pluginAction', pluginId: item.pluginId, action: item.action }),
            );
            control.append(icon(item.icon ?? 'puzzle'), element('span', '', item.label));
            control.title = item.tooltip ?? item.label;
            sidebar.append(control);
          }
          workspace.append(sidebar);
        }
      }
    });
  }
  if (ui.activeView === 'debug') {
    const state = workspace.querySelector('.debug-state');
    if (state)
      state.textContent = JSON.stringify(
        {
          music: value.music,
          events: [
            'trackChanged',
            'playbackStarted',
            'playbackPaused',
            'positionChanged',
            'queueChanged',
          ],
          plugins: value.plugins.map((plugin) => ({
            id: plugin.manifest.id,
            status: plugin.status,
            permissions: plugin.granted,
            error: plugin.error,
          })),
          logs: value.logs,
        },
        null,
        2,
      );
  }
  const contributions = ui.contributions.filter((item) => item.slot === 'player');
  const nextDockSignature = JSON.stringify({
    contributions,
    plugins: value.plugins.map((plugin) => plugin.status),
    status: value.status,
  });
  if (dockSignature !== nextDockSignature) {
    dockSignature = nextDockSignature;
    dock.replaceChildren();
    const status = element('span', 'dock-status');
    status.append(element('span', 'connection-dot'), element('span', '', value.status));
    dock.append(status);
    const controls = element('div', 'plugin-controls');
    for (const item of contributions) {
      const control = button(
        '',
        () => request({ type: 'pluginAction', pluginId: item.pluginId, action: item.action }),
        'dock-button',
      );
      control.append(icon(item.icon ?? 'puzzle'), element('span', '', item.label));
      control.title = item.tooltip ?? item.label;
      controls.append(control);
    }
    dock.append(
      controls,
      button('+ Extensions', () => request({ type: 'view', view: 'plugins' }), 'add-extensions'),
    );
  }
}
function renderPalette(): HTMLElement {
  const root = element('div', 'palette');
  root.append(element('span', 'eyebrow', 'COMMAND PALETTE'));
  const search = element('input', 'palette-search');
  search.placeholder = 'What would you like to do?';
  search.setAttribute('aria-label', 'Find a command');
  const list = element('div', 'command-list');
  const commands = [
    { id: 'app.settings', label: 'Open Settings' },
    { id: 'app.plugins', label: 'Open Plugin Manager' },
    ...(snapshot.settings.developer.enabled
      ? [{ id: 'app.reloadPlugins', label: 'Reload Plugins' }]
      : []),
    ...snapshot.overlay.contributions.filter(
      (value) => value.slot === 'command' || value.slot === 'menu',
    ),
  ];
  const update = () => {
    list.replaceChildren();
    for (const command of commands.filter((value) =>
      value.label.toLowerCase().includes(search.value.toLowerCase()),
    ))
      list.append(
        button(
          command.label,
          () => {
            request({ type: 'view', view: 'music' });
            request({ type: 'command', id: command.id });
          },
          'command-item',
        ),
      );
    if (!list.children.length) list.append(element('p', 'muted', 'No matching commands.'));
  };
  search.oninput = update;
  search.onkeydown = (event) => {
    if (event.key === 'Enter') list.querySelector('button')?.click();
  };
  update();
  root.append(search, list, element('span', 'muted palette-hint', 'Enter to run · Esc to close'));
  setTimeout(() => search.focus(), 0);
  return root;
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') request({ type: 'view', view: 'music' });
});
dock.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const commands = snapshot.overlay.contributions.filter((value) => value.slot === 'context');
  if (!commands.length) return;
  const menu = element('div', 'context-menu');
  menu.style.left = `${Math.min(event.clientX, innerWidth - 240)}px`;
  menu.style.bottom = '44px';
  for (const command of commands)
    menu.append(
      button(command.label, () => {
        request({ type: 'pluginAction', pluginId: command.pluginId, action: command.action });
        menu.remove();
      }),
    );
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
});
window.ytmusic.subscribe(render);
void window.ytmusic
  .request({ type: 'snapshot' })
  .then((value) => render(value as AppSnapshot))
  .catch((error) => toast(String(error)));
