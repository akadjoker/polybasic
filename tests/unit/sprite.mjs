// Sprites: how the square is turned for a camera in each view mode, checked
// by where its corners land on the screen.

import { spriteMatrix, newSprite, createSpriteQuad, SPRITE_FIXED, SPRITE_UPRIGHT, SPRITE_UPRIGHT2 } from '../../src/engine/scene/sprite.js';
import { World } from '../../src/engine/scene/world.js';
import { Mat4, Vec3 } from '../../src/engine/math/index.js';
import { projectPoint } from '../../src/engine/collide/camera.js';
import { assert, near, nearAll } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

// The screen points of the square's corners (top-left, top-right,
// bottom-right, bottom-left) for a camera.
function corners(camera, spriteEntity, sprite)
{
  const m = spriteMatrix(new Mat4(), spriteEntity.worldMatrix.e, camera.worldMatrix.e, sprite);
  const quad = createSpriteQuad().positions;
  const out = [];
  for (let i = 0; i < 4; i++)
  {
    const p = new Vec3(quad[i * 3], quad[i * 3 + 1], quad[i * 3 + 2]).applyMat4(m);
    out.push(projectPoint(camera, p, 800, 600));
  }
  return out;
}

test('view mode 1: an upright square on the screen, whatever the camera does', () =>
{
  const world = new World();
  const camera = world.createEntity('camera');
  const e = world.createEntity('pivot');
  const sprite = newSprite();
  for (const [pitch, yaw, roll] of [[0, 0, 0], [30, 40, 0], [-50, 170, 25], [80, -60, -40]])
  {
    camera.setPosition(2, 1, -3, false);
    camera.setRotation(pitch, yaw, roll, false);
    // Put the sprite 6 units in front of the camera, a little off centre.
    const c = camera.worldMatrix.e;
    e.setPosition(2 + c[8] * 6 + c[0], 1 + c[9] * 6 + c[1], -3 + c[10] * 6 + c[2], false);
    const [tl, tr, br, bl] = corners(camera, e, sprite);
    assert([tl, tr, br, bl].every((p) => p.inFront), 'behind the camera');
    near(tl.y, tr.y, 1e-6, 'top edge level');
    near(bl.y, br.y, 1e-6, 'bottom edge level');
    near(tl.x, bl.x, 1e-6, 'left edge upright');
    assert(tl.x < tr.x && tl.y < bl.y, `camera ${pitch},${yaw},${roll}: not the right way round`);
  }
});

test('view mode 2 keeps the entity\'s turn; 3 and 4 stay upright', () =>
{
  const world = new World();
  const camera = world.createEntity('camera');
  camera.setPosition(0, 5, -8, false);
  camera.setRotation(35, 20, 0, false);
  const e = world.createEntity('pivot');
  e.setPosition(1, 0, 2, false);
  e.setRotation(0, 30, 0, false);
  const fixed = { ...newSprite(), mode: SPRITE_FIXED };
  nearAll(spriteMatrix(new Mat4(), e.worldMatrix.e, camera.worldMatrix.e, fixed).e, e.worldMatrix.e, 1e-12, 'fixed');

  const cam = camera.worldMatrix.e;
  const up = (mode) =>
  {
    const m = spriteMatrix(new Mat4(), new Mat4().e, cam, { ...newSprite(), mode }).e;
    return { x: [m[0], m[1], m[2]], y: [m[4], m[5], m[6]], z: [m[8], m[9], m[10]] };
  };
  // Upright (3): faces along the camera's view, its up square to it and
  // as close to the entity's up as that allows.
  const u3 = up(SPRITE_UPRIGHT);
  const f = new Vec3(cam[8], cam[9], cam[10]).normalize();
  nearAll(u3.z, [f.x, f.y, f.z], 1e-12, 'upright faces the view');
  near(u3.x[1], 0, 1e-12, 'upright: its side stays level');
  // Upright 2 (4): only the camera's yaw, so it stands straight up.
  const u4 = up(SPRITE_UPRIGHT2);
  nearAll(u4.y, [0, 1, 0], 1e-12, 'upright 2 stands up');
  const h = Math.hypot(f.x, f.z);
  nearAll(u4.z, [f.x / h, 0, f.z / h], 1e-12, 'upright 2 faces the camera\'s way, level');
});

test('RotateSprite, ScaleSprite and HandleSprite', () =>
{
  const id = new Mat4().e;
  const s = { ...newSprite(), mode: SPRITE_FIXED, angle: 90, scaleX: 2, scaleY: 3, handleX: 1, handleY: -1 };
  const m = spriteMatrix(new Mat4(), id, id, s).e;
  // A quarter turn anticlockwise: its X axis points up.
  nearAll([m[0], m[1], m[2]], [0, 2, 0], 1e-12, 'x axis');
  nearAll([m[4], m[5], m[6]], [-3, 0, 0], 1e-12, 'y axis');
  // The handle (1, -1) is the bottom-right corner: that corner sits at the
  // entity's position.
  const corner = new Vec3(1, -1, 0).applyMat4(new Mat4().fromArray(Array.from(m)));
  nearAll([corner.x, corner.y, corner.z], [0, 0, 0], 1e-12, 'handle');
});

export default unit;
