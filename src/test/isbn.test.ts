import { describe, expect, it } from 'vitest';
import {
  extractIsbn,
  formatIsbn,
  isbn10To13,
  isbn13CheckDigit,
  isbn13ToIsbn10,
  isValidIsbn10,
  isValidIsbn13,
  isValidIssn,
  looseIsbn13,
  looksLikeIsbnQuery,
  stripIsbn,
  toIsbn13,
} from '../core/isbn';

describe('stripIsbn', () => {
  it('odstraní pomlčky, mezery i poznámky', () => {
    expect(stripIsbn('978-80-257-0367-0')).toBe('9788025703670');
    expect(stripIsbn(' 80-202-0468-7 (brož.) ')).toBe('8020204687');
    expect(stripIsbn('80 202 0468 x')).toBe('802020468X');
  });
});

describe('validace', () => {
  it('pozná platné ISBN-13', () => {
    expect(isValidIsbn13('9788025703670')).toBe(true);
    expect(isValidIsbn13('978-80-257-0367-0')).toBe(true);
    expect(isValidIsbn13('9788025703671')).toBe(false);
    expect(isValidIsbn13('1234567890123')).toBe(false);
  });

  it('pozná platné ISBN-10 včetně X', () => {
    expect(isValidIsbn10('8020204687')).toBe(true);
    expect(isValidIsbn10('80-202-0468-7')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn10('8020204688')).toBe(false);
  });

  it('spočítá kontrolní číslici ISBN-13', () => {
    expect(isbn13CheckDigit('978802570367')).toBe(0);
    expect(isbn13CheckDigit('978802020468')).toBe(4);
    expect(isbn13CheckDigit('978807388217')).toBe(4);
  });

  it('ověří ISSN', () => {
    expect(isValidIssn('1210-3292')).toBe(true);
    expect(isValidIssn('1210-3293')).toBe(false);
  });
});

describe('převod ISBN-10 → ISBN-13', () => {
  it('doplní prefix 978 a novou kontrolní číslici', () => {
    expect(isbn10To13('80-202-0468-7')).toBe('9788020204684');
    expect(isbn10To13('080442957X')).toBe('9780804429573');
  });

  it('odmítne neplatné ISBN-10', () => {
    expect(isbn10To13('80-202-0468-8')).toBeNull();
    expect(isbn10To13('12345')).toBeNull();
  });
});

describe('toIsbn13', () => {
  it('vrátí 13 číslic pro oba tvary', () => {
    expect(toIsbn13('978-80-257-0367-0')).toBe('9788025703670');
    expect(toIsbn13('80-202-0468-7')).toBe('9788020204684');
    expect(toIsbn13('9788025703670')).toBe('9788025703670');
  });

  it('odmítne nesmysly a prázdné hodnoty', () => {
    expect(toIsbn13('')).toBeNull();
    expect(toIsbn13(null)).toBeNull();
    expect(toIsbn13('neco text')).toBeNull();
    expect(toIsbn13('978-80-257-0367-1')).toBeNull();
  });

  it('looseIsbn13 srovná i číslo s rozbitou kontrolní číslicí', () => {
    expect(looseIsbn13('978-80-257-0367-1')).toBe('9788025703671');
    expect(looseIsbn13('80-202-0468-7')).toBe('9788020204684');
    expect(looseIsbn13('123')).toBeNull();
  });
});

describe('extractIsbn', () => {
  it('vytáhne ISBN z OCR přepisu s poznámkou', () => {
    expect(extractIsbn('ISBN 978-80-257-0367-0 (váz.) : 399 Kč')).toBe('9788025703670');
    expect(extractIsbn('80-202-0468-7 (brož.)')).toBe('9788020204684');
  });

  it('vytáhne ISBN bez oddělovačů z delšího textu', () => {
    expect(extractIsbn('kód 9788025703670 naskenováno')).toBe('9788025703670');
  });

  it('nevrátí nic, když text ISBN neobsahuje', () => {
    expect(extractIsbn('Saturnin Jirotka')).toBeNull();
    expect(extractIsbn('1234567890123')).toBeNull();
  });
});

describe('pomocné', () => {
  it('zobrazí ISBN-13 jako 13 číslic', () => {
    expect(formatIsbn('978-80-257-0367-0')).toBe('9788025703670');
    expect(formatIsbn(null)).toBe('');
  });

  it('pozná, že dotaz má smysl poslat jako číslo', () => {
    expect(looksLikeIsbnQuery('978-80-257-0367-0')).toBe(true);
    expect(looksLikeIsbnQuery('Saturnin')).toBe(false);
  });
});

describe('převod ISBN-13 na ISBN-10', () => {
  it('z třináctimístného tvaru udělá desetimístný se správnou kontrolní číslicí', () => {
    expect(isbn13ToIsbn10('9788070613436')).toBe('8070613432');
    expect(isbn13ToIsbn10('978-80-202-0468-4')).toBe('8020204687');
    expect(isbn13ToIsbn10('9788025703670')).toBe('8025703673');
  });

  it('u prefixu 979 desetimístný tvar neexistuje', () => {
    expect(isbn13ToIsbn10('9791090636071')).toBeNull();
  });

  it('cesta tam a zpět vrátí stejné číslo', () => {
    for (const isbn13 of ['9788070613436', '9788020204684', '9788000014623']) {
      expect(isbn10To13(isbn13ToIsbn10(isbn13)!)).toBe(isbn13);
    }
  });

  it('z nesmyslu vrátí null', () => {
    expect(isbn13ToIsbn10('')).toBeNull();
    expect(isbn13ToIsbn10(null)).toBeNull();
    expect(isbn13ToIsbn10('80-202-0468-7')).toBeNull();
  });
});
