/**
 * Datový model knihy a nastavení aplikace.
 * Zdroj pravdy pro celou aplikaci – UI i export pracují s tímto tvarem.
 */

export type BookSource = 'catalog' | 'manual';

/** Jak bylo ISBN získáno – hodí se pro zpětnou kontrolu při revizi fondu. */
export type IsbnSource = 'barcode' | 'ocr' | 'manual' | 'none';

export interface Book {
  /** Interní id záznamu (uuid). */
  id: string;
  /** Normalizované ISBN-13 bez pomlček, nebo null (kniha bez ISBN). */
  isbn13: string | null;
  /** ISBN tak, jak bylo načteno/napsáno (pro dohledání, když normalizace selže). */
  isbnRaw: string | null;
  /** Jak vzniklo isbn13. */
  isbnSource: IsbnSource;

  /** Název knihy (bez katalogizační interpunkce). */
  title: string;
  /** Podnázev, pokud ho katalog dodá jako samostatnou část. */
  subtitle: string | null;
  /** Autoři – primární první, pak další. */
  authors: string[];
  /** Překladatelé, ilustrátoři… (katalog je vrací jako "secondary"). */
  contributors: string[];
  publisher: string | null;
  place: string | null;
  year: number | null;
  pages: number | null;
  /** Číslo ČNB (bez "cnb" prefixu i s ním – ukládáme, co přišlo). */
  cnb: string | null;
  /** Identifikátor záznamu v katalogu Knihovny.cz (např. "mkp.3521868"). */
  catalogId: string | null;

  /** Přírůstkové číslo – evidence knihovny. */
  accession: string | null;
  /** Signatura / umístění v regálu. */
  signature: string | null;
  /** Volná poznámka knihovníka. */
  note: string | null;
  /** Počet kusů (duplicitní exempláře přidané jedním záznamem). */
  copies: number;

  source: BookSource;
  createdAt: string;
  updatedAt: string;
}

/** Nastavení, které přežívá zavření aplikace. */
export interface Settings {
  /** Prefix přírůstkového čísla, např. "2026-". */
  accessionPrefix: string;
  /** Pořadové číslo, od kterého se pokračuje. */
  accessionNext: number;
  /** Kolik míst doplnit nulami. */
  accessionPad: number;
  /** Automaticky ukládat po nalezení v katalogu (rychlé skenování). */
  autoSave: boolean;
  /** Vibrace + zvuk po načtení kódu. */
  feedback: boolean;
  /** Zkusit inverzní barvy, když běžné dekódování selže. */
  inverted: boolean;
  /** Použít OCR pro tištěné číslice. */
  ocr: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  accessionPrefix: '',
  accessionNext: 1,
  accessionPad: 0,
  autoSave: false,
  feedback: true,
  inverted: true,
  ocr: true,
};

/** Nová prázdná kniha – výchozí stav pro ruční vyplnění. */
export function emptyBook(partial: Partial<Book> = {}): Book {
  const now = new Date().toISOString();
  return {
    id: newId(),
    isbn13: null,
    isbnRaw: null,
    isbnSource: 'none',
    title: '',
    subtitle: null,
    authors: [],
    contributors: [],
    publisher: null,
    place: null,
    year: null,
    pages: null,
    cnb: null,
    catalogId: null,
    accession: null,
    signature: null,
    note: null,
    copies: 1,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback pro starší WebView bez crypto.randomUUID.
  return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
