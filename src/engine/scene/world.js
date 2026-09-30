// The world owns every entity and texture, hands out the Int handles that
// PolyBasic programs use, and builds the per-frame description the render
// backend draws.

import { Entity } from './entity.js';
import { Material } from './material.js';
import { Texture } from './texture.js';
import { EditableMesh } from './editable.js';

export class World
{
  constructor()
  {
    // Entities and textures share one handle space so a texture handle
    // passed where an entity is expected is reported clearly.
    this.handles = new Map();
    this.nextHandle = 1;
    this.ambient = [64 / 255, 64 / 255, 64 / 255];
    this.clearColor = [0, 0, 0];
    this.freedMeshes = [];
    this.freedTextures = [];
    this.freedEntities = [];
  }

  createEntity(kind, parent = null)
  {
    const e = new Entity(this.nextHandle++, kind);
    this.handles.set(e.id, e);
    if (kind === 'mesh') e.material = new Material();
    if (kind === 'camera')
    {
      e.camera = { fov: 60, near: 0.1, far: 1000, clearColor: [0, 0, 0], viewport: null };
    }
    // shadows: 0 casts none; otherwise, for a directional light, the size of
    // the square around the camera its shadows cover.
    if (kind === 'light') e.light = { type: 1, color: [1, 1, 1], range: 10, shadows: 0 };
    if (parent) e.setParent(parent, false);
    return e;
  }

  createMesh(mesh, parent = null)
  {
    const e = this.createEntity('mesh', parent);
    e.mesh = mesh;
    return e;
  }

  createTexture(width, height)
  {
    const t = new Texture(width, height);
    t.handle = this.nextHandle++;
    this.handles.set(t.handle, t);
    return t;
  }

  // Gives any other object kept by the engine (a sound, a song) a handle
  // in the same space, so mixing handles up is reported clearly.
  addHandle(object)
  {
    object.handle = this.nextHandle++;
    this.handles.set(object.handle, object);
    return object.handle;
  }

  removeHandle(object)
  {
    this.handles.delete(object.handle);
  }

  // Frees an entity and all its children.
  freeEntity(e)
  {
    for (const c of [...e.children]) this.freeEntity(c);
    if (e.parent) e.parent.children.splice(e.parent.children.indexOf(e), 1);
    e.parent = null;
    e.alive = false;
    this.handles.delete(e.id);
    this.freedEntities.push(e.id);
    // A built mesh no other entity uses: its surfaces go too.
    if (e.mesh instanceof EditableMesh && !this.entities.some((o) => o.mesh === e.mesh))
    {
      for (const s of e.mesh.surfaces) this.handles.delete(s.handle);
    }
  }

  freeTexture(t)
  {
    this.handles.delete(t.handle);
    this.freedTextures.push(t);
  }

  // A deep copy: children are copied too, mesh data is shared, and the
  // material is cloned so recolouring the copy leaves the original alone.
  copyEntity(src, parent)
  {
    const e = this.createEntity(src.kind, null);
    e.name = src.name;
    e.position.copy(src.position);
    e.rotation.copy(src.rotation);
    e.scale.copy(src.scale);
    e.visible = src.visible;
    e.order = src.order;
    e.castShadow = src.castShadow;
    e.receiveShadow = src.receiveShadow;
    e.mesh = src.mesh;
    e.materials = src.materials.map((m) => m.clone());
    e.surfaces = src.surfaces;
    e.brush = src.brush ? src.brush.clone() : null;
    e.camera = src.camera ? { ...src.camera, clearColor: [...src.camera.clearColor] } : null;
    e.light = src.light ? { ...src.light, color: [...src.light.color] } : null;
    e.sprite = src.sprite ? { ...src.sprite } : null;
    e.decal = src.decal;
    e.grass = src.grass;    // a copy of a field shares its tufts, as meshes are shared
    e.pickMode = src.pickMode;
    e.obscurer = src.obscurer;
    e.collisionType = src.collisionType;
    e.collisionFrom = null;
    e.radiusX = src.radiusX;
    e.radiusY = src.radiusY;
    e.box = src.box ? [...src.box] : null;
    if (parent) e.setParent(parent, false);
    for (const c of src.children) this.copyEntity(c, e);
    return e;
  }

  get entities()
  {
    return [...this.handles.values()].filter((h) => h instanceof Entity);
  }

  // A field of grass for the frame: its tufts, and where what pushes it is
  // now (world x, y, z and radius, four numbers each).
  grassItem(e, world)
  {
    const g = e.grass;
    const pushers = [];
    g.pushers = g.pushers.filter((p) => p.entity.alive);
    for (const p of g.pushers)
    {
      const w = p.entity.worldMatrix.e;
      pushers.push(w[12], w[13], w[14], p.radius);
    }
    return {
      id: e.id, order: e.order, world, mesh: g.mesh, materials: e.materials, castShadow: e.castShadow, receiveShadow: e.receiveShadow, sprite: null,
      grass: { tufts: g.tufts, count: g.count, version: g.version, height: g.height, width: g.width, wind: g.wind, pushers }
    };
  }

  // Everything the backend needs to draw one frame. World matrices are
  // brought up to date here, once per frame.
  buildFrame(width, height)
  {
    const cameras = [];
    const lights = [];
    const items = [];
    const mirrors = [];
    for (const e of this.handles.values())
    {
      if (!(e instanceof Entity) || !e.shown) continue;
      const world = e.worldMatrix.e;
      if (e.kind === 'camera') cameras.push({ id: e.id, order: e.order, world, ...e.camera });
      else if (e.kind === 'light') lights.push({ id: e.id, world, ...e.light });
      else if (e.kind === 'mirror') mirrors.push({ id: e.id, world });
      else if (e.kind === 'grass' && e.grass.count) items.push(this.grassItem(e, world));
      else if (e.kind === 'mesh' && e.mesh && e.mesh.indices.length) items.push({ id: e.id, order: e.order, world, mesh: e.mesh, materials: e.materials, castShadow: e.castShadow, receiveShadow: e.receiveShadow, sprite: e.sprite });
    }
    cameras.sort((a, b) => a.order - b.order || a.id - b.id);
    items.sort((a, b) => a.order - b.order || a.id - b.id);
    const frame = {
      width,
      height,
      clearColor: this.clearColor,
      ambient: this.ambient,
      cameras,
      lights,
      items,
      mirrors,
      freedEntities: this.freedEntities,
      freedTextures: this.freedTextures
    };
    this.freedEntities = [];
    this.freedTextures = [];
    return frame;
  }
}
