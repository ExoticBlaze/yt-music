import { dialog, shell } from 'electron';
import { z } from 'zod';
import { manifestDigest } from '../plugins/manifest-digest';
import type { AppRequest } from '../../shared/types/bridge';
import type { AppServices } from './context';
export async function handlePluginActions(
  request: Extract<AppRequest, { type: 'plugin' | 'install' }>,
  services: AppServices,
): Promise<unknown> {
  const { desktop, plugins, installer, settings, overlay } = services;
  switch (request.type) {
    case 'plugin': {
      const id = z.string().parse(request.id);
      const action = z
        .enum(['enable', 'disable', 'reload', 'uninstall', 'inspect', 'folder'])
        .parse(request.action);
      if (action === 'enable') {
        const plugin = await plugins.refresh(id);
        if (
          !plugin.builtin &&
          plugin.manifest.permissions.some((value) => !plugin.granted.includes(value))
        ) {
          const approval = await dialog.showMessageBox(desktop.window, {
            type: 'warning',
            title: 'Review changed plugin permissions',
            message: `Approve ${plugin.manifest.name}?`,
            detail: `Permissions:\n${plugin.manifest.permissions.join('\n')}\n\nNetwork domains: ${plugin.manifest.networkDomains.join(', ') || 'none'}`,
            buttons: ['Cancel', 'Approve'],
            defaultId: 0,
            cancelId: 0,
          });
          if (approval.response !== 1) return;
          plugins.approve(plugin.manifest);
        }
      }
      if (action === 'folder') {
        await shell.openPath(plugins.directory(id));
        return;
      }
      if (action === 'inspect') {
        plugins.inspect(id);
        return;
      }
      if (action === 'uninstall') {
        const answer = await dialog.showMessageBox(desktop.window, {
          type: 'question',
          title: 'Uninstall plugin',
          message: `Remove ${id}?`,
          detail:
            'The installed package will be removed. Its isolated saved settings are retained.',
          buttons: ['Cancel', 'Uninstall'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response === 1) {
          await plugins.forget(id);
          await installer.uninstall(id);
        }
        return;
      }
      return plugins[action](id);
    }
    case 'install': {
      const source = z.enum(['zip', 'folder']).parse(request.source);
      const selection = await dialog.showOpenDialog(desktop.window, {
        properties: [source === 'folder' ? 'openDirectory' : 'openFile'],
        filters: source === 'zip' ? [{ name: 'Plugin ZIP', extensions: ['zip'] }] : undefined,
      });
      if (!selection.filePaths[0] || selection.canceled) return;
      const manifest = await installer.install(selection.filePaths[0], async (manifest) => {
        if (plugins.list().some((value) => value.manifest.id === manifest.id))
          throw new Error('Plugin ID already exists');
        const answer = await dialog.showMessageBox(desktop.window, {
          type: 'warning',
          title: 'Approve plugin permissions',
          message: `Install ${manifest.name} ${manifest.version} by ${manifest.author}?`,
          detail: `${manifest.description}\n\nRequested permissions:\n${manifest.permissions.join('\n')}\n\nNetwork domains: ${manifest.networkDomains.join(', ') || 'none'}\n\nOnly install plugins from authors you trust.`,
          buttons: ['Cancel', 'Install and approve'],
          defaultId: 0,
          cancelId: 0,
        });
        return answer.response === 1;
      });
      if (manifest) {
        const next = settings.get();
        next.plugins[manifest.id] = {
          enabled: false,
          grants: manifest.permissions,
          manifestDigest: manifestDigest(manifest),
        };
        await settings.set(next);
        await plugins.scan();
        overlay.toast(`${manifest.name} installed. Enable it in Plugins.`);
      }
      return;
    }
  }
}
