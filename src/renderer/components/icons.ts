const paths: Record<string, string> = {
  crossfade: '<path d="M3 5c9 0 9 14 18 14M3 19c9 0 9-14 18-14"/><path d="M3 12h18"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  play: '<path fill="currentColor" stroke="none" d="m8 4 12 8-12 8V4Z"/>',
  pause: '<path fill="currentColor" stroke="none" d="M6 4h4v16H6V4Zm8 0h4v16h-4V4Z"/>',
  previous: '<path d="M5 5v14"/><path fill="currentColor" stroke="none" d="M19 5 7 12l12 7V5Z"/>',
  next: '<path d="M19 5v14"/><path fill="currentColor" stroke="none" d="m5 5 12 7-12 7V5Z"/>',
  shuffle: '<path d="M3 6h3l12 12h3m-4-4 4 4-4 4M3 18h3l4-4m4-4 4-4h3m-4-4 4 4-4 4"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-3v5a2 2 0 0 1-2 2H3"/>',
  heart: '<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-4 4 2 9 8 15 6-6 12-11 8-15Z"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',
  queue: '<path d="M3 5h18M3 10h18M3 15h10m4-1 5 4-5 4v-8Z"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  lyrics:
    '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="18" cy="16" rx="3" ry="2"/>',
  rooms:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  discord:
    '<path d="M6 5l-3 13 5 2 1-3h6l1 3 5-2-3-13-4-1-1 2h-2l-1-2-4 1Z"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/>',
  theme:
    '<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-4-5-6-9-6Z"/><path d="M7 9h.01M11 6h.01M16 7h.01M5 13h.01"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18"/>',
  puzzle:
    '<path d="M3 3h6v3a3 3 0 0 0 6 0V3h6v6h-3a3 3 0 0 0 0 6h3v6h-6v-3a3 3 0 0 0-6 0v3H3v-6h3a3 3 0 0 0 0-6H3V3Z"/>',
  settings:
    '<path d="m12 2 2 3 3-1 1 3 3 2-1 3 1 3-3 2-1 3-3-1-2 3-2-3-3 1-1-3-3-2 1-3-1-3 3-2 1-3 3 1Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  home: '<path d="m3 10 9-7 9 7v11H3V10Zm6 11v-7h6v7"/>',
};
export function icon(name: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.puzzle}</svg>`;
  return span;
}
