// The 3D, 2D and input commands of PolyBasic.
//
// ENGINE_COMMANDS are the signatures the compiler checks calls against (same
// format as the core commands in src/compiler/builtins.js), ENGINE_CONSTANTS
// the named values (KEY_LEFT, LIGHT_POINT, ...), and createEngineCommands
// builds the implementations for one engine.
//
// Entities and textures are Int handles: small positive numbers handed out
// by the world. 0 means "none" (e.g. no parent). Using a freed handle is a
// runtime error with a clear message, never a crash.

import { Entity } from './scene/entity.js';
import { byte, unit, tidy, handleHelpers } from './handles.js';
import {
  createCube, createSphere, createCylinder, createCone, createPlane, createTorus
} from './scene/mesh.js';
import { KEYS } from './input/input.js';
import { createSpriteQuad, newSprite, SPRITE_FREE, SPRITE_UPRIGHT2 } from './scene/sprite.js';
import { Trail, MAX_BLADE } from './scene/trail.js';
import { buildTree, TREE_KINDS, TREE_OAK, TREE_WILLOW, TREE_SHRUB, TREE_ASH, TREE_POPLAR, TREE_SEQUOIA, TREE_BEECH } from './scene/tree.js';
import { barkPixels, leafPixels } from './scene/tree-textures.js';
import { TEX_COLOR, TEX_ALPHA, TEX_MASKED, TEX_MIPMAP, TEX_CLAMPU, TEX_CLAMPV, TEX_SPHEREMAP, TEX_CUBEMAP } from './scene/texture.js';
import { COLLIDE_COMMANDS, COLLIDE_CONSTANTS, createCollideCommands } from './collide/commands.js';
import { PHYSICS_COMMANDS, PHYSICS_CONSTANTS, createPhysicsCommands } from './physics/commands.js';
import { MODEL_COMMANDS, MODEL_CONSTANTS, createModelCommands } from './model/commands.js';
import { AUDIO_COMMANDS, AUDIO_CONSTANTS, createAudioCommands } from './audio/commands.js';
import { MESH_COMMANDS, MESH_CONSTANTS, createMeshCommands } from './scene/mesh-commands.js';
import { runtimeError } from '../runtime/errors.js';

