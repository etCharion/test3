/**
 * Hledání v katalogu Knihovny.cz podle názvu, autora, ISBN nebo „všeho“.
 * Slouží k přidání knih, které nejdou naskenovat (chybí kód, je poškozený).
 */

import { h, toast } from '../dom';
import { icon } from '../icons';
import { createBookForm } from '../bookForm';
import { bookFromRecord, saveBook, searchBooks, store, type SearchHit } from '../../app/library';
import { formatIsbn } from '../../core/isbn';
import { cleanTail, mapAuthors, pickIsbn13 } from '../../core/record';
import type { CatalogSearchType } from '../../core/catalog';
import type { Book } from '../../core/types';
import { openSheet, type Screen } from './scan';

const TYPES: { key: CatalogSearchType; label: string; placeholder: string }[] = [
  { key: 'Title', label: 'Název', placeholder: 'Název knihy…' },
  { key: 'Author', label: 'Autor', placeholder: 'Jméno autora…' },
  { key: 'AllFields', label: 'Vše', placeholder: 'Název, autor, cokoli…' },
  { key: 'ISN', label: 'ISBN', placeholder: 'ISBN (10 nebo 13 číslic)…' },
];

export function createSearchScreen(initialQuery?: string): Screen {
  let type: CatalogSearchType = initialQuery ? 'AllFields' : 'Title';
  let query = initialQuery ?? '';
  let requestId = 0;

  const resultsHost = h('div');
  const info = h('p', { class: 'hint', style: 'margin: 2px 0 12px' });

  const input = h('input', {
    class: 'input',
    type: 'search',
    placeholder: TYPES[0]!.placeholder,
    value: query,
    autocomplete: 'off',
    on: {
      input: (event) => {
        query = (event.target as HTMLInputElement).value;
      },
      keydown: (event) => {
        if ((event as KeyboardEvent).key === 'Enter') {
          event.preventDefault();
          void runSearch();
        }
      },
    },
  }) as HTMLInputElement;

  const chips = h('div', { class: 'chips' });

  function renderChips(): void {
    chips.replaceChildren(
      ...TYPES.map((t) =>
        h(
          'button',
          {
            class: 'chip' + (t.key === type ? ' chip--active' : ''),
            type: 'button',
            on: {
              click: () => {
                type = t.key;
                input.placeholder = t.placeholder;
                renderChips();
                if (query.trim()) void runSearch();
              },
            },
          },
          t.label,
        ),
      ),
    );
  }

  const runButton = h(
    'button',
    { class: 'btn btn--primary', type: 'button', on: { click: () => void runSearch() } },
    icon('search'),
  ) as HTMLButtonElement;

  async function runSearch(): Promise<void> {
    const q = query.trim();
    if (!q) {
      info.textContent = 'Napište, co hledáte.';
      return;
    }
    // Při rychlém psaní doběhne víc dotazů – zobrazí se jen poslední.
    const current = ++requestId;
    runButton.disabled = true;
    info.textContent = 'Hledám v katalogu…';
    resultsHost.replaceChildren();
    const result = await searchBooks(q, type, 20);
    if (current !== requestId) return;
    runButton.disabled = false;

    info.textContent = result.message ?? `Nalezeno ${result.hits.length} záznamů`;

    if (result.hits.length === 0) {
      resultsHost.appendChild(
        h('div', { class: 'empty' }, h('p', { text: 'Nic nenalezeno. Zkuste jiný typ hledání.' })),
      );
      return;
    }
    for (const hit of result.hits) resultsHost.appendChild(hitItem(hit));
  }

  function hitItem(hit: SearchHit): HTMLElement {
    const record = hit.record;
    const { authors } = mapAuthors(record);
    const isbn = pickIsbn13(record);
    const publisher = record.publishers?.[0] ? cleanTail(record.publishers[0]) : '';
    const meta = [authors.join(', '), publisher, record.publicationDates?.[0], isbn ? formatIsbn(isbn) : '']
      .filter(Boolean)
      .join(' · ');

    const badges = h('div', { class: 'row row--wrap', style: 'gap:5px;margin-top:6px' });
    if (hit.alreadyInLibrary) {
      badges.appendChild(h('span', { class: 'badge badge--warn', text: 'už v knihovně' }));
    }
    if (!hit.isBook) badges.appendChild(h('span', { class: 'badge', text: 'audiokniha / jiné' }));

    return h(
      'button',
      { class: 'item', type: 'button', on: { click: () => openPreview(hit) } },
      h(
        'div',
        { class: 'item__body' },
        h('div', { class: 'item__title', text: record.title ?? '(bez názvu)' }),
        meta ? h('div', { class: 'item__meta', text: meta }) : null,
        badges.childElementCount ? badges : null,
      ),
    );
  }

  function openPreview(hit: SearchHit): void {
    const book = bookFromRecord(hit.record);
    const { authors, contributors } = mapAuthors(hit.record);
    const existing = book.isbn13 ? store.findByIsbn(book.isbn13) : undefined;
    const sheet = openSheet(h('div'));

    sheet.setContent(
      h(
        'div',
        {},
        h('h2', { class: 'sheet__title', text: book.title || 'Bez názvu' }),
        h('p', {
          class: 'sheet__sub',
          text: [authors.join(', '), book.publisher, book.year].filter(Boolean).join(' · '),
        }),
        h(
          'p',
          { class: 'hint' },
          book.isbn13 ? `ISBN ${formatIsbn(book.isbn13)}` : 'Záznam nemá ISBN',
          book.pages ? ` · ${book.pages} s.` : '',
          book.cnb ? ` · ${book.cnb}` : '',
          contributors.length ? ` · ${contributors.join(', ')}` : '',
        ),
        existing
          ? h(
              'p',
              { class: 'hint', style: 'color: var(--warn); margin-top:8px' },
              `Tuhle knihu už máte (č. ${existing.accession ?? '–'}).`,
            )
          : null,
        h(
          'div',
          { class: 'sheet__actions' },
          h(
            'button',
            {
              class: 'btn btn--primary',
              type: 'button',
              on: {
                click: () => {
                  const saved = saveBook(book);
                  sheet.close();
                  toast(`Přidáno: ${saved.title.slice(0, 40)} · č. ${saved.accession ?? '–'}`, 'ok');
                },
              },
            },
            icon('plus'),
            'Přidat do knihovny',
          ),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              on: {
                click: () => {
                  sheet.close();
                  openEditSheet(book);
                },
              },
            },
            icon('edit'),
            'Upravit před uložením',
          ),
        ),
      ),
    );
  }

  function openEditSheet(book: Book): void {
    const sheet = openSheet(h('div'));
    const form = createBookForm({
      book,
      heading: 'Úprava před uložením',
      submitLabel: 'Uložit do knihovny',
      onSubmit: (updated) => {
        const saved = saveBook(updated);
        sheet.close();
        toast(`Přidáno: ${saved.title.slice(0, 40)} · č. ${saved.accession ?? '–'}`, 'ok');
      },
      onCancel: () => sheet.close(),
    });
    sheet.setContent(form.element);
  }

  renderChips();
  const element = h(
    'section',
    {},
    h('div', { class: 'searchbar' }, input, runButton),
    chips,
    info,
    resultsHost,
  );

  if (query) void runSearch();

  return {
    element,
    destroy: () => {
      requestId += 1;
    },
  };
}
