/**
 * Testovací data: skutečná odpověď API katalogu Knihovny.cz.
 * Cloudové prostředí se na katalog nedostane, proto se testy nikdy nedotýkají sítě.
 */
import type { CatalogResponse } from '../core/catalog';

export const SAMPLE_RESPONSE: CatalogResponse = {
  resultCount: 1,
  records: [
    {
      id: 'mkp.3521868',
      title:
        'Životy slavných a starých provensálských básníků, kteří žili v dobách hrabat z kraje Provença',
      authors: {
        primary: { 'Jean de Nostredame, asi 1507-1577': [] },
        secondary: { 'Josef Prokop, 1971-': [], 'Vojtěch Domlátil, 1979-': [] },
        corporate: [],
      },
      publishers: ['Argo,'],
      placesOfPublication: ['Praha :'],
      publicationDates: ['2011'],
      physicalDescriptions: ['218 s. : il. ; 22 cm'],
      isbns: ['978-80-257-0367-0'],
      issns: [],
      cnb: 'cnb002163342',
      formats: ['0/BOOKS/'],
    },
  ],
  status: 'OK',
};

/** Nenalezeno: HTTP 200, resultCount 0, klíč records úplně chybí. */
export const EMPTY_RESPONSE = { resultCount: 0, status: 'OK' };

/**
 * Skutečné chování katalogu u starších knih (ověřeno proti živému API):
 * dotaz na 9788070613436 vrátí nula záznamů, ale desetimístné 8070613432
 * najde Saturnina. Záznam má v isbns jen desetimístný tvar.
 */
export const TEN_ONLY_RESPONSE: CatalogResponse = {
  resultCount: 1,
  records: [
    {
      id: 'mlp.10',
      title: 'Saturnin',
      authors: { primary: { 'Zdeněk Jirotka, 1911-2003': [] } },
      publishers: ['Československý spisovatel,'],
      placesOfPublication: ['Praha :'],
      publicationDates: ['1993'],
      physicalDescriptions: ['218 s.'],
      isbns: ['80-7061-343-2'],
      formats: ['0/BOOKS/'],
    },
  ],
  status: 'OK',
};

/**
 * Fake fetch, který odpovídá podle parametru `lookfor` v URL – pro testy
 * záložního tvaru ISBN (první dotaz 13 číslicemi, druhý 10).
 */
export function routedFetch(
  route: (lookfor: string, type: string) => unknown,
  init: { status?: number; onRequest?: (lookfor: string, type: string) => void } = {},
): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const params = new URL(url).searchParams;
    const lookfor = params.get('lookfor') ?? '';
    const type = params.get('type') ?? '';
    init.onRequest?.(lookfor, type);
    return Promise.resolve(
      new Response(JSON.stringify(route(lookfor, type)), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

/** Fake fetch, který první pokus zhavaruje (HTTP 5xx) a druhý už vrátí data. */
export function flakyFetch(body: unknown, failTimes = 1, status = 500): typeof fetch {
  let calls = 0;
  return (() => {
    calls += 1;
    const failing = calls <= failTimes;
    return Promise.resolve(
      new Response(failing ? '{}' : JSON.stringify(body), {
        status: failing ? status : 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

/**
 * Odpověď na dotaz podle názvu: první záznam je audiokniha jiného vydání,
 * druhý je hledaná kniha. Slouží k testu výběru správného vydání podle ISBN.
 */
export const MULTI_RESPONSE: CatalogResponse = {
  resultCount: 3,
  records: [
    {
      id: 'aud.1',
      title: 'Saturnin',
      authors: { primary: { 'Zdeněk Jirotka, 1911-2003': [] } },
      publishers: ['Knihovna a tiskárna pro nevidomé K. E. Macana'],
      placesOfPublication: ['Praha :'],
      publicationDates: ['2015'],
      physicalDescriptions: ['1 zvuková deska'],
      isbns: ['978-80-7294-123-4'],
      formats: ['0/AUDIO/'],
    },
    {
      id: 'mlp.2',
      title: 'Saturnin',
      authors: { primary: { 'Zdeněk Jirotka, 1911-2003': [] } },
      publishers: ['Československý spisovatel,'],
      placesOfPublication: ['Praha :'],
      publicationDates: ['c1993'],
      physicalDescriptions: ['218 s.'],
      isbns: ['80-202-0468-7'],
      formats: ['0/BOOKS/'],
    },
    {
      id: 'mlp.3',
      title: 'Saturnin',
      authors: { primary: { 'Zdeněk Jirotka, 1911-2003': [] } },
      publishers: ['XYZ,'],
      placesOfPublication: ['[Praha] :'],
      publicationDates: ['[2009]'],
      physicalDescriptions: ['260 stran'],
      isbns: ['978-80-7388-217-4'],
      cnb: 'cnb001987654',
      formats: ['0/BOOKS/'],
    },
  ],
  status: 'OK',
};

/** Záznam bez volitelných polí – testuje ?. a ?? (CNB chybí, isbns prázdné). */
export const SPARSE_RESPONSE: CatalogResponse = {
  resultCount: 1,
  records: [
    {
      id: 'abc.9',
      title: 'Neznámý titul',
      authors: {},
      formats: ['0/BOOKS/'],
    },
  ],
  status: 'OK',
};

/**
 * Pomocník: fake fetch, který vrátí dané tělo a stav.
 * Respektuje AbortSignal, aby testy časového limitu a rušení měly smysl
 * (skutečný fetch se chová stejně).
 */
export function fakeFetch(
  body: unknown,
  init: { status?: number; delayMs?: number; onRequest?: (url: string) => void } = {},
): typeof fetch {
  const { status = 200, delayMs = 0, onRequest } = init;
  return ((input: RequestInfo | URL, opts?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    onRequest?.(url);
    const signal = opts?.signal;
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve(
          new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }, delayMs);
      function onAbort() {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }) as typeof fetch;
}
