/**
 * Vygeneruje PNG ikony pro PWA (192, 512 a maskable 512) bez závislosti
 * na grafickém editoru – kreslí se přímo do pixelů a zapisuje jako PNG
 * přes zlib. Spuštění: node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');

const BG_TOP = [22, 28, 38];
const BG_BOTTOM = [12, 15, 21];
const GREEN = [53, 208, 127];
const WHITE = [231, 236, 243];

/** EAN-13 připomínající vzor: střídavě pruh/mezera, výšky 0 = běžný, 1 = guard. */
const PATTERN = [
  [2, 1],
  [1, 1],
  [2, 1],
  [3, 0],
  [1, 0],
  [2, 0],
  [2, 0],
  [1, 1],
  [3, 1],
  [2, 0],
  [1, 0],
  [3, 0],
  [1, 1],
  [2, 1],
  [2, 0],
  [1, 0],
  [2, 0],
  [1, 1],
  [3, 1],
];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtr 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Vzdálenost bodu od zaobleného obdélníku (pro antialiasing hran). */
function roundedRectCoverage(x, y, width, height, radius) {
  const cx = Math.min(Math.max(x, radius), width - radius);
  const cy = Math.min(Math.max(y, radius), height - radius);
  const dist = Math.hypot(x - cx, y - cy);
  return Math.min(1, Math.max(0, radius - dist + 0.5));
}

function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  // U maskable ikony necháváme obsah v bezpečné zóně (80 %).
  const contentScale = maskable ? 0.66 : 0.78;

  const put = (index, color, alpha) => {
    const a = Math.max(0, Math.min(1, alpha));
    if (a <= 0) return;
    rgba[index] = Math.round(rgba[index] * (1 - a) + color[0] * a);
    rgba[index + 1] = Math.round(rgba[index + 1] * (1 - a) + color[1] * a);
    rgba[index + 2] = Math.round(rgba[index + 2] * (1 - a) + color[2] * a);
    rgba[index + 3] = Math.round(rgba[index + 3] * (1 - a) + 255 * a);
  };

  // Pozadí (vertikální přechod) v zaobleném čtverci.
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const color = [
      Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
      Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
      Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
    ];
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const coverage = maskable ? 1 : roundedRectCoverage(x + 0.5, y + 0.5, size, size, radius);
      put(index, color, coverage);
    }
  }

  // Čárový kód: pruhy a mezery, střídavě, se „strážnými“ pruhy po stranách a uprostřed.
  const totalUnits = PATTERN.reduce((sum, item) => sum + item[0], 0) + PATTERN.length * 1;
  const contentWidth = size * contentScale;
  const unit = contentWidth / totalUnits;
  const barTall = size * (0.34 + 0.16) * contentScale;
  const barShort = size * 0.34 * contentScale;
  const centerY = size / 2;
  let cursor = size / 2 - contentWidth / 2;

  PATTERN.forEach(([widthUnits, isGuard], index) => {
    const barWidth = widthUnits * unit;
    const isBar = index % 2 === 0;
    if (isBar) {
      const height = isGuard ? barTall : barShort;
      const top = centerY - height / 2;
      const bottom = centerY + height / 2;
      const color = isGuard ? WHITE : GREEN;
      for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
        for (let x = Math.floor(cursor); x < Math.ceil(cursor + barWidth); x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const index = (y * size + x) * 4;
          put(index, color, 1);
        }
      }
    }
    cursor += barWidth + unit;
  });

  return encodePng(size, size, rgba);
}

mkdirSync(outDir, { recursive: true });
const files = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];

for (const [name, size, options] of files) {
  const png = drawIcon(size, options);
  writeFileSync(join(outDir, name), png);
  console.log(`public/icons/${name} – ${size}×${size}, ${png.length} B`);
}
