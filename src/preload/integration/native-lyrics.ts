import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/constants/ipc';
import type { PanelData } from '../../shared/types/ui';
import type { PlaybackState } from '../../shared/types/music';
import { renderNode } from '../../renderer/overlay/panels';
import { openPlayerPage } from './player-page';

const css = `
:host{display:flex;flex-direction:column;min-height:0;height:100%;color:#fff;font-family:Roboto,Arial,sans-serif;font-size:14px;color-scheme:dark}
*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{border:0;cursor:pointer;background:#242424;color:#eee;padding:9px 12px;border-radius:8px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #ff4545;outline-offset:2px}[hidden]{display:none!important}
.body{overflow:auto;flex:1;min-height:0;padding:20px 24px 32px;scrollbar-width:thin}.panel-text{white-space:pre-line;line-height:1.7}.muted{color:#999}.error{color:#ff7777}hr{border:0;border-top:1px solid #333}.field{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0;font-size:13px}.field-copy{display:flex;flex-direction:column}.text-input{max-width:55%;background:#242424;border:1px solid #444;color:#eee;border-radius:6px;padding:6px}.range{max-width:50%;accent-color:#ff4545}.button{margin:5px 5px 5px 0}.lyrics-wrapper{position:relative}.lyrics-scroll{position:relative;max-height:calc(100vh - 340px);min-height:180px;overflow:auto;padding:24px 0 90px;scrollbar-width:thin}.lyrics-scroll.center{text-align:center}.lyric-line{display:block;width:100%;font-size:inherit;font-weight:650;color:#777;line-height:1.5;text-align:inherit;padding:11px 0;background:transparent;transition:color .25s}.lyric-line.current{color:#fff}.lyric-line:hover{color:#ddd}.lyric-translation{display:block;font-size:.55em;font-weight:400;color:#aaa}.follow-button{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);white-space:nowrap;border:1px solid #444;border-radius:20px;font-size:12px}.options{margin-top:18px;color:#bbb}.options summary{cursor:pointer;padding:10px 0}.options-content{padding:8px 0}.code-block{white-space:pre-wrap}
`;

