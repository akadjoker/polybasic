// Maths types against values worked out by hand.

import { Vec3, Quat, Mat4, Aabb, Ray, Plane } from '../../src/engine/math/index.js';
import { assert, near, nearAll } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });
const S = Math.SQRT1_2;

test('Vec3 basics: cross product follows the standard formula, length, normalize', () =>
{
  nearAll(Object.values(new Vec3(1, 0, 0).cross(new Vec3(0, 1, 0))), [0, 0, 1]);
  nearAll(Object.values(new Vec3(0, 1, 0).cross(new Vec3(0, 0, 1))), [1, 0, 0]);
  near(new Vec3(3, 4, 12).length(), 13);
  nearAll(Object.values(new Vec3(0, 3, 4).normalize()), [0, 0.6, 0.8]);
  near(new Vec3(1, 2, 3).dot(new Vec3(4, -5, 6)), 12);
});

test('yaw turns left, pitch tilts the nose down, roll tilts the top left', () =>
{
  const fwd = (p, y, r) => Object.values(new Vec3(0, 0, 1).applyQuat(new Quat().fromEuler(p, y, r)));
  const up = (p, y, r) => Object.values(new Vec3(0, 1, 0).applyQuat(new Quat().fromEuler(p, y, r)));
  nearAll(fwd(0, 90, 0), [-1, 0, 0], 1e-12, 'yaw 90 forward');
  nearAll(fwd(0, -90, 0), [1, 0, 0], 1e-12, 'yaw -90 forward');
  nearAll(fwd(90, 0, 0), [0, -1, 0], 1e-12, 'pitch 90 forward');
  nearAll(fwd(45, 0, 0), [0, -S, S], 1e-12, 'pitch 45 forward');
  nearAll(up(0, 0, 90), [-1, 0, 0], 1e-12, 'roll 90 up');
  // Order: roll first, then pitch, then yaw.
  nearAll(fwd(45, 90, 30), [-S, -S, 0], 1e-12, 'pitch 45 then yaw 90');
});

test('Quat Euler round trip, including the straight up/down case', () =>
{
  for (const [p, y, r] of [[10, 20, 30], [-45, 170, -60], [89, -120, 5], [0, 180, 0], [-30, -90, 90]])
  {
    const e = new Quat().fromEuler(p, y, r).toEuler();
    const again = new Quat().fromEuler(e.pitch, e.yaw, e.roll);
    assert(again.equals(new Quat().fromEuler(p, y, r), 1e-9), `round trip ${p},${y},${r} -> ${JSON.stringify(e)}`);
    near(e.pitch, p, 1e-6, 'pitch');
  }
  const e = new Quat().fromEuler(90, 30, 20).toEuler();
  near(e.pitch, 90, 1e-6, 'pitch');
  near(e.roll, 0, 1e-9, 'roll folded into yaw');
  assert(new Quat().fromEuler(e.pitch, e.yaw, e.roll).equals(new Quat().fromEuler(90, 30, 20), 1e-9), 'gimbal round trip');
});

test('Quat multiply: a turn of 30 then 60 degrees is 90', () =>
{
  const a = new Quat().fromEuler(0, 30, 0);
  const b = new Quat().fromEuler(0, 60, 0);
  assert(a.clone().multiply(b).equals(new Quat().fromEuler(0, 90, 0)), 'yaw 30 * yaw 60');
  const inv = a.clone().invert();
  assert(a.clone().multiply(inv).equals(new Quat()), 'q * q^-1 is identity');
});

test('Mat4 compose is column-major T * R * S', () =>
{
  const m = new Mat4().compose(new Vec3(1, 2, 3), new Quat().fromEuler(0, 90, 0), new Vec3(2, 2, 2));
  // Yaw 90: X axis -> (0, 0, 1), Z axis -> (-1, 0, 0); scaled by 2.
  nearAll(m.e, [0, 0, 2, 0, 0, 2, 0, 0, -2, 0, 0, 0, 1, 2, 3, 1], 1e-12, 'matrix');
  nearAll(Object.values(new Vec3(1, 0, 0).applyMat4(m)), [1, 2, 5], 1e-12, 'point');
  nearAll(Object.values(new Vec3(1, 0, 0).applyMat4Direction(m)), [0, 0, 2], 1e-12, 'direction');
});

test('Mat4 multiply, invert, determinant and decompose', () =>
{
  const a = new Mat4().compose(new Vec3(1, -2, 3), new Quat().fromEuler(10, 20, 30), new Vec3(1, 2, 3));
  const b = new Mat4().compose(new Vec3(-4, 5, 6), new Quat().fromEuler(-40, 50, 60), new Vec3(0.5, 1, 2));
  const ab = new Mat4().multiplyMatrices(a, b);
  const p = new Vec3(0.3, -0.7, 1.1);
  nearAll(Object.values(p.clone().applyMat4(ab)), Object.values(p.clone().applyMat4(b).applyMat4(a)), 1e-9, 'a*b applies b then a');
  near(a.determinant(), 6, 1e-9, 'determinant = product of scales');
  const inv = a.clone();
  assert(inv.invert(), 'invertible');
  assert(inv.multiply(a).equals(new Mat4(), 1e-12), 'inverse * a = identity');
  const pos = new Vec3();
  const rot = new Quat();
  const scale = new Vec3();
  a.decompose(pos, rot, scale);
  nearAll([pos.x, pos.y, pos.z, scale.x, scale.y, scale.z], [1, -2, 3, 1, 2, 3], 1e-9, 'decomposed');
  assert(rot.equals(new Quat().fromEuler(10, 20, 30), 1e-9), 'decomposed rotation');
  const flat = new Mat4().compose(new Vec3(), new Quat(), new Vec3(0, 1, 1));
  assert(!flat.clone().invert(), 'a zero scale cannot be inverted');
});

test('Mat4 perspective maps near to -1 and far to +1 (looking down +Z)', () =>
{
  const m = new Mat4().perspective(90, 2, 1, 100);
  const project = (x, y, z) =>
  {
    const e = m.e;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    return [(e[0] * x) / w, (e[5] * y) / w, (e[10] * z + e[14]) / w];
  };
  nearAll(project(0, 0, 1), [0, 0, -1], 1e-12, 'near');
  nearAll(project(0, 0, 100), [0, 0, 1], 1e-12, 'far');
  nearAll(project(2, 1, 1), [1, 1, -1], 1e-12, 'edge of a 90 degree view');
});

test('Aabb transform, overlap; Ray against plane and box', () =>
{
  const box = new Aabb(new Vec3(-1, -1, -1), new Vec3(1, 1, 1));
  const turned = box.transformed(new Mat4().compose(new Vec3(10, 0, 0), new Quat().fromEuler(0, 45, 0), new Vec3(1, 1, 1)));
  near(turned.max.x, 10 + Math.SQRT2, 1e-9, 'rotated box grows');
  assert(!turned.intersects(box), 'far boxes do not overlap');
  assert(box.intersects(new Aabb(new Vec3(0.5, 0.5, 0.5), new Vec3(2, 2, 2))), 'overlap');
  const ray = new Ray(new Vec3(0, 5, 0), new Vec3(0, -1, 0));
  near(ray.intersectPlane(Plane.fromPointNormal(new Vec3(0, 1, 0), new Vec3(0, 1, 0))), 4, 1e-12, 'plane');
  near(ray.intersectAabb(box), 4, 1e-12, 'box');
  assert(new Ray(new Vec3(5, 5, 0), new Vec3(0, -1, 0)).intersectAabb(box) === null, 'miss');
});

export default unit;
