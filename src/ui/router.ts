/**
 * Hash routing – jediná stránka, žádná konfigurace serveru.
 * Díky tomu aplikace funguje na GitHub Pages i v podadresáři a po instalaci
 * na plochu se otevírá rovnou tam, kde uživatel skončil.
 */

export type Route =
  | { name: 'scan' }
  | { name: 'list' }
  | { name: 'search'; query?: string }
  | { name: 'settings' }
  | { name: 'book'; id: string }
  | { name: 'new'; isbn?: string };

export function parseHash(hash: string): Route {
  const clean = (hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = clean.split('?');
  const params = new URLSearchParams(queryPart ?? '');
  const segments = (pathPart ?? '').split('/').filter(Boolean);

  switch (segments[0]) {
    case 'list':
      return { name: 'list' };
    case 'search':
      return { name: 'search', query: params.get('q') ?? undefined };
    case 'settings':
      return { name: 'settings' };
    case 'book':
      return segments[1] ? { name: 'book', id: decodeURIComponent(segments[1]) } : { name: 'list' };
    case 'new':
      return { name: 'new', isbn: params.get('isbn') ?? undefined };
    case 'scan':
    default:
      return { name: 'scan' };
  }
}

export function navigate(hash: string): void {
  if (location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  location.hash = hash;
}

export function goScan(): void {
  navigate('#/scan');
}

export function goList(): void {
  navigate('#/list');
}

export function goSearch(query?: string): void {
  navigate(query ? `#/search?q=${encodeURIComponent(query)}` : '#/search');
}

export function goSettings(): void {
  navigate('#/settings');
}

export function goBook(id: string): void {
  navigate(`#/book/${encodeURIComponent(id)}`);
}

export function goNew(isbn?: string): void {
  navigate(isbn ? `#/new?isbn=${encodeURIComponent(isbn)}` : '#/new');
}

/** Zpět v historii, nebo na skenování, když historie chybí (přímé otevření). */
export function goBack(): void {
  if (history.length > 1) history.back();
  else goScan();
}
