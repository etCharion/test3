import { describe, expect, it } from 'vitest';
import {
  cleanPersonName,
  cleanPlace,
  cleanTail,
  extractPages,
  extractYear,
  mapAuthors,
  mapRecordToBook,
  pickIsbn13,
  splitTitle,
} from '../core/record';
import type { CatalogRecord } from '../core/catalog';
import { MULTI_RESPONSE, SAMPLE_RESPONSE, SPARSE_RESPONSE } from './fixtures';

const sample = SAMPLE_RESPONSE.records![0] as CatalogRecord;

describe('čištění katalogizační interpunkce', () => {
  it('ořeže čárku, dvojtečku i lomítko na konci', () => {
    expect(cleanTail('Argo,')).toBe('Argo');
    expect(cleanTail('Praha :')).toBe('Praha');
    expect(cleanTail('Název knihy /')).toBe('Název knihy');
    expect(cleanTail('Podnázev : /')).toBe('Podnázev');
    expect(cleanTail('bez interpunkce')).toBe('bez interpunkce');
    expect(cleanTail('')).toBe('');
  });

  it('odstraní hranaté závorky u místa', () => {
    expect(cleanPlace('[Praha] :')).toBe('Praha');
    expect(cleanPlace('Praha :')).toBe('Praha');
    expect(cleanPlace('Brno')).toBe('Brno');
  });

  it('odstraní roky z autorských jmen', () => {
    expect(cleanPersonName('Jean de Nostredame, asi 1507-1577')).toBe('Jean de Nostredame');
    expect(cleanPersonName('Josef Prokop, 1971-')).toBe('Josef Prokop');
    expect(cleanPersonName('Vojtěch Domlátil, 1979-')).toBe('Vojtěch Domlátil');
    expect(cleanPersonName('Jan Novák, [1971]')).toBe('Jan Novák');
    expect(cleanPersonName('Kosmas, činný 1110-1125')).toBe('Kosmas');
    expect(cleanPersonName('Anonym')).toBe('Anonym');
  });
});

describe('autoři', () => {
  it('primární jsou autoři, secondary překladatelé', () => {
    const { authors, contributors } = mapAuthors(sample);
    expect(authors).toEqual(['Jean de Nostredame']);
    expect(contributors).toEqual(['Josef Prokop', 'Vojtěch Domlátil']);
  });

  it('bez primárního autora použije sekundární/korporaci', () => {
    const { authors } = mapAuthors({
      authors: { primary: {}, secondary: { 'Petr Novák, 1960-': [] }, corporate: ['Český statistický úřad'] },
    });
    expect(authors).toEqual(['Český statistický úřad', 'Petr Novák']);
  });

  it('prázdné nebo chybějící autory zvládne bez chyby', () => {
    expect(mapAuthors({}).authors).toEqual([]);
    expect(mapAuthors({ authors: null }).authors).toEqual([]);
  });
});

describe('rok a strany', () => {
  it('vytáhne rok i z c2010 / [2025]', () => {
    expect(extractYear(sample)).toBe(2011);
    expect(extractYear({ publicationDates: ['c2010'] })).toBe(2010);
    expect(extractYear({ publicationDates: ['[2025]'] })).toBe(2025);
    expect(extractYear({})).toBeNull();
    expect(extractYear({ publicationDates: ['nedatováno'] })).toBeNull();
  });

  it('vytáhne počet stran z různých tvarů', () => {
    expect(extractPages(sample)).toBe(218);
    expect(extractPages({ physicalDescriptions: ['260 stran'] })).toBe(260);
    expect(extractPages({ physicalDescriptions: ['1 sv. (nestr.)'] })).toBeNull();
    expect(extractPages({})).toBeNull();
  });
});

describe('název', () => {
  it('rozdělí název a podnázev', () => {
    expect(splitTitle('Saturnin : humoristický román')).toEqual({
      title: 'Saturnin',
      subtitle: 'humoristický román',
    });
    expect(splitTitle('Saturnin /')).toEqual({ title: 'Saturnin', subtitle: null });
  });
});

describe('výběr ISBN ze záznamu', () => {
  it('preferuje hledané číslo', () => {
    const record: CatalogRecord = { isbns: ['80-202-0468-7', '978-80-7388-217-4'] };
    expect(pickIsbn13(record, '9788020204684')).toBe('9788020204684');
    expect(pickIsbn13(record)).toBe('9788020204684');
  });

  it('bez isbns vrátí null', () => {
    expect(pickIsbn13({})).toBeNull();
  });
});

describe('mapRecordToBook', () => {
  it('namapuje ukázkový záznam ze zadání', () => {
    const book = mapRecordToBook(sample, { isbn13: '9788025703670', isbnRaw: '978-80-257-0367-0' });
    expect(book.title).toContain('Životy slavných');
    expect(book.authors).toEqual(['Jean de Nostredame']);
    expect(book.contributors).toEqual(['Josef Prokop', 'Vojtěch Domlátil']);
    expect(book.publisher).toBe('Argo');
    expect(book.place).toBe('Praha');
    expect(book.year).toBe(2011);
    expect(book.pages).toBe(218);
    expect(book.isbn13).toBe('9788025703670');
    expect(book.cnb).toBe('cnb002163342');
    expect(book.catalogId).toBe('mkp.3521868');
    expect(book.source).toBe('catalog');
  });

  it('zvládne záznam bez volitelných polí', () => {
    const book = mapRecordToBook(SPARSE_RESPONSE.records![0]!, { isbn13: null });
    expect(book.title).toBe('Neznámý titul');
    expect(book.year).toBeNull();
    expect(book.pages).toBeNull();
    expect(book.cnb).toBeNull();
    expect(book.publisher).toBeNull();
    expect(book.isbn13).toBeNull();
  });

  it('u záznamu s rozbitou kontrolní číslicí ISBN podrží naskenované číslo', () => {
    const audio = mapRecordToBook(MULTI_RESPONSE.records![0]!, { isbn13: '9788072941234' });
    // isbns v záznamu číslo obsahuje, takže se použije hledané (naskenované) ISBN
    // i přesto, že kontrolní číslice v katalogu nesedí – chyba je v katalogu.
    expect(audio.isbn13).toBe('9788072941234');
  });
});
