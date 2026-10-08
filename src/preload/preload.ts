import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants/ipc';
import type { AppBridge, AppRequest, AppSnapshot } from '../shared/types/bridge';

const api: AppBridge = {
  request: (request: AppRequest) => ipcRenderer.invoke(IPC.app, request),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) =>
      callback(snapshot);
    ipcRenderer.on(IPC.snapshot, listener);
    return () => ipcRenderer.removeListener(IPC.snapshot, listener);
  },
};
contextBridge.exposeInMainWorld('ytmusic', api);
