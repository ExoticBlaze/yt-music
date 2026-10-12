import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants/ipc';
import type { PeerCommand } from '../shared/types/peer-rooms';
import type { RoomSnapshot } from '../shared/types/rooms';

contextBridge.exposeInMainWorld('peerBridge', {
  onCommand: (callback: (request: PeerCommand) => void) =>
    ipcRenderer.on(IPC.peerCommand, (_event, request: PeerCommand) => callback(request)),
  reply: (id: string, ok: boolean, error?: string) =>
    ipcRenderer.send(IPC.peerReply, { id, ok, error }),
  state: (value: RoomSnapshot) => ipcRenderer.send(IPC.peerState, value),
});
