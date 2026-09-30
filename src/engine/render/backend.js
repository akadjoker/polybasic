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
//     lights:  [{ id, world, type, color, range }],  type 1 directional, 2 point
//     items:   [{ id, world, mesh, material }],       mesh: MeshData, material: Material
//     freedEntities: [id],  freedTextures: [Texture] }
//
// `world` is a column-major 4x4 matrix (Float64Array) in PolyBasic space:
// left-handed, X right, Y up, Z forward; cameras look along their +Z.
// Colours are 0..1. Meshes, materials and textures carry `id` and
// `version`: re-upload when the version changes. Triangles are clockwise
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
