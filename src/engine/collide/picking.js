// Picking: the first pickable entity along a line, for CameraPick,
// LinePick, EntityPick and EntityVisible.
//
// An entity is pickable when it is shown and has a pick mode:
//   1 sphere   a sphere of its EntityRadius around its position
//   2 polygon  the triangles of its mesh, both sides
//   3 box      its EntityBox (or mesh bounds), from the outside
// A line with a radius sweeps a sphere of that radius instead of a thin
// ray, so it finds what a ball of that size would hit first.

import { meshBvh } from './bvh.js';
import { newHit, sweepTriangle, sweepSphere, rayTriangle, raySphere } from './sweep.js';
import { boxTriangles, shapeBounds, segmentNearBox } from './shapes.js';
import { Entity } from '../scene/entity.js';
import { Vec3 } from '../math/vec3.js';

export const PICK_NONE = 0;
export const PICK_SPHERE = 1;
export const PICK_POLYGON = 2;
export const PICK_BOX = 3;

// What a pick found. t is the fraction of the line (0..1) where it hit.
export function emptyPick()
{
  return { entity: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, distance: 0 };
}

// Finds the first pickable entity on the line from `origin` along `line`
// (whose length is the range). `accept(e)` can leave entities out.
// Returns emptyPick() filled in, with entity null for a miss.
export function pickLine(world, origin, line, radius, accept = () => true)
{
  const best = newHit(1);
  let found = null;
  const r = Math.max(0, radius);
  const tri = new Float64Array(9);
  const boxTris = new Float64Array(108);
  const { x: ox, y: oy, z: oz } = origin;
  const { x: lx, y: ly, z: lz } = line;

  for (const e of world.handles.values())
  {
    if (!(e instanceof Entity) || e.pickMode === PICK_NONE || !accept(e) || !e.shown) continue;
    const bounds = shapeBounds(e, e.pickMode);
    if (!bounds || !segmentNearBox(ox, oy, oz, lx, ly, lz, bounds, r, best.t)) continue;
    const before = best.t;

    if (e.pickMode === PICK_SPHERE)
    {
      const c = e.worldPosition();
      if (r > 0) sweepScaled(best, r, (h, s) => sweepSphere(ox * s, oy * s, oz * s, lx * s, ly * s, lz * s, c.x * s, c.y * s, c.z * s, e.radiusX * s, h));
      else raySphere(ox, oy, oz, lx, ly, lz, c.x, c.y, c.z, e.radiusX, best);
    }
    else if (e.pickMode === PICK_BOX)
    {
      boxTriangles(e, boxTris);
      for (let k = 0; k < 12; k++)
      {
        tri.set(boxTris.subarray(k * 9, k * 9 + 9));
        if (r > 0) sweepScaled(best, r, (h, s) => sweepTriangle(ox * s, oy * s, oz * s, lx * s, ly * s, lz * s, scaleTri(tri, s), false, h));
        else rayTriangle(ox, oy, oz, lx, ly, lz, tri, false, best);
      }
    }
    else if (e.pickMode === PICK_POLYGON)
    {
      if (r > 0) sweepMesh(e, origin, line, r, best);
      else rayMesh(e, origin, line, best);
    }
    if (best.t < before) found = e;
  }

  const result = emptyPick();
  if (!found) return result;
  result.entity = found;
  result.t = best.t;
  result.x = best.x;
  result.y = best.y;
  result.z = best.z;
  result.nx = best.nx;
  result.ny = best.ny;
  result.nz = best.nz;
  result.distance = best.t * Math.hypot(lx, ly, lz);
  return result;
}

// Runs a unit-sphere sweep in a space scaled by 1 / r and brings the hit
// back to the world.
function sweepScaled(best, r, sweep)
{
  const s = 1 / r;
  const hit = newHit(best.t);
  if (!sweep(hit, s)) return;
  best.t = hit.t;
  best.x = hit.x * r;
  best.y = hit.y * r;
  best.z = hit.z * r;
  best.nx = hit.nx;
  best.ny = hit.ny;
  best.nz = hit.nz;
}

function scaleTri(tri, s)
{
  const out = new Float64Array(9);
  for (let i = 0; i < 9; i++) out[i] = tri[i] * s;
  return out;
}

