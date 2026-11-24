/**
 * Obrazovka skenování – hlavní pracovní plocha.
 *
 * Tři režimy:
 *  1. čárový kód (kamera + BarcodeDetector/ZXing, umí i inverzní barvy),
 *  2. číslice (OCR tištěného ISBN pod kódem),
 *  3. ruční zadání čísla (katalogové hledání bez kamery).
 * Ke každému nálezu se otevře spodní panel s potvrzením – uložit, upravit, zahodit.
 */

import { feedback, h, ScreenWakeLock, toast } from '../dom';
import { icon, iconButton } from '../icons';
import { createBookForm } from '../bookForm';
import { goNew, goSettings } from '../router';
import {
  CameraError,
  hasNativeBarcodeDetector,
  listCameras,
  startCamera,
  type CameraHandle,
} from '../../core/scan/camera';
import { ScanEngine, type DetectedCode } from '../../core/scan/engine';
import { loadOcr, readIsbnFromCanvas } from '../../core/scan/ocr';
import { lookupIsbn, saveBook, store, type LookupResult } from '../../app/library';
import { formatIsbn } from '../../core/isbn';
import type { Book } from '../../core/types';

export interface Screen {
  element: HTMLElement;
  destroy(): void;
}

type Mode = 'barcode' | 'ocr';

const DEBOUNCE_MS = 2600;
const OCR_INTERVAL_MS = 1400;

