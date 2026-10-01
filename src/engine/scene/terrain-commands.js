// Terrain commands, with Blitz3D's names and meanings (see terrain.js).

import { handleHelpers } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import { Terrain, isPowerOfTwo } from './terrain.js';
import { Vec3 } from '../math/vec3.js';

export const TERRAIN_COMMANDS = [
  'CreateTerrain%(size, parent = 0)',
  'LoadTerrain%(file$, parent = 0)',
  'TerrainSize%(terrain)',
  'TerrainHeight#(terrain, x, z)',
  'ModifyTerrain(terrain, x, z, height#, realtime = 0)',
  'TerrainX#(terrain, x#, y#, z#)',
  'TerrainY#(terrain, x#, y#, z#)',
  'TerrainZ#(terrain, x#, y#, z#)',
  'TerrainDetail(terrain, detail, morph = 0)',
  'TerrainShading(terrain, on)'
];

export function createTerrainCommands(engine)
{
  const world = engine.world;
  const { entity, parentOf } = handleHelpers(world);

  const terrainEntity = (parent) =>
  {
    engine.autoGraphics();
    const e = world.createEntity('mesh', parent);
    engine.terrains.push(e);
    return e;
  };
  const give = (e, size) =>
  {
    e.terrain = new Terrain(size);
    e.mesh = e.terrain.mesh;
    return e.terrain;
  };
  const checkImage = (img) =>
  {
    if (img.width !== img.height) throw new Error(`the heightmap is ${img.width} x ${img.height}; a terrain must be square`);
    if (!isPowerOfTwo(img.width)) throw new Error(`the heightmap is ${img.width} across; a terrain's size must be a power of 2 (64, 128, 256...)`);
  };
  const terrain = (handle) =>
  {
    const e = entity(handle);
    if (!e.terrain)
    {
      if (engine.terrains.includes(e)) throw runtimeError(`Terrain ${handle} is still loading its heightmap`);
      throw runtimeError(`Entity ${handle} is not a terrain`);
    }
    return e.terrain;
  };
  // A world point onto the terrain below or above it: [x, y, z].
  const onto = (handle, x, y, z) =>
  {
    const e = entity(handle);
    const t = terrain(handle);
    const inv = e.worldMatrix.clone();
    inv.invert();
    const local = new Vec3(x, y, z).applyMat4(inv);
    return new Vec3(local.x, t.heightAt(local.x, local.z), local.z).applyMat4(e.worldMatrix);
  };

  return {
    createterrain(size, parent)
    {
      if (!isPowerOfTwo(size)) throw runtimeError(`CreateTerrain needs a size that is a power of 2 (64, 128, 256...), not ${size}`);
      const e = terrainEntity(parentOf(parent));
      give(e, size).update();
      return e.id;
    },
    loadterrain(file, parent)
    {
      const e = terrainEntity(parentOf(parent));
      const url = engine.resolve(file);
      const known = engine.heightmaps.get(url);
      if (known)
      {
        if (known.error) throw runtimeError(`LoadTerrain: could not load "${file}": ${known.error.message}`);
        try
        {
          checkImage(known.image);
        }
        catch (err)
        {
          throw runtimeError(`LoadTerrain: ${err.message}`);
        }
        const t = give(e, known.image.width);
        t.fromImage(known.image);
        t.update();
        return e.id;
      }
      // A name that was not in quotes: the terrain arrives later, and until
      // then TerrainSize is 0.
      if (engine.loadFile)
      {
        engine.track(engine.loadHeightmap(url).then((image) =>
        {
          checkImage(image);
          if (!e.alive) return;
          const t = give(e, image.width);
          t.fromImage(image);
          t.update();
        }).catch((err) => engine.warn(`LoadTerrain: could not load "${file}": ${err.message}`)));
      }
      return e.id;
    },
    terrainsize(handle)
    {
      const e = entity(handle);
      if (!e.terrain && !engine.terrains.includes(e)) throw runtimeError(`Entity ${handle} is not a terrain`);
      return e.terrain ? e.terrain.size : 0;
    },
    terrainheight: (handle, x, z) => terrain(handle).height(x, z),
    modifyterrain(handle, x, z, h)
    {
      // Blitz3D's realtime flag picks when its level of detail is redone;
      // here the mesh follows before the next step and the next frame.
      terrain(handle).setHeight(x, z, h);
    },
    terrainx: (handle, x, y, z) => onto(handle, x, y, z).x,
    terrainy: (handle, x, y, z) => onto(handle, x, y, z).y,
    terrainz: (handle, x, y, z) => onto(handle, x, y, z).z,
    terraindetail(handle, detail)
    {
      // Kept for Blitz3D programs: the whole grid is always drawn.
      terrain(handle).detail = detail;
    },
    terrainshading(handle, on)
    {
      terrain(handle).setShading(on !== 0);
    }
  };
}
