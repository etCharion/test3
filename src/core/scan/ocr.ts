/**
 * OCR tištěných číslic pod čárovým kódem (pro případy, kdy je kód poškozený
 * nebo chybí a ISBN je jen vytištěné).
 *
 * tesseract.js je velký (WASM + jazykový model), proto se načítá až při prvním
 * použití a klidně z CDN. Když se nenačte, aplikace to řekne a nabídne ruční
 * zadání – OCR není podmínkou provozu.
 */

import { extractIsbn } from '../isbn';

/** Odkud se OCR bere. Lze přepsat na vlastní kopii (offline provoz). */
export const TESSERACT_CDN = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js',
  'https://unpkg.com/tesseract.js@6.0.1/dist/tesseract.esm.min.js',
];

export type OcrStatus = 'idle' | 'loading' | 'recognizing' | 'ready' | 'error';

export interface OcrProgress {
  status: OcrStatus;
  /** 0–1, pokud to knihovna hlásí. */
  progress?: number;
  message?: string;
}

interface TesseractWorker {
  recognize(
    image: HTMLCanvasElement | ImageData | string,
    options?: Record<string, unknown>,
  ): Promise<{ data: { text: string } }>;
  terminate(): Promise<void>;
}

interface TesseractModule {
  createWorker(
    lang?: string,
    oem?: number,
    options?: Record<string, unknown>,
  ): Promise<TesseractWorker>;
}

let workerPromise: Promise<TesseractWorker> | null = null;
let loadFailed = false;

/** Načte OCR engine (jednou za běh aplikace). */
export async function loadOcr(onProgress?: (p: OcrProgress) => void): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise;
  if (loadFailed) throw new Error('OCR se nepodařilo načíst.');

  onProgress?.({ status: 'loading', progress: 0 });
  workerPromise = (async () => {
    let lastError: unknown = null;
    for (const url of TESSERACT_CDN) {
      try {
        const mod = (await import(/* @vite-ignore */ url)) as TesseractModule;
        const worker = await mod.createWorker('eng', 1, {
          logger: (m: { status?: string; progress?: number }) => {
            if (m.status === 'recognizing text') {
              onProgress?.({ status: 'recognizing', progress: m.progress ?? 0 });
            }
          },
        });
        onProgress?.({ status: 'ready', progress: 1 });
        return worker;
      } catch (err) {
        lastError = err;
      }
    }
    loadFailed = true;
    workerPromise = null;
    onProgress?.({ status: 'error', message: 'OCR engine se nepodařilo stáhnout.' });
    throw lastError instanceof Error ? lastError : new Error('OCR engine se nepodařilo stáhnout.');
  })();

  return workerPromise;
}

export function isOcrLoaded(): boolean {
  return workerPromise !== null && !loadFailed;
}

/**
 * Připraví výřez s číslicemi pro OCR: převede na odstíny šedi, zvedne
 * kontrast a práh, protože jde o tmavý text na světlém (nebo naopak).
 */
export function prepareDigitsCanvas(
  source: HTMLCanvasElement,
  region?: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement {
  const area = region ?? { x: 0, y: 0, width: source.width, height: source.height };
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.round(area.width));
  target.height = Math.max(1, Math.round(area.height));
  const ctx = target.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(
    source,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    target.width,
    target.height,
  );

  const image = ctx.getImageData(0, 0, target.width, target.height);
  const data = image.data;
  // Zjistit, jestli je podklad převážně tmavý (inverzní tisk) a srovnat to.
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }
  const avg = sum / (data.length / 4);
  const invert = avg < 128;
  for (let i = 0; i < data.length; i += 4) {
    let gray = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    if (invert) gray = 255 - gray;
    // Práh: text černý, podklad bílý – OCR to čte nejlépe.
    const value = gray > 140 ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return target;
}

export interface OcrResult {
  /** Nalezené ISBN-13, pokud v přepisu bylo platné. */
  isbn13: string | null;
  /** Surový přepis – ukáže se uživateli, když se nic nenašlo. */
  text: string;
}

/**
 * Přečte číslice z obrázku a zkusí z nich vytáhnout ISBN.
 * Povolené znaky omezíme na číslice a X – výrazně to snižuje chyby.
 */
export async function readIsbnFromCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const worker = await loadOcr(onProgress);
  const prepared = prepareDigitsCanvas(canvas);
  const { data } = await worker.recognize(prepared, {
    tessedit_char_whitelist: '0123456789X ',
    preserve_interword_spaces: '1',
  } as Record<string, unknown>);
  const text = (data.text ?? '').replace(/\s+/g, ' ').trim();
  return { isbn13: extractIsbn(text), text };
}

/** Uvolní OCR engine (např. při odchodu z obrazovky déle než x minut). */
export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    /* ignorujeme */
  }
  workerPromise = null;
}
