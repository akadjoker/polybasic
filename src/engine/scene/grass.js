// Grass: a field of tufts, each three crossed cards of blades, drawn all at
// once (instanced) and moved by the wind and by things that push through
// it, in the renderer's vertex shader. The engine keeps where the tufts are
// (in the grass entity's own space) and what pushes them; nothing is
// simulated per tuft, so a field of fifty thousand costs the program
// nothing but its memory.
//
// Adapted from Radion's grass (Grass.cpp and its shaders), which culls and
// simulates the blades in compute shaders; WebGL has none, so here the
// bending is worked out afresh every frame from the wind and the pushers.

import { MeshData } from './mesh.js';

// Tuft data per tuft: x, y, z (local), size, turn (radians).
export const TUFT_FLOATS = 5;
export const MAX_PUSHERS = 8;

// One tuft: three cards through its middle, 1 unit wide and high, standing
// on y = 0, blades at the top of the texture. Their normals point up, so
// the grass is lit as the ground under it is.
export function createTuft()
{
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let k = 0; k < 3; k++)
  {
    const a = k * Math.PI / 3;
    const dx = Math.cos(a) * 0.5;
    const dz = Math.sin(a) * 0.5;
    const base = positions.length / 3;
    positions.push(-dx, 1, -dz, dx, 1, dz, dx, 0, dz, -dx, 0, -dz);
    for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return new MeshData(positions, normals, uvs, indices);
}

// A small seeded generator (mulberry32).
function random(seed)
{
  let a = seed >>> 0 || 0x9e3779b9;
  return () =>
  {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Grass
{
  constructor(seed)
  {
    this.tufts = new Float32Array(TUFT_FLOATS * 64);
    this.count = 0;
    this.version = 0;
    this.height = 0.6;
    this.width = 0.6;
    this.wind = 1;
    this.pushers = [];          // { entity, radius }
    this.random = random(seed);
  }

  plant(x, y, z, size)
  {
    if ((this.count + 1) * TUFT_FLOATS > this.tufts.length)
    {
      const grown = new Float32Array(this.tufts.length * 2);
      grown.set(this.tufts);
      this.tufts = grown;
    }
    const o = this.count * TUFT_FLOATS;
    this.tufts[o] = x;
    this.tufts[o + 1] = y;
    this.tufts[o + 2] = z;
    // Tufts differ a little in size, and face every way.
    this.tufts[o + 3] = size * (0.75 + 0.5 * this.random());
    this.tufts[o + 4] = this.random() * Math.PI * 2;
    this.count++;
    this.version++;
  }

  // Up to `count` tufts spread evenly over a disc around (x, z). `ground(x,
  // z)` gives the height and the surface's facing there ({ y, ny }), or null
  // where there is no ground; steep ground (facing less than half up) gets
  // none. Returns how many were planted.
  paint(x, z, radius, count, size, ground)
  {
    let planted = 0;
    for (let i = 0; i < count; i++)
    {
      // Evenly over the disc: the square root keeps the middle from crowding.
      const r = radius * Math.sqrt(this.random());
      const a = this.random() * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const at = ground(px, pz);
      if (!at || at.ny < 0.5) continue;
      this.plant(px, at.y, pz, size);
      planted++;
    }
    return planted;
  }

  clear()
  {
    this.count = 0;
    this.version++;
  }
}

// Blades for the tufts' cards: tapering green strokes up from the bottom,
// darker at the root, on nothing (for TEX_MASKED).
export function bladePixels(size = 64)
{
  const px = new Uint8ClampedArray(size * size * 4);
  const next = random(7);
  for (let k = 0; k < 14; k++)
  {
    const root = 0.08 + 0.84 * next();
    const lean = (next() - 0.5) * 0.5;
    const tall = 0.55 + 0.45 * next();
    const width = 0.035 + 0.03 * next();
    const shade = 0.8 + 0.35 * next();
    for (let y = 0; y < size; y++)
    {
      const h = 1 - y / size;                       // 0 at the bottom row
      if (h > tall) continue;
      const along = h / tall;
      const cx = root + lean * along * along;
      const half = width * (1 - along) * size;
      const light = shade * (0.55 + 0.45 * along);
      for (let x = Math.floor((cx * size) - half); x <= Math.ceil((cx * size) + half); x++)
      {
        if (x < 0 || x >= size || Math.abs(x - cx * size) > half) continue;
        const i = (y * size + x) * 4;
        px[i] = 70 * light;
        px[i + 1] = 140 * light;
        px[i + 2] = 50 * light;
        px[i + 3] = 255;
      }
    }
  }
  return px;
}
