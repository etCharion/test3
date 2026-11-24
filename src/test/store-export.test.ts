import { describe, expect, it } from 'vitest';
import { LibraryStore, MemoryStorage, normalizeText } from '../core/store';
import { buildXlsx, columnLetter, escapeXml, sanitizeSheetName } from '../core/xlsx';
import { booksToRows, createCsv, EXPORT_COLUMNS, exportFileName } from '../core/export';
import { emptyBook, type Book } from '../core/types';
import { unzipSync, strFromU8 } from 'fflate';

function sampleBook(overrides: Partial<Book> = {}): Book {
  return emptyBook({
    title: 'Saturnin',
    authors: ['Zdeněk Jirotka'],
    publisher: 'Československý spisovatel',
    year: 1993,
    pages: 218,
    isbn13: '9788020204684',
    cnb: 'cnb002163342',
    source: 'catalog',
    catalogId: 'mlp.2',
    ...overrides,
  });
}

describe('LibraryStore', () => {
  it('přidá knihu, přidělí přírůstkové číslo a uloží ji', () => {
    const storage = new MemoryStorage();
    const store = new LibraryStore(storage);
    store.updateSettings({ accessionPrefix: '2026-', accessionNext: 7, accessionPad: 3 });
    const saved = store.add(sampleBook({ title: 'Saturnin' }));
    expect(saved.accession).toBe('2026-007');
    expect(store.peekAccession()).toBe('2026-008');
    expect(store.list()).toHaveLength(1);

    // nová instance nad stejným úložištěm data načte
    const reloaded = new LibraryStore(storage);
    expect(reloaded.list()[0]!.title).toBe('Saturnin');
    expect(reloaded.getSettings().accessionNext).toBe(8);
  });

  it('posune čítač i když číslo přišlo předvyplněné z formuláře', () => {
    const store = new LibraryStore(new MemoryStorage());
    store.updateSettings({ accessionPrefix: '2026-', accessionNext: 1, accessionPad: 3 });
    // Formulář posílá číslo, které sám předvyplnil (peekAccession).
    const first = store.add(sampleBook({ accession: store.peekAccession() }));
    expect(first.accession).toBe('2026-001');
    const second = store.add(sampleBook({ title: 'Druhá', accession: store.peekAccession() }));
    expect(second.accession).toBe('2026-002');
    expect(store.peekAccession()).toBe('2026-003');
  });

  it('posune čítač i po ručně přepsaném vyšším čísle', () => {
    const store = new LibraryStore(new MemoryStorage());
    store.updateSettings({ accessionPrefix: 'A-', accessionNext: 1, accessionPad: 0 });
    store.add(sampleBook({ accession: 'A-42' }));
    expect(store.peekAccession()).toBe('A-43');
    store.update(store.list()[0]!.id, { accession: 'A-99' });
    expect(store.peekAccession()).toBe('A-100');
  });

  it('najde duplicitu podle ISBN i podle názvu bez diakritiky', () => {
    const store = new LibraryStore(new MemoryStorage());
    store.add(sampleBook());
    expect(store.findByIsbn('978-80-202-0468-4')?.title).toBe('Saturnin');
    expect(store.findByIsbn('80-202-0468-7')?.title).toBe('Saturnin');
    expect(store.findByIsbn('9788025703670')).toBeUndefined();
    expect(store.findDuplicateTitle('saturnin')?.title).toBe('Saturnin');
    expect(store.findDuplicateTitle('Saturnin', 'jirotka')).toBeTruthy();
    expect(store.findDuplicateTitle('Jiná kniha')).toBeUndefined();
  });

  it('upraví a smaže knihu, upozorní odběratele', () => {
    const store = new LibraryStore(new MemoryStorage());
    const book = store.add(sampleBook());
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    const updated = store.update(book.id, { note: 'dar' });
    expect(updated?.note).toBe('dar');
    expect((updated?.updatedAt ?? '') >= book.updatedAt).toBe(true);
    expect(store.remove(book.id)).toBe(true);
    expect(store.remove(book.id)).toBe(false);
    expect(calls).toBe(2);
    unsubscribe();
    store.add(sampleBook());
    expect(calls).toBe(2);
  });

  it('statistiky a počet kusů', () => {
    const store = new LibraryStore(new MemoryStorage());
    store.add(sampleBook({ copies: 2 }));
    store.add(sampleBook({ title: 'Bez ISBN', isbn13: null, catalogId: null }));
    const stats = store.stats();
    expect(stats.total).toBe(2);
    expect(stats.withIsbn).toBe(1);
    expect(stats.withoutCatalog).toBe(1);
    expect(stats.copies).toBe(3);
  });

  it('záloha a obnova přes JSON', () => {
    const store = new LibraryStore(new MemoryStorage());
    store.add(sampleBook());
    const json = store.toJson();
    const other = new LibraryStore(new MemoryStorage());
    expect(other.fromJson(json)).toBe(1);
    expect(other.list()[0]!.isbn13).toBe('9788020204684');
    expect(() => other.fromJson('{"nic":"tu"}')).toThrow();
  });

  it('přežije rozbitá data v úložišti', () => {
    const storage = new MemoryStorage();
    storage.setItem('scaner.books.v1', '{tohle není json');
    storage.setItem('scaner.settings.v1', 'také ne');
    const store = new LibraryStore(storage);
    expect(store.list()).toEqual([]);
    expect(store.getSettings().accessionNext).toBe(1);
  });

  it('normalizeText odstraní diakritiku a velikost písmen', () => {
    expect(normalizeText('Žluťoučký Kůň')).toBe('zlutoucky kun');
  });
});

