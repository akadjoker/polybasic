// The BMP and PNG decoder, on files made here with every colour type, bit
// depth and row filter, whose pixels are known. (Real files from Blitz3D and
// Kenney were also checked against Chromium's decoder, pixel for pixel.)

import { deflateSync } from 'node:zlib';
import { decodeImage } from '../../src/engine/image/decode.js';
import { crc32 } from '../../web/zip.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

function chunk(type, data)
{
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// Applies PNG filter `f` to one row (the inverse of what the decoder does).
function filterRow(f, row, prev, step)
{
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++)
  {
    const a = i >= step ? row[i - step] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= step ? prev[i - step] : 0;
    let pred = 0;
    if (f === 1) pred = a;
    if (f === 2) pred = b;
    if (f === 3) pred = (a + b) >> 1;
    if (f === 4)
    {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i] = (row[i] - pred) & 255;
  }
  return out;
}

// A PNG of `rows` (raw bytes per row), each row with filter (y % 5).
function png(width, height, depth, type, rows, extra = [])
{
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([depth, type, 0, 0, 0], 8);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const step = Math.max(1, (channels * depth) >> 3);
  const parts = [];
  rows.forEach((row, y) =>
  {
    const f = y % 5;
    parts.push(Uint8Array.of(f), filterRow(f, row, y ? rows[y - 1] : null, step));
  });
  const raw = Buffer.concat(parts.map((p) => Buffer.from(p)));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const W = 7;
const H = 10;
const value = (x, y, c) => (x * 37 + y * 53 + c * 91 + x * y * 7) & 255;

test('PNG: RGB, RGBA, grey and grey with alpha at 8 bits, every row filter', async () =>
{
  for (const [type, channels] of [[2, 3], [6, 4], [0, 1], [4, 2]])
  {
    const rows = [];
    for (let y = 0; y < H; y++)
    {
      const row = new Uint8Array(W * channels);
      for (let x = 0; x < W; x++) for (let c = 0; c < channels; c++) row[x * channels + c] = value(x, y, c);
      rows.push(row);
    }
    const img = await decodeImage(png(W, H, 8, type, rows));
    for (let y = 0; y < H; y++)
    {
      for (let x = 0; x < W; x++)
      {
        const o = (y * W + x) * 4;
        const got = [...img.data.slice(o, o + 4)];
        const v = (c) => value(x, y, c);
        const want = type === 2 ? [v(0), v(1), v(2), 255] : type === 6 ? [v(0), v(1), v(2), v(3)] : type === 0 ? [v(0), v(0), v(0), 255] : [v(0), v(0), v(0), v(1)];
        assert(got.join() === want.join(), `type ${type} at ${x},${y}: ${got} not ${want}`);
      }
    }
  }
});

test('PNG: 16-bit samples read as their high byte; 1, 2 and 4-bit grey scaled to 0..255', async () =>
{
  const rows16 = [];
  for (let y = 0; y < H; y++)
  {
    const row = new Uint8Array(W * 2);
    for (let x = 0; x < W; x++)
    {
      row[x * 2] = value(x, y, 0);
      row[x * 2 + 1] = 99;
    }
    rows16.push(row);
  }
  const img16 = await decodeImage(png(W, H, 16, 0, rows16));
  for (let i = 0; i < W * H; i++) assert(img16.data[i * 4] === value(i % W, Math.floor(i / W), 0), `16-bit pixel ${i}`);

  for (const depth of [1, 2, 4])
  {
    const max = (1 << depth) - 1;
    const rows = [];
    for (let y = 0; y < H; y++)
    {
      const row = new Uint8Array(Math.ceil(W * depth / 8));
      for (let x = 0; x < W; x++)
      {
        const s = (x + y) & max;
        row[Math.floor(x * depth / 8)] |= s << (8 - depth - (x * depth) % 8);
      }
      rows.push(row);
    }
    const img = await decodeImage(png(W, H, depth, 0, rows));
    for (let y = 0; y < H; y++)
    {
      for (let x = 0; x < W; x++)
      {
        const want = Math.round(((x + y) & max) * 255 / max);
        assert(img.data[(y * W + x) * 4] === want, `${depth}-bit at ${x},${y}: ${img.data[(y * W + x) * 4]} not ${want}`);
      }
    }
  }
});

test('PNG: a palette with transparency', async () =>
{
  const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
  const trns = Buffer.from([255, 128]);
  const rows = [];
  for (let y = 0; y < H; y++) rows.push(Uint8Array.from({ length: W }, (_, x) => (x + y) % 4));
  const img = await decodeImage(png(W, H, 8, 3, rows, [chunk('PLTE', plte), chunk('tRNS', trns)]));
  for (let y = 0; y < H; y++)
  {
    for (let x = 0; x < W; x++)
    {
      const i = (x + y) % 4;
      const o = (y * W + x) * 4;
      const want = [plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], i < 2 ? trns[i] : 255];
      assert([...img.data.slice(o, o + 4)].join() === want.join(), `palette at ${x},${y}`);
    }
  }
});

