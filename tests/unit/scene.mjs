// Scene graph: parent/child transforms, the move/turn/point operations and
// their local/global variants, and the built-in meshes.

import { World, createCube, createSphere, createCylinder, createCone, createPlane, createTorus, Vec3 } from '../../src/engine/index.js';
import { assert, near, nearAll } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });
const pos = (e, global = true) => Object.values(e.getPosition(global));

test('a child follows its parent: world = parent world * local', () =>
{
  const w = new World();
  const parent = w.createEntity('pivot');
  const child = w.createEntity('pivot', parent);
  parent.setPosition(10, 0, 0, false);
  child.setPosition(0, 0, 2, false);
  parent.setRotation(0, 90, 0, false);
  nearAll(pos(child), [8, 0, 0], 1e-12, 'child world position after the parent turned left');
  parent.setScale(2, 2, 2);
  nearAll(pos(child), [6, 0, 0], 1e-12, 'scaled parent');
  nearAll(pos(child, false), [0, 0, 2], 1e-12, 'local position unchanged');
  const e = child.getRotation(true);
  near(e.yaw, 90, 1e-9, 'child inherits the yaw');
});

test('world matrices are cached and refreshed when an ancestor moves', () =>
{
  const w = new World();
  const a = w.createEntity('pivot');
  const b = w.createEntity('pivot', a);
  const c = w.createEntity('pivot', b);
  c.setPosition(1, 0, 0, false);
  nearAll(pos(c), [1, 0, 0]);
  a.setPosition(0, 5, 0, false);
  nearAll(pos(c), [1, 5, 0], 1e-12, 'grandchild after the root moved');
  b.setPosition(0, 0, 3, false);
  nearAll(pos(c), [1, 5, 3], 1e-12, 'after the middle moved');
});

test('Move goes along the entity\'s own axes, Translate along the parent\'s', () =>
{
  const w = new World();
  const e = w.createEntity('pivot');
  e.setRotation(0, 90, 0, false);
  e.move(0, 0, 1);
  nearAll(pos(e), [-1, 0, 0], 1e-12, 'Move forward after turning left');
  e.translate(0, 0, 1, false);
  nearAll(pos(e), [-1, 0, 1], 1e-12, 'Translate ignores the rotation');
  const parent = w.createEntity('pivot');
  parent.setRotation(0, 90, 0, false);
  const child = w.createEntity('pivot', parent);
  child.translate(0, 0, 1, false);
  nearAll(pos(child), [-1, 0, 0], 1e-12, 'local Translate follows the parent axes');
  child.translate(0, 0, 1, true);
  nearAll(pos(child), [-1, 0, 1], 1e-12, 'global Translate uses the world axes');
});

test('Position and Rotate: local versus global', () =>
{
  const w = new World();
  const parent = w.createEntity('pivot');
  parent.setPosition(5, 0, 0, false);
  parent.setRotation(0, 90, 0, false);
  const child = w.createEntity('pivot', parent);
  child.setPosition(1, 2, 3, true);
  nearAll(pos(child), [1, 2, 3], 1e-12, 'global position lands in the world');
  child.setRotation(0, 30, 0, true);
  near(child.getRotation(true).yaw, 30, 1e-9, 'global yaw');
  near(child.getRotation(false).yaw, -60, 1e-9, 'local yaw relative to the parent');
  child.setRotation(0, 30, 0, false);
  near(child.getRotation(true).yaw, 120, 1e-9, 'local rotation adds to the parent');
});

test('Turn: local turns about the own axes, global about the world axes', () =>
{
  const w = new World();
  const a = w.createEntity('pivot');
  a.setRotation(90, 0, 0, false);            // nose straight down
  a.turn(0, 90, 0, false);                   // local yaw: about its own up axis
  nearAll(Object.values(new Vec3(0, 0, 1).applyQuat(a.worldRotation())), [-1, 0, 0], 1e-9, 'local turn');
  const b = w.createEntity('pivot');
  b.setRotation(90, 0, 0, false);
  b.turn(0, 90, 0, true);                    // world yaw: spins about the world Y
  nearAll(Object.values(new Vec3(0, 0, 1).applyQuat(b.worldRotation())), [0, -1, 0], 1e-9, 'global turn keeps pointing down');
  const c = w.createEntity('pivot');
  for (let i = 0; i < 360; i++) c.turn(0, 1, 0, false);
  near(Math.abs(c.getRotation(true).yaw) % 360, 0, 1e-6, '360 turns of 1 degree');
});