export const ENGINE_COMMANDS = [
  // Screen
  'Graphics3D(width, height)',
  'GraphicsWidth%()',
  'GraphicsHeight%()',
  'ClsColor(r, g, b)',
  'FPS%()',

  // Cameras and lights
  'CreateCamera%(parent = 0)',
  'CameraClsColor(camera, r, g, b)',
  'CameraRange(camera, near#, far#)',
  'CameraFOV(camera, degrees#)',
  'CameraViewport(camera, x, y, width, height)',
  'CreateLight%(kind = 1, parent = 0)',
  'LightColor(light, r, g, b)',
  'LightRange(light, range#)',
  'LightShadows(light, on = 1, area# = 40)',
  'AmbientLight(r, g, b)',

  // Shapes and pivots
  'CreatePivot%(parent = 0)',
  'CreateCube%(parent = 0)',
  'CreateSphere%(segments = 16, parent = 0)',
  'CreateCylinder%(segments = 16, solid = 1, parent = 0)',
  'CreateCone%(segments = 16, solid = 1, parent = 0)',
  'CreatePlane%(divisions = 1, parent = 0)',
  'CreateTorus%(segments = 24, thickness# = 0.25, parent = 0)',

  // Trees
  'CreateTree%(kind = 1, seed = 0, parent = 0)',

  // Ribbon trails
  'CreateTrail%(first, second)',
  'TrailPoint(trail, entity)',
  'TrailLife(trail, seconds#)',
  'TrailStep(trail, distance#)',
  'TrailSmooth(trail, pieces)',
  'TrailColor(trail, r, g, b, alpha# = 1)',
  'TrailFadeColor(trail, r, g, b, alpha# = 0)',
  'TrailEmit(trail, on)',
  'ClearTrail(trail)',

  // Sprites
  'CreateSprite%(parent = 0)',
  'LoadSprite%(file$, flags = 1, parent = 0)',
  'RotateSprite(sprite, angle#)',
  'ScaleSprite(sprite, x#, y#)',
  'HandleSprite(sprite, x#, y#)',
  'SpriteViewMode(sprite, mode)',

  // Looks
  'EntityColor(entity, r, g, b)',
  'EntityAlpha(entity, alpha#)',
  'EntityShininess(entity, shininess#)',
  'EntityFX(entity, flags)',
  'EntityTexture(entity, texture)',
  'EntityOrder(entity, order)',
  'EntityBlend(entity, blend)',

  // Textures
  'LoadTexture%(file$, flags = 1)',
  'CreateTexture%(width, height, r = 255, g = 255, b = 255, flags = 1)',
  'CreateCheckerTexture%(size, cells, r1, g1, b1, r2 = 255, g2 = 255, b2 = 255)',
  'TexturePixel(texture, x, y, r, g, b, a = 255)',
  'ScaleTexture(texture, u#, v#)',
  'TextureLoaded%(texture)',
  'FreeTexture(texture)',

  // Moving and turning
  'PositionEntity(entity, x#, y#, z#, isGlobal = 0)',
  'MoveEntity(entity, x#, y#, z#)',
  'TranslateEntity(entity, x#, y#, z#, isGlobal = 0)',
  'RotateEntity(entity, pitch#, yaw#, roll#, isGlobal = 0)',
  'TurnEntity(entity, pitch#, yaw#, roll#, isGlobal = 0)',
  'PointEntity(entity, target, roll# = 0)',
  'ScaleEntity(entity, x#, y#, z#)',
  'EntityX#(entity, isGlobal = 0)',
  'EntityY#(entity, isGlobal = 0)',
  'EntityZ#(entity, isGlobal = 0)',
  'EntityPitch#(entity, isGlobal = 0)',
  'EntityYaw#(entity, isGlobal = 0)',
  'EntityRoll#(entity, isGlobal = 0)',
  'EntityDistance#(entity, other)',

  // Hierarchy and lifetime
  'EntityParent(entity, parent, isGlobal = 1)',
  'GetParent%(entity)',
  'CountChildren%(entity)',
  'GetChild%(entity, index)',
  'HideEntity(entity)',
  'ShowEntity(entity)',
  'EntityHidden%(entity)',
  'FreeEntity(entity)',
  'CopyEntity%(entity, parent = 0)',
  'EntityExists%(entity)',
  'NameEntity(entity, name$)',
  'EntityName$(entity)',

  // Input
  'KeyDown%(key)',
  'KeyHit%(key)',
  'KeyUp%(key)',
  'MouseX%()',
  'MouseY%()',
  'MouseDown%(button = 1)',
  'MouseHit%(button = 1)',
  'MouseXSpeed%()',
  'MouseYSpeed%()',
  'MouseWheel%()',
  'LockPointer(on = 1)',

  // 2D drawing on top of the 3D picture (in Draw)
  'Color(r, g, b)',
  'FontSize(size)',
  'Text(x, y, text$, centerX = 0, centerY = 0)',
  'TextWidth%(text$)',
  'Rect(x, y, width, height, solid = 1)',
  'Oval(x, y, width, height, solid = 1)',
  'Line(x1, y1, x2, y2)',
  'Plot(x, y)',

  ...COLLIDE_COMMANDS,
  ...PHYSICS_COMMANDS,
  ...MODEL_COMMANDS,
  ...MESH_COMMANDS,
  ...AUDIO_COMMANDS
];

