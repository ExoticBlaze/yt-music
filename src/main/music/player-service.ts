import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { IPC } from '../../shared/constants/ipc';
import type { PlayerCommand } from '../../shared/types/music';

export class PlayerService {
  onCommand?: (command: PlayerCommand, origin: 'user' | 'crossfade') => void;
  private pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(private readonly contents: WebContents) {}

  command(command: PlayerCommand, origin: 'user' | 'crossfade' = 'user'): Promise<void> {
    this.onCommand?.(command, origin);
    if (this.contents.isDestroyed()) return Promise.reject(new Error('Music view closed'));
    if (
      new URL(this.contents.getURL() || 'https://music.youtube.com').origin !==
      'https://music.youtube.com'
    )
      return Promise.reject(new Error('Return to YouTube Music before using playback controls'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('YouTube Music did not respond to the playback command'));
      }, 6000);
      this.pending.set(id, { resolve, reject, timer });
      this.contents.send(IPC.playerCommand, { id, command });
    });
  }

  result(response: { id: string; ok: boolean; error?: string }): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(response.id);
    if (response.ok) request.resolve();
    else request.reject(new Error(response.error ?? 'Playback command failed'));
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Music view closed'));
    }
    this.pending.clear();
  }
}
