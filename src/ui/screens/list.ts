/**
 * Seznam knihovny: filtrování, statistiky a export do Excelu.
 */

import { h, toast } from '../dom';
import { icon } from '../icons';
import { goBook, goScan } from '../router';
import { store } from '../../app/library';
import { normalizeText } from '../../core/store';
import { createCsv, createXlsxBlob, downloadBlob, exportFileName, shareFile } from '../../core/export';
import { formatIsbn } from '../../core/isbn';
import type { Book } from '../../core/types';
import type { Screen } from './scan';

export function createListScreen(): Screen {
  let filter = '';
  let sort: 'new' | 'title' | 'accession' = 'new';

  const stats = h('div', { class: 'stats' });
  const itemsHost = h('div');
  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Filtrovat podle názvu, autora, ISBN…',
    autocomplete: 'off',
    on: {
      input: (event) => {
        filter = (event.target as HTMLInputElement).value;
        renderItems();
      },
    },
  }) as HTMLInputElement;

  const sortSelect = h(
    'select',
    {
      class: 'input',
      style: 'flex:0 0 42%',
      on: {
        change: (event) => {
          sort = (event.target as HTMLSelectElement).value as typeof sort;
          renderItems();
        },
      },
    },
    h('option', { value: 'new' }, 'Nejnovější'),
    h('option', { value: 'title' }, 'Podle názvu'),
    h('option', { value: 'accession' }, 'Podle přírůstku'),
  ) as HTMLSelectElement;

  function sorted(books: Book[]): Book[] {
    const list = [...books];
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'cs'));
    if (sort === 'accession') {
      list.sort((a, b) => (a.accession ?? '').localeCompare(b.accession ?? '', 'cs', { numeric: true }));
    }
    return list;
  }

  function matches(book: Book, query: string): boolean {
    if (!query) return true;
    const haystack = [
      book.title,
      book.subtitle ?? '',
      book.authors.join(' '),
      book.publisher ?? '',
      book.accession ?? '',
      book.signature ?? '',
      book.isbn13 ?? '',
      String(book.year ?? ''),
      book.note ?? '',
    ]
      .join(' ')
      .toLowerCase();
    const needle = normalizeText(query);
    return haystack.includes(needle) || normalizeText(haystack).includes(needle);
  }

  function renderItems(): void {
    const all = store.list();
    const visible = sorted(all.filter((book) => matches(book, filter)));
    itemsHost.replaceChildren();

    const s = store.stats();
    stats.replaceChildren(
      statCard(String(s.total), 'knih'),
      statCard(String(s.withIsbn), 's ISBN'),
      statCard(String(s.withoutCatalog), 'mimo katalog'),
    );

    if (all.length === 0) {
      itemsHost.appendChild(
        h(
          'div',
          { class: 'empty' },
          h('p', { text: 'Knihovna je zatím prázdná.' }),
          h(
            'button',
            { class: 'btn btn--primary', type: 'button', on: { click: () => goScan() } },
            icon('scan'),
            'Začít skenovat',
          ),
        ),
      );
      return;
    }

    if (visible.length === 0) {
      itemsHost.appendChild(h('div', { class: 'empty', text: 'Filtru neodpovídá žádná kniha.' }));
      return;
    }

    for (const book of visible) {
      itemsHost.appendChild(bookItem(book));
    }
  }

  function bookItem(book: Book): HTMLElement {
    const badges = h('div', { class: 'row row--wrap', style: 'gap:5px;margin-top:6px' });
    if (book.accession) badges.appendChild(h('span', { class: 'badge badge--ok', text: `č. ${book.accession}` }));
    if (!book.title) badges.appendChild(h('span', { class: 'badge badge--warn', text: 'bez názvu' }));
    if (!book.isbn13) badges.appendChild(h('span', { class: 'badge', text: 'bez ISBN' }));
    if (!book.catalogId) badges.appendChild(h('span', { class: 'badge', text: 'ručně' }));
    if (book.copies > 1) badges.appendChild(h('span', { class: 'badge badge--info', text: `${book.copies}×` }));

    const meta = [
      book.authors.join(', '),
      book.year,
      book.publisher,
      book.isbn13 ? formatIsbn(book.isbn13) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return h(
      'button',
      {
        class: 'item',
        type: 'button',
        on: { click: () => goBook(book.id) },
      },
      h(
        'div',
        { class: 'item__body' },
        h('div', { class: 'item__title', text: book.title || '(bez názvu)' }),
        meta ? h('div', { class: 'item__meta', text: meta }) : null,
        badges.childElementCount ? badges : null,
      ),
    );
  }

  async function exportXlsx(): Promise<void> {
    const books = sorted(store.list());
    if (books.length === 0) {
      toast('Není co exportovat', 'warn');
      return;
    }
    const blob = createXlsxBlob(books);
    const name = exportFileName('knihovna', 'xlsx');
    if (await shareFile(blob, name, 'Knihovna – export')) {
      toast('Soubor předán do Sdílení', 'ok');
    } else {
      downloadBlob(blob, name);
      toast('Excel uložen do Stažených', 'ok');
    }
  }

  function exportCsvFile(): void {
    const books = sorted(store.list());
    if (books.length === 0) {
      toast('Není co exportovat', 'warn');
      return;
    }
    const blob = new Blob([createCsv(books)], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, exportFileName('knihovna', 'csv'));
    toast('CSV uloženo do Stažených', 'ok');
  }

  const exportRow = h(
    'div',
    { class: 'row', style: 'margin: 4px 0 16px' },
    h(
      'button',
      { class: 'btn btn--primary', type: 'button', style: 'flex:1', on: { click: () => void exportXlsx() } },
      icon('download'),
      'Export do Excelu',
    ),
    h(
      'button',
      { class: 'btn btn--sm', type: 'button', on: { click: exportCsvFile } },
      'CSV',
    ),
  );

  renderItems();
  const unsubscribe = store.subscribe(() => renderItems());

  const element = h(
    'section',
    {},
    stats,
    exportRow,
    h('div', { class: 'searchbar' }, searchInput),
    h('div', { class: 'row', style: 'margin-bottom:12px' }, sortSelect),
    itemsHost,
  );

  return {
    element,
    destroy: () => unsubscribe(),
  };
}

function statCard(value: string, label: string): HTMLElement {
  return h(
    'div',
    { class: 'stat' },
    h('div', { class: 'stat__value', text: value }),
    h('div', { class: 'stat__label', text: label }),
  );
}
