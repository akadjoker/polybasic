// Screen <-> world for a camera entity, with the same projection the
// render backend draws with: a vertical field of view, the aspect of the
// camera's viewport, and the viewport counted in screen pixels from the
// top-left (the whole screen when none is set). Cameras look along +Z.

import { Vec3 } from '../math/vec3.js';

const DEG = Math.PI / 180;

function viewportOf(camera, width, height)
{
  return camera.camera.viewport || [0, 0, width, height];
}

// The ray through screen pixel (x, y): origin at the camera, direction a
// unit vector in the world.
export function screenRay(camera, x, y, width, height)
{
  const [vx, vy, vw, vh] = viewportOf(camera, width, height);
  const tan = Math.tan(camera.camera.fov * DEG / 2);
  const ndcX = ((x - vx) / vw) * 2 - 1;
  const ndcY = 1 - ((y - vy) / vh) * 2;
  const dir = new Vec3(ndcX * tan * (vw / vh), ndcY * tan, 1);
  dir.applyMat4Direction(camera.worldMatrix).normalize();
  return { origin: camera.worldPosition(), direction: dir };
}

// Where a world point lands on the screen: { x, y } in pixels and `depth`,
// the distance in front of the camera along its forward axis. `inFront` is
// false for points behind the camera (x and y are then meaningless).
export function projectPoint(camera, point, width, height)
{
  const inv = camera.worldMatrix.clone();
  if (!inv.invert()) return { x: 0, y: 0, depth: 0, inFront: false };
  const p = point.clone().applyMat4(inv);
  const [vx, vy, vw, vh] = viewportOf(camera, width, height);
  if (p.z <= 0) return { x: 0, y: 0, depth: p.z, inFront: false };
  const tan = Math.tan(camera.camera.fov * DEG / 2);
  const ndcX = p.x / (p.z * tan * (vw / vh));
  const ndcY = p.y / (p.z * tan);
  return {
    x: vx + (ndcX + 1) / 2 * vw,
    y: vy + (1 - ndcY) / 2 * vh,
    depth: p.z,
    inFront: true
  };
}
