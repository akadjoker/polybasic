// Skinned model parts (see model/model.js, bindSkins).

import { Mat4 } from '../math/mat4.js';

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