export function createScanScreen(): Screen {
  let mode: Mode = 'barcode';
  let camera: CameraHandle | null = null;
  let engine: ScanEngine | null = null;
  const wakeLock = new ScreenWakeLock();
  let destroyed = false;
  let ocrTimer: number | null = null;
  let ocrBusy = false;
  let ocrReady = false;
  let sheetOpen = false;
  let lastCode = '';
  let lastCodeAt = 0;
  let devices: MediaDeviceInfo[] = [];
  let deviceIndex = 0;
  let torchOn = false;

  const video = h('video', {
    class: 'scan__video',
    autoplay: true,
    playsinline: true,
  }) as HTMLVideoElement;
  video.muted = true;

  const guide = h(
    'div',
    { class: 'scan__guide' },
    h('div', { class: 'scan__guide-corners' }),
    h('div', { class: 'scan__laser' }),
  );

  const messageBox = h('div', { class: 'scan__overlay-msg', style: 'display:none' });

  const torchBtn = iconButton('torch', 'Svítilna', () => void toggleTorch());
  torchBtn.style.display = 'none';
  const flipBtn = iconButton('flip', 'Přepnout kameru', () => void switchCamera());
  flipBtn.style.display = 'none';

  const tools = h('div', { class: 'scan__tools' }, torchBtn, flipBtn);
  const stage = h('div', { class: 'scan__stage' }, video, guide, tools, messageBox);

  const stateDot = h('span', { class: 'dot' });
  const stateText = h('span', { text: 'Spouštím kameru…' });
  const state = h('div', { class: 'scan__state' }, stateDot, stateText);

  const barcodeMode = h(
    'button',
    {
      class: 'mode-btn mode-btn--active',
      type: 'button',
      on: { click: () => void setMode('barcode') },
    },
    icon('scan'),
    'Čárový kód',
  );
  const ocrMode = h(
    'button',
    { class: 'mode-btn', type: 'button', on: { click: () => void setMode('ocr') } },
    icon('ocr'),
    'Číslice (OCR)',
  );
  const manualMode = h(
    'button',
    { class: 'mode-btn', type: 'button', on: { click: () => openManualSheet() } },
    icon('keyboard'),
    'Zadat číslo',
  );
  const modes = h('div', { class: 'scan__modes' }, barcodeMode, ocrMode, manualMode);

  const quickRow = h(
    'div',
    { class: 'row', style: 'margin-top:10px' },
    h(
      'button',
      {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        style: 'flex:1',
        on: { click: () => goNew() },
      },
      icon('plus'),
      'Vyplnit celou knihu ručně',
    ),
    h(
      'button',
      {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        on: { click: () => goSettings() },
        'aria-label': 'Nastavení',
      },
      icon('settings'),
    ),
  );

  const zoomInput = h('input', {
    type: 'range',
    min: '1',
    max: '3',
    step: '0.1',
    value: '1',
    style: 'flex:1',
    'aria-label': 'Přiblížení kamery',
    on: { input: () => void applyZoom() },
  }) as HTMLInputElement;
  const zoomRow = h(
    'div',
    { class: 'row', style: 'display:none; margin-top:10px' },
    h('span', { class: 'field__label', text: 'Zoom' }),
    zoomInput,
  );

  async function applyZoom(): Promise<void> {
    const zoom = camera?.zoom;
    if (!zoom) return;
    const value = Number(zoomInput.value);
    await camera?.setZoom(Math.min(zoom.max, Math.max(zoom.min, value)));
  }

  const element = h('section', { class: 'scan' }, stage, state, modes, quickRow, zoomRow);

  // ---------- stavové hlášky ----------

  function setState(text: string, kind: 'ok' | 'err' | 'busy' = 'ok'): void {
    stateText.textContent = text;
    stateDot.className = 'dot' + (kind === 'err' ? ' dot--err' : '');
  }

  function showMessage(text: string | null): void {
    if (!text) {
      messageBox.style.display = 'none';
      messageBox.textContent = '';
      return;
    }
    messageBox.style.display = 'block';
    messageBox.textContent = text;
  }

  // ---------- kamera ----------

  async function boot(): Promise<void> {
    if (destroyed) return;
    try {
      camera = await startCamera(video, { deviceId: devices[deviceIndex]?.deviceId });
    } catch (err) {
      const message =
        err instanceof CameraError ? err.message : 'Kameru se nepodařilo spustit. Zadejte ISBN ručně.';
      setState('Kamera není dostupná', 'err');
      showMessage(message);
      return;
    }

    showMessage(null);
    torchBtn.style.display = camera.torchSupported ? 'grid' : 'none';
    if (camera.zoom) {
      zoomInput.min = String(camera.zoom.min);
      zoomInput.max = String(camera.zoom.max);
      zoomInput.step = String(camera.zoom.step);
      zoomInput.value = String(camera.zoom.min);
      zoomRow.style.display = 'flex';
    }

    devices = await listCameras();
    flipBtn.style.display = devices.length > 1 ? 'grid' : 'none';

    void wakeLock.enable();
    startEngine();
  }

  function startEngine(): void {
    if (!engine) {
      engine = new ScanEngine(video, {
        inverted: store.getSettings().inverted,
        onDetect: (code) => void handleDetected(code),
        onStatus: ({ engine: which, frames }) => {
          if (mode !== 'barcode' || sheetOpen) return;
          if (frames % 12 === 0) {
            setState(
              `Hledám kód… (${which === 'native' ? 'nativní dekodér' : 'ZXing'}${
                store.getSettings().inverted ? ', i inverzní' : ''
              })`,
            );
          }
        },
      });
    }
    engine.update({ inverted: store.getSettings().inverted });
    engine.start();
    setState('Namiřte kód do rámečku');
  }

  function stopScanning(): void {
    engine?.stop();
    stopOcrLoop();
  }

  function resumeScanning(): void {
    sheetOpen = false;
    if (destroyed) return;
    if (mode === 'barcode') startEngine();
    else startOcrLoop();
  }

  async function toggleTorch(): Promise<void> {
    if (!camera) return;
    torchOn = !torchOn;
    const ok = await camera.setTorch(torchOn);
    if (!ok) {
      torchOn = false;
      toast('Svítilnu tento prohlížeč neumí ovládat', 'warn');
    }
    torchBtn.classList.toggle('icon-btn--on', torchOn);
  }

  async function switchCamera(): Promise<void> {
    if (devices.length < 2) return;
    deviceIndex = (deviceIndex + 1) % devices.length;
    engine?.stop();
    camera?.stop();
    engine = null;
    await boot();
  }

  // ---------- režimy ----------

  async function setMode(next: Mode): Promise<void> {
    if (mode === next) return;
    mode = next;
    barcodeMode.classList.toggle('mode-btn--active', mode === 'barcode');
    ocrMode.classList.toggle('mode-btn--active', mode === 'ocr');
    guide.classList.toggle('scan__guide--ocr', mode === 'ocr');
    engine?.stop();
    stopOcrLoop();
    if (mode === 'barcode') {
      startEngine();
    } else {
      await prepareOcr();
      startOcrLoop();
    }
  }

  async function prepareOcr(): Promise<void> {
    if (ocrReady || !store.getSettings().ocr) return;
    setState('Načítám OCR (jednorázově, několik MB)…');
    try {
      await loadOcr((progress) => {
        if (progress.status === 'recognizing') {
          setState(`Čtu číslice… ${Math.round((progress.progress ?? 0) * 100)} %`);
        } else if (progress.status === 'loading') {
          setState('Stahuji OCR engine…');
        }
      });
      ocrReady = true;
      setState('Přidržte číslice ISBN v rámečku');
    } catch {
      setState('OCR se nepodařilo načíst', 'err');
      showMessage('OCR engine se nepodařilo stáhnout. Zadejte číslo ručně tlačítkem „Zadat číslo“).');
    }
  }

  function startOcrLoop(): void {
    stopOcrLoop();
    if (!store.getSettings().ocr) {
      showMessage('OCR je vypnuté v nastavení. Zadejte ISBN ručně.');
      return;
    }
    ocrTimer = window.setInterval(() => void runOcr(), OCR_INTERVAL_MS);
  }

  function stopOcrLoop(): void {
    if (ocrTimer !== null) {
      clearInterval(ocrTimer);
      ocrTimer = null;
    }
  }

  async function runOcr(): Promise<void> {
    if (ocrBusy || sheetOpen || destroyed || video.readyState < 2) return;
    ocrBusy = true;
    try {
      const canvas = captureRegion(video, { x: 0.06, y: 0.36, width: 0.88, height: 0.26 }, 1400);
      const result = await readIsbnFromCanvas(canvas);
      if (result.isbn13) {
        await handleDetected({ text: result.isbn13, format: 'OCR', engine: 'zxing', inverted: false });
      } else if (result.text) {
        setState(`Přečteno „${result.text.slice(0, 22)}“ – zkuste to zblízka a kolmo`);
      } else {
        setState('Číslice nejsou čitelné – přibližte se nebo použijte čárový kód');
      }
    } catch {
      setState('OCR selhalo, zkuste to znovu', 'err');
    } finally {
      ocrBusy = false;
    }
  }

  // ---------- zpracování nálezu ----------

  async function handleDetected(code: DetectedCode): Promise<void> {
    const now = Date.now();
    if (code.text === lastCode && now - lastCodeAt < DEBOUNCE_MS) return;
    lastCode = code.text;
    lastCodeAt = now;

    stopScanning();
    feedback(store.getSettings().feedback);
    sheetOpen = true;

    const sheet = openSheet(h('div', { class: 'hint' }, 'Hledám v katalogu Knihovny.cz…'));
    const result = await lookupIsbn(code.text, code.format === 'OCR' ? 'ocr' : 'barcode');
    if (destroyed) {
      sheet.close();
      return;
    }
    renderResult(sheet, result, code);
  }

  function renderResult(
    sheet: { close: () => void; setContent: (node: Node) => void },
    result: LookupResult,
    code: DetectedCode | null,
  ): void {
    if (store.getSettings().autoSave && result.status === 'found' && result.book && !result.duplicate) {
      const saved = saveBook(result.book);
      sheet.close();
      toast(`Uloženo: ${shortTitle(saved)} · č. ${saved.accession ?? '–'}`, 'ok', 1800);
      resumeScanning();
      return;
    }

    const body = h('div');
    const close = () => sheet.close();

    if (result.status === 'found' && result.book) {
      const book = result.book;
      body.appendChild(
        h(
          'div',
          {},
          h('h2', { class: 'sheet__title', text: book.title || 'Bez názvu' }),
          book.subtitle ? h('p', { class: 'sheet__sub', text: book.subtitle }) : null,
          h('p', {
            class: 'card__meta',
            text: [
              book.authors.join(', '),
              book.publisher,
              book.year,
              book.pages ? `${book.pages} s.` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          }),
          h(
            'p',
            { class: 'hint', style: 'margin-top:8px' },
            `ISBN ${formatIsbn(book.isbn13)}`,
            book.cnb ? ` · ${book.cnb}` : '',
          ),
        ),
      );
      if (result.duplicate) {
        body.appendChild(
          h(
            'p',
            { class: 'hint', style: 'color: var(--warn); margin-top:8px' },
            `Pozor: tahle kniha už v knihovně je (č. ${result.duplicate.accession ?? '–'}, přidáno ${
              result.duplicate.createdAt.slice(0, 10)
            }).`,
          ),
        );
      }
      body.appendChild(
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
                  close();
                  toast(`Uloženo: ${shortTitle(saved)} · č. ${saved.accession ?? '–'}`, 'ok');
                  resumeScanning();
                },
              },
            },
            icon('check'),
            'Uložit do knihovny',
          ),
          h(
            'div',
            { class: 'sheet__actions sheet__actions--2', style: 'margin:0' },
            h(
              'button',
              { class: 'btn', type: 'button', on: { click: () => openEditSheet(book, close) } },
              icon('edit'),
              'Upravit',
            ),
            h(
              'button',
              {
                class: 'btn btn--ghost',
                type: 'button',
                on: {
                  click: () => {
                    close();
                    resumeScanning();
                  },
                },
              },
              'Zahodit',
            ),
          ),
        ),
      );
    } else if (result.status === 'notfound' && result.book) {
      const book = result.book;
      body.append(
        h('h2', { class: 'sheet__title', text: 'V katalogu není' }),
        h('p', { class: 'sheet__sub', text: `ISBN ${formatIsbn(result.isbn13)}` }),
        h('p', {
          class: 'hint',
          text: 'Katalog Knihovny.cz tuhle knihu nezná. Můžete ji uložit s číslem a doplnit ručně.',
        }),
      );
      if (result.duplicate) {
        body.appendChild(
          h(
            'p',
            { class: 'hint', style: 'color: var(--warn)' },
            `Už je v knihovně (č. ${result.duplicate.accession ?? '–'}).`,
          ),
        );
      }
      body.appendChild(
        h(
          'div',
          { class: 'sheet__actions' },
          h(
            'button',
            { class: 'btn', type: 'button', on: { click: () => openEditSheet(book, close) } },
            icon('edit'),
            'Vyplnit údaje ručně',
          ),
          h(
            'button',
            {
              class: 'btn btn--primary',
              type: 'button',
              on: {
                click: () => {
                  const saved = saveBook(book);
                  close();
                  toast(`Uloženo bez názvu (č. ${saved.accession ?? '–'}) – doplňte ho v seznamu`, 'warn', 3200);
                  resumeScanning();
                },
              },
            },
            'Uložit tak, jak je',
          ),
        ),
      );
    } else {
      const title =
        result.status === 'invalid'
          ? 'Tohle není ISBN'
          : result.status === 'error'
            ? 'Katalog neodpovídá'
            : 'Nic nenalezeno';
      body.appendChild(h('h2', { class: 'sheet__title', text: title }));
      body.appendChild(h('p', { class: 'sheet__sub', text: result.message ?? '' }));
      if (code) {
        body.appendChild(h('p', { class: 'hint', text: `Načteno: ${code.text} (${code.format})` }));
      }
      body.appendChild(
        h(
          'div',
          { class: 'sheet__actions' },
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              on: {
                click: () => {
                  close();
                  goNew(result.isbn13 ?? code?.text ?? undefined);
                },
              },
            },
            icon('plus'),
            'Vyplnit ručně',
          ),
          h(
            'button',
            {
              class: 'btn btn--primary',
              type: 'button',
              on: {
                click: () => {
                  lastCode = '';
                  close();
                  resumeScanning();
                },
              },
            },
            'Skenovat dál',
          ),
        ),
      );
      if (result.status === 'error') {
        body.appendChild(
          h(
            'button',
            {
              class: 'linkish',
              type: 'button',
              style: 'margin-top:10px',
              on: {
                click: () => {
                  close();
                  void handleDetected({
                    text: result.isbn13 ?? code?.text ?? '',
                    format: code?.format ?? '',
                    engine: 'zxing',
                    inverted: false,
                  });
                },
              },
            },
            'Zkusit znovu',
          ),
        );
      }
    }

    sheet.setContent(body);
  }

  function openEditSheet(book: Book, closeParent: () => void): void {
    const editSheet = openSheet(h('div'));
    const form = createBookForm({
      book,
      heading: book.title ? 'Úprava knihy' : 'Doplnění údajů',
      submitLabel: 'Uložit do knihovny',
      onSubmit: (updated) => {
        const saved = saveBook(updated);
        editSheet.close();
        closeParent();
        toast(`Uloženo: ${shortTitle(saved)} · č. ${saved.accession ?? '–'}`, 'ok');
        resumeScanning();
      },
      onCancel: () => editSheet.close(),
    });
    editSheet.setContent(form.element);
    setTimeout(() => form.focusTitle(), 120);
  }

  function openManualSheet(): void {
    const sheet = openSheet(h('div'));
    const input = h('input', {
      class: 'input input--mono',
      type: 'text',
      inputmode: 'numeric',
      placeholder: '9788025703670',
      maxlength: 24,
      autocomplete: 'off',
    }) as HTMLInputElement;

    const submit = async () => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      sheet.close();
      stopScanning();
      sheetOpen = true;
      const result = await lookupIsbn(value, 'manual');
      if (destroyed) return;
      renderResult(openSheet(h('div')), result, null);
    };

    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') void submit();
    });

    sheet.setContent(
      h(
        'div',
        {},
        h('h2', { class: 'sheet__title', text: 'Zadat ISBN ručně' }),
        h('p', { class: 'sheet__sub', text: 'Desetimístné i třináctimístné, pomlčky nevadí.' }),
        h('div', { class: 'field' }, input),
        h(
          'div',
          { class: 'sheet__actions' },
          h(
            'button',
            { class: 'btn btn--primary', type: 'button', on: { click: () => void submit() } },
            icon('search'),
            'Vyhledat v katalogu',
          ),
          h(
            'button',
            {
              class: 'btn btn--ghost',
              type: 'button',
              on: {
                click: () => {
                  sheet.close();
                  goNew();
                },
              },
            },
            'Vyplnit knihu bez čísla',
          ),
        ),
      ),
    );
    setTimeout(() => input.focus(), 120);
  }

  // ---------- životní cyklus ----------

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void wakeLock.refresh();
  };
  document.addEventListener('visibilitychange', onVisibility);

  void boot();

  return {
    element,
    destroy(): void {
      destroyed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stopScanning();
      engine = null;
      camera?.stop();
      camera = null;
      void wakeLock.disable();
    },
  };
}

