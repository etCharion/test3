/**
 * Export knihovny do Excelu (.xlsx) a do CSV pro rychlý import jinde.
 *
 * CSV má BOM a středník – český Excel jinak diakritiku rozsype a/nebo
 * nerozpozná oddělovač.
 */

import { buildXlsx, type CellValue, type SheetColumn } from './xlsx';
import type { Book } from './types';
import { formatIsbn } from './isbn';

export interface ExportColumn extends SheetColumn {
  /** Klíč pro mapování z knihy. */
  key: keyof Book | 'authorsText' | 'contributorsText' | 'createdText';
  width?: number;
  type?: 'text' | 'number';
}

/** Pořadí a šířky sloupců – odpovídá tomu, co knihovník potřebuje vidět. */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'accession', header: 'Přírůstkové číslo', width: 16 },
  { key: 'isbn13', header: 'ISBN-13', width: 16 },
  { key: 'title', header: 'Název', width: 46 },
  { key: 'subtitle', header: 'Podnázev', width: 28 },
  { key: 'authorsText', header: 'Autoři', width: 30 },
  { key: 'contributorsText', header: 'Překlad / ilustrace', width: 26 },
  { key: 'publisher', header: 'Nakladatel', width: 24 },
  { key: 'place', header: 'Místo', width: 14 },
  { key: 'year', header: 'Rok', width: 8, type: 'number' },
  { key: 'pages', header: 'Strany', width: 8, type: 'number' },
  { key: 'cnb', header: 'ČNB', width: 16 },
  { key: 'signature', header: 'Signatura', width: 14 },
  { key: 'copies', header: 'Kusů', width: 7, type: 'number' },
  { key: 'note', header: 'Poznámka', width: 32 },
  { key: 'source', header: 'Zdroj', width: 10 },
  { key: 'createdText', header: 'Přidáno', width: 12 },
];

/** Hodnota jednoho sloupce pro knihu. */
export function cellFor(book: Book, key: ExportColumn['key']): CellValue {
  switch (key) {
    case 'authorsText':
      return book.authors.join(', ');
    case 'contributorsText':
      return book.contributors.join(', ');
    case 'createdText':
      return formatDate(book.createdAt);
    case 'isbn13':
      return book.isbn13 ? formatIsbn(book.isbn13) : '';
    case 'copies':
      return book.copies || 1;
    case 'source':
      return book.source === 'catalog' ? 'katalog' : 'ručně';
    default: {
      const value = book[key as keyof Book];
      if (value === null || value === undefined) return '';
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return value ? 'ano' : 'ne';
      if (Array.isArray(value)) return value.join(', ');
      return String(value);
    }
  }
}

/** Datum ve tvaru 2026-01-31 (řadí se lexikálně i v Excelu). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function booksToRows(books: Book[]): CellValue[][] {
  return books.map((book) => EXPORT_COLUMNS.map((col) => cellFor(book, col.key)));
}

/** Název souboru s datem, aby se exporty nepřepisovaly. */
export function exportFileName(prefix = 'knihovna', extension = 'xlsx'): string {
  const today = formatDate(new Date().toISOString());
  return `${prefix}-${today}.${extension}`;
}

export function createXlsxBlob(books: Book[], sheetName = 'Knihovna'): Blob {
  const bytes = buildXlsx({
    name: sheetName,
    columns: EXPORT_COLUMNS.map((c) => ({ header: c.header, width: c.width, type: c.type })),
    rows: booksToRows(books),
  });
  return new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** CSV se středníkem, BOM a escapováním uvozovkami. */
export function createCsv(books: Book[], delimiter = ';'): string {
  const escape = (value: CellValue): string => {
    const text = value === null || value === undefined ? '' : String(value);
    if (text.includes('"') || text.includes(delimiter) || /[\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  };
  const lines = [EXPORT_COLUMNS.map((c) => escape(c.header)).join(delimiter)];
  for (const row of booksToRows(books)) lines.push(row.map(escape).join(delimiter));
  return '\ufeff' + lines.join('\r\n');
}

/** Spustí stažení souboru v prohlížeči. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Uvolnit až po chvíli – Safari jinak soubor někdy nestihne převzít.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Sdílení souboru přes systémovou nabídku (na Androidu se tak soubor pošle
 * do Disku, do mailu nebo uloží do Souborů). Když Web Share API chybí,
 * vrátí false a volající použije downloadBlob.
 */
export async function shareFile(blob: Blob, filename: string, title: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (!nav.share || !nav.canShare) return false;
  const file = new File([blob], filename, { type: blob.type });
  const data: ShareData & { files?: File[] } = { files: [file], title };
  if (!nav.canShare(data)) return false;
  try {
    await nav.share(data);
    return true;
  } catch {
    return false;
  }
}
