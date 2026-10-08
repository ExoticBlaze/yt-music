import type { AppSettings } from '../../shared/types/settings';
import { NATIVE_PLAYER_HEIGHT } from '../../shared/constants/layout';

const nativePlayerCSS = `
:root, ytmusic-app { --ytmusic-player-bar-height: ${NATIVE_PLAYER_HEIGHT}px !important; }
:is(ytmusic-player-bar, ytmusic-miniplayer) {
  height: ${NATIVE_PLAYER_HEIGHT}px !important;
  min-height: ${NATIVE_PLAYER_HEIGHT}px !important;
  max-height: ${NATIVE_PLAYER_HEIGHT}px !important;
}
ytmusic-player-bar .left-controls,
ytmusic-player-bar .middle-controls,
ytmusic-player-bar .right-controls,
ytmusic-miniplayer .ytMusicMiniPlayerLeftSection,
ytmusic-miniplayer .ytMusicMiniPlayerRightSection {
  height: 100% !important;
  min-height: 0 !important;
}
ytmusic-player-bar #play-pause-button {
  width: 40px !important;
  height: 40px !important;
}
#ytmusic-plus-volume-percent {
  display: inline-block;
  flex: 0 0 38px;
  width: 38px;
  margin: 0 6px;
  color: var(--ytmusic-primary-text-color, #f5f5f5);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: right;
  white-space: nowrap;
  user-select: none;
}
`;

export function appearanceCSS(settings: AppSettings, pluginStyles: string[]): string {
  const value = settings.appearance;
  const surfaces: Record<string, string> = {
    youtube: '#030303',
    midnight: '#0b1322',
    amethyst: '#170f21',
  };
  // A filter on ytmusic-app changes the containing block for its fixed player
  // bar, moving the bar away from the viewport bottom. Blur only the bar.
  let css = `:root { --ytmusic-plus-accent: ${value.accent}; --ytmusic-plus-background: ${surfaces[value.theme] ?? '#030303'}; --ytmusic-plus-surface: #191919; --ytmusic-plus-radius: 16px; --ytmusic-plus-blur: ${value.blur}px; --ytmusic-color-black1: var(--ytmusic-plus-background); --ytmusic-color-black2: var(--ytmusic-plus-surface); --ytmusic-color-accent: var(--ytmusic-plus-accent); }\n:is(ytmusic-player-bar, ytmusic-miniplayer) { backdrop-filter: blur(var(--ytmusic-plus-blur)); }\n${nativePlayerCSS}\n${value.themeCss}`;
  if (value.background) {
    try {
      const url = new URL(value.background);
      if (url.protocol === 'https:')
        css += `ytmusic-app { background-image: url(${JSON.stringify(url.href)}); background-size: cover; background-attachment: fixed; }`;
    } catch {}
  }
  if (!value.animations)
    css += '* { animation-duration: 0s !important; transition-duration: 0s !important; }';
  css += pluginStyles.join('\n');
  return css;
}