// A BMP of `bits` per pixel, rows bottom-up (or top-down when `topDown`).
function bmp(width, height, bits, pixel, palette = null, topDown = false)
{
  const stride = ((width * bits + 31) >> 5) << 2;
  const paletteSize = palette ? palette.length / 3 * 4 : 0;
  const offset = 14 + 40 + paletteSize;
  const out = Buffer.alloc(offset + stride * height);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(offset, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(topDown ? -height : height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(bits, 28);
  out.writeUInt32LE(0, 30);
  out.writeUInt32LE(palette ? palette.length / 3 : 0, 46);
  if (palette)
  {
    for (let i = 0; i < palette.length / 3; i++)
    {
      out[54 + i * 4] = palette[i * 3 + 2];
      out[55 + i * 4] = palette[i * 3 + 1];
      out[56 + i * 4] = palette[i * 3];
    }
  }
  for (let y = 0; y < height; y++)
  {
    const row = offset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) pixel(out, row, x, y);
  }
  return out;
}

test('BMP: 24 and 32 bits, bottom-up and top-down; 8 and 4-bit palettes', async () =>
{
  for (const topDown of [false, true])
  {
    const img = await decodeImage(bmp(W, H, 24, (out, row, x, y) =>
    {
      out[row + x * 3] = value(x, y, 2);
      out[row + x * 3 + 1] = value(x, y, 1);
      out[row + x * 3 + 2] = value(x, y, 0);
    }, null, topDown));
    for (let y = 0; y < H; y++)
    {
      for (let x = 0; x < W; x++)
      {
        const o = (y * W + x) * 4;
        assert([...img.data.slice(o, o + 3)].join() === [value(x, y, 0), value(x, y, 1), value(x, y, 2)].join(), `24-bit ${topDown ? 'top-down' : 'bottom-up'} at ${x},${y}`);
      }
    }
  }
  const img32 = await decodeImage(bmp(W, H, 32, (out, row, x, y) =>
  {
    out[row + x * 4] = 1;
    out[row + x * 4 + 1] = 2;
    out[row + x * 4 + 2] = value(x, y, 0);
    out[row + x * 4 + 3] = 77;
  }));
  assert([...img32.data.slice(4 * 8, 4 * 8 + 4)].join() === [value(1, 1, 0), 2, 1, 77].join(), '32-bit');

  const palette = [];
  for (let i = 0; i < 16; i++) palette.push(i * 16, 255 - i * 16, i * 3);
  for (const bits of [8, 4])
  {
    const img = await decodeImage(bmp(W, H, bits, (out, row, x, y) =>
    {
      const i = (x * 3 + y) % 16;
      if (bits === 8) out[row + x] = i;
      else out[row + (x >> 1)] |= x % 2 ? i : i << 4;
    }, palette));
    for (let y = 0; y < H; y++)
    {
      for (let x = 0; x < W; x++)
      {
        const i = (x * 3 + y) % 16;
        const o = (y * W + x) * 4;
        assert([...img.data.slice(o, o + 3)].join() === palette.slice(i * 3, i * 3 + 3).join(), `${bits}-bit palette at ${x},${y}`);
      }
    }
  }
});

test('images that cannot be read say why', async () =>
{
  const cases = [
    [Buffer.from('GIF89a'), /only BMP and PNG/],
    [(() => { const b = bmp(2, 2, 24, () => {}); b.writeUInt32LE(1, 30); return b; })(), /compressed BMP/],
    [(() => { const p = png(2, 2, 8, 0, [Uint8Array.of(0, 0), Uint8Array.of(0, 0)]); p[8 + 8 + 12] = 1; return p; })(), /interlaced/]
  ];
  for (const [bytes, message] of cases)
  {
    let error = null;
    try
    {
      await decodeImage(bytes);
    }
    catch (e)
    {
      error = e;
    }
    assert(error && message.test(error.message), `${message}: ${error && error.message}`);
  }
});

export default unit;
