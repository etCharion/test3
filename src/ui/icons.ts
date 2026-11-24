/**
 * Ikony jako inline SVG. Řetězce jsou statické (žádná data zvenku),
 * takže se smí vkládat přes innerHTML.
 */

const NS = 'http://www.w3.org/2000/svg';

const PATHS: Record<string, string> = {
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10.5 8v8M14 8v8M17.5 8v8"/>',
  books:
    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M10 4h4.5A1.5 1.5 0 0 1 16 5.5v13a1.5 1.5 0 0 1-1.5 1.5H10z"/><path d="M16 6h2.5A1.5 1.5 0 0 1 20 7.5v11"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M3 12h2.2M18.8 12H21M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
  torch:
    '<path d="M8 3h8v3l-2 2v4h-4V8L8 6z"/><path d="M10 12h4v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"/>',
  flip: '<path d="M4 8a8 8 0 0 1 13.6-3.4L20 7"/><path d="M20 4v3.5h-3.5"/><path d="M20 16a8 8 0 0 1-13.6 3.4L4 17"/><path d="M4 20v-3.5h3.5"/>',
  keyboard:
    '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M9.5 13.5h.01M13 13.5h.01M16.5 13.5h.01M8 16.5h8"/>',
  ocr: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M8 10h8M8 14h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  download: '<path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M5 19h14"/>',
  share: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  alert: '<path d="M12 8v5"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5"/>',
  book: '<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z"/><path d="M5 20a3 3 0 0 1 3-3h9"/>',
  cloud: '<path d="M7 18h9a4 4 0 0 0 .5-8A5.5 5.5 0 0 0 6 10.6 3.7 3.7 0 0 0 7 18z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/>',
};

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (extraClass) svg.setAttribute('class', extraClass);
  svg.innerHTML = PATHS[name] ?? '';
  return svg;
}

/** Tlačítko s ikonou pro lištu nad kamerou. */
export function iconButton(
  name: IconName,
  label: string,
  onClick: (event: Event) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.appendChild(icon(name));
  btn.addEventListener('click', onClick);
  return btn;
}
