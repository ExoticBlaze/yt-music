import { webFrame } from 'electron';
import { selectors } from './selectors';

function isPlayerPageOpen(): boolean {
  const app = document.querySelector('ytmusic-app') as
    (Element & { playerPageOpen?: boolean }) | null;
  const page = document.querySelector('ytmusic-player-page');
  return app?.playerPageOpen === true || page?.hasAttribute('player-page-open') === true;
}

export function clickControl(element: Element | null | undefined): boolean {
  const target = element?.querySelector<HTMLButtonElement>('button') ?? element;
  if (!(target instanceof HTMLElement) || target.matches(':disabled')) return false;
  target.click();
  return true;
}

export async function openPlayerPage(upNext = false): Promise<void> {
  const open: boolean = await webFrame.executeJavaScript(`(${isPlayerPageOpen.toString()})()`);
  const player = document.querySelector(selectors.player);
  if (
    !open &&
    !clickControl(
      player?.querySelector(selectors.queueToggle) ??
        player?.querySelector('.ytmusicTrackInfoTitle, .ytmusicTrackInfoThumbnailWrapper'),
    )
  )
    throw new Error('Choose a song to open the player page');
  if (upNext)
    clickControl(document.querySelector('ytmusic-player-page #side-panel tp-yt-paper-tab'));
}
