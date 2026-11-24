/**
 * Dekódování čárových kódů ze živého videa.
 *
 * Dvě cesty, protože prohlížeče se liší:
 *  1. Nativní BarcodeDetector – Chrome/Android, rychlý a bez knihovny.
 *  2. ZXing (@zxing/library) – fallback pro iOS, Firefox a desktopy.
 *
 * Inverzní kódy (bílé na černém): snímky se střídavě kreslí normálně
 * a převrácené, takže se kód najde i bez zásahu uživatele. U ZXingu to
 * obstará `HTMLCanvasElementLuminanceSource(canvas, true)`.
 */

export type DetectEngine = 'native' | 'zxing';

export interface DetectedCode {
  text: string;
  format: string;
  engine: DetectEngine;
  /** Byl snímek při úspěchu převrácený? */
  inverted: boolean;
}

export interface ScanEngineOptions {
  /** Zkoušet i inverzní barvy. */
  inverted?: boolean;
  /** Prodleva mezi snímky v ms (nižší = plynulejší, víc CPU). */
  intervalMs?: number;
  /** Delší strana snímaného obrázku – víc pixelů = menší kódy. */
  maxDimension?: number;
  onDetect: (code: DetectedCode) => void;
  /** Stav pro diagnostiku v UI. */
  onStatus?: (status: { engine: DetectEngine; frames: number; inverted: boolean }) => void;
}

/** Formáty, které mají smysl u knih: EAN-13 (ISBN), EAN-8, UPC, ITF, Code 128. */
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128', 'code_39'];
const NATIVE_FORMAT_NAMES: Record<string, string> = {
  ean_13: 'EAN_13',
  ean_8: 'EAN_8',
  upc_a: 'UPC_A',
  upc_e: 'UPC_E',
  itf: 'ITF',
  code_128: 'CODE_128',
  code_39: 'CODE_39',
};

interface NativeBarcode {
  rawValue: string;
  format: string;
}
interface NativeDetector {
  detect(source: CanvasImageSource): Promise<NativeBarcode[]>;
}
type NativeDetectorCtor = new (options?: { formats?: string[] }) => NativeDetector;

interface ZxingResult {
  getText(): string;
  getBarcodeFormat(): number;
}
interface ZxingReader {
  decode(bitmap: unknown, hints?: Map<number, unknown>): ZxingResult;
}

interface ZxingModule {
  MultiFormatReader: new () => ZxingReader;
  BinaryBitmap: new (binarizer: unknown) => unknown;
  HybridBinarizer: new (source: unknown) => unknown;
  HTMLCanvasElementLuminanceSource: new (
    canvas: HTMLCanvasElement,
    doAutoInvert?: boolean,
  ) => { invert(): unknown };
  DecodeHintType: { POSSIBLE_FORMATS: number; TRY_HARDER: number; CHARACTER_SET: number };
  BarcodeFormat: { EAN_13: number; EAN_8: number; UPC_A: number; UPC_E: number; ITF: number; CODE_128: number; CODE_39: number };
  NotFoundException: new (...args: unknown[]) => Error;
}

let zxingPromise: Promise<ZxingModule> | null = null;

/** ZXing se načítá až při prvním použití – na Androidu se vůbec nenačte. */
export async function loadZxing(): Promise<ZxingModule> {
  if (!zxingPromise) {
    zxingPromise = import('@zxing/library').then((mod) => mod as unknown as ZxingModule);
  }
  return zxingPromise;
}

export class ScanEngine {
  private video: HTMLVideoElement;
  private options: ScanEngineOptions;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nativeDetector: NativeDetector | null = null;
  private nativeFailed = 0;
  private running = false;
  private busy = false;
  private frames = 0;
  private timer: number | null = null;
  private invertedSupport: boolean | null = null;