export class NativeLyrics {
  private panel: PanelData | null = null;
  private host?: HTMLElement;
  private shadow?: ShadowRoot;
  private side?: HTMLElement;
  private cleanups: (() => void)[] = [];
  private signature = '';
  private selected = false;
  private requested = false;
  private pendingOpen = false;
  private style = document.createElement('style');
  private originalTabs = new Map<
    HTMLElement,
    { disabled: string | null; tabindex: string | null }
  >();
  constructor(private getMusic: () => { state: PlaybackState; received: number }) {
    this.style.textContent = `ytmusic-player-page #side-panel[data-ytm-lyrics] tp-yt-paper-tab:nth-of-type(2){pointer-events:auto!important;opacity:1!important}ytmusic-player-page #side-panel[data-ytm-lyrics-active] #tab-renderer{display:none!important}ytmusic-player-page #side-panel[data-ytm-lyrics-active] .tab-header{color:#888}ytmusic-player-page #side-panel[data-ytm-lyrics-active] .tab-header:nth-of-type(2){color:#fff;border-bottom:2px solid #fff}ytmusic-player-page #side-panel[data-ytm-lyrics-active] #selectionBar{visibility:hidden}`;
    document.addEventListener('click', this.click, true);
    document.addEventListener('keydown', this.keydown, true);
  }
  update(panel: PanelData | null, open: boolean): void {
    this.panel = panel;
    if (open && !this.requested) this.pendingOpen = true;
    if (!open && this.requested) this.selected = false;
    this.requested = open;
    this.discover();
  }
  discover(): void {
    if (!this.panel) {
      this.remove();
      return;
    }
    const side = document.querySelector<HTMLElement>('ytmusic-player-page #side-panel');
    if (!side) return;
    if (!this.style.isConnected) document.documentElement.append(this.style);
    if (this.side !== side || !this.host?.isConnected) {
      this.removeHost();
      this.side = side;
      this.host = document.createElement('section');
      this.host.id = 'ytmusic-plus-native-lyrics';
      this.host.setAttribute('role', 'tabpanel');
      this.host.setAttribute('aria-label', 'Lyrics');
      this.host.style.cssText = 'flex:1;min-height:0;overflow:hidden;width:100%;';
      this.shadow = this.host.attachShadow({ mode: 'closed' });
      side.append(this.host);
      this.signature = '';
    }
    side.dataset.ytmLyrics = '';
    const tab = this.lyricsTab();
    if (tab) {
      if (!this.originalTabs.has(tab))
        this.originalTabs.set(tab, {
          disabled: tab.getAttribute('aria-disabled'),
          tabindex: tab.getAttribute('tabindex'),
        });
      tab.setAttribute('aria-disabled', 'false');
      tab.setAttribute('tabindex', '0');
    }
    if (this.pendingOpen) {
      void openPlayerPage().catch((error) => console.error('YTMusic+ lyrics page:', String(error)));
      this.selected = true;
      this.pendingOpen = false;
    }
    this.applySelection();
    const signature = JSON.stringify(this.panel);
    if (signature === this.signature) return;
    this.signature = signature;
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    const style = document.createElement('style');
    style.textContent = css;
    const body = document.createElement('div');
    body.className = 'body';
    const panel = this.panel;
    const invoke = (action: string, value?: string | number | boolean) =>
      ipcRenderer.send(IPC.nativeLyricsAction, { pluginId: panel.pluginId, action, value });
    const divider = panel.nodes.findIndex((node) => node.type === 'divider');
    const content = divider < 0 ? panel.nodes : panel.nodes.slice(0, divider);
    for (const node of content) body.append(renderNode(node, invoke, this.getMusic, this.cleanups));
    if (divider >= 0) {
      const options = document.createElement('details');
      options.className = 'options';
      const summary = document.createElement('summary');
      summary.textContent = 'Lyrics options';
      const controls = document.createElement('div');
      controls.className = 'options-content';
      for (const node of panel.nodes.slice(divider + 1))
        controls.append(renderNode(node, invoke, this.getMusic, this.cleanups));
      options.append(summary, controls);
      body.append(options);
    }
    this.shadow!.replaceChildren(style, body);
  }
  private lyricsTab(): HTMLElement | undefined {
    return this.side?.querySelectorAll<HTMLElement>('tp-yt-paper-tab')[1];
  }
  private click = (event: Event) => {
    if (!this.panel || !(event.target instanceof Element)) return;
    const tab = event.target.closest<HTMLElement>('tp-yt-paper-tab');
    if (!tab || !this.side?.contains(tab)) return;
    if (tab === this.lyricsTab()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.selected = true;
    } else this.selected = false;
    this.applySelection();
  };
  private keydown = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === this.lyricsTab())
      this.click(event);
  };
  private applySelection(): void {
    if (!this.side || !this.host) return;
    this.side.toggleAttribute('data-ytm-lyrics-active', this.selected);
    this.host.style.display = this.selected ? 'flex' : 'none';
    if (this.selected)
      for (const tab of this.side.querySelectorAll<HTMLElement>('tp-yt-paper-tab'))
        tab.setAttribute('aria-selected', String(tab === this.lyricsTab()));
    else
      for (const tab of this.side.querySelectorAll<HTMLElement>('tp-yt-paper-tab'))
        tab.setAttribute('aria-selected', String(tab.classList.contains('iron-selected')));
  }
  private removeHost(): void {
    if (this.side)
      for (const tab of this.side.querySelectorAll<HTMLElement>('tp-yt-paper-tab'))
        tab.setAttribute('aria-selected', String(tab.classList.contains('iron-selected')));
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.host?.remove();
    this.side?.removeAttribute('data-ytm-lyrics');
    this.side?.removeAttribute('data-ytm-lyrics-active');
  }
  private remove(): void {
    this.removeHost();
    this.style.remove();
    for (const [tab, original] of this.originalTabs) {
      for (const [attribute, value] of [
        ['aria-disabled', original.disabled],
        ['tabindex', original.tabindex],
      ] as const) {
        if (value === null) tab.removeAttribute(attribute);
        else tab.setAttribute(attribute, value);
      }
    }
    this.originalTabs.clear();
    this.host = undefined;
    this.side = undefined;
    this.selected = false;
    this.pendingOpen = false;
    this.signature = '';
  }
  dispose(): void {
    this.remove();
    document.removeEventListener('click', this.click, true);
    document.removeEventListener('keydown', this.keydown, true);
  }
}
