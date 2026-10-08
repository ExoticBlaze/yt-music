import type { PlayerCommand } from '../../shared/types/music';
import { selectors } from './selectors';
import { findMedia } from './detector';
import { clickControl, openPlayerPage } from './player-page';
import { openArtist } from './artist';

export async function executePlayerCommand(command: PlayerCommand): Promise<void> {
  const video = findMedia();
  const player = document.querySelector(selectors.player);
  if (
    command.type === 'openPlayerPage' ||
    command.type === 'openQueue' ||
    command.type === 'openUpNext'
  ) {
    await openPlayerPage(command.type !== 'openPlayerPage');
    return;
  }
  if (command.type === 'openArtist') {
    await openArtist();
    return;
  }
  if (command.type === 'openTrack') {
    const url = new URL('/watch', 'https://music.youtube.com');
    url.searchParams.set('v', command.videoId);
    if (command.playlistId) url.searchParams.set('list', command.playlistId);
    location.assign(url.href);
    return;
  }
  if (command.type === 'playQueueItem') {
    const item = document.querySelectorAll(selectors.queueItems)[command.index];
    const target =
      item?.querySelector<HTMLElement>('ytmusic-play-button-renderer, .song-title, a, .title') ??
      (item as HTMLElement | undefined);
    if (!target) throw new Error('Queue item is unavailable in the current page');
    target.click();
    return;
  }
  if (!video) throw new Error('YouTube Music player is not ready');
  switch (command.type) {
    case 'toggleMute':
      video.muted = !video.muted;
      break;
    case 'toggleShuffle':
    case 'cycleRepeat':
    case 'toggleLike': {
      const name = {
        toggleShuffle: 'shuffle',
        cycleRepeat: 'repeat',
        toggleLike: 'like',
      } as const;
      const button = player?.querySelector<HTMLElement>(selectors[name[command.type]]);
      if (!button) throw new Error('This YouTube Music control is not available yet');
      clickControl(button);
      break;
    }
    case 'play':
      await video.play();
      break;
    case 'pause':
      video.pause();
      break;
    case 'togglePlay':
      if (video.paused) await video.play();
      else video.pause();
      break;
    case 'seek':
      video.currentTime = Math.max(
        0,
        Math.min(command.value, Number.isFinite(video.duration) ? video.duration : command.value),
      );
      break;
    case 'setVolume':
      video.volume = Math.max(0, Math.min(1, command.value));
      if (video.volume > 0) video.muted = false;
      break;
    case 'setRate':
      video.playbackRate = Math.max(0.97, Math.min(1.03, command.value));
      break;
    case 'next':
    case 'previous': {
      const button = player?.querySelector<HTMLElement>(selectors[command.type]);
      if (!button) throw new Error(`${command.type} control is unavailable`);
      clickControl(button);
      break;
    }
  }
}
