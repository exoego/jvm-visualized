import { h } from './dom';

let el: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (!el) {
    el = h('div', { class: 'tooltip', role: 'tooltip' });
    document.body.append(el);
  }
  return el;
}

export function showTooltip(x: number, y: number, ...content: (Node | string)[]): void {
  const tip = ensure();
  tip.replaceChildren(...content);
  tip.classList.add('show');
  const rect = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - 12, Math.max(12, x - rect.width / 2));
  const top = y - rect.height - 14 < 8 ? y + 20 : y - rect.height - 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function hideTooltip(): void {
  el?.classList.remove('show');
}
