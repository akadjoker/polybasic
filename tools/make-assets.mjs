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

// A flag waving, as an MD2 file: a grid of vertices with a wave running
// along it, one frame per twentieth of a wave. Written in the file's axes,
// which are PolyBasic's (z, x, y), with each triangle's last two corners
// swapped (see src/engine/model/md2.js), so that it reads back clockwise
// seen from -z. Normals are the nearest of the MD2 table's.
const { MD2_NORMALS } = await import('../src/engine/model/md2-normals.js');

function md2(skin, uvs, tris, frames)
{
  const nv = frames[0].length;
  const frameSize = 40 + nv * 4;
  const uvAt = 68;
  const triAt = uvAt + uvs.length * 4;
  const frameAt = triAt + tris.length * 12;
  const end = frameAt + frames.length * frameSize;
  const out = Buffer.alloc(end);
  [0x32504449, 8, skin[0], skin[1], frameSize, 0, nv, uvs.length, tris.length, 0, frames.length, 68, uvAt, triAt, frameAt, end, end]
    .forEach((x, i) => out.writeInt32LE(x, i * 4));
  uvs.forEach(([s, t], i) =>
  {
    out.writeInt16LE(s, uvAt + i * 4);
    out.writeInt16LE(t, uvAt + i * 4 + 2);
  });
  tris.forEach(([a, b, c], i) => [a, c, b, a, c, b].forEach((v, j) => out.writeUInt16LE(v, triAt + i * 12 + j * 2)));
  frames.forEach((verts, f) =>
  {
    const at = frameAt + f * frameSize;
    // PolyBasic (x, y, z) is the file's (y, z, x).
    const file = verts.map(({ p }) => [p[2], p[0], p[1]]);
    const lo = [0, 1, 2].map((i) => Math.min(...file.map((q) => q[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...file.map((q) => q[i])));
    const scale = lo.map((l, i) => Math.max(hi[i] - l, 1e-6) / 255);
    [...scale, ...lo].forEach((x, j) => out.writeFloatLE(x, at + j * 4));
    out.write(`wave${String(f).padStart(3, '0')}`, at + 24, 'latin1');
    verts.forEach(({ n }, k) =>
    {
      const q = file[k].map((x, i) => Math.round((x - lo[i]) / scale[i]));
      let best = 0;
      let bestDot = -2;
      for (let t = 0; t < 162; t++)
      {
        // The table is in the file's axes too.
        const d = MD2_NORMALS[t * 3] * n[2] + MD2_NORMALS[t * 3 + 1] * n[0] + MD2_NORMALS[t * 3 + 2] * n[1];
        if (d > bestDot)
        {
          bestDot = d;
          best = t;
        }
      }
      out.set([q[0], q[1], q[2], best], at + 40 + k * 4);
    });
  });
  return out;
}

{
  const COLS = 12;
  const ROWS = 7;
  const WIDTH = 3;
  const HEIGHT = 2;
  const FRAMES = 20;
  const SKIN = [128, 64];
  const uvs = [];
  const tris = [];
  for (let r = 0; r <= ROWS; r++)
  {
    for (let c = 0; c <= COLS; c++) uvs.push([Math.round(c / COLS * SKIN[0]), Math.round((1 - r / ROWS) * SKIN[1])]);
  }
  const at = (c, r) => r * (COLS + 1) + c;
  for (let r = 0; r < ROWS; r++)
  {
    for (let c = 0; c < COLS; c++)
    {
      // Clockwise seen from -z: up, then across.
      tris.push([at(c, r), at(c, r + 1), at(c + 1, r + 1)], [at(c, r), at(c + 1, r + 1), at(c + 1, r)]);
    }
  }
  const frames = [];
  // FRAMES + 1 frames, the last the same as the first: a loop from the
  // first to the last treats the last as the first (as Blitz3D does), so
  // the wave runs round without a jump.
  for (let f = 0; f <= FRAMES; f++)
  {
    const phase = f / FRAMES * Math.PI * 2;
    const verts = [];
    for (let r = 0; r <= ROWS; r++)
    {
      for (let c = 0; c <= COLS; c++)
      {
        const x = c / COLS * WIDTH;
        const y = r / ROWS * HEIGHT;
        // The wave grows away from the pole, and the loose end droops.
        const reach = x / WIDTH;
        const angle = phase - x * 2.2 + y * 0.4;
        const z = Math.sin(angle) * 0.35 * reach;
        // The normal facing -z: minus the cross product of the tangents
        // along x, (1, dy/dx, dz/dx), and along y, (0, 1, dz/dy).
        const dzdx = 0.35 * (Math.cos(angle) * -2.2 * reach + Math.sin(angle) / WIDTH);
        const dzdy = 0.35 * reach * Math.cos(angle) * 0.4;
        const dydx = -0.3 * x / (WIDTH * WIDTH);
        const n = [dzdx - dydx * dzdy, dzdy, -1];
        const len = Math.hypot(...n);
        verts.push({ p: [x, y - reach * reach * 0.15, z], n: n.map((v) => v / len) });
      }
    }
    frames.push(verts);
  }
  writeFileSync(new URL('../examples/assets/flag.md2', import.meta.url), md2(SKIN, uvs, tris, frames));
  console.log('wrote examples/assets/flag.md2');
}

// The flag's cloth: three bands with a white chevron at the pole.
writeFileSync(new URL('../examples/assets/flag.png', import.meta.url), png(128, 64, (x, y) =>
{
  const band = y < 21 ? [20, 150, 140] : y < 43 ? [245, 240, 225] : [110, 60, 190];
  const chevron = x < 40 - Math.abs(y - 32) * 1.2;
  const shade = ((x >> 3) + (y >> 3)) & 1 ? 0 : 0.05;
  return mix(chevron ? [240, 190, 40] : band, [0, 0, 0], shade);
}));
console.log('wrote examples/assets/flag.png');
