import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants/ipc';
import type { PluginCall } from '../shared/types/plugin-rpc';

contextBridge.exposeInMainWorld('pluginBridge', {
  bootstrap: () => ipcRenderer.invoke(IPC.pluginReady),
  call: (request: PluginCall) => ipcRenderer.invoke(IPC.pluginCall, request),
  report: (status: string, error?: string) => ipcRenderer.send(IPC.pluginHealth, { status, error }),
  onEvent: (callback: (event: string, payload: unknown) => void) => {
    ipcRenderer.on(IPC.pluginEvent, (_event, name: string, value: unknown) =>
      callback(name, value),
    );
  },
  onAction: (callback: (id: string, value?: string | number | boolean) => void) => {
    ipcRenderer.on(IPC.pluginAction, (_event, id: string, value?: string | number | boolean) =>
      callback(id, value),
    );
  },
  onLifecycle: (callback: (action: 'stop' | 'ping') => void) => {
    ipcRenderer.on(IPC.pluginLifecycle, (_event, action: 'stop' | 'ping') => callback(action));
  },
});
