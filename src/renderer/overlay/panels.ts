import type { PanelData, UINode } from '../../shared/types/ui';
import type { PlaybackState } from '../../shared/types/music';
import { element, button, field, input, select, toggle } from '../components/dom';

export function renderPanel(
  panel: PanelData,
  getMusic: () => { state: PlaybackState; received: number },
  close: () => void,
): { element: HTMLElement; dispose: () => void } {
  const root = element('aside', `plugin-panel ${panel.kind}`);
  const header = element('div', 'panel-heading');
  const heading = element('div');
  heading.append(
    element('span', 'eyebrow', panel.subtitle ?? 'YTMusic+ EXTENSION'),
    element('h2', '', panel.title),
  );
  header.append(heading, button('×', close, 'close-panel'));
  root.append(header);
  const body = element('div', 'panel-body');
  root.append(body);
  const cleanups: (() => void)[] = [];
  const invoke = (action: string, value?: string | number | boolean) => {
    void window.ytmusic
      .request({ type: 'pluginAction', pluginId: panel.pluginId, action, value })
      .catch((error) => console.error(error));
  };
  for (const node of panel.nodes) body.append(renderNode(node, invoke, getMusic, cleanups));
  return { element: root, dispose: () => cleanups.forEach((cleanup) => cleanup()) };
}
export function renderNode(
  node: UINode,
  invoke: (action: string, value?: string | number | boolean) => void,
  getMusic: () => { state: PlaybackState; received: number },
  cleanups: (() => void)[],
): HTMLElement {
  switch (node.type) {
    case 'text':
      return element('p', `panel-text ${node.tone ?? ''}`, node.text);
    case 'divider':
      return element('hr');
    case 'code':
      return element('pre', 'code-block', node.text);
    case 'button': {
      const value = button(
        node.label,
        () => invoke(node.action),
        node.primary ? 'button primary' : 'button secondary',
      );
      value.disabled = !!node.disabled;
      return value;
    }
    case 'input': {
      const control = node.multiline
        ? element('textarea', 'text-input code-editor')
        : input(node.value, (value) => invoke(node.action, value));
      control.value = node.value;
      control.id = `plugin-${node.id}`;
      control.placeholder = node.placeholder ?? '';
      if (node.multiline) {
        let timer: ReturnType<typeof setTimeout>;
        control.oninput = () => {
          clearTimeout(timer);
          timer = setTimeout(() => invoke(node.action, control.value), 350);
        };
        cleanups.push(() => clearTimeout(timer));
      }
      return field(node.label, control);
    }
    case 'toggle':
      return field(
        node.label,
        toggle(node.value, (value) => invoke(node.action, value)),
      );
    case 'select': {
      const control = select(node.value, node.options, (value) => invoke(node.action, value));
      control.id = `plugin-${node.id}`;
      return field(node.label, control);
    }
    case 'range': {
      const control = element('input', 'range');
      control.type = 'range';
      control.min = String(node.min);
      control.max = String(node.max);
      control.step = String(node.step ?? 1);
      control.value = String(node.value);
      control.id = `plugin-${node.id}`;
      control.onchange = () => invoke(node.action, Number(control.value));
      return field(`${node.label} · ${node.value}`, control);
    }
    case 'participants': {
      const list = element('div', 'participants');
      for (const participant of node.participants) {
        const row = element('div', 'participant');
        row.append(
          element('span', 'avatar', participant.name.slice(0, 1).toUpperCase()),
          element('span', 'participant-name', participant.name),
          element('span', `role ${participant.role}`, participant.role),
        );
        if (node.promoteAction && participant.role !== 'host')
          row.append(
            button(
              participant.role === 'dj' ? '↓' : '↑',
              () => invoke(node.promoteAction!, participant.id),
              'small-button',
            ),
          );
        if (node.kickAction && participant.role !== 'host')
          row.append(button('×', () => invoke(node.kickAction!, participant.id), 'small-button'));
        list.append(row);
      }
      return list;
    }
    case 'lyrics': {
      const wrapper = element('div', 'lyrics-wrapper');
      const scroll = element('div', `lyrics-scroll ${node.align}`);
      scroll.style.fontSize = `${node.fontSize}px`;
      const lines = node.lines.map((line) => {
        const value = element('button', 'lyric-line');
        value.append(element('span', '', line.text || '♪'));
        if (node.translation && line.translation)
          value.append(element('small', 'lyric-translation', line.translation));
        if (node.romanized && line.romanized)
          value.append(element('small', 'lyric-translation', line.romanized));
        value.onclick = () => {
          if (node.seekAction) invoke(node.seekAction, line.time);
        };
        return value;
      });
      scroll.append(...lines);
      const follow = button(
        'Return to current line ↓',
        () => {
          manualUntil = 0;
          previous = -2;
          update();
        },
        'follow-button',
      );
      wrapper.append(scroll, follow);
      let manualUntil = 0;
      let previous = -2;
      let wasManual = false;
      const manual = () => {
        manualUntil = Date.now() + 8000;
      };
      scroll.addEventListener('wheel', manual, { passive: true });
      scroll.addEventListener('pointerdown', manual);
      const update = () => {
        const { state, received } = getMusic();
        const elapsed = state.playing ? Math.max(0, performance.now() - received) / 1000 : 0;
        const position = (state.track?.position ?? 0) + elapsed + node.offset / 1000;
        let active = -1;
        for (let i = 0; i < node.lines.length; i++) {
          if (node.lines[i]!.time <= position) active = i;
          else break;
        }
        const manuallyScrolling = Date.now() < manualUntil;
        follow.hidden = !manuallyScrolling;
        if (active !== previous) {
          lines[previous]?.classList.remove('current');
          lines[active]?.classList.add('current');
        }
        const target = lines[active];
        if (target && !manuallyScrolling && (active !== previous || wasManual))
          scroll.scrollTo({
            top:
              target.offsetTop -
              scroll.offsetTop -
              scroll.clientHeight / 2 +
              target.clientHeight / 2,
            behavior: 'smooth',
          });
        previous = active;
        wasManual = manuallyScrolling;
      };
      const timer = setInterval(update, 200);
      update();
      cleanups.push(() => clearInterval(timer));
      return wrapper;
    }
  }
}
