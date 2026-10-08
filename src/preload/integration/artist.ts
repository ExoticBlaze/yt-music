import { webFrame } from 'electron';
import { readSiteState } from './site-state';

function navigateArtist(browseId: string): boolean {
  const app = document.querySelector('ytmusic-app');
  if (!app) return false;
  app.dispatchEvent(
    new CustomEvent('yt-navigate', {
      bubbles: true,
      composed: true,
      detail: {
        endpoint: {
          browseEndpoint: {
            browseId,
            browseEndpointContextSupportedConfigs: {
              browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' },
            },
          },
        },
      },
    }),
  );
  return true;
}

export async function openArtist(): Promise<void> {
  const site = await readSiteState();
  const url = site.artistUrl ? new URL(site.artistUrl) : undefined;
  const id = url?.pathname.match(/^\/(?:channel|browse)\/([\w-]{1,200})\/?$/)?.[1];
  if (!id || url?.origin !== 'https://music.youtube.com' || url.username || url.password)
    throw new Error('Artist page is unavailable for this track');
  // Use the site's normal browse navigation, preserving the active player and queue.
  const navigated: boolean = await webFrame.executeJavaScript(
    `(${navigateArtist.toString()})(${JSON.stringify(id)})`,
  );
  if (!navigated) throw new Error('YouTube Music is still loading the artist page');
}
