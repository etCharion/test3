/**
 * Detail a úprava jedné knihy + mazání.
 */

import { confirmDialog, h, toast } from '../dom';
import { icon } from '../icons';
import { createBookForm } from '../bookForm';
import { goBack, goScan } from '../router';
import { saveBook, store } from '../../app/library';
import type { Screen } from './scan';

export function createBookScreen(id: string): Screen {
  const book = store.get(id);

  if (!book) {
    return {
      element: h(
        'div',
        { class: 'empty' },
        h('p', { text: 'Kniha nebyla nalezena.' }),
        h('button', { class: 'btn', type: 'button', on: { click: goScan } }, 'Zpět na skenování'),
      ),
      destroy: () => {},
    };
  }

  const form = createBookForm({
    book,
    submitLabel: 'Uložit změny',
    onSubmit: (updated) => {
      saveBook(updated);
      toast('Uloženo', 'ok');
      goBack();
    },
    onCancel: goBack,
  });

  const removeBtn = h(
    'button',
    {
      class: 'btn btn--danger btn--block',
      type: 'button',
      style: 'margin-top:14px',
      on: {
        click: async () => {
          const ok = await confirmDialog(
            `Smazat „${book.title || 'knihu bez názvu'}“ z knihovny? Akce nejde vrátit.`,
            'Smazat knihu',
          );
          if (!ok) return;
          store.remove(book.id);
          toast('Kniha smazána', 'ok');
          goBack();
        },
      },
    },
    icon('trash'),
    'Smazat knihu',
  );

  const meta = h(
    'p',
    { class: 'hint', style: 'margin: 0 0 14px' },
    `Přidáno ${book.createdAt.slice(0, 10)}`,
    book.catalogId ? ` · katalog ${book.catalogId}` : ' · ruční záznam',
  );

  return { element: h('section', {}, meta, form.element, removeBtn), destroy: () => {} };
}
