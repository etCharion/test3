import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  CatalogError,
  findByIsbn,
  isbnQueryForms,
  isBookRecord,
  pickRecordByIsbn,
  searchCatalog,
  CATALOG_FIELDS,
} from '../core/catalog';
import {
  EMPTY_RESPONSE,
  fakeFetch,
  flakyFetch,
  MULTI_RESPONSE,
  routedFetch,
  SAMPLE_RESPONSE,
  TEN_ONLY_RESPONSE,
} from './fixtures';

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

describe('tvary dotazu podle ISBN', () => {
  it('posílá 13 číslic, a jako zálohu desetimístný tvar bez pomlček', () => {
    expect(isbnQueryForms('80-7061-343-2')).toEqual(['9788070613436', '8070613432']);
    expect(isbnQueryForms('978-80-7061-343-6')).toEqual(['9788070613436', '8070613432']);
  });

  it('u prefixu 979 desetimístný tvar neexistuje', () => {
    expect(isbnQueryForms('979-10-90636-07-1')).toEqual(['9791090636071']);
  });

  it('text okolo čísla ani pomlčky do dotazu nejdou', () => {
    expect(isbnQueryForms('ISBN 978-80-257-0367-0 (váz.)')).toEqual(['9788025703670', '8025703673']);
    expect(isbnQueryForms('80-202-0468-7 (brož.)')[1]).toBe('8020204687');
  });

  it('neplatnou kontrolní číslici pošle tak, jak je (jen číslice)', () => {
    expect(isbnQueryForms('9788020204683')).toEqual(['9788020204683']);
    expect(isbnQueryForms('9788020204684')).toEqual(['9788020204684', '8020204687']);
  });
});

describe('findByIsbn – záložní desetimístný tvar', () => {
  it('když 13 číslic nic nenajde, zkusí 10 a knihu najde', async () => {
    const seen: string[] = [];
    const result = await findByIsbn('9788070613436', {
      fetchImpl: routedFetch(
        (lookfor) => (lookfor === '8070613432' ? TEN_ONLY_RESPONSE : EMPTY_RESPONSE),
        { onRequest: (lookfor) => seen.push(lookfor) },
      ),
    });
    expect(seen).toEqual(['9788070613436', '8070613432']);
    expect(result.record?.id).toBe('mlp.10');
    expect(result.isbn13).toBe('9788070613436');
    expect(result.records).toHaveLength(1);
  });

  it('když 13 číslic knihu najde, druhý dotaz už neposílá', async () => {
    const seen: string[] = [];
    const result = await findByIsbn('9788025703670', {
      fetchImpl: routedFetch(() => SAMPLE_RESPONSE, { onRequest: (lookfor) => seen.push(lookfor) }),
    });
    expect(seen).toEqual(['9788025703670']);
    expect(result.record?.id).toBe('mkp.3521868');
  });

  it('vrací i záznamy z obou dotazů (ruční výběr jiného vydání)', async () => {
    const result = await findByIsbn('9788070613436', {
      fetchImpl: routedFetch((lookfor) =>
        lookfor === '8070613432' ? TEN_ONLY_RESPONSE : MULTI_RESPONSE,
      ),
    });
    const ids = result.records.map((r) => r.id);
    expect(ids).toEqual(['aud.1', 'mlp.2', 'mlp.3', 'mlp.10']);
    expect(result.record?.id).toBe('mlp.10');
  });

  it('když oba tvary selžou, hlásí chybu katalogu', async () => {
    await expect(
      findByIsbn('9788070613436', { fetchImpl: fakeFetch({}, { status: 500 }) }),
    ).rejects.toMatchObject({ code: 'http', status: 500 });
  });

  it('chyba u záložního tvaru nezahodí záznamy z prvního dotazu', async () => {
    let call = 0;
    const impl = (() => {
      call += 1;
      if (call === 2) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(
        new Response(JSON.stringify(EMPTY_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as typeof fetch;
    const result = await findByIsbn('9788070613436', { fetchImpl: impl });
    expect(result.record).toBeNull();
    expect(result.records).toEqual([]);
  });
});

describe('searchCatalog – jeden pokus navíc na HTTP 5xx', () => {
  it('po chybě 500 zkusí dotaz znovu a vrátí data', async () => {
    const records = await searchCatalog('9788025703670', 'ISN', {
      fetchImpl: flakyFetch(SAMPLE_RESPONSE, 1, 500),
    });
    expect(records).toHaveLength(1);
  });

  it('opakovaná chyba 500 už se hlásí', async () => {
    await expect(
      searchCatalog('9788025703670', 'ISN', { fetchImpl: flakyFetch(SAMPLE_RESPONSE, 5, 500) }),
    ).rejects.toMatchObject({ code: 'http', status: 500 });
  });

  it('na chybu 400 se neopakuje', async () => {
    let calls = 0;
    const impl = routedFetch(() => ({}), { status: 400, onRequest: () => (calls += 1) });
    await expect(searchCatalog('x', 'Title', { fetchImpl: impl })).rejects.toMatchObject({
      status: 400,
    });
    expect(calls).toBe(1);
  });
});
