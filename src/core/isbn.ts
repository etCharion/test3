/**
 * Práce s ISBN: čištění, validace, převod ISBN-10 → ISBN-13,
 * vytahování čísla z textu (OCR, ruční opis, poznámky katalogu).
 *
 * Pravidlo katalogu: dotaz musí jít 13 číslicemi bez pomlček –
 * desetimístné ISBN novější knihy nenajde.
 */

/** Znaky, které se v ISBN mohou objevit (X jen jako kontrolní číslice ISBN-10). */
const ISBN_CHARS = /[0-9Xx]/;

/** Odstraní vše kromě číslic a X, velká X sjednotí. */
export function stripIsbn(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

/** Kontrolní číslice ISBN-10 (poslední znak může být X = 10). */
export function isValidIsbn10(value: string): boolean {
  const s = stripIsbn(value);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i]!;
    const digit = ch === 'X' ? 10 : Number(ch);
    sum += (10 - i) * digit;
  }
  return sum % 11 === 0;
}

/** Kontrolní číslice ISBN-13 (EAN-13: střídavě 1 a 3). */
export function isValidIsbn13(value: string): boolean {
  const s = stripIsbn(value);
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(s[12]);
}

/** Dopočítá kontrolní číslici pro prvních 12 číslic ISBN-13. */
export function isbn13CheckDigit(first12: string): number {
  const s = stripIsbn(first12).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * Převod ISBN-10 na ISBN-13: prefix 978 + prvních 9 číslic + nová kontrolní číslice.
 * Vrací null, když vstup není platné ISBN-10.
 */
export function isbn10To13(value: string): string | null {
  const s = stripIsbn(value);
  if (!isValidIsbn10(s)) return null;
  const core = '978' + s.slice(0, 9);
  return core + String(isbn13CheckDigit(core));
}

/**
 * Převod ISBN-13 na ISBN-10 (jen pro prefix 978; 979 desetimístný tvar nemá).
 *
 * Katalog zná část starších knih jen pod desetimístným ISBN – dotaz třinácti
 * číslicemi u nich nic nenajde. Proto se jako záložní tvar posílá tohle číslo.
 * Vrací null, když z čísla ISBN-10 udělat nelze.
 */
export function isbn13ToIsbn10(value: string | null | undefined): string | null {
  const s = stripIsbn(value);
  if (!/^978\d{10}$/.test(s)) return null;
  const core = s.slice(3, 12); // 9 číslic za prefixem 978
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const rest = (11 - (sum % 11)) % 11;
  const check = rest === 10 ? 'X' : String(rest);
  const ten = core + check;
  return isValidIsbn10(ten) ? ten : null;
}

/**
 * Univerzální normalizace na ISBN-13 bez pomlček.
 * Bere ISBN-10 (převede), ISBN-13 (ověří kontrolní číslici).
 * Vrací null, když číslo není platné ISBN.
 */
export function toIsbn13(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = stripIsbn(raw);
  if (s.length === 13) return isValidIsbn13(s) ? s : null;
  if (s.length === 10) return isbn10To13(s);
  return null;
}

/**
 * Normalizace „na pokus" – i když kontrolní číslice nesedí (překlep v katalogu,
 * OCR chyba). Používá se jen pro porovnávání záznamů, nikdy pro nový záznam.
 */
export function looseIsbn13(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = stripIsbn(raw);
  if (s.length === 13) return s;
  if (s.length === 10) {
    const core = '978' + s.slice(0, 9);
    return core + String(isbn13CheckDigit(core));
  }
  return null;
}

/**
 * Vytáhne ISBN z libovolného textu (OCR přepis, "ISBN 80-202-0468-7 (brož.)",
 * "978-80-257-0367-0 (váz.) : 399 Kč").
 *
 * Postup: najde souvislé úseky složené z číslic a oddělovačů, v každém zkusí
 * celý úsek a pak posuvná okna délek 13 a 10. Vrací první číslo s platnou
 * kontrolní číslicí, jinak null.
 */
export function extractIsbn(text: string): string | null {
  if (!text) return null;
  // 1) Přímý pokus – text je celé ISBN ("978-80-257-0367-0").
  const direct = toIsbn13(text);
  if (direct) return direct;

  // 2) Rozděl na úseky tvořené číslicemi/X a oddělovači.
  const runs = text.match(/[0-9Xx][0-9Xx\s.,\u00a0-]*/g) ?? [];
  for (const run of runs) {
    const digits = stripIsbn(run);
    for (const len of [13, 10]) {
      for (let start = 0; start + len <= digits.length; start++) {
        const candidate = digits.slice(start, start + len);
        const normalized = toIsbn13(candidate);
        if (normalized) return normalized;
      }
    }
  }
  return null;
}

/**
 * Zobrazení ISBN. Schválně bez pomlček: dělení na skupiny závisí na registračním
 * rozsahu vydavatele a bez tabulky rozsahů by pomlčky lhaly. Číslice se zobrazují
 * tak, jak je potřeba je opsat nebo nadiktovat.
 */
export function formatIsbn(isbn13: string | null): string {
  if (!isbn13) return '';
  return stripIsbn(isbn13);
}

/** Je to číslo, které má smysl poslat do katalogu? (jen čistě číselné ISBN) */
export function looksLikeIsbnQuery(text: string): boolean {
  const s = stripIsbn(text);
  return s.length === 10 || s.length === 13;
}

/** ISSN – některé brožury mají ISSN místo ISBN; ověříme jen tvar. */
export function isValidIssn(value: string): boolean {
  const s = stripIsbn(value);
  if (!/^\d{7}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(s[i]) * (8 - i);
  const rest = (11 - (sum % 11)) % 11;
  const check = rest === 10 ? 'X' : String(rest);
  return check === s[7];
}

/** Pomocník pro testy/UI: obsahuje text aspoň jeden znak ISBN? */
export function hasIsbnChars(text: string): boolean {
  return ISBN_CHARS.test(text ?? '');
}
