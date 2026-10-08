import type { AppSnapshot, AppRequest } from '../../shared/types/bridge';
import type { PluginInfo } from '../../shared/types/plugin';
import { element, button, toggle } from '../components/dom';
import { icon } from '../components/icons';

export function renderPlugins(
  snapshot: AppSnapshot,
  request: (value: AppRequest) => void,
  selected: string | null,
  select: (id: string | null) => void,
): HTMLElement {
  const root = element('div', 'page');
  const heading = element('div', 'page-heading');
  const copy = element('div');
  copy.append(
    element('span', 'eyebrow', 'MAKE IT YOURS'),
    element('h1', '', selected ? 'Plugin details' : 'Your music, extended.'),
    element('p', 'muted', 'Small additions. A whole new way to listen.'),
  );
  const actions = element('div', 'heading-actions');
  actions.append(
    button('Install ZIP', () => request({ type: 'install', source: 'zip' }), 'button primary'),
    button(
      'Install folder',
      () => request({ type: 'install', source: 'folder' }),
      'button secondary',
    ),
    button('Open plugins folder ↗', () => request({ type: 'developer', action: 'pluginsFolder' })),
  );
  heading.append(copy, actions);
  root.append(heading);
  const plugin = snapshot.plugins.find((value) => value.manifest.id === selected);
  if (plugin) {
    root.append(
      button('← All plugins', () => select(null)),
      details(plugin, snapshot, request),
    );
    return root;
  }
  const banner = element('div', 'plugin-banner');
  banner.append(
    icon('puzzle'),
    element('div', '', 'A familiar player. A world of possibilities.'),
    element(
      'span',
      'muted',
      `${snapshot.plugins.filter((value) => value.status === 'enabled').length} active extensions`,
    ),
  );
  root.append(banner);
  const grid = element('div', 'plugin-grid');
  for (const plugin of snapshot.plugins) {
    const card = element('article', `plugin-card ${plugin.manifest.icon}`);
    const top = element('div', 'card-top');
    const badge = element('div', 'plugin-icon');
    badge.append(icon(plugin.manifest.icon));
    const enabled = toggle(plugin.status === 'enabled', (value) =>
      request({ type: 'plugin', id: plugin.manifest.id, action: value ? 'enable' : 'disable' }),
    );
    enabled.setAttribute('aria-label', `Enable ${plugin.manifest.name}`);
    top.append(badge, enabled);
    const title = button(plugin.manifest.name, () => select(plugin.manifest.id), 'plugin-title');
    const bottom = element('div', 'card-bottom');
    bottom.append(
      element('span', `status ${plugin.status}`, plugin.status),
      element('span', 'muted', `v${plugin.manifest.version}`),
    );
    card.append(top, title, element('p', 'muted', plugin.manifest.description), bottom);
    if (plugin.error) card.append(element('p', 'error', plugin.error));
    grid.append(card);
  }
  root.append(
    grid,
    element(
      'p',
      'fine-print',
      'Extensions run in isolated sandboxes. You stay in control of their permissions.',
    ),
  );
  return root;
}
function details(
  plugin: PluginInfo,
  snapshot: AppSnapshot,
  request: (value: AppRequest) => void,
): HTMLElement {
  const root = element('div', 'plugin-detail');
  const badge = element('div', `plugin-icon large ${plugin.manifest.icon}`);
  badge.append(icon(plugin.manifest.icon));
  root.append(
    badge,
    element('h2', '', plugin.manifest.name),
    element(
      'p',
      'muted',
      `Version ${plugin.manifest.version} · ${plugin.manifest.author} · ${plugin.builtin ? 'Built in' : 'Installed locally'}`,
    ),
    element('p', '', plugin.manifest.description),
  );
  const actions = element('div', 'button-row');
  for (const action of [
    plugin.status === 'enabled' ? 'disable' : 'enable',
    'reload',
    ...(plugin.builtin ? [] : ['uninstall']),
  ])
    actions.append(
      button(
        action[0]!.toUpperCase() + action.slice(1),
        () =>
          request({
            type: 'plugin',
            id: plugin.manifest.id,
            action: action as 'enable' | 'disable' | 'reload' | 'uninstall',
          }),
        'button secondary',
      ),
    );
  const panel = snapshot.overlay.panels.find((value) => value.pluginId === plugin.manifest.id);
  if (panel)
    actions.append(
      button(
        'Open plugin settings',
        () => request({ type: 'panel', pluginId: plugin.manifest.id, id: panel.id }),
        'button primary',
      ),
    );
  root.append(actions, element('h3', '', 'Permissions'));
  const permissions = element('div', 'permission-list');
  for (const permission of plugin.manifest.permissions)
    permissions.append(
      element(
        'span',
        `permission ${plugin.granted.includes(permission) ? 'granted' : ''}`,
        permission,
      ),
    );
  root.append(permissions);
  if (plugin.manifest.networkDomains.length)
    root.append(element('p', 'muted', `Network: ${plugin.manifest.networkDomains.join(', ')}`));
  if (plugin.error) root.append(element('pre', 'error code-block', plugin.error));
  if (snapshot.settings.developer.enabled) {
    root.append(element('h3', '', 'Developer tools'));
    const row = element('div', 'button-row');
    row.append(
      button('Inspect plugin', () =>
        request({ type: 'plugin', id: plugin.manifest.id, action: 'inspect' }),
      ),
      button('Open directory', () =>
        request({ type: 'plugin', id: plugin.manifest.id, action: 'folder' }),
      ),
    );
    root.append(
      row,
      element(
        'pre',
        'code-block',
        snapshot.logs
          .filter((value) => value.pluginId === plugin.manifest.id)
          .map((value) => `${value.time} ${value.level}: ${value.message}`)
          .join('\n') || 'No plugin logs yet.',
      ),
    );
  }
  return root;
}
