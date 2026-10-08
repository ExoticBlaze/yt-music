import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));
import { allowedNavigation, secureNavigation } from '../src/main/windows/navigation';
import { EventEmitter } from 'node:events';
import { isPrivateAddress, pluginFetch } from '../src/main/plugins/network';
import { shortcutConflicts } from '../src/main/windows/shortcuts';
import { appRequestSchema } from '../src/main/ipc/schemas';

describe('security boundaries', () => {
  it('opens allowed popups normally and routes account navigation without replacing the music renderer', () => {
    const contents = Object.assign(new EventEmitter(), {
      session: {},
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(),
    });
    const signIn = vi.fn();
    secureNavigation(contents as unknown as Electron.WebContents, { signIn });
    const handler = contents.setWindowOpenHandler.mock.calls[0]![0];
    expect(handler({ url: 'https://accounts.google.com/signin' }).action).toBe('allow');
    expect(contents.loadURL).not.toHaveBeenCalled();
    const event = { preventDefault: vi.fn() };
    contents.emit('will-navigate', event, 'https://accounts.google.com/signin');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith('https://accounts.google.com/signin');
  });
  it('allows exact HTTPS login/music origins and rejects deceptive hosts', () => {
    expect(allowedNavigation('https://accounts.google.com/signin')).toBe(true);
    expect(allowedNavigation('https://accounts.youtube.com/accounts/SetSID')).toBe(true);
    expect(allowedNavigation('https://music.youtube.com/watch?v=abcdefghijk')).toBe(true);
    for (const url of [
      'https://music.youtube.com.attacker.com',
      'http://music.youtube.com',
      'file:///C:/private',
      'https://user:pass@music.youtube.com',
    ])
      expect(allowedNavigation(url)).toBe(false);
  });
  it('blocks local and undeclared plugin network destinations before requesting', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.17.1.1',
      '192.168.1.1',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ])
      expect(isPrivateAddress(address)).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    await expect(pluginFetch(['example.com'], 'https://not-allowed.com')).rejects.toThrow();
    await expect(pluginFetch(['example.com'], 'https://127.0.0.1')).rejects.toThrow();
    await expect(pluginFetch(['example.com'], 'https://example.com:8080')).rejects.toThrow();
  });
  it('validates explicit app IPC messages and shortcut conflicts', () => {
    expect(appRequestSchema.safeParse({ type: 'unknown-channel' }).success).toBe(false);
    expect(appRequestSchema.safeParse({ type: 'plugin', action: 'execute', id: 'x' }).success).toBe(
      false,
    );
    expect(shortcutConflicts({ first: 'Ctrl+Shift+L', second: 'Control+Shift+l' })).toHaveLength(1);
  });
});
