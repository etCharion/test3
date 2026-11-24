/**
 * Formulář jedné knihy – používá se pro ruční zadání, pro doplnění nálezu
 * z katalogu i pro pozdější úpravy.
 */

import { h, toast } from './dom';
import { icon } from './icons';
import { stripIsbn, toIsbn13 } from '../core/isbn';
import type { Book } from '../core/types';
import { store } from '../app/library';

export interface BookFormOptions {
  book: Book;
  submitLabel?: string;
  /** Nadpis nad formulářem. */
  heading?: string;
  onSubmit: (book: Book) => void | Promise<void>;
  onCancel?: () => void;
  /** Zobrazit přírůstkové číslo a signaturu (výchozí ano). */
  showLibraryFields?: boolean;
}

export interface BookFormHandle {
  element: HTMLFormElement;
  /** Přečte aktuální stav z polí. */
  read(): Book;
  focusTitle(): void;
  setError(message: string | null): void;
}

function textField(
  label: string,
  value: string,
  options: {
    placeholder?: string;
    inputmode?: string;
    mono?: boolean;
    maxlength?: number;
    required?: boolean;
    onInput?: (value: string) => void;
    onBlur?: (input: HTMLInputElement) => void;
  } = {},
): { field: HTMLElement; input: HTMLInputElement } {
  const input = h('input', {
    class: 'input' + (options.mono ? ' input--mono' : ''),
    type: 'text',
    value,
    placeholder: options.placeholder ?? '',
    inputmode: options.inputmode,
    maxlength: options.maxlength,
    autocomplete: 'off',
  });
  if (options.onInput) input.addEventListener('input', () => options.onInput!(input.value));
  if (options.onBlur) input.addEventListener('blur', () => options.onBlur!(input));
  const field = h(
    'label',
    { class: 'field' },
    h('span', { class: 'field__label', text: label }),
    input,
  );
  return { field, input };
}

