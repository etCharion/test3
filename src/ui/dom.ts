/**
 * Drobná pomocná vrstva nad DOM.
 *
 * Vše se staví přes `h()` a textContent, nikdy přes innerHTML s daty
 * z katalogu – názvy knih přicházejí zvenku a do HTML nepatří.
 */

export type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  autofocus?: boolean;
  autoplay?: boolean;
  playsinline?: boolean;
  accept?: string;
  inputmode?: string;
  autocomplete?: string;
  maxlength?: number;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  rows?: number;
  href?: string;
  target?: string;
  rel?: string;
  id?: string;
  name?: string;
  role?: string;
  'aria-label'?: string;
  'aria-live'?: string;
  'aria-modal'?: string;
  dataset?: Record<string, string>;
  style?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'html') el.innerHTML = String(value);
    else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
        el.dataset[dk] = dv;
      }
    } else if (key === 'on') {
      for (const [event, handler] of Object.entries(value as Record<string, EventListener>)) {
        el.addEventListener(event, handler);
      }
    } else if (key === 'value') {
      (el as HTMLInputElement).value = String(value);
    } else if (key === 'checked' || key === 'disabled' || key === 'autofocus') {
      (el as HTMLInputElement)[key] = Boolean(value);
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Krátká zpráva dole nad lištou. */
export function toast(message: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'info', ms = 2600): void {
  const host = document.getElementById('toast-host') ?? document.body;
  const node = h('div', { class: `toast toast--${kind}`, role: 'status', 'aria-live': 'polite' }, message);
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast--in'));
  setTimeout(() => {
    node.classList.remove('toast--in');
    setTimeout(() => node.remove(), 250);
  }, ms);
}

/** Synchronní potvrzení – vrací Promise, aby se dalo await-ovat. */
export function confirmDialog(message: string, confirmLabel = 'Smazat'): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };
    const overlay = h(
      'div',
      { class: 'modal', on: { click: (e) => { if (e.target === overlay) close(false); } } },
      h(
        'div',
        { class: 'modal__box' },
        h('p', { class: 'modal__text', text: message }),
        h(
          'div',
          { class: 'modal__actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', on: { click: () => close(false) } }, 'Zrušit'),
          h('button', { class: 'btn btn--danger', type: 'button', on: { click: () => close(true) } }, confirmLabel),
        ),
      ),
    );
    document.body.appendChild(overlay);
  });
}

/** Vibrace + krátký tón po načtení kódu. */
export function feedback(enabled: boolean): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(60);
  } catch {
    /* ignorujeme */
  }
  try {
    const Ctx = globalThis.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1180;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    setTimeout(() => void ctx.close(), 400);
  } catch {
    /* zvuk není podmínkou */
  }
}

/** Drží obrazovku zapnutou, dokud je skenování aktivní. */
export class ScreenWakeLock {
  private lock: { release(): Promise<void> } | null = null;
  private wanted = false;

  async enable(): Promise<void> {
    this.wanted = true;
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    if (!nav.wakeLock) return;
    try {
      this.lock = await nav.wakeLock.request('screen');
    } catch {
      /* prohlížeč to nepovolil – nevadí */
    }
  }

  async disable(): Promise<void> {
    this.wanted = false;
    try {
      await this.lock?.release();
    } catch {
      /* ignorujeme */
    }
    this.lock = null;
  }

  /** Po návratu na kartu je potřeba zámek obnovit. */
  async refresh(): Promise<void> {
    if (!this.wanted) return;
    if (document.visibilityState !== 'visible') return;
    await this.enable();
  }
}
