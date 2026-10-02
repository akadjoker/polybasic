// Skinned model parts (see model/model.js, bindSkins).

import { Mat4 } from '../math/mat4.js';
import { Vec3 } from '../math/vec3.js';
import { Aabb } from '../math/aabb.js';
import { MeshData } from './mesh.js';

// The matrices that move a skinned part's vertices, in the part's own
// space: (the part's world)^-1 * (a joint's world) * (its inverse bind).
// Worked out once a frame, from where the joints are.
const partInverse = new Mat4();
const jointMatrix = new Mat4();
const bind = new Mat4();
export function skinPalette(e)
{
  const { joints, inverseBind, palette } = e.skin;
  partInverse.copy(e.worldMatrix);
  partInverse.invert();
  for (let j = 0; j < joints.length; j++)
  {
    const joint = joints[j];
    if (!joint || !joint.alive)
    {
      palette.fill(0, j * 16, j * 16 + 16);
      for (const k of [0, 5, 10, 15]) palette[j * 16 + k] = 1;
      continue;
    }
    for (let k = 0; k < 16; k++) bind.e[k] = inverseBind[j * 16 + k];
    jointMatrix.multiplyMatrices(joint.worldMatrix, bind).premultiply(partInverse);
    palette.set(jointMatrix.e, j * 16);
  }
  return palette;
}

// The mesh that picks, collisions and bounds see for an entity: its own, or
// for a skinned part the mesh bent into the pose it is in now (in the part's
// space, like the rest shape, so the part's world matrix applies as before).
// The bending is only redone when the palette has changed since the last
// look, and the mesh's `pose` count then moves on so triangle trees follow.
export function shapeMesh(e)
{
  const skin = e.skin;
  if (!skin) return e.mesh;
  const source = e.mesh;
  const palette = skinPalette(e);
  let posed = skin.posed;
  if (!posed || posed.sourceVersion !== source.version)
  {
    posed = new MeshData([], [], [], []);
    posed.positions = new Float32Array(source.positions.length);
    posed.normals = source.normals;
    posed.uvs = source.uvs;
    posed.indices = source.indices;
    posed.submeshes = source.submeshes;
    posed.pose = 0;
    posed.sourceVersion = source.version;
    posed.palette = null;
    skin.posed = posed;
  }
  if (posed.palette && sameNumbers(posed.palette, palette)) return posed;
  posed.palette = Float32Array.from(palette);
  const from = source.positions;
  const to = posed.positions;
  const { joints, weights } = source;
  const bounds = new Aabb();
  const p = new Vec3();
  for (let v = 0; v < from.length / 3; v++)
  {
    const x = from[v * 3];
    const y = from[v * 3 + 1];
    const z = from[v * 3 + 2];
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let k = 0; k < 4; k++)
    {
      const w = weights[v * 4 + k];
      if (!w) continue;
      const m = joints[v * 4 + k] * 16;
      ox += w * (palette[m] * x + palette[m + 4] * y + palette[m + 8] * z + palette[m + 12]);
      oy += w * (palette[m + 1] * x + palette[m + 5] * y + palette[m + 9] * z + palette[m + 13]);
      oz += w * (palette[m + 2] * x + palette[m + 6] * y + palette[m + 10] * z + palette[m + 14]);
    }
    to[v * 3] = ox;
    to[v * 3 + 1] = oy;
    to[v * 3 + 2] = oz;
    bounds.expandByPoint(p.set(ox, oy, oz));
  }
  posed.bounds = bounds;
  posed.pose++;
  return posed;
}

function sameNumbers(a, b)
{
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
