/**
 * Aplikační logika mezi katalogem, úložištěm a UI.
 * UI obrazovky odsud berou data a nevolají fetch ani localStorage přímo.
 */

import { findByIsbn, isBookRecord, searchCatalog, CatalogError, type CatalogRecord, type CatalogSearchType } from '../core/catalog';
import { mapRecordToBook, describeRecord } from '../core/record';
import { extractIsbn, toIsbn13 } from '../core/isbn';
import { LibraryStore } from '../core/store';
import { emptyBook, type Book, type IsbnSource } from '../core/types';

/** Jediná instance knihovny pro celou aplikaci. */
export const store = new LibraryStore();

export type LookupStatus = 'found' | 'notfound' | 'invalid' | 'error';

export interface LookupResult {
  status: LookupStatus;
  /** Nalezená kniha (připravená k uložení, ještě neuložená). */
  book: Book | null;
  /** Všechny záznamy z katalogu – pro ruční výběr jiného vydání. */
  records: CatalogRecord[];
  isbn13: string | null;
  /** Už je tahle kniha v knihovně? */
  duplicate: Book | null;
  message: string | null;
}

function invalidResult(message: string): LookupResult {
  return { status: 'invalid', book: null, records: [], isbn13: null, duplicate: null, message };
}

/**
 * Načte knihu podle naskenovaného/opsaného kódu.
 *
 * Když kód není ISBN (třeba jiný EAN), neposílá se do katalogu a UI to řekne.
 * Když katalog nic nenajde, vrací se 'notfound' – knihu lze přesto uložit.
 */
export async function lookupIsbn(
  raw: string,
  isbnSource: IsbnSource = 'barcode',
): Promise<LookupResult> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return invalidResult('Prázdný kód.');

  const isbn13 = toIsbn13(trimmed) ?? extractIsbn(trimmed);
  if (!isbn13) {
    return invalidResult(
      `Tento kód není platné ISBN (${trimmed}). Zkontrolujte ho, nebo knihu vyplňte ručně.`,
    );
  }

  const duplicate = store.findByIsbn(isbn13) ?? null;

  try {
    const result = await findByIsbn(isbn13);
    if (result.record) {
      const book = mapRecordToBook(result.record, {
        isbn13,
        isbnRaw: trimmed,
        isbnSource,
      });
      return {
        status: 'found',
        book,
        records: result.records,
        isbn13,
        duplicate,
        message: null,
      };
    }
    // Nenalezeno – ale knihu jde uložit i tak, s ručním doplněním.
    const book = emptyBook({
      isbn13,
      isbnRaw: trimmed,
      isbnSource,
      title: '',
      source: 'manual',
    });
    return {
      status: 'notfound',
      book,
      records: result.records,
      isbn13,
      duplicate,
      message: 'V katalogu se nenašla kniha s tímto ISBN.',
    };
  } catch (err) {
    const message =
      err instanceof CatalogError
        ? err.code === 'timeout'
          ? 'Katalog neodpovídá (časový limit 8 s). Zkuste to znovu.'
          : err.code === 'network'
            ? 'Katalog je nedostupný. Zkontrolujte připojení k internetu.'
            : `Katalog vrátil chybu: ${err.message}`
        : 'Katalog se nepodařilo oslovit.';
    const book = emptyBook({ isbn13, isbnRaw: trimmed, isbnSource, title: '', source: 'manual' });
    return { status: 'error', book, records: [], isbn13, duplicate, message };
  }
}

export interface SearchHit {
  record: CatalogRecord;
  description: string;
  isbn13: string | null;
  isBook: boolean;
  alreadyInLibrary: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  message: string | null;
  status: 'ok' | 'empty' | 'error';
}

/**
 * Hledání v katalogu podle názvu, autora nebo všeho dohromady.
 * Audioknihy a CD jdou do výsledků také, ale označené – knihy se poznají
 * podle formats "0/BOOKS/".
 */
export async function searchBooks(
  query: string,
  type: CatalogSearchType,
  limit = 20,
): Promise<SearchResult> {
  const q = (query ?? '').trim();
  if (!q) return { hits: [], message: null, status: 'empty' };
  try {
    const records = await searchCatalog(q, type, { limit });
    const hits: SearchHit[] = records.map((record) => {
      const isbn13 = toIsbn13((record.isbns ?? [])[0] ?? '');
      return {
        record,
        description: describeRecord(record),
        isbn13,
        isBook: isBookRecord(record),
        alreadyInLibrary: isbn13 ? !!store.findByIsbn(isbn13) : false,
      };
    });
    // Knihy první – u hledání podle názvu chodí i mluvené slovo.
    hits.sort((a, b) => Number(b.isBook) - Number(a.isBook));
    return {
      hits,
      status: hits.length ? 'ok' : 'empty',
      message: hits.length ? null : 'Katalog nic nenašel. Zkuste jiný výraz.',
    };
  } catch (err) {
    const message =
      err instanceof CatalogError && err.code === 'timeout'
        ? 'Katalog neodpovídá (časový limit 8 s).'
        : 'Katalog je nedostupný. Zkontrolujte připojení.';
    return { hits: [], message, status: 'error' };
  }
}

/** Uloží knihu; prázdný název doplní upozorněním, ale nebrání uložení. */
export function saveBook(book: Book): Book {
  const existing = book.id ? store.get(book.id) : undefined;
  if (existing) return store.update(book.id, book) ?? book;
  return store.add(book);
}

/** Rychlé přidání z výsledku hledání. */
export function bookFromRecord(record: CatalogRecord): Book {
  return mapRecordToBook(record, {
    isbn13: toIsbn13((record.isbns ?? [])[0] ?? ''),
    isbnRaw: (record.isbns ?? [])[0] ?? null,
    isbnSource: 'manual',
  });
}

/** Lidsky čitelný popis chyby pro UI. */
export function describeError(err: unknown): string {
  if (err instanceof CatalogError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
