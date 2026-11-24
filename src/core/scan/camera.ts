/**
 * Přístup ke kameře.
 *
 * getUserMedia funguje jen v secure contextu (HTTPS nebo localhost) – na
 * GitHub Pages je to splněno, při otevření přes http:// v LAN ne.
 * Chyby překládáme na srozumitelné hlášky, protože „NotAllowedError“
 * knihovníkovi nic neřekne.
 */

export type CameraErrorCode = 'insecure' | 'denied' | 'notfound' | 'busy' | 'abort' | 'unknown';

export class CameraError extends Error {
  readonly code: CameraErrorCode;
  constructor(code: CameraErrorCode, message: string) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

export interface CameraHandle {
  stream: MediaStream;
  /** Vypne kameru a uvolní stopu. */
  stop(): void;
  torchSupported: boolean;
  setTorch(on: boolean): Promise<boolean>;
  zoom: ZoomRange | null;
  setZoom(value: number): Promise<void>;
  /** Název zařízení (pro rozlišení zadní/přední kamery). */
  label: string;
}

export interface StartCameraOptions {
  deviceId?: string;
  /** Ideální rozlišení – vysoké pomáhá u drobných čárových kódů. */
  width?: number;
  height?: number;
}

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
}

/** Ověří, že prohlížeč kameru vůbec dovolí. */
export function assertCameraUsable(): void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'unknown',
      'Tento prohlížeč neumí pracovat s kamerou. Zadejte ISBN ručně.',
    );
  }
  const secure = globalThis.isSecureContext ?? location.protocol === 'https:';
  if (!secure) {
    throw new CameraError(
      'insecure',
      'Kamera jde zapnout jen přes HTTPS (nebo na localhostu). Otevřete aplikaci přes https.',
    );
  }
}

function translateError(err: unknown): CameraError {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CameraError(
      'denied',
      'Přístup ke kameře je zakázán. Povolte ho v nastavení prohlížeče, nebo zadejte ISBN ručně.',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new CameraError('notfound', 'Žádná kamera nebyla nalezena.');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new CameraError('busy', 'Kameru právě používá jiná aplikace.');
  }
  if (name === 'AbortError') {
    return new CameraError('abort', 'Spuštění kamery bylo přerušeno.');
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new CameraError('unknown', 'Kameru nelze spustit: ' + msg);
}

/** Zapne kameru a napojí ji na <video>. */
export async function startCamera(
  video: HTMLVideoElement,
  options: StartCameraOptions = {},
): Promise<CameraHandle> {
  assertCameraUsable();

  const constraints: MediaStreamConstraints = {
    audio: false,
    video: options.deviceId
      ? {
          deviceId: { exact: options.deviceId },
          width: { ideal: options.width ?? 1920 },
          height: { ideal: options.height ?? 1080 },
        }
      : {
          facingMode: { ideal: 'environment' },
          width: { ideal: options.width ?? 1920 },
          height: { ideal: options.height ?? 1080 },
        },
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    throw translateError(err);
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  try {
    await video.play();
  } catch {
    /* iOS někdy odmítne play() bez gesta – obrázek pak dorazí po prvním dotyku */
  }

  const track = stream.getVideoTracks()[0];
  const capabilities = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
  const zoom = capabilities.zoom
    ? { min: capabilities.zoom.min, max: capabilities.zoom.max, step: capabilities.zoom.step || 0.1 }
    : null;

  const applyConstraint = async (advanced: Record<string, unknown>): Promise<boolean> => {
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [advanced] } as MediaTrackConstraints);
      return true;
    } catch {
      return false;
    }
  };

  return {
    stream,
    label: track?.label ?? '',
    torchSupported: capabilities.torch === true,
    async setTorch(on: boolean): Promise<boolean> {
      return applyConstraint({ torch: on });
    },
    zoom,
    async setZoom(value: number): Promise<void> {
      await applyConstraint({ zoom: value });
    },
    stop(): void {
      for (const t of stream.getTracks()) t.stop();
      if (video.srcObject === stream) video.srcObject = null;
    },
  };
}

/** Seznam kamer – volá se až po udělení oprávnění, jinak jsou popisky prázdné. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

/** Otestuje, jestli prohlížeč umí nativní BarcodeDetector (rychlé na Androidu). */
export function hasNativeBarcodeDetector(): boolean {
  return typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector === 'function';
}
