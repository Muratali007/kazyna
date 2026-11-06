// Генерирует PNG-иконки «Казыны» (кольцо бюджета на фиолетовом градиенте) без внешних зависимостей.
// Запуск: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BG1 = [124, 58, 237]; // #7c3aed
const BG2 = [6, 182, 212]; // #06b6d4
const WHITE = [255, 255, 255];
const GOLD = [250, 204, 21];

// Фигуры в координатах 0..1; содержимое — в центральных 60% (безопасная зона maskable-иконки)
function color(x, y) {
  const bg = mix(BG1, BG2, Math.min(1, Math.max(0, (x + y) / 2)));
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = Math.hypot(dx, dy);
  if (r >= 0.2 && r <= 0.29) {
    const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI); // 0 — сверху, по часовой
    return a < Math.PI * 1.35 ? GOLD : mix(WHITE, bg, 0.35);
  }
  // знак ₸ в центре: верхняя черта, вторая черта, ножка
  if (Math.abs(dx) <= 0.1 && y >= 0.395 && y <= 0.425) return WHITE;
  if (Math.abs(dx) <= 0.1 && y >= 0.455 && y <= 0.485) return WHITE;
  if (Math.abs(dx) <= 0.017 && y >= 0.455 && y <= 0.62) return WHITE;
  return bg;
}

function render(size) {
  const SS = 4;
  const row = size * 4 + 1;
  const raw = Buffer.alloc(size * row);
  for (let py = 0; py < size; py++) {
    raw[py * row] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = color((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = py * row + 1 + px * 4;
      const n = SS * SS;
      raw[o] = Math.round(r / n);
      raw[o + 1] = Math.round(g / n);
      raw[o + 2] = Math.round(b / n);
      raw[o + 3] = 255;
    }
  }
  return png(size, size, raw);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  fs.writeFileSync(path.join(out, name), render(size));
  console.log('icons/' + name);
}
