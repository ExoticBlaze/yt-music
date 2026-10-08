import { randomUUID } from 'node:crypto';
import { ipcMain, type WebContents, type IpcMainEvent } from 'electron';
import { IPC } from '../../shared/constants/ipc';
import {
  audioGainReplySchema,
  type AudioGainRequest,
  type AudioGainStatus,
} from '../../shared/types/crossfade';

export class AudioGainClient {
  private pending = new Map<
    string,
    {
      resolve: (status: AudioGainStatus) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(private contents: WebContents) {
    ipcMain.on(IPC.audioGainReply, this.reply);
  }
  private reply = (event: IpcMainEvent, input: unknown): void => {
    if (
      event.sender !== this.contents ||
      event.senderFrame !== this.contents.mainFrame ||
      !event.senderFrame.url.startsWith('https://music.youtube.com/')
    )
      return;
    const parsed = audioGainReplySchema.safeParse(input);
    if (!parsed.success) return;
    const response = parsed.data;
    const request = this.pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(response.id);
    if (response.ok && response.status) request.resolve(response.status);
    else request.reject(new Error(response.error ?? 'Audio fade failed'));
  };
  command(value: Omit<AudioGainRequest, 'id'> = {}): Promise<AudioGainStatus> {
    if (this.contents.isDestroyed()) return Promise.reject(new Error('Music player closed'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Audio fade timed out'));
      }, 2200);
      this.pending.set(id, { resolve, reject, timer });
      this.contents.send(IPC.audioGain, { ...value, id });
    });
  }
  dispose(): void {
    ipcMain.removeListener(IPC.audioGainReply, this.reply);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Music player closed'));
    }
    this.pending.clear();
  }
}