export const ENGINE_CONSTANTS = {
  ...KEYS,
  MOUSE_LEFT: 1,
  MOUSE_RIGHT: 2,
  MOUSE_MIDDLE: 3,
  LIGHT_DIRECTIONAL: 1,
  LIGHT_POINT: 2,
  FX_FULLBRIGHT: 1,
  FX_FLAT: 4,
  FX_TWOSIDED: 16,
  FX_NOSHADOWCAST: 0x20000,
  FX_NOSHADOWRECV: 0x40000,
  TREE_OAK,
  TREE_WILLOW,
  TREE_SHRUB,
  TREE_ASH,
  TREE_POPLAR,
  TREE_SEQUOIA,
  TREE_BEECH,
  TEX_COLOR,
  TEX_ALPHA,
  TEX_MASKED,
  TEX_MIPMAP,
  TEX_CLAMPU,
  TEX_CLAMPV,
  ...COLLIDE_CONSTANTS,
  ...PHYSICS_CONSTANTS,
  ...MODEL_CONSTANTS,
  ...MESH_CONSTANTS,
  ...AUDIO_CONSTANTS
};


// Blitz3D texture flags a program may pass: colour, alpha, masked,
// mipmapped, clamped; 256 and 512 (video memory, high colour) mean nothing
// here and are ignored. Sphere and cube maps are not supported.
function textureFlags(flags, command)
{
  if (flags & (TEX_SPHEREMAP | TEX_CUBEMAP)) throw runtimeError(`${command}: sphere and cube maps (flags 64 and 128) are not supported`);
  return flags;
}

