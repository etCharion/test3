import { describe, expect, it } from 'vitest';
import { searchBooks } from '../app/library';
import { EMPTY_RESPONSE, routedFetch, SAMPLE_RESPONSE, TEN_ONLY_RESPONSE } from './fixtures';

/**
 * Obrazovka „Hledat“ s typem ISBN. Do katalogu nesmí jít pomlčky ani slovo
 * „ISBN“ (takový dotaz nic nenajde) a starší knihy, které katalog zná jen
 * pod desetimístným číslem, se musí dohledat záložním dotazem.
 */
describe('hledání podle ISBN', () => {
  it('z dotazu „80-202-0468-7“ pošle 13 číslic a záznam najde', async () => {
    const seen: string[] = [];
    const result = await searchBooks('80-202-0468-7', 'ISN', 20, {
      fetchImpl: routedFetch(
        () => ({
          resultCount: 1,
          records: [
            {
              id: 'mlp.2',
              title: 'Saturnin',
              isbns: ['80-202-0468-7 (brož.)'],
              formats: ['0/BOOKS/'],
            },
          ],
          status: 'OK',
        }),
        { onRequest: (l) => seen.push(l) },
      ),
    });
    // jen 13 číslic, žádné pomlčky, druhý dotaz není potřeba
    expect(seen).toEqual(['9788020204684']);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.exactIsbn).toBe(true);
    expect(result.status).toBe('ok');
  });

  it('dotaz s textem „ISBN 978…“ se znormalizuje, nepošle se jako text', async () => {
    const seen: string[] = [];
    await searchBooks('ISBN 978-80-257-0367-0', 'ISN', 20, {
      fetchImpl: routedFetch(() => SAMPLE_RESPONSE, { onRequest: (l) => seen.push(l) }),
    });
    expect(seen[0]).toBe('9788025703670');
  });

  it('když 13 číslic nic nenajde, dohledá knihu podle 10 číslic', async () => {
    const seen: string[] = [];
    const result = await searchBooks('9788070613436', 'ISN', 20, {
      fetchImpl: routedFetch(
        (lookfor) => (lookfor === '8070613432' ? TEN_ONLY_RESPONSE : EMPTY_RESPONSE),
        { onRequest: (l) => seen.push(l) },
      ),
    });
    expect(seen).toEqual(['9788070613436', '8070613432']);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.record.id).toBe('mlp.10');
    expect(result.hits[0]!.exactIsbn).toBe(true);
  });

  it('přesná shoda ISBN jde ve výsledcích nahoru', async () => {
    const result = await searchBooks('9788025703670', 'ISN', 20, {
      fetchImpl: routedFetch(() => ({
        resultCount: 2,
        records: [
          { id: 'other', title: 'Jiné vydání', isbns: ['978-80-0000-000-0'], formats: ['0/BOOKS/'] },
          ...SAMPLE_RESPONSE.records!,
        ],
        status: 'OK',
      })),
    });
    expect(result.hits.map((h) => h.record.id)).toEqual(['mkp.3521868', 'other']);
    expect(result.hits[0]!.exactIsbn).toBe(true);
    expect(result.hits[1]!.exactIsbn).toBe(false);
  });

  it('nic nenalezeno hlásí prázdný výsledek, ne chybu', async () => {
    const result = await searchBooks('9788070613436', 'ISN', 20, {
      fetchImpl: routedFetch(() => EMPTY_RESPONSE),
    });
    expect(result.hits).toEqual([]);
    expect(result.status).toBe('empty');
  });

  it('textový dotaz se neposílá jako ISBN (pomlčky se neodstraňují)', async () => {
    const seen: Array<[string, string]> = [];
    await searchBooks('Saturnin Jirotka', 'AllFields', 20, {
      fetchImpl: routedFetch(() => SAMPLE_RESPONSE, {
        onRequest: (lookfor, type) => seen.push([lookfor, type]),
      }),
    });
    expect(seen).toEqual([['Saturnin Jirotka', 'AllFields']]);
  });
});
