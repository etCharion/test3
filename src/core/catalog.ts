/**
 * Klient veřejného API katalogu Knihovny.cz.
 *
 * Ověřené chování (proti živému API):
 *  - GET https://www.knihovny.cz/api/v1/search, CORS povolen, volá se přímo
 *    z prohlížeče, bez vlastních hlaviček a bez API klíče.
 *  - type: ISN | Title | Author | AllFields | adv_search_nbn, jiná hodnota = 500.
 *  - limit: 0–100 (nad 100 = 400).
 *  - Bez field[] nepřijde nakladatel, rok, ISBN ani ČNB.
 *  - Nenalezeno = HTTP 200 s resultCount 0 a CHYBĚJÍCÍM klíčem records.
 */

import { looseIsbn13, toIsbn13 } from './isbn';

export const CATALOG_ENDPOINT = 'https://www.knihovny.cz/api/v1/search';

/** Pole, která si vyžádáme. (nbn/nbns/publicationPlaces/languages neexistují.) */
export const CATALOG_FIELDS = [
  'id',
  'title',
  'authors',
  'publishers',
  'placesOfPublication',
  'publicationDates',
  'physicalDescriptions',
  'isbns',
  'issns',
  'cnb',
  'formats',
] as const;

export type CatalogField = (typeof CATALOG_FIELDS)[number];

export type CatalogSearchType = 'ISN' | 'Title' | 'Author' | 'AllFields' | 'adv_search_nbn';

/** Autoři přijdou jako objekt, kde jména jsou KLÍČE. */
export interface CatalogAuthors {
  primary?: Record<string, unknown> | null;
  secondary?: Record<string, unknown> | null;
  corporate?: unknown[] | Record<string, unknown> | null;
}

export interface CatalogRecord {
  id?: string;
  title?: string;
  authors?: CatalogAuthors | null;
  publishers?: string[];
  placesOfPublication?: string[];
  publicationDates?: string[];
  physicalDescriptions?: string[];
  isbns?: string[];
  issns?: string[];
  cnb?: string | null;
  formats?: string[];
}

export interface CatalogResponse {
  resultCount?: number;
  records?: CatalogRecord[];
  status?: string;
}

export type CatalogErrorCode = 'network' | 'timeout' | 'http' | 'parse' | 'aborted';

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly status?: number;
  constructor(code: CatalogErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export interface SearchOptions {
  /** Vlastní fetch (testy). */
  fetchImpl?: typeof fetch;
  /** Časový limit v ms, výchozí 8 s. */
  timeoutMs?: number;
  /** Vnější signál pro zrušení (např. nový dotaz v UI). */
  signal?: AbortSignal;
  limit?: number;
}

/** Sestaví URL dotazu přes URLSearchParams (field[] se opakuje). */
export function buildSearchUrl(lookfor: string, type: CatalogSearchType, limit = 10): string {
  const p = new URLSearchParams({ lookfor, type, limit: String(limit) });
  for (const pole of CATALOG_FIELDS) p.append('field[]', pole);
  return CATALOG_ENDPOINT + '?' + p.toString();
}

/**
 * Odešle dotaz do katalogu a vrátí záznamy.
 * Síť, limit i HTTP chyby jsou zabalené do CatalogError, aby je UI umělo
 * rozlišit („katalog neodpovídá“ vs. „nic nenalezeno“).
 */
export async function searchCatalog(
  lookfor: string,
  type: CatalogSearchType,
  options: SearchOptions = {},
): Promise<CatalogRecord[]> {
  const query = (lookfor ?? '').trim();
  if (!query) return [];

  const { fetchImpl = globalThis.fetch, timeoutMs = 8000, signal, limit = 10 } = options;
  const url = buildSearchUrl(query, type, limit);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onOuterAbort = () => ctrl.abort(new Error('aborted'));
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new CatalogError('aborted', 'Dotaz byl zrušen.');
    }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetchImpl(url, { signal: ctrl.signal });
  } catch (err) {
    const timedOut = ctrl.signal.aborted && !(signal?.aborted ?? false);
    if (timedOut) {
      throw new CatalogError('timeout', 'Katalog neodpověděl do 8 sekund.');
    }
    if (signal?.aborted) throw new CatalogError('aborted', 'Dotaz byl zrušen.');
    const msg = err instanceof Error ? err.message : String(err);
    throw new CatalogError('network', 'Katalog je nedostupný: ' + msg);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }

  if (!response.ok) {
    throw new CatalogError('http', `Katalog vrátil HTTP ${response.status}.`, response.status);
  }

  let data: CatalogResponse;
  try {
    data = (await response.json()) as CatalogResponse;
  } catch {
    throw new CatalogError('parse', 'Odpověď katalogu není platné JSON.');
  }

  // Nenalezeno: klíč records úplně chybí.
  return data.records ?? [];
}

export interface IsbnLookup {
  /** Záznam, jehož isbns obsahují hledané číslo (null = nenalezeno). */
  record: CatalogRecord | null;
  /** Všechny záznamy, které katalog vrátil (pro ruční výběr jiného vydání). */
  records: CatalogRecord[];
  /** Normalizované hledané ISBN-13 (null = ze vstupu nešlo ISBN udělat). */
  isbn13: string | null;
}

/**
 * Najde záznam pro konkrétní ISBN.
 *
 * Katalog vrací i jiná vydání téhož díla, proto se nebere první záznam naslepo:
 * vybere se ten, jehož isbns hledané číslo po převodu na 13 číslic obsahují.
 */
export async function findByIsbn(
  rawIsbn: string,
  options: SearchOptions = {},
): Promise<IsbnLookup> {
  const isbn13 = toIsbn13(rawIsbn);
  // Dotaz vždy 13 číslicemi – desetimístné ISBN novější knihy nenajde.
  const query = isbn13 ?? rawIsbn.replace(/[^0-9Xx]/g, '');
  const records = await searchCatalog(query, 'ISN', { ...options, limit: options.limit ?? 10 });
  const record = isbn13 ? pickRecordByIsbn(records, isbn13) : (records[0] ?? null);
  return { record, records, isbn13 };
}

/** Vybere záznam, jehož pole isbns obsahuje hledané ISBN-13. */
export function pickRecordByIsbn(
  records: CatalogRecord[],
  isbn13: string,
): CatalogRecord | null {
  const target = looseIsbn13(isbn13);
  if (!target) return null;
  for (const record of records) {
    for (const value of record.isbns ?? []) {
      if (looseIsbn13(value) === target) return record;
    }
  }
  return null;
}

/** Je záznam kniha? (audioknihy a CD mají jiné formats) */
export function isBookRecord(record: CatalogRecord): boolean {
  const formats = record.formats ?? [];
  if (formats.length === 0) return true; // pole formats nepřišlo → nefiltrovat
  return formats.some((f) => f.includes('0/BOOKS/'));
}
