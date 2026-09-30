// Sprites: a square that turns to face the camera, as in Blitz3D. The
// entity keeps its place in the world; how the square is turned depends on
// the camera looking at it, so it is worked out for every camera
// (spriteMatrix) and the backend only applies the result.
//
// View modes (Blitz3D's):
//   1  faces the camera: turned as the camera is (the default)
//   2  fixed: turned as the entity is, seen only from the front
//   3  upright: faces along the camera's view, keeping the entity's up
//   4  upright, turned only by the camera's yaw: trees, posts

import { MeshData } from './mesh.js';

export const SPRITE_FREE = 1;
export const SPRITE_FIXED = 2;
export const SPRITE_UPRIGHT = 3;
export const SPRITE_UPRIGHT2 = 4;

// A sprite's own settings (RotateSprite, ScaleSprite, HandleSprite,
// SpriteViewMode).
export function newSprite()
{
  return { mode: SPRITE_FREE, angle: 0, scaleX: 1, scaleY: 1, handleX: 0, handleY: 0 };
}

// The square, -1..1 in X and Y, facing -Z (towards a camera looking along
// +Z), texture top-left at the top-left corner.
export function createSpriteQuad()
{
  return new MeshData(
    [-1, 1, 0, 1, 1, 0, 1, -1, 0, -1, -1, 0],
    [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 1, 2, 0, 2, 3]
  );
}

function normalize(v)
{
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b)
{
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// The world matrix to draw a sprite with for a camera: `out` is a Mat4,
// `entity` and `camera` world matrices (column-major arrays).
export function spriteMatrix(out, entity, camera, sprite)
{
  const col = (m, c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  let bi;
  let bj;
  let bk;
  switch (sprite.mode)
  {
    case SPRITE_FIXED:
      bi = col(entity, 0);
      bj = col(entity, 1);
      bk = col(entity, 2);
      break;
    case SPRITE_UPRIGHT:
    {
      // Blitz3D: the camera's forward axis, then the entity's up made
      // square to it.
      bk = normalize(col(camera, 2));
      bi = normalize(cross(col(entity, 1), bk));
      bj = cross(bk, bi);
      break;
    }
    case SPRITE_UPRIGHT2:
    {
      // The entity's own turn, then the camera's yaw on top.
      const f = col(camera, 2);
      const h = Math.hypot(f[0], f[2]);
      const z = h > 1e-9 ? [f[0] / h, 0, f[2] / h] : [0, 0, 1];
      const x = [z[2], 0, -z[0]];
      const turn = (v) => [x[0] * v[0] + z[0] * v[2], v[1], x[2] * v[0] + z[2] * v[2]];
      bi = turn(col(entity, 0));
      bj = turn(col(entity, 1));
      bk = turn(col(entity, 2));
      break;
    }
    default:
      bi = normalize(col(camera, 0));
      bj = normalize(col(camera, 1));
      bk = normalize(col(camera, 2));
  }
  // RotateSprite turns it in its own plane (positive: anticlockwise, as a
  // roll), ScaleSprite stretches it, HandleSprite moves the point it hangs
  // from (-1..1 across the square).
  const a = sprite.angle * Math.PI / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = [0, 1, 2].map((n) => (c * bi[n] + s * bj[n]) * sprite.scaleX);
  const y = [0, 1, 2].map((n) => (-s * bi[n] + c * bj[n]) * sprite.scaleY);
  const e = out.e;
  for (let n = 0; n < 3; n++)
  {
    e[n] = x[n];
    e[4 + n] = y[n];
    e[8 + n] = bk[n];
    e[12 + n] = entity[12 + n] - sprite.handleX * x[n] - sprite.handleY * y[n];
  }
  e[3] = 0;
  e[7] = 0;
  e[11] = 0;
  e[15] = 1;
  return out;
}
