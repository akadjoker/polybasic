// The shapes rays and moving spheres meet, in world space.
//
// A model (the pivot LoadMesh returns) counts as one thing: its triangles
// are those of all its parts, and its box is the box around them.

import { Vec3 } from '../math/vec3.js';

// The entities whose triangles make up e: e itself when it has a mesh, the
// shown parts of a model, or none.
export function meshParts(e)
{
  if (e.mesh) return [e];
  if (!e.model || !e.model.loaded) return [];
  const parts = [];
  const walk = (n) =>
  {
    for (const c of n.children)
    {
      if (!c.visible) continue;
      if (c.mesh && c.mesh.positions.length) parts.push(c);
      walk(c);
    }
  };
  walk(e);
  return parts;
}

// The entity's box in its own space: EntityBox if set, else the bounds of
// its mesh (or of a model's parts), else the -1..1 cube the built-in
// shapes fill.
export function localBox(e)
{
  if (e.box)
  {
    const [x, y, z, w, h, d] = e.box;
    return { min: [x, y, z], max: [x + w, y + h, z + d] };
  }
  if (e.mesh && !e.mesh.bounds.isEmpty())
  {
    const b = e.mesh.bounds;
    return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
  }
  const parts = e.mesh ? [] : meshParts(e);
  const inv = e.worldMatrix.clone();
  if (parts.length && inv.invert())
  {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const p = new Vec3();
    for (const part of parts)
    {
      const b = part.mesh.bounds;
      for (let i = 0; i < 8; i++)
      {
        p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMat4(part.worldMatrix).applyMat4(inv);
        lo[0] = Math.min(lo[0], p.x);
        lo[1] = Math.min(lo[1], p.y);
        lo[2] = Math.min(lo[2], p.z);
        hi[0] = Math.max(hi[0], p.x);
        hi[1] = Math.max(hi[1], p.y);
        hi[2] = Math.max(hi[2], p.z);
      }
    }
    return { min: lo, max: hi };
  }
  return { min: [-1, -1, -1], max: [1, 1, 1] };
}

// The box as 12 world-space triangles (9 numbers each) facing outwards,
// also when the entity is mirrored by a negative scale.
export function boxTriangles(e, out = new Float64Array(108))
{
  const { min, max } = localBox(e);
  const m = e.worldMatrix;
  const corner = [];
  for (let i = 0; i < 8; i++)
  {
    corner.push(new Vec3(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).applyMat4(m));
  }
  const centre = new Vec3();
  for (const c of corner) centre.add(c);
  centre.scale(1 / 8);
  // Each face as four corner numbers going round it.
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  let o = 0;
  const put = (a, b, c) =>
  {
    // Outward: the cross product must point away from the centre.
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.dot(a.clone().sub(centre)) < 0)
    {
      const t = b;
      b = c;
      c = t;
    }
    for (const p of [a, b, c])
    {
      out[o++] = p.x;
      out[o++] = p.y;
      out[o++] = p.z;
    }
  };
  for (const [a, b, c, d] of faces)
  {
    put(corner[a], corner[b], corner[c]);
    put(corner[a], corner[c], corner[d]);
  }
  return out;
}

// The world box around the entity's shape for a mode (1 sphere,
// 2 polygon, 3 box), or null when it has none (a model that has not
// arrived yet). Used to skip entities a ray or a move cannot reach.
export function shapeBounds(e, mode)
{
  if (mode === 1)
  {
    const p = e.worldPosition();
    const r = e.radiusX;
    return { min: [p.x - r, p.y - r, p.z - r], max: [p.x + r, p.y + r, p.z + r] };
  }
  if (mode === 2)
  {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const part of meshParts(e))
    {
      if (part.mesh.bounds.isEmpty()) continue;
      const b = part.worldBounds();
      lo[0] = Math.min(lo[0], b.min.x);
      lo[1] = Math.min(lo[1], b.min.y);
      lo[2] = Math.min(lo[2], b.min.z);
      hi[0] = Math.max(hi[0], b.max.x);
      hi[1] = Math.max(hi[1], b.max.y);
      hi[2] = Math.max(hi[2], b.max.z);
    }
    return lo[0] <= hi[0] ? { min: lo, max: hi } : null;
  }
  const { min, max } = localBox(e);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const p = new Vec3();
  for (let i = 0; i < 8; i++)
  {
    p.set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).applyMat4(e.worldMatrix);
    lo[0] = Math.min(lo[0], p.x);
    lo[1] = Math.min(lo[1], p.y);
    lo[2] = Math.min(lo[2], p.z);
    hi[0] = Math.max(hi[0], p.x);
    hi[1] = Math.max(hi[1], p.y);
    hi[2] = Math.max(hi[2], p.z);
  }
  return { min: lo, max: hi };
}

// Does the segment origin + s * line (0 <= s <= limit) come within `pad`
// of the box? A cheap first test before the exact shape; it runs for every
// pair of mover and target, so it allocates nothing.
export function segmentNearBox(ox, oy, oz, lx, ly, lz, box, pad, limit)
{
  span[0] = 0;
  span[1] = limit;
  return slabNear(ox, lx, box.min[0] - pad, box.max[0] + pad) &&
    slabNear(oy, ly, box.min[1] - pad, box.max[1] + pad) &&
    slabNear(oz, lz, box.min[2] - pad, box.max[2] + pad);
}

// The part of the segment inside the slabs tested so far.
const span = new Float64Array(2);

function slabNear(o, d, lo, hi)
{
  if (Math.abs(d) < 1e-15) return o >= lo && o <= hi;
  let n = (lo - o) / d;
  let f = (hi - o) / d;
  if (n > f)
  {
    const t = n;
    n = f;
    f = t;
  }
  if (n > span[0]) span[0] = n;
  if (f < span[1]) span[1] = f;
  return span[0] <= span[1];
}
