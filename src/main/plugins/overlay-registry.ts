import type { Contribution, OverlayState, PanelData } from '../../shared/types/ui';

export class OverlayRegistry {
  private toastSequence = 0;
  private state: OverlayState = {
    panels: [],
    contributions: [],
    activePanel: null,
    activeView: 'music',
    toast: null,
  };
  readonly styles = new Map<string, string>();
  constructor(private readonly changed: () => void) {}
  get(): OverlayState {
    return structuredClone(this.state);
  }
  panel(panel: PanelData): void {
    this.state.panels = [
      ...this.state.panels.filter(
        (value) => !(value.id === panel.id && value.pluginId === panel.pluginId),
      ),
      panel,
    ];
    this.changed();
  }
  contribution(contribution: Contribution): void {
    this.state.contributions = [
      ...this.state.contributions.filter(
        (value) => !(value.id === contribution.id && value.pluginId === contribution.pluginId),
      ),
      contribution,
    ];
    this.changed();
  }
  remove(pluginId: string, id?: string): void {
    this.state.panels = this.state.panels.filter(
      (value) => value.pluginId !== pluginId || (id !== undefined && value.id !== id),
    );
    this.state.contributions = this.state.contributions.filter(
      (value) => value.pluginId !== pluginId || (id !== undefined && value.id !== id),
    );
    if (!id) this.styles.delete(pluginId);
    if (
      !this.state.panels.some((value) => `${value.pluginId}:${value.id}` === this.state.activePanel)
    )
      this.state.activePanel = null;
    this.changed();
  }
  open(pluginId: string, id: string): void {
    if (!this.state.panels.some((value) => value.pluginId === pluginId && value.id === id))
      throw new Error('Panel does not exist');
    const key = `${pluginId}:${id}`;
    this.state.activePanel = this.state.activePanel === key ? null : key;
    this.state.activeView = 'music';
    this.changed();
  }
  view(view: OverlayState['activeView']): void {
    this.state.activeView = view;
    this.state.activePanel = null;
    this.changed();
  }
  toast(text: string): void {
    this.state.toast = { id: ++this.toastSequence, text };
    this.changed();
  }
}
