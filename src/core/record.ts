/**
 * Mapování záznamu z katalogu Knihovny.cz na interní model Book.
 *
 * Katalog sype katalogizační interpunkci („Argo,“, „Praha :“, „[Praha] :“),
 * autory vrací jako klíče objektu s roky na konci („Jméno Příjmení, 1971-“)
 * a rok schovává v publicationDates („c2010“, „[2025]“). Tady se to čistí.
 */

import { formatIsbn, looseIsbn13, toIsbn13 } from './isbn';
import type { CatalogRecord } from './catalog';
import { emptyBook, type Book, type IsbnSource } from './types';

/** Ořeže katalogizační interpunkci na konci textu: „Argo,“ → „Argo“. */
export function cleanTail(value: string): string {
  let s = (value ?? '').trim();
  // Opakovaně, protože „Praha : /“ má víc vrstev.
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/\s*[/:;=]\s*$/, '').replace(/[\s,.;:]+$/, '');
    if (s === before) break;
  }
  return s.trim();
}

/** Odstraní hranaté závorky („[Praha]“ → „Praha“) a ořeže interpunkci. */
export function cleanPlace(value: string): string {
  return cleanTail((value ?? '').replace(/[[\]]/g, '').replace(/\s*:\s*$/, ''));
}

/** Odstraní roky z konce autorského jména: „Jean de Nostredame, asi 1507-1577“. */
export function cleanPersonName(value: string): string {
  let s = (value ?? '').trim();
  // „, 1971-“, „, asi 1507-1577“, „, 1971“, „, [1971]“, „, činný 1450-1500“
  s = s.replace(
    /,?\s*(?:asi\s+|ca\.?\s+|činn[ýá]\s+)?\[?\d{3,4}\]?\s*(?:[-–]\s*\[?\d{0,4}\]?)?\s*$/u,
    '',
  );
  s = s.replace(/[\s,;]+$/, '');
  return s.trim();
}

/** Klíče objektu autorů → pole jmen (bez letopočtů). */
function namesFromKeys(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => cleanPersonName(String(v))).filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .map(cleanPersonName)
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const one = cleanPersonName(value);
    return one ? [one] : [];
  }
  return [];
}

export interface MappedAuthors {
  authors: string[];
  contributors: string[];
}

export function mapAuthors(record: CatalogRecord): MappedAuthors {
  const a = record.authors ?? {};
  const primary = namesFromKeys(a.primary);
  const secondary = namesFromKeys(a.secondary);
  const corporate = namesFromKeys(a.corporate);
  // Korporace bereme jako autory jen když chybí osobní autor.
  const authors = primary.length > 0 ? [...primary, ...corporate] : [...corporate, ...secondary];
  const contributors = primary.length > 0 ? secondary : [];
  return { authors, contributors };
}

/** Rok z publicationDates: „c2010“, „[2025]“, „2011“ → 2011. */
export function extractYear(record: CatalogRecord): number | null {
  const raw = (record.publicationDates ?? []).join(' ');
  const found = raw.match(/\d{4}/g);
  if (!found) return null;
  const year = Number(found[0]);
  const maxYear = new Date().getFullYear() + 2;
  if (year < 1400 || year > maxYear) return null;
  return year;
}

/** Počet stran z physicalDescriptions: „218 s. : il. ; 22 cm“, „260 stran“ → 218/260. */
export function extractPages(record: CatalogRecord): number | null {
  for (const description of record.physicalDescriptions ?? []) {
    // Pozor na \b za tečkou ("218 s. : il.") – hranice slova tam neexistuje,
    // proto se koncové tečky neošetřují přes \b.
    const m = description.match(/(\d{1,5})\s*(?:s\.|str\.|stran(?:a|y)?|p\.|pages?)/iu);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/** Rozdělí „Název : podnázev“ na dvě části (MARC konvence). */
export function splitTitle(title: string): { title: string; subtitle: string | null } {
  const clean = cleanTail(title);
  const idx = clean.indexOf(' : ');
  if (idx > 2 && idx < clean.length - 3) {
    return { title: clean.slice(0, idx).trim(), subtitle: cleanTail(clean.slice(idx + 3)) };
  }
  return { title: clean, subtitle: null };
}

/** První platné ISBN-13 ze záznamu (ideálně to hledané). */
export function pickIsbn13(record: CatalogRecord, preferred?: string | null): string | null {
  const wanted = preferred ? looseIsbn13(preferred) : null;
  const candidates = (record.isbns ?? []).map((v) => ({ raw: v, isbn13: toIsbn13(v) }));
  if (wanted) {
    const match = candidates.find((c) => looseIsbn13(c.raw) === wanted);
    if (match?.isbn13) return match.isbn13;
    if (match) return wanted;
  }
  const valid = candidates.find((c) => c.isbn13);
  return valid?.isbn13 ?? null;
}

export interface MapOptions {
  /** Hledané ISBN – preferuje se při výběru z polí isbns. */
  isbn13?: string | null;
  isbnRaw?: string | null;
  isbnSource?: IsbnSource;
}

/** Záznam katalogu → nová kniha. */
export function mapRecordToBook(record: CatalogRecord, options: MapOptions = {}): Book {
  const { title, subtitle } = splitTitle(record.title ?? '');
  const { authors, contributors } = mapAuthors(record);
  const isbn13 = pickIsbn13(record, options.isbn13 ?? null);
  const cnb = typeof record.cnb === 'string' && record.cnb.trim() ? record.cnb.trim() : null;

  return emptyBook({
    isbn13,
    isbnRaw: options.isbnRaw ?? null,
    isbnSource: options.isbnSource ?? (options.isbnRaw ? 'manual' : 'none'),
    title,
    subtitle,
    authors,
    contributors,
    publisher: record.publishers?.[0] ? cleanTail(record.publishers[0]) : null,
    place: record.placesOfPublication?.[0] ? cleanPlace(record.placesOfPublication[0]) : null,
    year: extractYear(record),
    pages: extractPages(record),
    cnb,
    catalogId: record.id ?? null,
    source: 'catalog',
  });
}

/** Krátký popis pro seznam výsledků hledání. */
export function describeRecord(record: CatalogRecord): string {
  const parts: string[] = [];
  const { authors } = mapAuthors(record);
  if (authors[0]) parts.push(authors[0]);
  const year = extractYear(record);
  if (year) parts.push(String(year));
  const publisher = record.publishers?.[0] ? cleanTail(record.publishers[0]) : '';
  if (publisher) parts.push(publisher);
  const isbn = pickIsbn13(record);
  if (isbn) parts.push(formatIsbn(isbn));
  return parts.join(' · ');
}
