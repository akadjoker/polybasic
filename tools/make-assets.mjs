// Draws the example textures and writes them as PNG files, so the images
// in examples/assets are reproducible from code.
//
//   node tools/make-assets.mjs

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(bytes)
{
  let c;
  let crc = 0xffffffff;
  for (const b of bytes)
  {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data)
{
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(width, height, pixel)
{
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
  {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++)
    {
      const [r, g, b] = pixel(x, y);
      const i = y * (width * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// A panel tile: a teal-to-violet gradient, a light frame with rounded
// corners, and a "P" made of blocks in the middle.
const LETTER = [
  '11110',
  '10001',
  '10001',
  '11110',
  '10000',
  '10000',
  '10000'
];
writeFileSync(new URL('../examples/assets/tile.png', import.meta.url), png(256, 256, (x, y) =>
{
  const base = mix([20, 150, 140], [110, 60, 190], (x + y) / 510);
  const edge = Math.min(x, y, 255 - x, 255 - y);
  if (edge < 10) return mix(base, [240, 240, 250], 0.85);
  if (edge < 14) return mix(base, [0, 0, 0], 0.35);
  const lx = Math.floor((x - 68) / 24);
  const ly = Math.floor((y - 44) / 24);
  if (lx >= 0 && lx < 5 && ly >= 0 && ly < 7 && LETTER[ly][lx] === '1')
  {
    const inX = (x - 68) % 24;
    const inY = (y - 44) % 24;
    if (inX > 1 && inY > 1 && inX < 23 && inY < 23) return mix([250, 245, 230], base, inY / 60);
  }
  // Faint diagonal stripes give the lighting something to show.
  return ((x + y) >> 4) & 1 ? base : mix(base, [255, 255, 255], 0.06);
}));
console.log('wrote examples/assets/tile.png');
