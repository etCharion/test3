import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  CatalogError,
  findByIsbn,
  isBookRecord,
  pickRecordByIsbn,
  searchCatalog,
  CATALOG_FIELDS,
} from '../core/catalog';
import { EMPTY_RESPONSE, fakeFetch, MULTI_RESPONSE, SAMPLE_RESPONSE } from './fixtures';

describe('buildSearchUrl', () => {
  it('skládá parametry přes URLSearchParams a field[] opakuje', () => {
    const url = buildSearchUrl('9788025703670', 'ISN', 10);
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://www.knihovny.cz/api/v1/search?')).toBe(true);
    expect(q.get('lookfor')).toBe('9788025703670');
    expect(q.get('type')).toBe('ISN');
    expect(q.get('limit')).toBe('10');
    expect(q.getAll('field[]')).toEqual([...CATALOG_FIELDS]);
    // pole, která v API neexistují, se neposílají
    for (const bad of ['nbn', 'cleanNbn', 'languages', 'publicationPlaces', 'cleanIsbn']) {
      expect(q.getAll('field[]')).not.toContain(bad);
    }
  });

  it('diakritiku a mezery zakóduje', () => {
    const url = buildSearchUrl('Saturnin Jirotka', 'AllFields', 5);
    expect(url).toContain('lookfor=Saturnin+Jirotka');
    expect(new URL(url).searchParams.get('type')).toBe('AllFields');
  });
});

describe('searchCatalog', () => {
  it('vrátí záznamy z ukázkové odpovědi', async () => {
    const records = await searchCatalog('9788025703670', 'ISN', {
      fetchImpl: fakeFetch(SAMPLE_RESPONSE),
    });
    expect(records).toHaveLength(1);
    expect(records[0]!.id).toBe('mkp.3521868');
  });

  it('nenalezeno (chybí records) vrátí prázdné pole, ne chybu', async () => {
    const records = await searchCatalog('9780000000002', 'ISN', {
      fetchImpl: fakeFetch(EMPTY_RESPONSE),
    });
    expect(records).toEqual([]);
  });

  it('prázdný dotaz neposílá žádný request', async () => {
    let called = 0;
    const records = await searchCatalog('   ', 'ISN', {
      fetchImpl: fakeFetch(SAMPLE_RESPONSE, { onRequest: () => called++ }),
    });
    expect(records).toEqual([]);
    expect(called).toBe(0);
  });

  it('HTTP 500 přeloží na CatalogError s kódem http', async () => {
    await expect(
      searchCatalog('x', 'Title', { fetchImpl: fakeFetch({}, { status: 500 }) }),
    ).rejects.toMatchObject({ name: 'CatalogError', code: 'http', status: 500 });
  });

  it('neplatné JSON přeloží na CatalogError parse', async () => {
    await expect(
      searchCatalog('x', 'Title', { fetchImpl: fakeFetch('<html>502</html>') }),
    ).rejects.toMatchObject({ code: 'parse' });
  });

  it('síťovou chybu přeloží na CatalogError network', async () => {
    const failing = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    await expect(searchCatalog('x', 'Title', { fetchImpl: failing })).rejects.toBeInstanceOf(
      CatalogError,
    );
  });

  it('pomalá odpověď spadne na časový limit 8 s (zkráceno v testu)', async () => {
    await expect(
      searchCatalog('x', 'Title', {
        fetchImpl: fakeFetch(SAMPLE_RESPONSE, { delayMs: 300 }),
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('vnější abort skončí kódem aborted', async () => {
    const controller = new AbortController();
    const promise = searchCatalog('x', 'Title', {
      fetchImpl: fakeFetch(SAMPLE_RESPONSE, { delayMs: 300 }),
      signal: controller.signal,
      timeoutMs: 5000,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('výběr záznamu podle ISBN', () => {
  it('nenechá se zmást jiným vydáním téhož díla', () => {
    const records = MULTI_RESPONSE.records!;
    expect(pickRecordByIsbn(records, '9788020204684')?.id).toBe('mlp.2');
    expect(pickRecordByIsbn(records, '9788073882174')?.id).toBe('mlp.3');
    expect(pickRecordByIsbn(records, '9781234567897')).toBeNull();
  });

  it('findByIsbn dotazuje 13 číslicemi i pro ISBN-10', async () => {
    let seenUrl = '';
    const result = await findByIsbn('80-202-0468-7', {
      fetchImpl: fakeFetch(MULTI_RESPONSE, { onRequest: (u) => (seenUrl = u) }),
    });
    expect(new URL(seenUrl).searchParams.get('lookfor')).toBe('9788020204684');
    expect(result.isbn13).toBe('9788020204684');
    expect(result.record?.id).toBe('mlp.2');
  });

  it('když žádný záznam ISBN neobsahuje, hlásí nenalezeno', async () => {
    const result = await findByIsbn('9788025703670', {
      fetchImpl: fakeFetch(MULTI_RESPONSE),
    });
    expect(result.records).toHaveLength(3);
    expect(result.record).toBeNull();
  });
});

describe('isBookRecord', () => {
  it('odfiltruje audioknihy, ale prázdné formats nechá projít', () => {
    expect(isBookRecord({ formats: ['0/BOOKS/'] })).toBe(true);
    expect(isBookRecord({ formats: ['0/AUDIO/'] })).toBe(false);
    expect(isBookRecord({})).toBe(true);
  });
});
