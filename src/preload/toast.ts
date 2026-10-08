import { ipcRenderer } from 'electron';
import { IPC } from '../shared/constants/ipc';

ipcRenderer.on(IPC.toastMessage, (_event, payload: { text: string; accent: string }) => {
  const content = document.querySelector<HTMLElement>('#native-toast');
  if (content) {
    content.textContent = payload.text;
    content.style.borderColor = payload.accent;
  }
});
