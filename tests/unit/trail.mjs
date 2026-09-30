// Ribbon trails: sampling paced by the fastest point, ageing, and the
// ribbon's mesh.

import { Trail, MAX_SAMPLES } from '../../src/engine/scene/trail.js';
import { World } from '../../src/engine/scene/world.js';
import { assert, near } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });
const DT = 1 / 60;

// A blade of two pivots, base and tip, and its trail.
function blade()
{
  const world = new World();
  const base = world.createEntity('pivot');
  const tip = world.createEntity('pivot');
  tip.setPosition(0, 1, 0, false);
  const trail = new Trail(world.createEntity('mesh'), [base, tip]);
  return { base, tip, trail };
}

test('samples are taken as often as the fastest point moves a step', () =>
{
  const { base, tip, trail } = blade();
  trail.update(DT);
  assert(trail.samples.length === 1, `seeded with ${trail.samples.length}`);
  // The tip moves 1 unit, the base 0.1: 1 / 0.08 = 12 steps of the tip.
  tip.setPosition(1, 1, 0, false);
  base.setPosition(0.1, 0, 0, false);
  trail.update(DT);
  assert(trail.samples.length === 13, `${trail.samples.length} samples`);
  // Each new sample is one step further along the tip's path.
  near(trail.samples[5].points[1][0], 5 * 0.08, 1e-12, 'tip of sample 5');
  near(trail.samples[5].points[0][0], 5 * 0.008, 1e-12, 'base keeps pace with it');
  // Standing still adds nothing.
  trail.update(DT);
  assert(trail.samples.length === 13, 'a still blade adds samples');
});

test('samples fade and go after their life; the mesh follows the blade', () =>
{
  const { tip, trail } = blade();
  trail.life = 0.5;
  trail.smooth = 4;
  trail.update(DT);
  for (let k = 1; k <= 10; k++)
  {
    tip.setPosition(k * 0.1, 1, 0, false);
    trail.update(DT);
  }
  // The ribbon runs through every sample, and on to where the blade is now
  // when it has moved past the last one; 6 corners per piece.
  const last = trail.samples[trail.samples.length - 1].points;
  const reach = trail.samples.length + (trail.moved(trail.current, last) > 1e-4 ? 1 : 0);
  const pieces = (reach - 1) * trail.smooth;
  assert(trail.mesh.positions.length / 3 === pieces * 6, `${trail.mesh.positions.length / 3} corners for ${pieces} pieces`);
  // The first corner is the oldest sample's base, at its place.
  const p = trail.mesh.positions;
  near(p[0], trail.samples[0].points[0][0], 1e-6, 'starts at the oldest sample');
  // The head is solid, the tail faded (alpha is the 4th colour value).
  const c = trail.mesh.colors;
  assert(c[c.length - 1] > c[3], `head alpha ${c[c.length - 1]}, tail ${c[3]}`);
  // After its life, a still blade's trail is gone.
  for (let k = 0; k < 40; k++) trail.update(DT);
  assert(trail.samples.length <= 1 && trail.mesh.positions.length === 0, `left: ${trail.samples.length} samples, ${trail.mesh.positions.length / 3} corners`);
});

test('a swing too fast for the samples still fades out at its tail', () =>
{
  const { tip, trail } = blade();
  trail.life = 1;
  trail.update(DT);
  // 1 unit a step with steps of 0.08: 12 samples a step, far more than a
  // second of them can be kept.
  for (let k = 1; k <= 60; k++)
  {
    tip.setPosition(k, 1, 0, false);
    trail.update(DT);
  }
  assert(trail.samples.length === MAX_SAMPLES, `${trail.samples.length} samples`);
  const c = trail.mesh.colors;
  near(c[3], 0, 1e-6, 'tail alpha');
  near(c[c.length - 1], 1, 1e-6, 'head alpha');
});

test('the mesh is the interpolated ribbon, corner for corner (three-point blade)', () =>
{
  const world = new World();
  const blade3 = [world.createEntity('pivot'), world.createEntity('pivot'), world.createEntity('pivot')];
  const trail = new Trail(world.createEntity('mesh'), blade3);
  trail.life = 2;
  trail.smooth = 5;
  for (let k = 1; k <= 40; k++)
  {
    const a = k / 5;
    const r = 1 + 0.3 * Math.sin(k / 7);
    blade3[0].setPosition(Math.cos(a), Math.sin(a), 0.1 * k, false);
    blade3[1].setPosition(2 * r * Math.cos(a), 2 * r * Math.sin(a), 0.1 * k, false);
    blade3[2].setPosition(3 * Math.cos(a), 3 * Math.sin(a), 0.1 * k + Math.sin(k), false);
    trail.update(DT);
  }
  let count = trail.samples.length;
  if (trail.moved(trail.current, trail.samples[count - 1].points) > 1e-4) count++;
  const at = (i) => trail.renderSample(i);
  const p = trail.mesh.positions;
  let v = 0;
  let worst = 0;
  for (let seg = 0; seg + 1 < count; seg++)
  {
    const around = [at(seg > 0 ? seg - 1 : seg), at(seg), at(seg + 1), at(seg + 2 < count ? seg + 2 : seg + 1)];
    let previous = at(seg);
    for (let d = 1; d <= trail.smooth; d++)
    {
      const next = trail.interpolate(...around, d / trail.smooth);
      for (let i = 0; i < 2; i++)
      {
        for (const [section, point] of [[previous, i], [previous, i + 1], [next, i], [next, i + 1], [next, i], [previous, i + 1]])
        {
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(p[v * 3 + c] - section.points[point][c]));
          v++;
        }
      }
      previous = next;
    }
  }
  assert(v === p.length / 3 && worst < 1e-5, `${v} of ${p.length / 3} corners, largest difference ${worst}`);
});

test('between samples the ribbon runs through the middle of the blade smoothly', () =>
{
  const { trail } = blade();
  const s = (x, y) => ({ points: [[x, y, 0], [x, y + 1, 0]], age: 0, distance: 0 });
  // Along a straight line, the middle stays on it and the blade keeps its
  // length.
  const mid = trail.interpolate(s(0, 0), s(1, 0), s(2, 0), s(3, 0), 0.5);
  near(mid.points[0][0], 1.5, 1e-9, 'halfway along');
  near(mid.points[1][1] - mid.points[0][1], 1, 1e-9, 'blade length');
  // At a sharp turn back the tangent is dropped: no overshoot past the
  // turning point.
  const back = trail.interpolate(s(0, 0), s(1, 0), s(0.2, 0), s(-1, 0), 0.5);
  assert(back.points[0][0] <= 1 + 1e-9 && back.points[0][0] >= 0.2 - 1e-9, `overshoot: ${back.points[0][0]}`);
});

export default unit;
