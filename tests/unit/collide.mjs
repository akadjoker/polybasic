// The geometry under picking and collisions: the triangle tree, rays and
// sphere sweeps, and the camera projection. Known answers first, then
// random cases checked against brute force.

import { MeshBvh } from '../../src/engine/collide/bvh.js';
import { newHit, sweepTriangle, sweepSphere, rayTriangle, raySphere } from '../../src/engine/collide/sweep.js';
import { screenRay, projectPoint } from '../../src/engine/collide/camera.js';
import { createSphere, createTorus } from '../../src/engine/scene/mesh.js';
import { World } from '../../src/engine/scene/world.js';
import { pickLine, meshTrianglesNear } from '../../src/engine/collide/picking.js';
import { Collisions } from '../../src/engine/collide/collisions.js';
import { boxTriangles } from '../../src/engine/collide/shapes.js';
import { createCube } from '../../src/engine/scene/mesh.js';
import { createPlane } from '../../src/engine/scene/mesh.js';
import { Vec3 } from '../../src/engine/math/vec3.js';
import { assert, near } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

// A repeatable random sequence.
function random(seed)
{
  let s = seed >>> 0;
  return () =>
  {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A floor triangle at y = 0, big enough for the tests, front facing up.
const FLOOR = [-100, 0, -100, 0, 0, 100, 100, 0, -100];
function frontOf(tri)
{
  const e1 = new Vec3(tri[3] - tri[0], tri[4] - tri[1], tri[5] - tri[2]);
  const e2 = new Vec3(tri[6] - tri[0], tri[7] - tri[1], tri[8] - tri[2]);
  return e1.cross(e2).normalize();
}

// The closest point of a triangle to p (Ericson, Real-Time Collision
// Detection 5.1.5), used as the reference for the sweeps.
function closestOnTriangle(p, tri)
{
  const a = new Vec3(tri[0], tri[1], tri[2]);
  const b = new Vec3(tri[3], tri[4], tri[5]);
  const c = new Vec3(tri[6], tri[7], tri[8]);
  const ab = b.clone().sub(a);
  const ac = c.clone().sub(a);
  const ap = p.clone().sub(a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = p.clone().sub(b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().add(ab.scale(d1 / (d1 - d3)));
  const cp = p.clone().sub(c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().add(ac.scale(d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
  {
    return b.clone().add(c.clone().sub(b).scale((d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }
  const denom = 1 / (va + vb + vc);
  return a.clone().add(ab.scale(vb * denom)).add(ac.scale(vc * denom));
}

test('a sphere falling on a floor stops one radius above it', () =>
{
  const hit = newHit();
  assert(sweepTriangle(0, 5, 0, 0, -10, 0, FLOOR, false, hit), 'no hit');
  near(hit.t, 0.4, 1e-12, 't');
  near(hit.y, 0, 1e-12, 'contact y');
  near(hit.ny, 1, 1e-12, 'normal y');
});

test('one-sided triangles let things through from behind, two-sided ones do not', () =>
{
  const hit = newHit();
  assert(!sweepTriangle(0, -5, 0, 0, 10, 0, FLOOR, false, hit), 'one-sided hit from behind');
  assert(sweepTriangle(0, -5, 0, 0, 10, 0, FLOOR, true, hit), 'two-sided missed');
  near(hit.t, 0.4, 1e-12, 't');
  near(hit.ny, -1, 1e-12, 'normal faces the sphere');
});

test('moving along or away from a surface is free, even when touching it', () =>
{
  assert(!sweepTriangle(0, 0.5, 0, 5, 0, 0, FLOOR, false, newHit()), 'sliding along counted');
  assert(!sweepTriangle(0, 0.5, 0, 0, 3, 0, FLOOR, false, newHit()), 'leaving counted');
  const hit = newHit();
  assert(sweepTriangle(0, 0.5, 0, 0, -3, 0, FLOOR, false, hit), 'pressing in not counted');
  assert(hit.t === 0, `t ${hit.t}`);
});

test('corners and edges stop the sphere at distance 1', () =>
{
  const tri = [0, 0, 0, 0, 0, 1, 1, 0, 0];
  // Straight at the corner (0, 0, 0) along -X from x = 5, below the plane.
  let hit = newHit();
  assert(sweepTriangle(5, 0, -3, -10, 0, 0, tri, true, hit) === false, 'far miss');
  hit = newHit();
  assert(sweepTriangle(-5, 0, -0.5, 10, 0, 0, tri, true, hit), 'corner or edge miss');
  const centre = new Vec3(-5 + 10 * hit.t, 0, -0.5);
  near(closestOnTriangle(centre, tri).distanceTo(centre), 1, 1e-9, 'distance at contact');
});

test('random sweeps agree with the exact distance to the triangle', () =>
{
  const rnd = random(7);
  let hits = 0;
  for (let i = 0; i < 3000; i++)
  {
    const tri = Array.from({ length: 9 }, () => rnd() * 4 - 2);
    const p = new Vec3(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4);
    const v = new Vec3(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4);
    const start = closestOnTriangle(p, tri).distanceTo(p);
    if (start <= 1.001) continue;   // starts touching: covered above
    const hit = newHit();
    const got = sweepTriangle(p.x, p.y, p.z, v.x, v.y, v.z, tri, true, hit);
    // Reference: the first time the distance drops to 1, by fine sampling
    // and bisection.
    let ref = -1;
    const steps = 400;
    for (let k = 1; k <= steps; k++)
    {
      const at = p.clone().add(v.clone().scale(k / steps));
      if (closestOnTriangle(at, tri).distanceTo(at) <= 1)
      {
        let lo = (k - 1) / steps;
        let hi = k / steps;
        for (let j = 0; j < 50; j++)
        {
          const mid = (lo + hi) / 2;
          const m = p.clone().add(v.clone().scale(mid));
          if (closestOnTriangle(m, tri).distanceTo(m) <= 1) hi = mid;
          else lo = mid;
        }
        ref = hi;
        break;
      }
    }
    if (ref < 0)
    {
      // Sampling can miss a graze shorter than a step: then any hit must
      // still be a real touch.
      if (got)
      {
        const c = p.clone().add(v.clone().scale(hit.t));
        near(closestOnTriangle(c, tri).distanceTo(c), 1, 1e-6, `case ${i}: graze distance`);
      }
      continue;
    }
    assert(got, `case ${i}: missed a contact at t = ${ref}`);
    near(hit.t, ref, 1e-6, `case ${i}: t`);
    const c = p.clone().add(v.clone().scale(hit.t));
    const q = closestOnTriangle(c, tri);
    near(q.distanceTo(new Vec3(hit.x, hit.y, hit.z)), 0, 1e-6, `case ${i}: contact point`);
    const n = c.clone().sub(q).normalize();
    near(n.dot(new Vec3(hit.nx, hit.ny, hit.nz)), 1, 1e-6, `case ${i}: normal`);
    hits++;
  }
  assert(hits > 200, `only ${hits} contacts tested`);
});

test('sphere against sphere', () =>
{
  const hit = newHit();
  assert(sweepSphere(-10, 0, 0, 20, 0, 0, 0, 0, 0, 2, hit), 'miss');
  near(hit.t, 7 / 20, 1e-12, 't');
  near(hit.x, -2, 1e-12, 'contact on the target surface');
  near(hit.nx, -1, 1e-12, 'normal');
  assert(!sweepSphere(-10, 3.1, 0, 20, 0, 0, 0, 0, 0, 2, newHit()), 'passing by counted');
  assert(!sweepSphere(-2, 0, 0, -5, 0, 0, 0, 0, 0, 2, newHit()), 'leaving counted');
});

test('rays against triangles and spheres', () =>
{
  let hit = newHit(Infinity);
  assert(rayTriangle(0, 5, 0, 0, -1, 0, FLOOR, false, hit), 'front miss');
  near(hit.t, 5, 1e-12, 't');
  near(hit.ny, 1, 1e-12, 'normal');
  assert(!rayTriangle(0, -5, 0, 0, 1, 0, FLOOR, false, newHit(Infinity)), 'one-sided back hit');
  hit = newHit(Infinity);
  assert(rayTriangle(0, -5, 0, 0, 1, 0, FLOOR, true, hit), 'two-sided back miss');
  near(hit.ny, -1, 1e-12, 'normal faces the ray');
  assert(!rayTriangle(0, 5, 0, 0, -1, 0, FLOOR, false, newHit(4)), 'hit beyond the limit');
  assert(frontOf(FLOOR).y > 0, 'test triangle faces up');

  hit = newHit(Infinity);
  assert(raySphere(0, 0, -10, 0, 0, 2, 0, 0, 0, 1, hit), 'sphere miss');
  near(hit.t, 4.5, 1e-12, 't');
  near(hit.nz, -1, 1e-12, 'normal');
  assert(!raySphere(0, 0, 0, 0, 0, 1, 0, 0, 0, 1, newHit(Infinity)), 'a ray from inside hits');
});

test('the triangle tree finds the same nearest hit and boxes as brute force', () =>
{
  const rnd = random(3);
  for (const mesh of [createSphere(12), createTorus(20, 0.3)])
  {
    const bvh = new MeshBvh(mesh.positions, mesh.indices);
    const tri = new Float64Array(9);
    for (let i = 0; i < 300; i++)
    {
      const o = [rnd() * 6 - 3, rnd() * 6 - 3, rnd() * 6 - 3];
      const d = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
      const brute = newHit(Infinity);
      for (let t = 0; t < bvh.triangleCount; t++) rayTriangle(...o, ...d, bvh.corners(t, tri), true, brute);
      const fast = newHit(Infinity);
      bvh.queryRay(...o, ...d, Infinity, (t) =>
      {
        rayTriangle(...o, ...d, bvh.corners(t, tri), true, fast);
        return fast.t;
      });
      assert(brute.t === fast.t, `ray ${i}: ${brute.t} vs ${fast.t}`);

      const lo = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
      const hi = lo.map((v) => v + rnd() * 0.8);
      const want = new Set();
      for (let t = 0; t < bvh.triangleCount; t++)
      {
        bvh.corners(t, tri);
        let overlap = true;
        for (let a = 0; a < 3; a++)
        {
          const min = Math.min(tri[a], tri[a + 3], tri[a + 6]);
          const max = Math.max(tri[a], tri[a + 3], tri[a + 6]);
          if (min > hi[a] || max < lo[a]) overlap = false;
        }
        if (overlap) want.add(t);
      }
      const got = new Set();
      bvh.queryBox(...lo, ...hi, (t) => got.add(t));
      assert(got.size === want.size && [...want].every((t) => got.has(t)), `box ${i}: ${got.size} vs ${want.size}`);
    }
  }
});

test('camera projection and the ray through a pixel agree', () =>
{
  const world = new World();
  const cam = world.createEntity('camera');
  cam.setPosition(1, 2, -3, false);
  cam.setRotation(20, 35, 5, false);
  cam.camera.fov = 70;
  const rnd = random(11);
  for (const viewport of [null, [100, 50, 300, 200]])
  {
    cam.camera.viewport = viewport;
    for (let i = 0; i < 50; i++)
    {
      const point = new Vec3(rnd() * 10 - 5, rnd() * 10 - 5, rnd() * 20);
      const p = projectPoint(cam, point, 800, 600);
      if (!p.inFront) continue;
      const ray = screenRay(cam, p.x, p.y, 800, 600);
      const to = point.clone().sub(ray.origin).normalize();
      near(to.dot(ray.direction), 1, 1e-12, 'ray through the projected pixel');
    }
  }
  // The centre of the screen is straight ahead.
  cam.camera.viewport = null;
  const ahead = screenRay(cam, 400, 300, 800, 600);
  const fwd = new Vec3(0, 0, 1).applyQuat(cam.rotation);
  near(ahead.direction.dot(fwd), 1, 1e-12, 'centre ray');
  // The top edge of the screen is half the field of view above.
  const top = screenRay(cam, 400, 0, 800, 600);
  near(Math.acos(top.direction.dot(fwd)) * 180 / Math.PI, 35, 1e-9, 'half fov');
});

test('picked normals stay perpendicular under a parent with uneven scale', () =>
{
  // A plane rolled 45 degrees under a parent stretched 3 times in Y: the
  // world surface is sheared, and the right normal comes from the inverse
  // transpose of the world matrix, not the matrix itself.
  const world = new World();
  const parent = world.createEntity('pivot');
  parent.setScale(1, 3, 1);
  const plane = world.createMesh(createPlane(1), parent);
  plane.setRotation(0, 0, 45, false);
  plane.pickMode = 2;
  const hit = pickLine(world, new Vec3(-5, 0.2, 0.1), new Vec3(10, 0, 0), 0);
  assert(hit.entity === plane, 'missed the plane');
  const m = plane.worldMatrix;
  const ax = new Vec3(1, 0, 0).applyMat4Direction(m);
  const az = new Vec3(0, 0, 1).applyMat4Direction(m);
  const n = new Vec3(hit.nx, hit.ny, hit.nz);
  near(n.length(), 1, 1e-12, 'unit normal');
  near(n.dot(ax), 0, 1e-12, 'perpendicular to the surface (x)');
  near(n.dot(az), 0, 1e-12, 'perpendicular to the surface (z)');
  assert(n.x < 0, 'normal faces the ray');
  // The hit point lies on the line and on the surface.
  const p = new Vec3(hit.x, hit.y, hit.z);
  near(p.y, 0.2, 1e-12, 'on the line');
  near(p.clone().sub(plane.worldPosition()).dot(n), 0, 1e-12, 'on the surface');
});

test('random fast moves never end inside a mesh or a box (ellipsoids, slide and stop)', () =>
{
  const rnd = random(5);
  for (const response of [1, 2, 3])
  {
    const world = new World();
    const collisions = new Collisions(world);
    collisions.set(1, 2, 2, response);
    collisions.set(1, 3, 3, response);
    const solids = [];
    // Turned, unevenly scaled spheres, tori and cubes as meshes (type 2)
    // and cubes as boxes (type 3).
    for (let i = 0; i < 24; i++)
    {
      const kind = i % 4;
      const mesh = kind === 0 ? createSphere(10) : kind === 1 ? createTorus(16, 0.35) : createCube();
      const e = world.createMesh(mesh);
      e.setPosition(rnd() * 16 - 8, rnd() * 16 - 8, rnd() * 16 - 8, false);
      e.setRotation(rnd() * 360, rnd() * 360, rnd() * 360, false);
      e.setScale(0.5 + rnd() * 2, 0.5 + rnd() * 2, 0.5 + rnd() * 2);
      e.collisionType = kind === 3 ? 3 : 2;
      solids.push(e);
    }
    const movers = [];
    for (let i = 0; i < 8; i++)
    {
      const m = world.createEntity('pivot');
      m.radiusX = 0.2 + rnd() * 0.5;
      m.radiusY = 0.2 + rnd() * 0.8;
      m.collisionType = 1;
      // Start somewhere clear of everything.
      for (;;)
      {
        m.setPosition(rnd() * 20 - 10, rnd() * 20 - 10, rnd() * 20 - 10, false);
        if (clearance(m, solids) > 1) break;
      }
      movers.push(m);
    }
    collisions.resetAll();
    let contacts = 0;
    for (let step = 0; step < 150; step++)
    {
      for (const m of movers)
      {
        // Up to 3 units a step: often more than the thinnest walls.
        m.translate(rnd() * 6 - 3, rnd() * 6 - 3, rnd() * 6 - 3, true);
        const p = m.worldPosition();
        // Keep them in the area.
        if (Math.abs(p.x) > 10 || Math.abs(p.y) > 10 || Math.abs(p.z) > 10) m.translate(-p.x * 0.2, -p.y * 0.2, -p.z * 0.2, true);
      }
      collisions.update();
      for (const m of movers)
      {
        contacts += m.collisions.length;
        const c = clearance(m, solids);
        assert(c > 1 - 1e-6, `response ${response}, step ${step}: entity ${m.id} is inside something (ellipsoid distance ${c})`);
      }
    }
    assert(contacts > 100, `response ${response}: only ${contacts} contacts, the test is too easy`);
  }
});

function nearTriangles(e, p, pad)
{
  const out = [];
  meshTrianglesNear(e, p, new Vec3(), pad, (t) => out.push(Array.from(t)));
  return out;
}

// The smallest distance from a mover to any triangle of the solids, in its
// ellipsoid space (1 means touching).
function clearance(m, solids)
{
  const p = m.worldPosition();
  const s = new Vec3(1 / m.radiusX, 1 / m.radiusY, 1 / m.radiusX);
  const centre = new Vec3(p.x * s.x, p.y * s.y, p.z * s.z);
  let best = Infinity;
  for (const e of solids)
  {
    const tris = e.collisionType === 3
      ? Array.from({ length: 12 }, (_, k) => Array.from(boxTriangles(e).subarray(k * 9, k * 9 + 9)))
      : nearTriangles(e, p, [m.radiusX * 3, m.radiusY * 3, m.radiusX * 3]);
    for (const t of tris)
    {
      const scaled = t.map((v, i) => v * [s.x, s.y, s.z][i % 3]);
      best = Math.min(best, closestOnTriangle(centre, scaled).distanceTo(centre));
    }
  }
  return best;
}

export default unit;
