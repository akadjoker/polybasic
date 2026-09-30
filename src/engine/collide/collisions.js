// Collisions: after every Update, entities that moved are swept from where
// they were to where the program put them, and stopped or slid along
// whatever they would have passed through.
//
// A moving entity is an ellipsoid around its position, EntityRadius wide
// (X and Z) and high (Y), aligned with the world axes. `Collisions src,
// dst, method, response` says how entities of type src meet those of type
// dst:
//   method   1 sphere   the other entity's EntityRadius sphere
//            2 polygon  the other entity's mesh triangles (both sides; for
//                       a model, the triangles of all its parts)
//            3 box      the other entity's EntityBox (or the box around
//                       its mesh or model), from the outside
//   response 1 stop     stop at the first contact
//            2 slide    slide along what was hit
//            3 slide, but a surface facing up (a floor, a ramp) does not
//              turn downward movement into sliding: gravity does not make
//              things slip down slopes
// The other entity is taken where it is now; only the moving one sweeps.
//
// The sweep works in "ellipsoid space", the world scaled by 1 / radius per
// axis, where the moving ellipsoid is the unit sphere of sweep.js
// (Fauerby, "Improved Collision detection and Response", 2003).

import { Vec3 } from '../math/vec3.js';
import { Entity } from '../scene/entity.js';
import { newHit, sweepTriangle, sweepSphere } from './sweep.js';
import { boxTriangles, shapeBounds, segmentNearBox, meshParts } from './shapes.js';
import { meshTrianglesNear } from './picking.js';

export const COLLIDE_SPHERE = 1;
export const COLLIDE_POLYGON = 2;
export const COLLIDE_BOX = 3;
export const RESPONSE_STOP = 1;
export const RESPONSE_SLIDE = 2;
export const RESPONSE_SLIDE_NO_DOWNHILL = 3;

// Slides per step: enough for a corner between a wall and a floor.
const MAX_SLIDES = 8;
// How far short of a contact a sphere stops (in ellipsoid space, so in
// fractions of its radius): enough to stay out of rounding error.
const GAP = 1e-6;
// Moves shorter than this are not swept.
const TINY = 1e-12;

export class Collisions
{
  constructor(world)
  {
    this.world = world;
    this.rules = new Map();   // source type -> [{ dst, method, response }]
    // Per step: each target's world box and box triangles, worked out
    // once instead of for every mover that passes near it.
    this.cache = new Map();   // entity -> { bounds: [by method], boxTris }
    this.tri = new Float64Array(9);
  }

  entry(e)
  {
    let c = this.cache.get(e);
    if (!c)
    {
      c = { bounds: [], boxTris: null, inv: undefined, parts: null };
      this.cache.set(e, c);
    }
    return c;
  }

  // The world box of an entity's shape for a method, cached for the step.
  boundsOf(e, method)
  {
    const c = this.entry(e);
    if (c.bounds[method] === undefined) c.bounds[method] = shapeBounds(e, method);
    return c.bounds[method];
  }

  // The entities whose triangles make up e (itself, or a model's parts).
  partsOf(e)
  {
    const c = this.entry(e);
    if (!c.parts) c.parts = meshParts(e);
    return c.parts;
  }

  // The inverse world matrix, or null when there is none (a zero scale).
  inverseOf(e)
  {
    const c = this.entry(e);
    if (c.inv === undefined)
    {
      const inv = e.worldMatrix.clone();
      c.inv = inv.invert() ? inv : null;
    }
    return c.inv;
  }

  boxTrianglesOf(e)
  {
    const c = this.entry(e);
    if (!c.boxTris) c.boxTris = boxTriangles(e);
    return c.boxTris;
  }

  set(src, dst, method, response)
  {
    let list = this.rules.get(src);
    if (!list)
    {
      list = [];
      this.rules.set(src, list);
    }
    // A second rule for the same pair replaces the first.
    const i = list.findIndex((r) => r.dst === dst);
    const rule = { dst, method, response };
    if (i >= 0) list[i] = rule;
    else list.push(rule);
  }

