// The render backend interface. A backend only draws: it receives a
// complete description of the frame (built by World.buildFrame) and keeps
// whatever GPU objects it needs, keyed by our ids. Nothing else in the
// engine knows which backend is in use, so replacing three.js with another
// renderer means writing one new class with these methods.
//
//   init(surface)        take the drawing surface (a canvas, or nothing);
//                        called once by the platform code
//   reset()              forget every object: a new program starts
//   resize(w, h, ratio)  logical size in pixels and the device pixel ratio
//   render(frame)        draw one frame (see below)
//   dispose()            release everything
//
// A frame is:
//   { width, height,
//     clearColor: [r, g, b],             used when there is no camera
//     ambient: [r, g, b],
//     cameras: [{ id, world, fov, near, far, clearColor, viewport }],
//     lights:  [{ id, world, type, color, range, shadows }],  type 1 directional, 2 point;
//              shadows 0: none, otherwise the width of the square around the
//              camera a directional light's shadows cover
//     items:   [{ id, world, mesh, materials, castShadow, receiveShadow, sprite }],
//              mesh: MeshData, materials: [Material]; sprite: null, or a
//              sprite's settings: draw it with scene/sprite.js's
//              spriteMatrix(world, camera world) for each camera;
//              grass: absent, or a field of tufts (scene/grass.js): `mesh`
//              drawn once per tuft, { tufts, count, version, height, width,
//              wind, pushers } (tufts: x, y, z, size, turn in the entity's
//              space; pushers: world x, y, z, radius)
//     time: seconds of simulated time
//              (submesh s of the mesh uses materials[s.material])
//     freedEntities: [id],  freedTextures: [Texture] }
//
// `world` is a column-major 4x4 matrix (Float64Array) in PolyBasic space:
// left-handed, X right, Y up, Z forward; cameras look along their +Z.
// Colours are 0..1. Meshes, materials and textures carry `id` and
// `version`: re-upload when the version changes. A mesh with a `pose`
// count (MD2 models) changes only its positions and normals when the pose
// changes, and `bounds` covers every pose. Triangles are clockwise
// when seen from the front; texture UV (0, 0) is the top-left pixel.

export class RenderBackend
{
  init(surface)
  {
  }

  reset()
  {
  }

  resize(width, height, pixelRatio = 1)
  {
  }

  render(frame)
  {
  }

  dispose()
  {
  }
}
