// The pictures trees wear, drawn by code (no image files): bark, and a
// sprig of leaves on nothing, for the leaf cards (TEX_MASKED). The same
// numbers always draw the same pictures.

// A hash of two integers to 0..1.
function hash(x, y, seed)
{
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise, wrapping every `period` cells so the bark tiles.
function noise(x, y, period, seed)
{
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i) => ((i % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Bark: brown, in long vertical fibres with darker cracks. Tiles both ways.
export function barkPixels(width = 64, height = 128)
{
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
  {
    for (let x = 0; x < width; x++)
    {
      // Stretched along the trunk: fibres, then finer grain on top.
      const u = x / width;
      const v = y / height;
      let n = 0;
      let amp = 0.5;
      for (let o = 0; o < 4; o++)
      {
        const f = 1 << o;
        n += amp * noise(u * 8 * f, v * 2 * f, 8 * f, 11 + o);
        amp /= 2;
      }
      const crack = noise(u * 12, v * 3, 12, 5);
      let shade = 0.55 + 0.6 * n;
      if (crack < 0.28) shade *= 0.45 + crack;
      const i = (y * width + x) * 4;
      px[i] = 92 * shade;
      px[i + 1] = 68 * shade;
      px[i + 2] = 48 * shade;
      px[i + 3] = 255;
    }
  }
  return px;
}

// Leaf styles: 0 broad, 1 long and thin, 2 small and round.
const LEAF_STYLES = [
  { count: 9, length: 0.26, width: 0.11, spread: 0.55, colour: [70, 128, 48] },
  { count: 14, length: 0.3, width: 0.045, spread: 0.3, colour: [96, 140, 60] },
  { count: 18, length: 0.1, width: 0.08, spread: 0.8, colour: [58, 118, 52] }
];

// A sprig: a stem from the bottom middle up, leaves along it, nothing
// around them (alpha 0).
export function leafPixels(style = 0, size = 128)
{
  const s = LEAF_STYLES[style] || LEAF_STYLES[0];
  const px = new Uint8ClampedArray(size * size * 4);
  const put = (x, y, r, g, b) =>
  {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  // Leaves first, the stem over them.
  for (let k = 0; k < s.count; k++)
  {
    const along = 0.12 + 0.8 * (k + 0.5) / s.count;           // up the stem
    const side = k % 2 === 0 ? 1 : -1;
    const lean = side * s.spread * (0.6 + 0.4 * hash(k, 1, style)) * (1 - along * 0.5);
    const cx = 0.5 + Math.sin(lean) * s.length * 0.55;
    const cy = 1 - along - Math.cos(lean) * s.length * 0.35;
    const len = s.length * (0.75 + 0.5 * hash(k, 2, style));
    const wid = s.width * (0.8 + 0.4 * hash(k, 3, style));
    const tint = 0.8 + 0.35 * hash(k, 4, style);
    const angle = lean;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const r = Math.ceil(Math.max(len, wid) * size);
    const x0 = Math.round(cx * size);
    const y0 = Math.round(cy * size);
    for (let y = y0 - r; y <= y0 + r; y++)
    {
      for (let x = x0 - r; x <= x0 + r; x++)
      {
        // Into the leaf's own frame: along its length (a) and across (b).
        const dx = x / size - cx;
        const dy = y / size - cy;
        const a = (dx * sa - dy * ca) / (len / 2);
        const b = (dx * ca + dy * sa) / (wid / 2);
        // A leaf: pointed at both ends, widest a little below the middle.
        const edge = Math.pow(1 - Math.min(1, Math.abs(a)), 0.8) * (1 - 0.25 * a);
        if (Math.abs(b) > edge || Math.abs(a) > 1) continue;
        // Lighter along the middle vein, darker to the edges.
        const light = tint * (Math.abs(b) < 0.08 ? 1.25 : 1 - 0.3 * Math.abs(b) / Math.max(edge, 1e-3));
        put(x, y, s.colour[0] * light, s.colour[1] * light, s.colour[2] * light);
      }
    }
  }
  const stem = [78, 60, 40];
  for (let y = Math.round(size * 0.1); y < size; y++)
  {
    const x = Math.round(size * (0.5 + 0.02 * Math.sin(y / size * 6)));
    put(x, y, ...stem);
    put(x + 1, y, ...stem);
  }
  return px;
}
