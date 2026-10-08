import type { Input } from 'electron';

export function normalizeShortcut(shortcut: string): string {
  const keys = shortcut
    .toLowerCase()
    .replace(/control|commandorcontrol|cmdorctrl/g, 'ctrl')
    .split('+')
    .map((value) => value.trim());
  const key = keys.pop() ?? '';
  return [...['ctrl', 'alt', 'shift', 'meta'].filter((value) => keys.includes(value)), key].join(
    '+',
  );
}
export function matchesShortcut(input: Input, shortcut: string): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false;
  return (
    normalizeShortcut(
      [
        input.control || (process.platform === 'darwin' && input.meta) ? 'Ctrl' : '',
        input.alt ? 'Alt' : '',
        input.shift ? 'Shift' : '',
        input.meta && process.platform !== 'darwin' ? 'Meta' : '',
        input.key,
      ]
        .filter(Boolean)
        .join('+'),
    ) === normalizeShortcut(shortcut)
  );
}
export function shortcutConflicts(shortcuts: Record<string, string>): string[] {
  const used = new Map<string, string>();
  const conflicts: string[] = [];
  for (const [id, value] of Object.entries(shortcuts)) {
    if (!value) continue;
    const normalized = normalizeShortcut(value);
    const previous = used.get(normalized);
    if (previous && previous !== id) conflicts.push(`${value}: ${previous} and ${id}`);
    used.set(normalized, id);
  }
  return conflicts;
}
