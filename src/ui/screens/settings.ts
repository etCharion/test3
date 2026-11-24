/**
 * Nastavení: přírůstková čísla, chování skeneru, zálohy a informace o datech.
 */

import { confirmDialog, h, toast } from '../dom';
import { icon } from '../icons';
import { store } from '../../app/library';
import { downloadBlob, exportFileName } from '../../core/export';
import { CATALOG_ENDPOINT } from '../../core/catalog';
import type { Settings } from '../../core/types';
import type { Screen } from './scan';

export function createSettingsScreen(): Screen {
  const s = store.getSettings();

  const preview = h('p', { class: 'hint' });

  function refreshPreview(): void {
    preview.textContent = `Další kniha dostane číslo: ${store.peekAccession()}`;
  }

  function update(patch: Partial<Settings>): void {
    store.updateSettings(patch);
    refreshPreview();
    toast('Nastavení uloženo', 'ok', 1400);
  }

  const prefixInput = h('input', {
    class: 'input',
    type: 'text',
    value: s.accessionPrefix,
    placeholder: 'např. 2026-',
    autocomplete: 'off',
    on: { change: (e) => update({ accessionPrefix: (e.target as HTMLInputElement).value }) },
  }) as HTMLInputElement;

  const nextInput = h('input', {
    class: 'input',
    type: 'number',
    min: '1',
    value: String(s.accessionNext),
    on: {
      change: (e) => {
        const value = Number((e.target as HTMLInputElement).value);
        update({ accessionNext: Number.isFinite(value) && value > 0 ? Math.floor(value) : 1 });
      },
    },
  }) as HTMLInputElement;

  const padInput = h('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '8',
    value: String(s.accessionPad),
    on: {
      change: (e) => {
        const value = Number((e.target as HTMLInputElement).value);
        update({ accessionPad: Number.isFinite(value) ? Math.min(8, Math.max(0, Math.floor(value))) : 0 });
      },
    },
  }) as HTMLInputElement;

  function toggleRow(label: string, description: string, key: keyof Settings, checked: boolean): HTMLElement {
    const input = h('input', {
      type: 'checkbox',
      checked,
      style: 'width:22px;height:22px;accent-color:var(--accent);flex:none',
      on: {
        change: (e) =>
          update({ [key]: (e.target as HTMLInputElement).checked } as unknown as Partial<Settings>),
      },
    }) as HTMLInputElement;
    return h(
      'label',
      { class: 'row', style: 'align-items:flex-start;gap:12px;padding:10px 0;cursor:pointer' },
      input,
      h(
        'div',
        { class: 'item__body' },
        h('div', { text: label, style: 'font-weight:600;font-size:14.5px' }),
        h('div', { class: 'hint', text: description }),
      ),
    );
  }

  function exportBackup(): void {
    const blob = new Blob([store.toJson()], { type: 'application/json' });
    downloadBlob(blob, exportFileName('knihovna-zaloha', 'json'));
    toast('Záloha uložena', 'ok');
  }

  function importBackup(): void {
    const input = h('input', { type: 'file', accept: '.json,application/json' }) as HTMLInputElement;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const count = store.fromJson(await file.text());
        toast(`Obnoveno ${count} knih`, 'ok');
      } catch (err) {
        toast('Soubor se nepodařilo načíst: ' + (err instanceof Error ? err.message : ''), 'error', 4000);
      }
    });
    input.click();
  }

  const clearButton = h(
    'button',
    {
      class: 'btn btn--danger btn--block',
      type: 'button',
      on: {
        click: async () => {
          const ok = await confirmDialog(
            `Smazat všech ${store.list().length} knih z knihovny? Nejprve si udělejte zálohu.`,
            'Smazat vše',
          );
          if (!ok) return;
          store.clear();
          toast('Knihovna vyprázdněna', 'ok');
        },
      },
    },
    icon('trash'),
    'Vyprázdnit knihovnu',
  );

  refreshPreview();

  const element = h(
    'section',
    {},
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'section-title', style: 'margin-top:0' }, 'Přírůstková čísla'),
      h('div', { class: 'row--split' }, field('Prefix', prefixInput), field('Pokračovat od', nextInput)),
      field('Doplňovat nulami (počet míst)', padInput),
      preview,
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'section-title', style: 'margin-top:0' }, 'Chování skeneru'),
      toggleRow(
        'Ukládat rovnou po nalezení',
        'Nález z katalogu se uloží bez potvrzování – nejrychlejší způsob evidence.',
        'autoSave',
        s.autoSave,
      ),
      toggleRow('Vibrace a tón', 'Zpětná vazba po načtení kódu.', 'feedback', s.feedback),
      toggleRow(
        'Zkoušet i inverzní barvy',
        'Bílé čárové kódy na tmavém podkladu. Střídá normální a převrácený snímek.',
        'inverted',
        s.inverted,
      ),
      toggleRow(
        'OCR tištěných číslic',
        'Režim „Číslice“ přečte ISBN vytištěné pod kódem. Engine se stahuje až při prvním použití.',
        'ocr',
        s.ocr,
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'section-title', style: 'margin-top:0' }, 'Data'),
      h(
        'div',
        { class: 'row', style: 'margin-bottom:8px' },
        h(
          'button',
          { class: 'btn btn--block', type: 'button', on: { click: exportBackup } },
          icon('download'),
          'Záloha (JSON)',
        ),
        h('button', { class: 'btn btn--block', type: 'button', on: { click: importBackup } }, 'Obnovit'),
      ),
      clearButton,
      store.persistent
        ? null
        : h(
            'p',
            { class: 'hint', style: 'color: var(--warn); margin-bottom:0' },
            'Prohlížeč blokuje ukládání dat – po zavření aplikace knihovna zmizí.',
          ),
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'section-title', style: 'margin-top:0' }, 'Zdroj dat'),
      h('p', { class: 'hint', style: 'margin:0' }, 'Údaje o knihách pocházejí z veřejného API katalogu Knihovny.cz:'),
      h(
        'p',
        { class: 'hint', style: 'margin:6px 0 0; word-break:break-all; color: var(--info)' },
        CATALOG_ENDPOINT,
      ),
      h(
        'p',
        { class: 'hint', style: 'margin:8px 0 0' },
        'Dotazy jdou přímo z vašeho prohlížeče – aplikace nemá server ani API klíč.',
      ),
    ),
    h('p', { class: 'hint', style: 'text-align:center; margin-top:18px' }, 'Skener knihovny · verze 1.0.0'),
  );

  return { element, destroy: () => {} };
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field__label', text: label }), input);
}
