export const selectors = {
  player: ':is(ytmusic-player-bar, ytmusic-miniplayer)',
  title: '.title, .ytmusicTrackInfoTitle',
  byline: ':is(.byline, .ytmusicTrackInfoByline)',
  volumeSlider: '#volume-slider, .ytMusicMiniPlayerVolumeWrapper input[aria-label="Volume"]',
  volumeButton: '.volume button, .ytMusicMiniPlayerVolumeWrapper button',
  volumeAnchor: '.volume, .ytMusicMiniPlayerVolumeWrapper',
  artwork: 'img',
  next: '.next-button, [aria-label="Next"], [title="Next"]',
  previous: '.previous-button, [aria-label="Previous"], [title="Previous"]',
  repeat: '.repeat, [aria-label^="Repeat"], [title^="Repeat"]',
  shuffle: '.shuffle, [aria-label^="Shuffle"], [title^="Shuffle"]',
  queueToggle:
    '.toggle-player-page-button, #toggle-player-page-button, [aria-label="Open player page"], [title="Open player page"]',
  like: 'ytmusic-like-button-renderer [aria-pressed], like-button-view-model button',
  queue: 'ytmusic-player-queue',
  queueItems: 'ytmusic-player-queue-item',
} as const;
