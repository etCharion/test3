/**
 * Ruční vyplnění celé knihy – buď úplně od nuly, nebo s dohledáním
 * podle zadaného ISBN.
 */

import { h, toast } from '../dom';
import { icon } from '../icons';
import { createBookForm } from '../bookForm';
import { goBack, goScan } from '../router';
import { lookupIsbn, saveBook, store } from '../../app/library';
import { emptyBook, type Book } from '../../core/types';
import type { Screen } from './scan';

export function createNewScreen(initialIsbn?: string): Screen {
  const host = h('div');
  let current: Book = emptyBook({
    isbn13: initialIsbn ?? null,
    isbnRaw: initialIsbn ?? null,
    isbnSource: initialIsbn ? 'manual' : 'none',
  });
  let form: ReturnType<typeof createBookForm> | null = null;

  const lookupInput = h('input', {
    class: 'input input--mono',
    type: 'text',
    inputmode: 'numeric',
    placeholder: '9788025703670',
    value: initialIsbn ?? '',
    maxlength: 24,
    autocomplete: 'off',
  }) as HTMLInputElement;

  const lookupButton = h(
    'button',
    { class: 'btn', type: 'button', on: { click: () => void lookup() } },
    icon('search'),
  ) as HTMLButtonElement;

  async function lookup(): Promise<void> {
    const value = lookupInput.value.trim();
    if (!value) {
      lookupInput.focus();
      return;
    }
    lookupButton.disabled = true;
    toast('Hledám v katalogu…', 'info', 1200);
    const result = await lookupIsbn(value, 'manual');
    lookupButton.disabled = false;
    if (!result.book) return;

    // Zachovat, co uživatel vyplnil, a doplnit jen chybějící údaje z katalogu.
    const typed = form?.read() ?? current;
    const merged: Book = {
      ...result.book,
      accession: typed.accession,
      signature: typed.signature,
      note: typed.note,
      copies: typed.copies,
      title: result.book.title || typed.title,
    };
    mount(merged);
    toast(
      result.status === 'found'
        ? 'Doplněno z katalogu Knihovny.cz'
        : result.message ?? 'V katalogu nenalezeno – vyplňte ručně',
      result.status === 'found' ? 'ok' : 'warn',
      3000,
    );
  }

  function mount(book: Book): void {
    form = createBookForm({
      book,
      submitLabel: 'Uložit do knihovny',
      onSubmit: (updated) => {
        const saved = saveBook(updated);
        toast(`Uloženo: ${saved.title.slice(0, 40)} · č. ${saved.accession ?? '–'}`, 'ok');
        goScan();
      },
      onCancel: goBack,
    });
    host.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'section-title', style: 'margin-top:0' }, 'Dohledat podle ISBN'),
        h('div', { class: 'row' }, lookupInput, lookupButton),
        h('p', {
          class: 'hint',
          style: 'margin:8px 0 0',
          text: 'Když katalog knihu zná, doplní se název, autor, nakladatel i rok.',
        }),
      ),
      form.element,
    );
    current = book;
  }

  mount(current);

  return {
    element: h(
      'section',
      {},
      h(
        'p',
        { class: 'hint', style: 'margin:0 0 12px' },
        `Příští přírůstkové číslo: ${store.peekAccession()}`,
      ),
      host,
    ),
    destroy: () => {
      form = null;
    },
  };
}