export function createBookForm(options: BookFormOptions): BookFormHandle {
  const original = options.book;
  let isbnValue = original.isbn13 ?? original.isbnRaw ?? '';

  const title = textField('Název *', original.title, {
    placeholder: 'Název knihy',
    required: true,
  });

  const authors = textField('Autoři', original.authors.join(', '), {
    placeholder: 'Jméno Příjmení, další autoři oddělte čárkou',
  });

  const contributors = textField('Překlad / ilustrace', original.contributors.join(', '), {
    placeholder: 'Např. překladatel',
  });

  const subtitle = textField('Podnázev', original.subtitle ?? '', {
    placeholder: 'Nepovinné',
  });

  const isbn = textField('ISBN', isbnValue, {
    placeholder: '9788025703670',
    inputmode: 'numeric',
    mono: true,
    maxlength: 24,
    onBlur: (input) => {
      const raw = input.value.trim();
      const normalized = toIsbn13(raw);
      if (!raw) {
        isbnHint.textContent = '';
        input.classList.remove('input--invalid');
        return;
      }
      if (normalized) {
        input.value = normalized;
        isbnHint.textContent = 'Uloží se jako ' + normalized;
        isbnHint.style.color = 'var(--muted)';
      } else if (stripIsbn(raw).length >= 8) {
        isbnHint.textContent = 'Tohle nevypadá na platné ISBN (kontrolní číslice nesedí).';
        isbnHint.style.color = 'var(--warn)';
      } else {
        isbnHint.textContent = 'ISBN by mělo mít 10 nebo 13 číslic.';
        isbnHint.style.color = 'var(--warn)';
      }
    },
  });
  const isbnHint = h('span', { class: 'hint', text: original.isbn13 ? 'Uloží se jako ' + original.isbn13 : '' });
  isbn.field.appendChild(isbnHint);

  const publisher = textField('Nakladatel', original.publisher ?? '', { placeholder: 'Argo' });
  const place = textField('Místo', original.place ?? '', { placeholder: 'Praha' });

  const year = textField('Rok', original.year ? String(original.year) : '', {
    inputmode: 'numeric',
    maxlength: 4,
    placeholder: '2011',
  });

  const pages = textField('Strany', original.pages ? String(original.pages) : '', {
    inputmode: 'numeric',
    maxlength: 5,
    placeholder: '218',
  });

  const cnb = textField('ČNB', original.cnb ?? '', { placeholder: 'cnb002163342' });

  const showLibrary = options.showLibraryFields !== false;
  const accession = textField(
    'Přírůstkové číslo',
    original.accession ?? store.peekAccession(),
    { placeholder: store.peekAccession() },
  );
  const signature = textField('Signatura', original.signature ?? '', { placeholder: 'B-12' });
  const copies = textField('Počet kusů', String(original.copies || 1), {
    inputmode: 'numeric',
    maxlength: 3,
  });
  const note = h('textarea', {
    class: 'textarea',
    value: original.note ?? '',
    placeholder: 'Poznámka (stav, dar, poškození…)',
  });

  const errorBox = h('div', { class: 'hint', style: 'color: var(--danger); min-height: 18px;' });

  const read = (): Book => {
    const isbnTyped = isbn.input.value.trim();
    const normalized = toIsbn13(isbnTyped);
    return {
      ...original,
      title: title.input.value.trim(),
      subtitle: subtitle.input.value.trim() || null,
      authors: splitList(authors.input.value),
      contributors: splitList(contributors.input.value),
      isbn13: normalized ?? null,
      isbnRaw: isbnTyped || null,
      isbnSource: normalized && original.isbn13 ? original.isbnSource : normalized ? 'manual' : 'none',
      publisher: publisher.input.value.trim() || null,
      place: place.input.value.trim() || null,
      year: parsePositiveInt(year.input.value),
      pages: parsePositiveInt(pages.input.value),
      cnb: cnb.input.value.trim() || null,
      accession: accession.input.value.trim() || null,
      signature: signature.input.value.trim() || null,
      copies: parsePositiveInt(copies.input.value) ?? 1,
      note: note.value.trim() || null,
      updatedAt: new Date().toISOString(),
    };
  };

  const submit = h(
    'button',
    { class: 'btn btn--primary btn--block', type: 'submit' },
    icon('check'),
    options.submitLabel ?? 'Uložit knihu',
  );

  const form = h(
    'form',
    {
      class: 'book-form',
      on: {
        submit: (event) => {
          event.preventDefault();
          const book = read();
          if (!book.title) {
            errorBox.textContent = 'Název je povinný – bez něj se kniha v seznamu nepozná.';
            title.input.focus();
            toast('Doplňte název knihy', 'warn');
            return;
          }
          errorBox.textContent = '';
          void options.onSubmit(book);
        },
      },
    },
    options.heading ? h('h2', { class: 'section-title', text: options.heading }) : null,
    h('div', { class: 'card' }, title.field, subtitle.field, authors.field, contributors.field),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'section-title', style: 'margin-top:0' }, 'Vydání'),
      isbn.field,
      publisher.field,
      h('div', { class: 'row--split' }, place.field, year.field),
      h('div', { class: 'row--split' }, pages.field, cnb.field),
    ),
    showLibrary
      ? h(
          'div',
          { class: 'card' },
          h('div', { class: 'section-title', style: 'margin-top:0' }, 'Knihovna'),
          h('div', { class: 'row--split' }, accession.field, signature.field),
          h('div', { class: 'row--split' }, copies.field, h('div')),
          note,
        )
      : null,
    errorBox,
    submit,
    options.onCancel
      ? h(
          'button',
          {
            class: 'btn btn--ghost btn--block',
            type: 'button',
            style: 'margin-top:8px',
            on: { click: () => options.onCancel?.() },
          },
          'Zpět',
        )
      : null,
  );

  return {
    element: form,
    read,
    focusTitle: () => title.input.focus(),
    setError: (message) => {
      errorBox.textContent = message ?? '';
    },
  };
}

/** „Novák, Nový“ → ['Novák', 'Nový'] (čárka i středník). */
export function splitList(value: string): string[] {
  return (value ?? '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parsePositiveInt(value: string): number | null {
  const digits = (value ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