  clear()
  {
    this.rules.clear();
  }

  // Forgets where an entity was: its next move starts from here, so a
  // PositionEntity that follows is a jump, not a sweep.
  reset(e)
  {
    e.collisionFrom = e.worldPosition();
  }

  resetAll()
  {
    for (const e of this.world.handles.values())
    {
      if (e instanceof Entity && e.collisionType) this.reset(e);
    }
  }

  // One step: every entity of a source type that moved is swept.
  update()
  {
    if (this.rules.size === 0)
    {
      // Nothing collides, but the positions stay current for when a rule
      // is added.
      for (const e of this.world.handles.values())
      {
        if (e instanceof Entity && e.collisionType)
        {
          e.collisions.length = 0;
          this.reset(e);
        }
      }
      return;
    }
    const byType = new Map();
    const movers = [];
    for (const e of this.world.handles.values())
    {
      if (!(e instanceof Entity) || !e.collisionType) continue;
      let list = byType.get(e.collisionType);
      if (!list)
      {
        list = [];
        byType.set(e.collisionType, list);
      }
      list.push(e);
      if (this.rules.has(e.collisionType)) movers.push(e);
      else
      {
        e.collisions.length = 0;
        this.reset(e);
      }
    }
    this.cache.clear();
    for (const e of movers)
    {
      e.collisions.length = 0;
      const to = e.worldPosition();
      const from = e.collisionFrom || to;
      if (!e.shown || from.distanceTo(to) < TINY)
      {
        e.collisionFrom = to;
        continue;
      }
      const end = this.sweep(e, from, to.clone().sub(from), byType);
      if (!end.equals(to, 0)) e.setPosition(end.x, end.y, end.z, true);
      e.collisionFrom = e.worldPosition();
      // It moved: other movers must see it where it is now.
      this.cache.delete(e);
    }
    this.cache.clear();
  }

  // Moves entity e from `from` along `move` (world), returns where it ends.
  sweep(e, from, move, byType)
  {
    const rx = e.radiusX;
    const ry = e.radiusY;
    // World -> ellipsoid space and back.
    const toE = (v) => new Vec3(v.x / rx, v.y / ry, v.z / rx);
    const toW = (v) => new Vec3(v.x * rx, v.y * ry, v.z * rx);
    // Sliding never travels further than the move itself, so only what is
    // within that reach of the start can be met.
    const reach = move.length() + Math.max(rx, ry);
    const lo = [from.x - reach, from.y - reach, from.z - reach];
    const hi = [from.x + reach, from.y + reach, from.z + reach];
    const targets = [];
    for (const rule of this.rules.get(e.collisionType))
    {
      for (const other of byType.get(rule.dst) || [])
      {
        if (other === e || !other.shown) continue;
        const b = this.boundsOf(other, rule.method);
        if (!b || b.min[0] > hi[0] || b.max[0] < lo[0] || b.min[1] > hi[1] || b.max[1] < lo[1] || b.min[2] > hi[2] || b.max[2] < lo[2]) continue;
        targets.push({ other, rule, bounds: b });
      }
    }
    if (targets.length === 0) return from.clone().add(move);

    let pos = toE(from);
    let vel = toE(move);
    for (let slide = 0; slide < MAX_SLIDES; slide++)
    {
      if (vel.length() < TINY) break;
      const found = this.nearest(e, pos, vel, targets, rx, ry);
      if (!found)
      {
        pos.add(vel);
        break;
      }
      const { hit, other, rule } = found;
      const n = new Vec3(hit.nx, hit.ny, hit.nz);
      // The world normal: back through the inverse transpose of the scale.
      const worldNormal = new Vec3(n.x / rx, n.y / ry, n.z / rx).normalize();
      const contact = toW(new Vec3(hit.x, hit.y, hit.z));
      e.collisions.push({
        entity: other,
        x: contact.x,
        y: contact.y,
        z: contact.z,
        nx: worldNormal.x,
        ny: worldNormal.y,
        nz: worldNormal.z
      });
      // Up to the contact, stopping a hair short of it along the move (not
      // along the normal, which would creep sideways on a slope).
      const rest = vel.clone().scale(1 - hit.t);
      const travel = vel.length() * hit.t;
      if (travel > GAP) pos.add(vel.normalize().scale(travel - GAP));
      if (rule.response === RESPONSE_STOP) break;
      if (rule.response === RESPONSE_SLIDE_NO_DOWNHILL && worldNormal.y > 0 && rest.y < 0) rest.y = 0;
      // What is left of the move, along the surface.
      vel = rest.sub(n.scale(rest.dot(n)));
    }
    return toW(pos);
  }