/** Oříznutý snímek z videa – poměry vůči velikosti videa. */
export function captureRegion(
  video: HTMLVideoElement,
  region: { x: number; y: number; width: number; height: number },
  targetWidth = 1200,
): HTMLCanvasElement {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const sx = Math.round(vw * region.x);
  const sy = Math.round(vh * region.y);
  const sw = Math.max(1, Math.round(vw * region.width));
  const sh = Math.max(1, Math.round(vh * region.height));

  const scale = Math.min(3, Math.max(1, targetWidth / sw));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function shortTitle(book: Book): string {
  const title = book.title || 'kniha bez názvu';
  return title.length > 34 ? title.slice(0, 33) + '…' : title;
}

/** Spodní panel; vrací ovládání obsahu a zavírání. */
export function openSheet(initial: Node): {
  close: () => void;
  setContent: (node: Node) => void;
  isOpen: () => boolean;
} {
  const content = h('div', { class: 'sheet__box' }, h('div', { class: 'sheet__handle' }));
  const overlay = h(
    'div',
    {
      class: 'sheet',
      role: 'dialog',
      'aria-modal': 'true',
      on: {
        click: (event) => {
          if (event.target === overlay) close();
        },
      },
    },
    content,
  );

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  let opened = true;
  function close(): void {
    if (!opened) return;
    opened = false;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function appendContent(node: Node): void {
    while (content.childElementCount > 1) content.lastElementChild!.remove();
    content.appendChild(node);
  }

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  appendContent(initial);

  return {
    close,
    setContent: appendContent,
    isOpen: () => opened,
  };
}

export { hasNativeBarcodeDetector };
