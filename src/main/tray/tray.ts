import { Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';

export function createTray(
  root: string,
  callbacks: { show: () => void; toggle: () => void; next: () => void; quit: () => void },
): Tray {
  const tray = new Tray(
    nativeImage.createFromPath(join(root, 'assets/icon.png')).resize({ width: 20, height: 20 }),
  );
  tray.setToolTip('YTMusic+');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open YTMusic+', click: callbacks.show },
      { type: 'separator' },
      { label: 'Play / Pause', click: callbacks.toggle },
      { label: 'Next track', click: callbacks.next },
      { type: 'separator' },
      { label: 'Quit', click: callbacks.quit },
    ]),
  );
  tray.on('double-click', callbacks.show);
  return tray;
}
