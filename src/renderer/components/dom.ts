export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(
  label: string,
  callback: () => void,
  className = 'button',
): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.onclick = callback;
  return node;
}
export function sectionTitle(title: string, description: string): HTMLElement {
  const node = element('div', 'section-heading');
  node.append(element('h2', '', title), element('p', 'muted', description));
  return node;
}
export function field(label: string, control: HTMLElement, description?: string): HTMLElement {
  const row = element('label', 'field');
  const copy = element('span', 'field-copy');
  copy.append(element('span', 'field-label', label));
  if (description) copy.append(element('span', 'muted field-description', description));
  row.append(copy, control);
  return row;
}
export function toggle(value: boolean, callback: (value: boolean) => void): HTMLInputElement {
  const control = element('input', 'toggle');
  control.type = 'checkbox';
  control.checked = value;
  control.onchange = () => callback(control.checked);
  return control;
}
export function input(
  value: string,
  callback: (value: string) => void,
  type = 'text',
): HTMLInputElement {
  const node = element('input', 'text-input');
  node.type = type;
  node.value = value;
  node.onchange = () => callback(node.value);
  return node;
}
export function select(
  value: string,
  options: { value: string; label: string }[],
  callback: (value: string) => void,
): HTMLSelectElement {
  const node = element('select', 'text-input');
  for (const option of options) {
    const item = element('option', '', option.label);
    item.value = option.value;
    node.append(item);
  }
  node.value = value;
  node.onchange = () => callback(node.value);
  return node;
}
export function preserveFocus(container: HTMLElement, render: () => void): void {
  const active = document.activeElement;
  const id = active instanceof HTMLElement && container.contains(active) ? active.id : '';
  const start =
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type === 'text')
      ? active.selectionStart
      : null;
  const end =
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type === 'text')
      ? active.selectionEnd
      : null;
  render();
  if (!id) return;
  const replacement = document.getElementById(id);
  replacement?.focus();
  if (
    replacement instanceof HTMLTextAreaElement ||
    (replacement instanceof HTMLInputElement && replacement.type === 'text')
  )
    replacement.setSelectionRange(start, end);
}