  constructor(video: HTMLVideoElement, options: ScanEngineOptions) {
    this.video = video;
    this.options = options;
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Prohlížeč nepodporuje 2D canvas.');
    this.ctx = ctx;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.frames = 0;
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Volá se při změně nastavení za běhu (např. vypnutí inverze). */
  update(options: Partial<ScanEngineOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    if (!this.busy) {
      this.busy = true;
      try {
        await this.processFrame();
      } catch {
        /* jeden špatný snímek nemá shodit celé skenování */
      } finally {
        this.busy = false;
      }
    }
    if (!this.running) return;
    const delay = this.options.intervalMs ?? 120;
    this.timer = setTimeout(() => void this.loop(), delay) as unknown as number;
  }

  /** Připraví canvas se snímkem z videa (volitelně převráceným). */
  private drawFrame(inverted: boolean): boolean {
    const video = this.video;
    if (video.readyState < 2 || !video.videoWidth) return false;

    const maxDimension = this.options.maxDimension ?? 960;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (inverted && this.canInvertWithFilter()) {
      ctx.filter = 'invert(1)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
      return true;
    }
    ctx.drawImage(video, 0, 0, width, height);
    if (inverted) this.invertPixels();
    return true;
  }

  private canInvertWithFilter(): boolean {
    if (this.invertedSupport === null) {
      this.invertedSupport = 'filter' in this.ctx;
    }
    return this.invertedSupport;
  }

  /** Ruční inverze pixelů pro prohlížeče bez ctx.filter. */
  private invertPixels(): void {
    const { width, height } = this.canvas;
    const image = this.ctx.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]!;
      data[i + 1] = 255 - data[i + 1]!;
      data[i + 2] = 255 - data[i + 2]!;
    }
    this.ctx.putImageData(image, 0, 0);
  }

  private async processFrame(): Promise<void> {
    const useInverted = this.options.inverted !== false && this.frames % 2 === 1;
    this.frames += 1;
    if (!this.drawFrame(useInverted)) return;

    const native = await this.tryNative(useInverted);
    if (native) {
      this.emit(native, useInverted);
      return;
    }
    const zx = await this.tryZxing(useInverted);
    if (zx) this.emit(zx, useInverted);
    else this.options.onStatus?.({ engine: 'zxing', frames: this.frames, inverted: useInverted });
  }

  private emit(code: DetectedCode, inverted: boolean): void {
    this.options.onDetect({ ...code, inverted });
    this.options.onStatus?.({ engine: code.engine, frames: this.frames, inverted });
  }

  private async tryNative(inverted: boolean): Promise<DetectedCode | null> {
    const ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (!ctor || this.nativeFailed >= 3) return null;

    if (!this.nativeDetector) {
      try {
        this.nativeDetector = new ctor({ formats: NATIVE_FORMATS });
      } catch {
        // Prohlížeč nezná některý formát – zkus bez seznamu.
        try {
          this.nativeDetector = new ctor();
        } catch {
          this.nativeFailed = 3;
          return null;
        }
      }
    }
    try {
      const codes = await this.nativeDetector.detect(this.canvas);
      this.nativeFailed = 0;
      const first = codes.find((c) => (c.rawValue ?? '').length >= 8);
      if (!first) return null;
      return {
        text: first.rawValue.trim(),
        format: NATIVE_FORMAT_NAMES[first.format] ?? String(first.format).toUpperCase(),
        engine: 'native',
        inverted,
      };
    } catch {
      this.nativeFailed += 1;
      return null;
    }
  }

  private async tryZxing(inverted: boolean): Promise<DetectedCode | null> {
    let zx: ZxingModule;
    try {
      zx = await loadZxing();
    } catch {
      return null;
    }
    const hints = new Map<number, unknown>();
    hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
      zx.BarcodeFormat.EAN_13,
      zx.BarcodeFormat.EAN_8,
      zx.BarcodeFormat.UPC_A,
      zx.BarcodeFormat.UPC_E,
      zx.BarcodeFormat.ITF,
      zx.BarcodeFormat.CODE_128,
      zx.BarcodeFormat.CODE_39,
    ]);
    hints.set(zx.DecodeHintType.TRY_HARDER, true);

    const reader = new zx.MultiFormatReader();
    // doAutoInvert = false → inverzi už jsme provedli při kreslení snímku,
    // takže ji ZXing nemusí zdvojovat.
    const source = new zx.HTMLCanvasElementLuminanceSource(this.canvas, false);
    const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(source));
    try {
      const result = reader.decode(bitmap, hints);
      return {
        text: result.getText().trim(),
        format: 'ZXING',
        engine: 'zxing',
        inverted,
      };
    } catch {
      // NotFoundException/ChecksumException = na snímku nic čitelného, zkusí se další
      return null;
    }
  }

}

/**
 * Jednorázové dekódování hotového obrázku (fotka z galerie, testy).
 * Zkusí nativní detektor, ZXing, a nakonec převrácený obraz.
 */
export async function decodeCanvas(source: HTMLCanvasElement): Promise<DetectedCode | null> {
  const ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  const tryNativeOn = async (canvas: HTMLCanvasElement): Promise<DetectedCode | null> => {
    if (!ctor) return null;
    try {
      const detector = new ctor({ formats: NATIVE_FORMATS });
      const codes = await detector.detect(canvas);
      const first = codes.find((c) => (c.rawValue ?? '').length >= 8);
      if (!first) return null;
      return {
        text: first.rawValue.trim(),
        format: NATIVE_FORMAT_NAMES[first.format] ?? String(first.format).toUpperCase(),
        engine: 'native',
        inverted: false,
      };
    } catch {
      return null;
    }
  };

  const tryZxingOn = async (canvas: HTMLCanvasElement): Promise<DetectedCode | null> => {
    let zx: ZxingModule;
    try {
      zx = await loadZxing();
    } catch {
      return null;
    }
    const hints = new Map<number, unknown>();
    hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
      zx.BarcodeFormat.EAN_13,
      zx.BarcodeFormat.EAN_8,
      zx.BarcodeFormat.UPC_A,
      zx.BarcodeFormat.UPC_E,
      zx.BarcodeFormat.ITF,
      zx.BarcodeFormat.CODE_128,
      zx.BarcodeFormat.CODE_39,
    ]);
    hints.set(zx.DecodeHintType.TRY_HARDER, true);
    const reader = new zx.MultiFormatReader();
    for (const autoInvert of [false, true]) {
      const luminance = new zx.HTMLCanvasElementLuminanceSource(canvas, autoInvert);
      const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(luminance));
      try {
        const result = reader.decode(bitmap, hints);
        return {
          text: result.getText().trim(),
          format: 'ZXING',
          engine: 'zxing',
          inverted: autoInvert,
        };
      } catch {
        if (!autoInvert) {
          try {
            const invertedBitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(luminance.invert()));
            const result = reader.decode(invertedBitmap, hints);
            return { text: result.getText().trim(), format: 'ZXING', engine: 'zxing', inverted: true };
          } catch {
            /* zkusí se ještě autoInvert */
          }
        }
      }
    }
    return null;
  };

  return (await tryNativeOn(source)) ?? (await tryZxingOn(source)) ?? null;
}
