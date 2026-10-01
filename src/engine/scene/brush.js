// The entity brush of a model, as Blitz3D combines it with each surface's
// own brush (brush.cpp, Brush(a, b)): colours and alpha multiply,
// shininess adds, FX flags add up, and a blend or texture set on the
// entity replaces the surface's. Model parts keep the file's materials in
// `surfaces` and draw with `materials`, the two combined.

import { Material } from './material.js';

export function newBrush()
{
  const b = new Material();
  b.blend = null;
  return b;
}

export function combine(out, surface, brush)
{
  out.color = surface.color.map((c, i) => c * brush.color[i]);
  const own = surface.alphaMode === 'opaque' ? 1 : surface.alpha;
  out.alpha = own * brush.alpha;
  out.alphaMode = surface.alphaMode === 'opaque' && out.alpha < 1 ? 'blend' : surface.alphaMode;
  out.alphaCutoff = surface.alphaCutoff;
  out.shininess = Math.min(1, surface.shininess + brush.shininess);
  out.blend = brush.blend || surface.blend;
  out.fullbright = surface.fullbright || brush.fullbright;
  out.flat = surface.flat || brush.flat;
  out.twoSided = surface.twoSided || brush.twoSided;
  out.vertexColors = surface.vertexColors || brush.vertexColors;
  out.vertexAlpha = surface.vertexAlpha || brush.vertexAlpha;
  out.texture = brush.texture || surface.texture;
  out.decal = surface.decal;
  out.name = surface.name;
  out.changed();
}

// Every part of the model below `root` drawn with root's brush.
export function paintModel(root)
{
  const brush = root.brush;
  if (!brush || !root.model || !root.model.loaded) return;
  for (const part of root.model.nodes)
  {
    if (!part || !part.surfaces) continue;
    part.surfaces.forEach((s, i) => combine(part.materials[i], s, brush));
    part.castShadow = root.castShadow;
    part.receiveShadow = root.receiveShadow;
  }
}
