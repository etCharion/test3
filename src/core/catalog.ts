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
 *
 * Dvě věci ověřené proti živému katalogu (jinak by kniha „nebyla nalezena“):
 *  - Starší knihy jsou v katalogu často jen pod DESETIMÍSTNÝM ISBN. Dotaz
 *    třinácti číslicemi u nich vrátí resultCount 0 (např. 9788020204683 nic,
 *    8020204687 tři záznamy Saturnina). Proto se posílá 13 číslic, a když nic
 *    nenajdou, zkusí se ještě desetimístný tvar.
 *  - Katalog občas odpoví HTTP 500 i na platný dotaz, proto jeden pokus navíc.
 */

import { isbn13ToIsbn10, looseIsbn13, stripIsbn, toIsbn13 } from './isbn';

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
 *
 * Na HTTP 5xx (katalog občas zhavaruje i na platný dotaz) zkusí jeden pokus
 * navíc, ale jen dokud stačí časový limit – jinak by se čekání zdvojnásobilo.
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
  const deadline = Date.now() + timeoutMs;

  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await requestOnce(url, fetchImpl, Math.max(1, deadline - Date.now()), signal);
    if (response.ok) break;
    const retryable = response.status >= 500 && attempt === 0 && Date.now() < deadline;
    if (!retryable) {
      throw new CatalogError('http', `Katalog vrátil HTTP ${response.status}.`, response.status);
    }
  }
  if (!response) throw new CatalogError('network', 'Katalog je nedostupný.');

  let data: CatalogResponse;
  try {
    data = (await response.json()) as CatalogResponse;
  } catch {
    throw new CatalogError('parse', 'Odpověď katalogu není platné JSON.');
  }

  // Nenalezeno: klíč records úplně chybí.
  return data.records ?? [];
}

/** Jeden HTTP požadavek s časovým limitem a podporou vnějšího zrušení. */
async function requestOnce(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
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

  try {
    return await fetchImpl(url, { signal: ctrl.signal });
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
 * Tvary, kterými se má ISBN zkusit hledat, v pořadí: 13 číslic (novější knihy),
 * pak 10 číslic (starší knihy, které katalog pod třináctimístným tvarem nezná).
 * Vždycky jen číslice a X – pomlčky ani slovo „ISBN“ do dotazu nepatří.
 */
export function isbnQueryForms(rawIsbn: string): string[] {
  const forms: string[] = [];
  const isbn13 = toIsbn13(rawIsbn);
  if (isbn13) {
    forms.push(isbn13);
    const isbn10 = isbn13ToIsbn10(isbn13);
    if (isbn10) forms.push(isbn10);
  }
  if (forms.length === 0) {
    // Neplatná kontrolní číslice nebo překlep: pošle se, co z čísla zbylo.
    const digits = stripIsbn(rawIsbn);
    if (digits.length === 10 || digits.length === 13) forms.push(digits);
  }
  return forms;
}

/**
 * Najde záznam pro konkrétní ISBN.
 *
 * Katalog vrací i jiná vydání téhož díla, proto se nebere první záznam naslepo:
 * vybere se ten, jehož isbns hledané číslo po převodu na 13 číslic obsahují.
 *
 * Dotaz jde nejdřív třinácti číslicemi (desetimístné ISBN novější knihu
 * nenajde), a když nic nenajde, zkusí se ještě desetimístný tvar – starší knihy
 * jsou v katalogu často jen pod ním a jinak by se hlásily jako nenalezené.
 */
export async function findByIsbn(
  rawIsbn: string,
  options: SearchOptions = {},
): Promise<IsbnLookup> {
  const isbn13 = toIsbn13(rawIsbn);
  const limit = options.limit ?? 10;
  const records: CatalogRecord[] = [];
  const seen = new Set<string>();
  let lastError: unknown = null;
  let anySuccess = false;

  for (const form of isbnQueryForms(rawIsbn)) {
    let found: CatalogRecord[];
    try {
      found = await searchCatalog(form, 'ISN', { ...options, limit });
    } catch (err) {
      // Chyba u jednoho tvaru nemá zahodit, co už našel tvar předchozí.
      lastError = err;
      continue;
    }
    anySuccess = true;
    for (const record of found) {
      const key = record.id ?? JSON.stringify(record.isbns ?? []) + '|' + (record.title ?? '');
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(record);
    }
    const match = isbn13 ? pickRecordByIsbn(records, isbn13) : (records[0] ?? null);
    if (match) return { record: match, records, isbn13 };
  }

  if (!anySuccess && lastError) throw lastError;
  return { record: null, records, isbn13 };
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
