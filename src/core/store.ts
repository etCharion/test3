/**
 * Persistence knihovny a nastavení.
 *
 * Data držíme v localStorage (jednotky MB stačí na tisíce knih, synchronní
 * přístup zjednodušuje UI). Když je úložiště zakázané (privátní režim),
 * aplikace funguje dál v paměti a upozorní, že se data neuloží.
 */

import { DEFAULT_SETTINGS, emptyBook, newId, type Book, type Settings } from './types';
import { looseIsbn13, toIsbn13 } from './isbn';

const BOOKS_KEY = 'scaner.books.v1';
const SETTINGS_KEY = 'scaner.settings.v1';

/** Minimální rozhraní úložiště – v testech ho nahradí paměť. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export type Unsubscribe = () => void;

export interface LibraryStats {
  total: number;
  withIsbn: number;
  withoutCatalog: number;
  copies: number;
}

export class LibraryStore {
  private books: Book[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<() => void>();
  private storage: StorageLike;
  /** False, když se zápis do úložiště nezdařil – UI to má uživateli říct. */
  readonly persistent: boolean;

  constructor(storage?: StorageLike) {
    let store = storage;
    let persistent = true;
    if (!store) {
      try {
        const ls = globalThis.localStorage;
        const probe = '__scaner_probe__';
        ls.setItem(probe, '1');
        ls.removeItem(probe);
        store = ls;
      } catch {
        store = new MemoryStorage();
        persistent = false;
      }
    }
    this.storage = store;
    this.persistent = persistent;
    this.load();
  }

  private load(): void {
    try {
      const rawBooks = this.storage.getItem(BOOKS_KEY);
      if (rawBooks) {
        const parsed = JSON.parse(rawBooks);
        if (Array.isArray(parsed)) {
          this.books = parsed
            .filter((b): b is Book => !!b && typeof b === 'object' && typeof b.title === 'string')
            .map((b) => normalizeBook(b));
        }
      }
    } catch {
      this.books = [];
    }
    try {
      const rawSettings = this.storage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings);
        if (parsed && typeof parsed === 'object') {
          this.settings = { ...DEFAULT_SETTINGS, ...parsed };
        }
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  private saveBooks(): void {
    try {
      this.storage.setItem(BOOKS_KEY, JSON.stringify(this.books));
    } catch {
      /* plné nebo zakázané úložiště – data zůstanou v paměti */
    }
    this.emit();
  }

  private saveSettings(): void {
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* viz výše */
    }
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Knihy od nejnovější. */
  list(): Book[] {
    return [...this.books].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Book | undefined {
    return this.books.find((b) => b.id === id);
  }

  /** Najde knihu podle ISBN-13 (nebo ISBN-10, to se převede). */
  findByIsbn(isbn: string | null | undefined): Book | undefined {
    const target = looseIsbn13(isbn ?? null) ?? toIsbn13(isbn ?? null);
    if (!target) return undefined;
    return this.books.find((b) => b.isbn13 === target);
  }

  findDuplicateTitle(title: string, author?: string): Book | undefined {
    const t = normalizeText(title);
    if (!t) return undefined;
    const a = author ? normalizeText(author) : '';
    return this.books.find((b) => {
      if (normalizeText(b.title) !== t) return false;
      if (!a) return true;
      return b.authors.some((x) => normalizeText(x).includes(a) || a.includes(normalizeText(x)));
    });
  }

  /**
   * Posune čítač přírůstkových čísel za použité číslo.
   * Důležité: formulář číslo předvyplňuje, takže se čítač musí posunout i když
   * číslo nepřidělila knihovna sama – jinak by dvě knihy dostaly stejné číslo.
   */
  private advanceAccessionCounter(accession: string | null): boolean {
    if (!accession) return false;
    const { accessionPrefix, accessionNext } = this.settings;
    if (!accession.startsWith(accessionPrefix)) return false;
    const numeric = Number(accession.slice(accessionPrefix.length).replace(/\D/g, ''));
    if (!Number.isFinite(numeric) || numeric < accessionNext) return false;
    this.settings.accessionNext = Math.floor(numeric) + 1;
    return true;
  }

  /** Přidá knihu; prázdné přírůstkové číslo doplní podle nastavení. */
  add(book: Book): Book {
    const now = new Date().toISOString();
    const prepared: Book = {
      ...normalizeBook(book),
      id: book.id || newId(),
      createdAt: book.createdAt || now,
      updatedAt: now,
    };
    if (!prepared.accession) prepared.accession = this.peekAccession();
    const advanced = this.advanceAccessionCounter(prepared.accession);
    this.books.push(prepared);
    this.saveBooks();
    if (advanced) this.saveSettings();
    return prepared;
  }

  update(id: string, patch: Partial<Book>): Book | undefined {
    const index = this.books.findIndex((b) => b.id === id);
    if (index < 0) return undefined;
    const merged: Book = {
      ...this.books[index]!,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.books[index] = normalizeBook(merged);
    const advanced = this.advanceAccessionCounter(this.books[index]!.accession);
    this.saveBooks();
    if (advanced) this.saveSettings();
    return this.books[index];
  }

  remove(id: string): boolean {
    const before = this.books.length;
    this.books = this.books.filter((b) => b.id !== id);
    if (this.books.length === before) return false;
    this.saveBooks();
    return true;
  }

  clear(): void {
    this.books = [];
    this.saveBooks();
  }

  /** Nahradí celou knihovnu (import ze zálohy). */
  replaceAll(books: Book[]): void {
    this.books = books.map((b) => normalizeBook(b));
    this.saveBooks();
  }

  /** Další přírůstkové číslo, které by kniha dostala – jen náhled. */
  peekAccession(): string {
    const { accessionPrefix, accessionNext, accessionPad } = this.settings;
    return accessionPrefix + String(accessionNext).padStart(accessionPad, '0');
  }

  nextAccession(): string {
    const value = this.peekAccession();
    this.settings.accessionNext += 1;
    this.saveSettings();
    return value;
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    this.saveSettings();
    return this.getSettings();
  }

  stats(): LibraryStats {
    return {
      total: this.books.length,
      withIsbn: this.books.filter((b) => !!b.isbn13).length,
      withoutCatalog: this.books.filter((b) => !b.catalogId).length,
      copies: this.books.reduce((sum, b) => sum + (b.copies || 1), 0),
    };
  }

  /** CSV popis knihovny pro zálohu (JSON, ne Excel). */
  toJson(): string {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), books: this.books }, null, 2);
  }

  fromJson(json: string): number {
    const data = JSON.parse(json);
    const books = Array.isArray(data) ? data : data?.books;
    if (!Array.isArray(books)) throw new Error('Soubor neobsahuje seznam knih.');
    this.replaceAll(books as Book[]);
    return this.books.length;
  }
}

/** Porovnávání bez diakritiky a velikosti písmen (pro hledání duplicit). */
export function normalizeText(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Doplnění chybějících polí u dat načtených ze starší verze úložiště. */
export function normalizeBook(book: Book): Book {
  const base = emptyBook();
  const merged: Book = { ...base, ...book };
  merged.authors = Array.isArray(merged.authors) ? merged.authors.filter(Boolean) : [];
  merged.contributors = Array.isArray(merged.contributors) ? merged.contributors.filter(Boolean) : [];
  merged.copies = Number.isFinite(merged.copies) && merged.copies > 0 ? Math.floor(merged.copies) : 1;
  merged.isbn13 = merged.isbn13 ? looseIsbn13(merged.isbn13) : null;
  merged.year = merged.year ? Number(merged.year) : null;
  merged.pages = merged.pages ? Number(merged.pages) : null;
  merged.createdAt = merged.createdAt || new Date().toISOString();
  merged.updatedAt = merged.updatedAt || merged.createdAt;
  return merged;
}
