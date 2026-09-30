// The three.js backend. This is the only file that imports three.js.
//
// three.js is right-handed with cameras looking down -Z, PolyBasic is
// left-handed with cameras looking down +Z. Mirroring the Z axis maps one
// onto the other: every world matrix M becomes S * M * S with
// S = diag(1, 1, -1), vertex positions and normals get their Z negated,
// and triangles swap two corners so the clockwise front faces become
// three.js's counter-clockwise ones. The picture is identical; only the
// bookkeeping differs.

import * as THREE from 'three';
import { RenderBackend } from '../backend.js';

// Indices of a column-major 4x4 matrix that change sign under S * M * S:
// exactly one of (row, column) is the Z row/column.
const MIRRORED = [2, 6, 14, 8, 9, 11];

function mirrorInto(target, world)
{
  const e = target.elements;
  for (let i = 0; i < 16; i++) e[i] = world[i];
  for (const i of MIRRORED) e[i] = -e[i];
  return target;
}

function srgb(color, rgb)
{
  return color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

// three.js lights are physically based; π makes an intensity of "1" light
// a white surface facing the light to full white, as the commands promise.
const LIGHT_SCALE = Math.PI;

export class ThreeBackend extends RenderBackend
{
  constructor()
  {
    super();
    this.objects = new Map();     // entity id -> THREE.Mesh
    this.geometries = new Map();  // mesh id -> { geometry, version }
    this.materials = new Map();   // material id -> { material, key }
    this.textures = new Map();    // texture id -> { texture, version }
    this.lights = new Map();      // entity id -> THREE.Light
    this.cameras = new Map();     // entity id -> THREE.PerspectiveCamera
    this.width = 1;
    this.height = 1;
  }

  init(canvas)
  {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.ambient = new THREE.AmbientLight(0xffffff, 0);
    this.scene.add(this.ambient);
  }

  // A new program: drop every object, keep the renderer (and its WebGL
  // context, which browsers only hand out a few of).
  reset()
  {
    for (const { geometry } of this.geometries.values()) geometry.dispose();
    for (const { material } of this.materials.values()) material.dispose();
    for (const { texture } of this.textures.values()) texture.dispose();
    for (const map of [this.objects, this.geometries, this.materials, this.textures, this.lights, this.cameras]) map.clear();
    this.scene = new THREE.Scene();
    this.ambient = new THREE.AmbientLight(0xffffff, 0);
    this.scene.add(this.ambient);
  }

  resize(width, height, pixelRatio = 1)
  {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  render(frame)
  {
    for (const id of frame.freedEntities) this.dropEntity(id);
    for (const t of frame.freedTextures) this.dropTexture(t.id);

    srgb(this.ambient.color, frame.ambient);
    this.ambient.intensity = LIGHT_SCALE;

    const seen = new Set();
    for (const item of frame.items)
    {
      seen.add(item.id);
      this.syncItem(item);
    }
    for (const [id, obj] of this.objects)
    {
      if (!seen.has(id)) obj.visible = false;
    }
    this.syncLights(frame.lights);

    const r = this.renderer;
    if (frame.cameras.length === 0)
    {
      r.setViewport(0, 0, this.width, this.height);
      r.setScissor(0, 0, this.width, this.height);
      r.setClearColor(srgb(new THREE.Color(), frame.clearColor), 1);
      r.clear(true, true, true);
      return;
    }
    for (const cam of frame.cameras)
    {
      const [x, y, w, h] = cam.viewport || [0, 0, this.width, this.height];
      // PolyBasic viewports count from the top-left; WebGL from the bottom.
      const gy = this.height - y - h;
      r.setViewport(x, gy, w, h);
      r.setScissor(x, gy, w, h);
      r.setClearColor(srgb(new THREE.Color(), cam.clearColor), 1);
      r.clear(true, true, true);
      r.render(this.scene, this.syncCamera(cam, w / h));
    }
  }

  // ------------------------------------------------------------ meshes

  syncItem(item)
  {
    let obj = this.objects.get(item.id);
    const geometry = this.geometry(item.mesh);
    const material = this.material(item.material);
    if (!obj)
    {
      obj = new THREE.Mesh(geometry, material);
      obj.matrixAutoUpdate = false;
      this.objects.set(item.id, obj);
      this.scene.add(obj);
    }
    obj.geometry = geometry;
    obj.material = material;
    obj.visible = true;
    obj.renderOrder = item.order;
    mirrorInto(obj.matrix, item.world);
    obj.matrixWorldNeedsUpdate = true;
  }

  geometry(mesh)
  {
    const known = this.geometries.get(mesh.id);
    if (known && known.version === mesh.version) return known.geometry;
    if (known) known.geometry.dispose();

    const positions = Float32Array.from(mesh.positions);
    const normals = Float32Array.from(mesh.normals);
    for (let i = 2; i < positions.length; i += 3)
    {
      positions[i] = -positions[i];
      normals[i] = -normals[i];
    }
    const indices = Uint32Array.from(mesh.indices);
    for (let i = 0; i < indices.length; i += 3)
    {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(mesh.uvs), 2));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    for (const s of mesh.submeshes) g.addGroup(s.start, s.count, 0);
    g.computeBoundingSphere();
    this.geometries.set(mesh.id, { geometry: g, version: mesh.version });
    return g;
  }

  material(m)
  {
    const tex = m.texture && m.texture.loaded ? this.texture(m.texture) : null;
    const key = `${m.version}:${m.fullbright}:${tex ? tex.id + '.' + m.texture.version : '-'}`;
    const known = this.materials.get(m.id);
    if (known && known.key === key) return known.material;
    if (known) known.material.dispose();

    const options = {
      color: srgb(new THREE.Color(), m.color),
      map: tex,
      transparent: m.alpha < 1,
      opacity: m.alpha,
      side: m.twoSided ? THREE.DoubleSide : THREE.FrontSide
    };
    let material;
    if (m.fullbright) material = new THREE.MeshBasicMaterial(options);
    else
    {
      const s = m.shininess;
      material = new THREE.MeshPhongMaterial({
        ...options,
        flatShading: m.flat,
        shininess: 2 + s * 126,
        specular: new THREE.Color(s * 0.8, s * 0.8, s * 0.8)
      });
    }
    this.materials.set(m.id, { material, key });
    return material;
  }

  texture(t)
  {
    const known = this.textures.get(t.id);
    if (known && known.version === t.version)
    {
      known.texture.repeat.set(t.scaleU, t.scaleV);
      return known.texture;
    }
    if (known) known.texture.dispose();
    let texture;
    if (t.image) texture = new THREE.Texture(t.image);
    else
    {
      texture = new THREE.DataTexture(new Uint8Array(t.pixels), t.width, t.height, THREE.RGBAFormat);
      // Small generated textures are usually pixel patterns: keep them sharp.
      texture.magFilter = THREE.NearestFilter;
    }
    // Our rows start at the top, like the images: no flipping.
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(t.scaleU, t.scaleV);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.textures.set(t.id, { texture, version: t.version });
    return texture;
  }

  // ------------------------------------------------- lights and cameras

  syncLights(lights)
  {
    const seen = new Set();
    for (const l of lights)
    {
      seen.add(l.id);
      let light = this.lights.get(l.id);
      const wanted = l.type === 2 ? 'PointLight' : 'DirectionalLight';
      if (light && light.type !== wanted)
      {
        this.scene.remove(light);
        light = null;
      }
      if (!light)
      {
        light = l.type === 2 ? new THREE.PointLight() : new THREE.DirectionalLight();
        if (light.target) this.scene.add(light.target);
        this.scene.add(light);
        this.lights.set(l.id, light);
      }
      const w = l.world;
      srgb(light.color, l.color);
      light.intensity = LIGHT_SCALE;
      light.visible = true;
      light.position.set(w[12], w[13], -w[14]);
      if (l.type === 2)
      {
        light.distance = l.range;
        light.decay = 0;
      }
      else
      {
        // A directional light shines along its entity's forward axis.
        light.target.position.set(w[12] + w[8], w[13] + w[9], -(w[14] + w[10]));
        light.target.updateMatrixWorld();
      }
    }
    for (const [id, light] of this.lights)
    {
      if (!seen.has(id)) light.visible = false;
    }
  }

  syncCamera(cam, aspect)
  {
    let camera = this.cameras.get(cam.id);
    if (!camera)
    {
      camera = new THREE.PerspectiveCamera();
      camera.matrixAutoUpdate = false;
      this.cameras.set(cam.id, camera);
    }
    camera.fov = cam.fov;
    camera.aspect = aspect;
    camera.near = cam.near;
    camera.far = cam.far;
    camera.updateProjectionMatrix();
    mirrorInto(camera.matrix, cam.world);
    camera.matrixWorldNeedsUpdate = true;
    camera.updateMatrixWorld(true);
    return camera;
  }

  // ------------------------------------------------------------ cleanup

  dropEntity(id)
  {
    const obj = this.objects.get(id);
    if (obj)
    {
      this.scene.remove(obj);
      this.objects.delete(id);
    }
    const light = this.lights.get(id);
    if (light)
    {
      this.scene.remove(light);
      if (light.target) this.scene.remove(light.target);
      this.lights.delete(id);
    }
    this.cameras.delete(id);
  }

  dropTexture(id)
  {
    const known = this.textures.get(id);
    if (known)
    {
      known.texture.dispose();
      this.textures.delete(id);
    }
  }

  // For tests: the three.js world matrix of an entity's object.
  objectMatrix(id)
  {
    const obj = this.objects.get(id) || this.cameras.get(id);
    return obj ? Array.from(obj.matrixWorld.elements) : null;
  }

  dispose()
  {
    for (const { geometry } of this.geometries.values()) geometry.dispose();
    for (const { material } of this.materials.values()) material.dispose();
    for (const { texture } of this.textures.values()) texture.dispose();
    this.renderer.dispose();
  }
}