test('Point aims the forward axis at a target', () =>
{
  const w = new World();
  const cam = w.createEntity('camera');
  cam.setPosition(0, 2, -5, false);
  const target = w.createEntity('pivot');
  cam.pointAt(target.worldPosition());
  const r = cam.getRotation(true);
  near(r.pitch, Math.atan2(2, 5) * 180 / Math.PI, 1e-9, 'pitch');
  near(r.yaw, 0, 1e-9, 'yaw');
  target.setPosition(-5, 2, -5, false);
  cam.pointAt(target.worldPosition());
  near(cam.getRotation(true).yaw, 90, 1e-9, 'target on the left: yaw 90');
});

test('Parent with and without keeping the world transform; Free and Copy', () =>
{
  const w = new World();
  const p = w.createEntity('pivot');
  p.setPosition(10, 0, 0, false);
  p.setRotation(0, 90, 0, false);
  const e = w.createEntity('pivot');
  e.setPosition(1, 0, 0, false);
  e.setParent(p, true);
  nearAll(pos(e), [1, 0, 0], 1e-9, 'kept in place');
  e.setParent(null, true);
  nearAll(pos(e), [1, 0, 0], 1e-9, 'unparented in place');
  e.setParent(p, false);
  // Turned left 90 degrees, the parent's X axis points along world +Z.
  nearAll(pos(e), [10, 0, 1], 1e-9, 'local values kept, moved with the parent');
  const copy = w.copyEntity(p, null);
  assert(copy.children.length === 1 && copy.children[0] !== e, 'children copied');
  nearAll(pos(copy.children[0]), [10, 0, 1], 1e-9, 'copied child in the same place');
  const count = w.entities.length;
  w.freeEntity(p);
  assert(w.entities.length === count - 2 && !e.alive, 'freeing removes the children too');
});

test('hidden parents hide children; the frame lists what is drawn', () =>
{
  const w = new World();
  const cam = w.createEntity('camera');
  const p = w.createEntity('pivot');
  const cube = w.createMesh(createCube(), p);
  w.createEntity('light');
  let f = w.buildFrame(800, 600);
  assert(f.cameras.length === 1 && f.lights.length === 1 && f.items.length === 1, 'one of each');
  p.visible = false;
  f = w.buildFrame(800, 600);
  assert(f.items.length === 0, 'hidden with the parent');
  p.visible = true;
  cube.setPosition(3, 0, 0, false);
  f = w.buildFrame(800, 600);
  near(f.items[0].world[12], 3, 1e-12, 'world matrix in the frame');
  void cam;
});

test('built-in meshes: clockwise front faces agree with the normals, sizes fit -1..1', () =>
{
  const meshes = {
    cube: createCube(), sphere: createSphere(12), cylinder: createCylinder(10), cone: createCone(10),
    plane: createPlane(3), torus: createTorus(16, 0.3)
  };
  for (const [name, m] of Object.entries(meshes))
  {
    const p = m.positions;
    const n = m.normals;
    for (let t = 0; t < m.indices.length; t += 3)
    {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      const v = (i) => new Vec3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      const face = v(b).sub(v(a)).cross(v(c).sub(v(a)));
      const normal = new Vec3(n[a * 3] + n[b * 3] + n[c * 3], n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
      assert(face.dot(normal) > 0, `${name}: triangle ${t / 3} faces inwards`);
    }
    for (const v of p) assert(Math.abs(v) <= 1 + 1e-9, `${name}: vertex outside -1..1`);
    assert(m.uvs.length / 2 === m.vertexCount && m.normals.length === p.length, `${name}: attribute sizes`);
  }
  assert(meshes.cube.triangleCount === 12 && meshes.cube.vertexCount === 24, 'cube counts');
  // The cube's front face (towards -Z) is clockwise as seen from the front.
  const front = [...meshes.cube.indices.slice(0, 3)].map((i) => [meshes.cube.positions[i * 3], meshes.cube.positions[i * 3 + 1]]);
  const signedArea = (front[1][0] - front[0][0]) * (front[2][1] - front[0][1]) - (front[2][0] - front[0][0]) * (front[1][1] - front[0][1]);
  assert(signedArea < 0, 'front face runs clockwise on screen');
});

export default unit;
