// The shapes rays and moving spheres meet, in world space.

import { Vec3 } from '../math/vec3.js';

// The entity's box in its own space: EntityBox if set, else the bounds of
// its mesh, else the -1..1 cube the built-in shapes fill.
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
// 2 polygon, 3 box), or null when it has none (a polygon entity whose mesh
// has not loaded). Used to skip entities a ray or a move cannot reach.
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
    if (!e.mesh || e.mesh.bounds.isEmpty()) return null;
    const b = e.worldBounds();
    return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
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
// of the box? A cheap first test before the exact shape.
export function segmentNearBox(ox, oy, oz, lx, ly, lz, box, pad, limit)
{
  let t0 = 0;
  let t1 = limit;
  const o = [ox, oy, oz];
  const d = [lx, ly, lz];
  for (let a = 0; a < 3; a++)
  {
    const lo = box.min[a] - pad;
    const hi = box.max[a] + pad;
    if (Math.abs(d[a]) < 1e-15)
    {
      if (o[a] < lo || o[a] > hi) return false;
      continue;
    }
    let n = (lo - o[a]) / d[a];
    let f = (hi - o[a]) / d[a];
    if (n > f)
    {
      const t = n;
      n = f;
      f = t;
    }
    t0 = Math.max(t0, n);
    t1 = Math.min(t1, f);
    if (t0 > t1) return false;
  }
  return true;
}