  // The first contact along the move, in ellipsoid space, or null.
  nearest(e, pos, vel, targets, rx, ry)
  {
    const hit = newHit(1);
    let best = null;
    // The move in world space, for the cheap box test and to gather mesh
    // triangles.
    const wPos = new Vec3(pos.x * rx, pos.y * ry, pos.z * rx);
    const wVel = new Vec3(vel.x * rx, vel.y * ry, vel.z * rx);
    const pad = Math.max(rx, ry);
    const tri = this.tri;
    const toE = (src, offset) =>
    {
      for (let k = 0; k < 9; k += 3)
      {
        tri[k] = src[offset + k] / rx;
        tri[k + 1] = src[offset + k + 1] / ry;
        tri[k + 2] = src[offset + k + 2] / rx;
      }
      return tri;
    };
    for (const target of targets)
    {
      const { other, rule, bounds } = target;
      if (!segmentNearBox(wPos.x, wPos.y, wPos.z, wVel.x, wVel.y, wVel.z, bounds, pad, hit.t)) continue;
      const before = hit.t;
      if (rule.method === COLLIDE_SPHERE) this.sphereHit(other, wPos, wVel, rx, ry, hit);
      else if (rule.method === COLLIDE_POLYGON)
      {
        // A model is met as a whole: the triangles of all its parts.
        for (const part of this.partsOf(other))
        {
          const inv = this.inverseOf(part);
          if (!inv) continue;
          meshTrianglesNear(part, wPos, wVel, [rx, ry, rx], (t) =>
          {
            sweepTriangle(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, toE(t, 0), true, hit);
          }, inv);
        }
      }
      else
      {
        const boxTris = this.boxTrianglesOf(other);
        for (let k = 0; k < 12; k++)
        {
          sweepTriangle(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, toE(boxTris, k * 9), false, hit);
        }
      }
      if (hit.t < before) best = target;
    }
    return best ? { hit, other: best.other, rule: best.rule } : null;
  }

  // Sphere against sphere uses the mover's horizontal radius as a sphere
  // (exact when both radii are equal). The hit is worked out in world
  // units and brought into ellipsoid space.
  sphereHit(other, wPos, wVel, rx, ry, hit)
  {
    const c = other.worldPosition();
    const s = 1 / rx;
    const h = newHit(hit.t);
    if (!sweepSphere(wPos.x * s, wPos.y * s, wPos.z * s, wVel.x * s, wVel.y * s, wVel.z * s, c.x * s, c.y * s, c.z * s, other.radiusX * s, h)) return;
    const n = new Vec3(h.nx * rx, h.ny * ry, h.nz * rx).normalize();
    // h is in the world scaled by 1 / rx; ellipsoid space divides the world
    // by rx, ry, rx.
    hit.t = h.t;
    hit.x = h.x;
    hit.y = h.y * rx / ry;
    hit.z = h.z;
    hit.nx = n.x;
    hit.ny = n.y;
    hit.nz = n.z;
  }
}