// A thin ray against a mesh: the ray goes into the mesh's own space, where
// the triangle tree lives, and the hit comes back out. The fraction t is
// the same in both spaces.
function rayMesh(e, origin, line, best)
{
  const inv = e.worldMatrix.clone();
  if (!inv.invert()) return;
  const o = origin.clone().applyMat4(inv);
  const d = line.clone().applyMat4Direction(inv);
  const bvh = meshBvh(e.mesh);
  const tri = new Float64Array(9);
  const hit = newHit(best.t);
  let got = false;
  bvh.queryRay(o.x, o.y, o.z, d.x, d.y, d.z, hit.t, (t) =>
  {
    if (rayTriangle(o.x, o.y, o.z, d.x, d.y, d.z, bvh.corners(t, tri), true, hit)) got = true;
    return hit.t;
  });
  if (!got) return;
  const p = new Vec3(hit.x, hit.y, hit.z).applyMat4(e.worldMatrix);
  const n = normalToWorld(inv, hit.nx, hit.ny, hit.nz);
  // Face the ray in the world too.
  if (n.dot(line) > 0) n.scale(-1);
  best.t = hit.t;
  best.x = p.x;
  best.y = p.y;
  best.z = p.z;
  best.nx = n.x;
  best.ny = n.y;
  best.nz = n.z;
}

// A sphere of radius r swept against a mesh: the triangles near the move
// are brought into the world, scaled by 1 / r, and swept against.
function sweepMesh(e, origin, line, r, best)
{
  const s = 1 / r;
  meshTrianglesNear(e, origin, line, r, (tri) =>
  {
    for (let i = 0; i < 9; i++) tri[i] *= s;
    sweepScaled(best, r, (h) => sweepTriangle(origin.x * s, origin.y * s, origin.z * s, line.x * s, line.y * s, line.z * s, tri, true, h));
  });
}

// Calls visit(tri) with each world-space triangle (9 numbers, in a buffer
// that is reused: copy it to keep it) of a mesh entity that a move from
// origin along line, padded by `pad` (a number or [x, y, z]), could touch.
// `inv` is the inverse of the entity's world matrix when the caller has it.
export function meshTrianglesNear(e, origin, line, pad, visit, inv = null)
{
  if (!inv)
  {
    inv = e.worldMatrix.clone();
    if (!inv.invert()) return;
  }
  const [px, py, pz] = Array.isArray(pad) ? pad : [pad, pad, pad];
  const lo = [Math.min(origin.x, origin.x + line.x) - px, Math.min(origin.y, origin.y + line.y) - py, Math.min(origin.z, origin.z + line.z) - pz];
  const hi = [Math.max(origin.x, origin.x + line.x) + px, Math.max(origin.y, origin.y + line.y) + py, Math.max(origin.z, origin.z + line.z) + pz];
  const llo = [Infinity, Infinity, Infinity];
  const lhi = [-Infinity, -Infinity, -Infinity];
  const p = new Vec3();
  for (let i = 0; i < 8; i++)
  {
    p.set(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]).applyMat4(inv);
    llo[0] = Math.min(llo[0], p.x);
    llo[1] = Math.min(llo[1], p.y);
    llo[2] = Math.min(llo[2], p.z);
    lhi[0] = Math.max(lhi[0], p.x);
    lhi[1] = Math.max(lhi[1], p.y);
    lhi[2] = Math.max(lhi[2], p.z);
  }
  const bvh = meshBvh(e.mesh);
  const m = e.worldMatrix.e;
  // A mirrored entity turns its triangles inside out; they are turned back
  // so one-sided tests keep the right front.
  const mirrored = e.worldMatrix.determinant() < 0;
  const local = new Float64Array(9);
  const tri = new Float64Array(9);
  bvh.queryBox(llo[0], llo[1], llo[2], lhi[0], lhi[1], lhi[2], (t) =>
  {
    bvh.corners(t, local);
    for (let k = 0; k < 3; k++)
    {
      const x = local[k * 3];
      const y = local[k * 3 + 1];
      const z = local[k * 3 + 2];
      const o = (mirrored && k > 0 ? 3 - k : k) * 3;
      tri[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
      tri[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      tri[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    visit(tri);
  });
}

// A normal from an entity's space to the world: multiply by the inverse
// transpose, which keeps it perpendicular under non-uniform scale.
function normalToWorld(inv, nx, ny, nz)
{
  const e = inv.e;
  return new Vec3(
    e[0] * nx + e[1] * ny + e[2] * nz,
    e[4] * nx + e[5] * ny + e[6] * nz,
    e[8] * nx + e[9] * ny + e[10] * nz).normalize();
}