describe('xlsx writer', () => {
  it('pojmenuje sloupce podle Excelu', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(28)).toBe('AB');
    expect(columnLetter(52)).toBe('AZ');
    expect(columnLetter(53)).toBe('BA');
  });

  it('escapuje XML a odstraní řídící znaky', () => {
    expect(escapeXml('a & b < c > d "e" \'f\'')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;',
    );
    expect(escapeXml('text\u0001s')).toBe('texts');
  });

  it('ošetří název listu', () => {
    expect(sanitizeSheetName('Knihovna')).toBe('Knihovna');
    expect(sanitizeSheetName('a/b:c*d?e[f]g\\h').length).toBeLessThanOrEqual(31);
    expect(sanitizeSheetName('')).toBe('List');
  });

  it('vyrobí platný ZIP se všemi částmi sešitu', () => {
    const bytes = buildXlsx({
      name: 'Knihovna',
      columns: [
        { header: 'Název', width: 40 },
        { header: 'Rok', width: 8, type: 'number' },
      ],
      rows: [
        ['Saturnin', 1993],
        ['Žluťoučký kůň & spol.', null],
      ],
    });
    expect(bytes[0]).toBe(0x50); // 'P' – začátek ZIPu
    const files = unzipSync(bytes);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(Object.keys(files)).toContain(part);
    }
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('Saturnin');
    expect(sheet).toContain('Žluťoučký kůň &amp; spol.');
    expect(sheet).toContain('<v>1993</v>'); // číslo zůstalo číslem
    expect(sheet).toContain('autoFilter');
    expect(sheet).toContain('pane ySplit="1"');
    const workbook = strFromU8(files['xl/workbook.xml']!);
    expect(workbook).toContain('name="Knihovna"');
  });

  it('zvládne prázdnou tabulku (jen hlavička)', () => {
    const files = unzipSync(
      buildXlsx({ name: 'Prázdné', columns: [{ header: 'Název' }], rows: [] }),
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('Název');
    expect(sheet).toContain('dimension ref="A1:A1"');
  });
});

describe('export', () => {
  it('namapuje knihu na řádek se všemi sloupci', () => {
    const rows = booksToRows([sampleBook()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(EXPORT_COLUMNS.length);
    expect(rows[0]![0]).toBe(''); // přírůstkové číslo nevyplněno
    expect(rows[0]![1]).toBe('9788020204684');
    expect(rows[0]![2]).toBe('Saturnin');
    expect(rows[0]![4]).toBe('Zdeněk Jirotka');
    expect(rows[0]!.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('CSV má BOM, středník a escapuje uvozovky', () => {
    const csv = createCsv([sampleBook({ title: 'Název; s "uvozovkami"' })]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv.split('\r\n')[0]).toContain('Přírůstkové číslo;ISBN-13;Název');
    expect(csv).toContain('"Název; s ""uvozovkami"""');
  });

  it('název souboru obsahuje dnešní datum', () => {
    expect(exportFileName()).toMatch(/^knihovna-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(exportFileName('fond', 'csv')).toMatch(/\.csv$/);
  });
});