export function createEngineCommands(engine)
{
  const world = engine.world;

  const { entity, parentOf, texture, ofKind } = handleHelpers(world);
  const material = (handle) =>
  {
    const e = entity(handle);
    if (!e.material) throw runtimeError(`Entity ${handle} is a ${e.kind}, which has no surface to colour`);
    return e.material;
  };
  const shape = (mesh, parent) =>
  {
    engine.autoGraphics();
    return world.createMesh(mesh, parentOf(parent)).id;
  };
  // A sprite: the shared square, lit by nothing and casting no shadow, as
  // in Blitz3D. A loaded one glows (adds to what is behind) unless its
  // texture is alpha or masked.
  const makeSprite = (parent, tex) =>
  {
    engine.autoGraphics();
    const e = world.createMesh(engine.sharedMesh('sprite', createSpriteQuad), parentOf(parent));
    e.sprite = newSprite();
    e.castShadow = false;
    e.receiveShadow = false;
    const m = e.material;
    m.fullbright = true;
    if (tex)
    {
      m.texture = tex;
      if (!tex.alpha && !tex.masked) m.blend = 'add';
    }
    m.changed();
    return e.id;
  };
  const sprite = (handle) =>
  {
    const e = entity(handle);
    if (!e.sprite) throw runtimeError(`Entity ${handle} is not a sprite (CreateSprite and LoadSprite make sprites)`);
    return e.sprite;
  };
  // The drawn bark and leaves trees wear, made once per engine (again if a
  // program frees one).
  const treeTextures = new Map();
  const treeTexture = (key, width, height, pixels, flags) =>
  {
    let t = treeTextures.get(key);
    if (!t || !world.handles.has(t.handle))
    {
      t = world.createTexture(width, height);
      t.pixels.set(pixels());
      t.nearest = false;
      t.setFlags(flags);
      treeTextures.set(key, t);
    }
    return t;
  };
  const trail = (handle) =>
  {
    const e = entity(handle);
    if (!e.trail) throw runtimeError(`Entity ${handle} is not a trail (CreateTrail makes trails)`);
    return e.trail;
  };
  const style = engine.style;
  const step = () => engine.input.step;

  return {
    ...createCollideCommands(engine),
    ...createPhysicsCommands(engine),
    ...createModelCommands(engine),
    ...createAudioCommands(engine),
    ...createMeshCommands(engine),

    // ---------------------------------------------------------- screen
    graphics3d(width, height)
    {
      if (width < 1 || height < 1) throw runtimeError(`Graphics3D needs a positive size, not ${width} x ${height}`);
      engine.setGraphics(width, height);
    },
    graphicswidth: () => engine.width,
    graphicsheight: () => engine.height,
    clscolor(r, g, b)
    {
      world.clearColor = [unit(r), unit(g), unit(b)];
    },
    fps: () => engine.fps,

    // ------------------------------------------------- cameras, lights
    createcamera(parent)
    {
      engine.autoGraphics();
      return world.createEntity('camera', parentOf(parent)).id;
    },
    cameraclscolor(camera, r, g, b)
    {
      ofKind(camera, 'camera', 'camera').camera.clearColor = [unit(r), unit(g), unit(b)];
    },
    camerarange(camera, near, far)
    {
      if (!(near > 0 && far > near)) throw runtimeError(`CameraRange needs 0 < near < far, not ${near} and ${far}`);
      const c = ofKind(camera, 'camera', 'camera').camera;
      c.near = near;
      c.far = far;
    },
    camerafov(camera, degrees)
    {
      ofKind(camera, 'camera', 'camera').camera.fov = Math.max(1, Math.min(179, degrees));
    },
    cameraviewport(camera, x, y, width, height)
    {
      ofKind(camera, 'camera', 'camera').camera.viewport = [x, y, Math.max(1, width), Math.max(1, height)];
    },
    createlight(kind, parent)
    {
      if (kind !== 1 && kind !== 2) throw runtimeError(`CreateLight kind must be LIGHT_DIRECTIONAL (1) or LIGHT_POINT (2), not ${kind}`);
      const e = world.createEntity('light', parentOf(parent));
      e.light.type = kind;
      return e.id;
    },
    lightcolor(light, r, g, b)
    {
      ofKind(light, 'light', 'light').light.color = [unit(r), unit(g), unit(b)];
    },
    lightrange(light, range)
    {
      ofKind(light, 'light', 'light').light.range = Math.max(0, range);
    },
    lightshadows(light, on, area)
    {
      if (on && !(area > 0)) throw runtimeError(`LightShadows needs an area above 0, not ${area}`);
      ofKind(light, 'light', 'light').light.shadows = on ? area : 0;
    },
    ambientlight(r, g, b)
    {
      world.ambient = [unit(r), unit(g), unit(b)];
    },

    // ---------------------------------------------------------- shapes
    createpivot(parent)
    {
      return world.createEntity('pivot', parentOf(parent)).id;
    },
    createcube: (parent) => shape(engine.sharedMesh('cube', () => createCube()), parent),
    createsphere: (segments, parent) =>
      shape(engine.sharedMesh('sphere' + segments, () => primitive(createSphere(clampSegments(segments)), 'sphere')), parent),
    createcylinder: (segments, solid, parent) =>
      shape(engine.sharedMesh(`cylinder${segments}.${solid}`, () => primitive(createCylinder(clampSegments(segments), solid !== 0), 'cylinder')), parent),
    createcone: (segments, solid, parent) =>
      shape(engine.sharedMesh(`cone${segments}.${solid}`, () => createCone(clampSegments(segments), solid !== 0)), parent),
    createplane: (divisions, parent) =>
      shape(engine.sharedMesh('plane' + divisions, () => createPlane(Math.max(1, Math.min(256, divisions)))), parent),
    createtree(kind, seed, parent)
    {
      if (!TREE_KINDS[kind]) throw runtimeError(`CreateTree needs one of the TREE_ kinds (${TREE_OAK} to ${TREE_BEECH}), not ${kind}`);
      engine.autoGraphics();
      const { bark, twigs, leaves } = buildTree(kind, seed);
      const e = world.createMesh(bark, parentOf(parent));
      e.name = 'tree';
      e.material.texture = treeTexture('bark', 64, 128, () => barkPixels(), TEX_COLOR);
      e.material.changed();
      const t = world.createMesh(twigs, e);
      t.name = 'twigs';
      t.material.texture = treeTexture(`leaves${leaves}`, 128, 128, () => leafPixels(leaves), TEX_MASKED);
      t.material.changed();
      return e.id;
    },
    createtrail(first, second)
    {
      const blade = [entity(first), entity(second)];
      if (blade[0] === blade[1]) throw runtimeError('CreateTrail needs two different entities for the ends of its blade');
      engine.autoGraphics();
      const e = world.createEntity('mesh');
      const t = new Trail(e, blade);
      e.mesh = t.mesh;
      e.trail = t;
      e.castShadow = false;
      e.receiveShadow = false;
      const m = e.material;
      m.fullbright = true;
      m.twoSided = true;
      m.vertexColors = true;
      m.vertexAlpha = true;
      m.blend = 'add';
      m.changed();
      engine.trails.push(t);
      return e.id;
    },
    trailpoint(handle, point)
    {
      const t = trail(handle);
      const e = entity(point);
      if (t.blade.includes(e)) throw runtimeError(`Entity ${point} is already on trail ${handle}'s blade`);
      if (t.blade.length >= MAX_BLADE) throw runtimeError(`A trail's blade has at most ${MAX_BLADE} points`);
      t.blade.push(e);
      t.clear();
    },
    traillife(handle, seconds)
    {
      trail(handle).life = Math.max(0.01, seconds);
    },
    trailstep(handle, distance)
    {
      trail(handle).step = Math.max(0.001, distance);
    },
    trailsmooth(handle, pieces)
    {
      trail(handle).smooth = Math.max(1, Math.min(64, pieces));
    },
    trailcolor(handle, r, g, b, alpha)
    {
      const t = trail(handle);
      const end = t.end;
      t.setColors(r, g, b, alpha, r, g, b, 0);
      if (t.fadeSet) t.end = end;
    },
    trailfadecolor(handle, r, g, b, alpha)
    {
      const t = trail(handle);
      const start = t.start;
      t.setColors(0, 0, 0, 0, r, g, b, alpha);
      t.start = start;
      t.fadeSet = true;
    },
    trailemit(handle, on)
    {
      trail(handle).setEmitting(on !== 0);
    },
    cleartrail(handle)
    {
      trail(handle).clear();
    },
    createsprite: (parent) => makeSprite(parent, null),
    loadsprite: (file, flags, parent) => makeSprite(parent, engine.loadTexture(file).setFlags(textureFlags(flags, 'LoadSprite'))),
    rotatesprite(handle, angle)
    {
      sprite(handle).angle = angle;
    },
    scalesprite(handle, x, y)
    {
      const s = sprite(handle);
      s.scaleX = x;
      s.scaleY = y;
    },
    handlesprite(handle, x, y)
    {
      const s = sprite(handle);
      s.handleX = x;
      s.handleY = y;
    },
    spriteviewmode(handle, mode)
    {
      if (mode < SPRITE_FREE || mode > SPRITE_UPRIGHT2) throw runtimeError(`SpriteViewMode needs a mode from 1 to 4, not ${mode}`);
      sprite(handle).mode = mode;
    },
    createtorus: (segments, thickness, parent) =>
      shape(engine.sharedMesh(`torus${segments}.${thickness}`, () => createTorus(clampSegments(segments), Math.max(0.01, Math.min(1, thickness)))), parent),

    // ----------------------------------------------------------- looks
    entitycolor(handle, r, g, b)
    {
      const m = material(handle);
      m.color = [unit(r), unit(g), unit(b)];
      m.changed();
    },
    entityalpha(handle, alpha)
    {
      const m = material(handle);
      m.alpha = Math.max(0, Math.min(1, alpha));
      m.changed();
    },
    entityshininess(handle, shininess)
    {
      const m = material(handle);
      m.shininess = Math.max(0, Math.min(1, shininess));
      m.changed();
    },
    entityfx(handle, flags)
    {
      const m = material(handle);
      m.fullbright = (flags & 1) !== 0;
      m.flat = (flags & 4) !== 0;
      m.twoSided = (flags & 16) !== 0;
      m.vertexColors = (flags & 2) !== 0;
      m.vertexAlpha = (flags & 32) !== 0;
      m.changed();
      const e = entity(handle);
      e.castShadow = (flags & 0x20000) === 0;
      e.receiveShadow = (flags & 0x40000) === 0;
    },
    entitytexture(handle, tex)
    {
      const m = material(handle);
      m.texture = tex === 0 ? null : texture(tex);
      m.changed();
    },
    entityorder(handle, order)
    {
      entity(handle).order = order;
    },
    entityblend(handle, blend)
    {
      const modes = { 1: 'alpha', 2: 'multiply', 3: 'add' };
      if (!modes[blend]) throw runtimeError(`EntityBlend needs 1 (alpha), 2 (multiply) or 3 (add), not ${blend}`);
      const m = material(handle);
      m.blend = modes[blend];
      m.changed();
    },

    // -------------------------------------------------------- textures
    loadtexture(file, flags)
    {
      return engine.loadTexture(file).setFlags(textureFlags(flags, 'LoadTexture')).handle;
    },
    createtexture(width, height, r, g, b, flags)
    {
      if (width < 1 || height < 1 || width > 4096 || height > 4096)
      {
        throw runtimeError(`CreateTexture size must be 1 to 4096, not ${width} x ${height}`);
      }
      return world.createTexture(width, height).fill(byte(r), byte(g), byte(b)).setFlags(textureFlags(flags, 'CreateTexture')).handle;
    },
    createcheckertexture(size, cells, r1, g1, b1, r2, g2, b2)
    {
      if (size < 1 || size > 4096) throw runtimeError(`CreateCheckerTexture size must be 1 to 4096, not ${size}`);
      const t = world.createTexture(size, size);
      t.checker(Math.max(1, cells), [byte(r1), byte(g1), byte(b1)], [byte(r2), byte(g2), byte(b2)]);
      return t.handle;
    },
    texturepixel(tex, x, y, r, g, b, a)
    {
      const t = texture(tex);
      if (!t.pixels) throw runtimeError('TexturePixel only works on textures made with CreateTexture');
      t.setPixel(x, y, byte(r), byte(g), byte(b), byte(a));
    },
    scaletexture(tex, u, v)
    {
      const t = texture(tex);
      t.scaleU = u;
      t.scaleV = v;
    },
    textureloaded: (tex) => (texture(tex).loaded ? 1 : 0),
    freetexture(tex)
    {
      world.freeTexture(texture(tex));
    },

    // -------------------------------------------------------- transforms
    positionentity(handle, x, y, z, isGlobal)
    {
      entity(handle).setPosition(x, y, z, isGlobal !== 0);
    },
    moveentity(handle, x, y, z)
    {
      entity(handle).move(x, y, z);
    },
    translateentity(handle, x, y, z, isGlobal)
    {
      entity(handle).translate(x, y, z, isGlobal !== 0);
    },
    rotateentity(handle, pitch, yaw, roll, isGlobal)
    {
      entity(handle).setRotation(pitch, yaw, roll, isGlobal !== 0);
    },
    turnentity(handle, pitch, yaw, roll, isGlobal)
    {
      entity(handle).turn(pitch, yaw, roll, isGlobal !== 0);
    },
    pointentity(handle, target, roll)
    {
      const e = entity(handle);
      e.pointAt(entity(target).worldPosition(), roll);
    },
    scaleentity(handle, x, y, z)
    {
      entity(handle).setScale(x, y, z);
    },
    entityx: (handle, isGlobal) => tidy(entity(handle).getPosition(isGlobal !== 0).x),
    entityy: (handle, isGlobal) => tidy(entity(handle).getPosition(isGlobal !== 0).y),
    entityz: (handle, isGlobal) => tidy(entity(handle).getPosition(isGlobal !== 0).z),
    entitypitch: (handle, isGlobal) => tidy(entity(handle).getRotation(isGlobal !== 0).pitch),
    entityyaw: (handle, isGlobal) => tidy(entity(handle).getRotation(isGlobal !== 0).yaw),
    entityroll: (handle, isGlobal) => tidy(entity(handle).getRotation(isGlobal !== 0).roll),
    entitydistance(a, b)
    {
      return tidy(entity(a).worldPosition().distanceTo(entity(b).worldPosition()));
    },

    // ---------------------------------------------- hierarchy, lifetime
    entityparent(handle, parent, isGlobal)
    {
      const e = entity(handle);
      const p = parentOf(parent);
      for (let q = p; q; q = q.parent)
      {
        if (q === e) throw runtimeError(`Entity ${handle} cannot be its own parent (or a parent of its parent)`);
      }
      e.setParent(p, isGlobal !== 0);
    },
    getparent: (handle) =>
    {
      const p = entity(handle).parent;
      return p ? p.id : 0;
    },
    countchildren: (handle) => entity(handle).children.length,
    getchild(handle, index)
    {
      const c = entity(handle).children[index - 1];
      if (!c) throw runtimeError(`Entity ${handle} has no child number ${index}`);
      return c.id;
    },
    hideentity(handle)
    {
      entity(handle).visible = false;
    },
    showentity(handle)
    {
      entity(handle).visible = true;
    },
    entityhidden: (handle) => (entity(handle).visible ? 0 : 1),
    freeentity(handle)
    {
      world.freeEntity(entity(handle));
    },
    copyentity(handle, parent)
    {
      const src = entity(handle);
      const copy = world.copyEntity(src, parentOf(parent));
      if (src.model) engine.models.copy(src, copy);
      return copy.id;
    },
    entityexists: (handle) => (world.handles.get(handle) instanceof Entity ? 1 : 0),
    nameentity(handle, name)
    {
      entity(handle).name = name;
    },
    entityname: (handle) => entity(handle).name,

    // ------------------------------------------------------------ input
    keydown: (key) => (step().down.has(key) ? 1 : 0),
    keyhit: (key) => step().hits.get(key) || 0,
    keyup: (key) => (step().ups.has(key) ? 1 : 0),
    mousex: () => Math.round(step().x),
    mousey: () => Math.round(step().y),
    mousedown: (button) => (step().buttons.has(button) ? 1 : 0),
    mousehit: (button) => step().buttonHits.get(button) || 0,
    mousexspeed: () => Math.round(step().speedX),
    mouseyspeed: () => Math.round(step().speedY),
    mousewheel: () => step().wheel,
    lockpointer(on)
    {
      engine.input.pointerLockWanted = on !== 0;
      if (!on && engine.unlockPointer) engine.unlockPointer();
    },

    // --------------------------------------------------------------- 2D
    color(r, g, b)
    {
      style.color = [byte(r), byte(g), byte(b)];
    },
    fontsize(size)
    {
      style.fontSize = Math.max(4, Math.min(400, size));
    },
    text(x, y, text, centerX, centerY)
    {
      engine.overlay.text(x, y, text, centerX !== 0, centerY !== 0, style);
    },
    textwidth: (text) => engine.overlay.textWidth(text, style),
    rect(x, y, width, height, solid)
    {
      engine.overlay.rect(x, y, width, height, solid !== 0, style);
    },
    oval(x, y, width, height, solid)
    {
      engine.overlay.oval(x, y, width, height, solid !== 0, style);
    },
    line(x1, y1, x2, y2)
    {
      engine.overlay.line(x1, y1, x2, y2, style);
    },
    plot(x, y)
    {
      engine.overlay.rect(x, y, 1, 1, true, style);
    }
  };
}

// Marks a built-in mesh with its shape, so a physics body made from it can
// be a true sphere or cylinder rather than its triangles.
function primitive(mesh, kind)
{
  mesh.primitive = kind;
  return mesh;
}

function clampSegments(n)
{
  return Math.max(3, Math.min(128, n));
}

