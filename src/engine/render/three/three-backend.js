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
import { spriteMatrix } from '../../scene/sprite.js';
import { Mat4 } from '../../math/mat4.js';

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

// The reflection through a mirror's XZ plane, in PolyBasic space:
// M * diag(1, -1, 1) * M^-1. three.js turns the triangles of whatever it
// draws with a mirrored matrix round by itself.
function reflection(world)
{
  const m = new Mat4().fromArray(world);
  const inverse = m.clone();
  inverse.invert();
  const flip = new Mat4();
  flip.e[5] = -1;
  return m.multiply(flip).multiply(inverse);
}

// The RGBA bytes of an image, top row first.
function imagePixels(image)
{
  if (!image) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  return new Uint8Array(ctx.getImageData(0, 0, image.width, image.height).data.buffer);
}

// Pixels that are not drawn (alpha 0) take the colour of a drawn
// neighbour: smoothing between a leaf and the black around it then gives
// leaf colour, not a dark rim.
function bleedEdges(pixels, width, height)
{
  const source = pixels.slice();
  for (let y = 0; y < height; y++)
  {
    for (let x = 0; x < width; x++)
    {
      const i = (y * width + x) * 4;
      if (source[i + 3] !== 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = (ny * width + nx) * 4;
        if (source[j + 3] === 0) continue;
        pixels[i] = source[j];
        pixels[i + 1] = source[j + 1];
        pixels[i + 2] = source[j + 2];
        break;
      }
    }
  }
}

function srgb(color, rgb)
{
  return color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

const WRAP = {
  repeat: THREE.RepeatWrapping,
  clamp: THREE.ClampToEdgeWrapping,
  mirror: THREE.MirroredRepeatWrapping
};

// three.js lights are physically based; π makes an intensity of "1" light
// a white surface facing the light to full white, as the commands promise.
const LIGHT_SCALE = Math.PI;

// Shadow maps: texels a side, for a directional light and for each of the
// six faces of a point light's.
const SUN_MAP = 2048;
const POINT_MAP = 1024;

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
    this.sprites = [];            // this frame's { obj, world, sprite }
    this.spriteMatrix = new Mat4();
  }

  init(canvas)
  {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);
    // Only lights that cast shadows cost anything (three.js leaves the
    // shadow code out of the shaders while none does).
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    this.sprites.length = 0;
    this.time = frame.time || 0;
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
      const camera = this.syncCamera(cam, w / h);
      this.fitShadows(camera);
      const mirrors = frame.mirrors || [];
      for (const m of mirrors)
      {
        const reflect = reflection(m.world);
        // Sprites face the camera as seen in the mirror.
        this.faceSprites(new Mat4().multiplyMatrices(reflect, new Mat4().fromArray(cam.world)).e);
        mirrorInto(this.scene.matrix, reflect.e);
        this.scene.matrixAutoUpdate = false;
        this.scene.updateMatrixWorld(true);
        r.render(this.scene, camera);
      }
      if (mirrors.length)
      {
        this.scene.matrix.identity();
        this.scene.updateMatrixWorld(true);
      }
      this.faceSprites(cam.world);
      r.render(this.scene, camera);
    }
  }

  // ------------------------------------------------------------ meshes

  syncItem(item)
  {
    if (item.grass)
    {
      this.syncGrass(item);
      return;
    }
    let obj = this.objects.get(item.id);
    const geometry = this.geometry(item.mesh);
    // One three.js material per submesh group; a single one when all the
    // submeshes share it (the built-in shapes).
    const materials = item.materials.map((m) => this.material(m));
    const material = materials.length === 1 ? materials[0] : materials;
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
    obj.castShadow = item.castShadow !== false;
    obj.receiveShadow = item.receiveShadow !== false;
    if (item.sprite) this.sprites.push({ obj, world: item.world, sprite: item.sprite });
    else
    {
      mirrorInto(obj.matrix, item.world);
      obj.matrixWorldNeedsUpdate = true;
    }
  }

  // A field of grass: one tuft mesh drawn once per tuft. The tufts' matrices
  // are only worked out again when the field changes; the wind and the
  // pushing happen in the vertex shader.
  syncGrass(item)
  {
    const g = item.grass;
    let obj = this.objects.get(item.id);
    if (obj && (!obj.isInstancedMesh || obj.userData.grassVersion !== g.version || obj.count !== g.count))
    {
      this.scene.remove(obj);
      if (obj.isInstancedMesh) obj.dispose();
      obj = null;
    }
    const material = this.grassMaterial(item.materials[0]);
    if (!obj)
    {
      obj = new THREE.InstancedMesh(this.geometry(item.mesh), material, g.count);
      obj.matrixAutoUpdate = false;
      const local = new THREE.Matrix4();
      const turn = new THREE.Matrix4();
      const size = new THREE.Matrix4();
      const t = g.tufts;
      for (let i = 0; i < g.count; i++)
      {
        const o = i * 5;
        const k = t[o + 3];
        // In PolyBasic's space: moved, turned about Y, sized; then mirrored
        // like every other matrix.
        local.makeTranslation(t[o], t[o + 1], t[o + 2]);
        local.multiply(turn.makeRotationY(t[o + 4]));
        local.multiply(size.makeScale(g.width * k, g.height * k, g.width * k));
        const e = local.elements;
        for (const m of MIRRORED) e[m] = -e[m];
        obj.setMatrixAt(i, local);
      }
      obj.instanceMatrix.needsUpdate = true;
      // Around all the tufts, for culling: only changes with the field.
      obj.computeBoundingSphere();
      obj.userData.grassVersion = g.version;
      this.objects.set(item.id, obj);
      this.scene.add(obj);
    }
    obj.material = material;
    obj.visible = true;
    obj.renderOrder = item.order;
    obj.castShadow = item.castShadow !== false;
    obj.receiveShadow = item.receiveShadow !== false;
    mirrorInto(obj.matrix, item.world);
    obj.matrixWorldNeedsUpdate = true;
    const u = material.userData.grass;
    u.time.value = this.time;
    u.wind.value = g.wind;
    u.height.value = g.height;
    u.count.value = Math.min(8, g.pushers.length / 4);
    for (let i = 0; i < u.count.value; i++)
    {
      const p = g.pushers;
      u.pushers.value[i].set(p[i * 4], p[i * 4 + 1], -p[i * 4 + 2], p[i * 4 + 3]);
    }
  }

  // The material of a grass entity, with the wind and the pushing added to
  // its vertex shader.
  grassMaterial(m)
  {
    const material = this.material(m);
    if (material.userData.grass) return material;
    const grass = {
      time: { value: 0 },
      wind: { value: 1 },
      height: { value: 1 },
      count: { value: 0 },
      pushers: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }
    };
    material.userData.grass = grass;
    material.customProgramCacheKey = () => 'polybasic-grass';
    material.onBeforeCompile = (shader) =>
    {
      shader.uniforms.pbTime = grass.time;
      shader.uniforms.pbWind = grass.wind;
      shader.uniforms.pbHeight = grass.height;
      shader.uniforms.pbPushCount = grass.count;
      shader.uniforms.pbPushers = grass.pushers;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float pbTime;
uniform float pbWind;
uniform float pbHeight;
uniform int pbPushCount;
uniform vec4 pbPushers[8];`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  mat4 pbTuft = modelMatrix * instanceMatrix;
#else
  mat4 pbTuft = modelMatrix;
#endif
  vec3 pbRoot = (pbTuft * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // Only the tops move: nothing at the root, most at the tips.
  float pbBend = transformed.y * transformed.y;
  // Gusts rolling across the field.
  float pbPhase = pbTime * 1.6 + pbRoot.x * 0.35 + pbRoot.z * 0.27;
  vec3 pbMove = vec3(sin(pbPhase) * 0.6 + sin(pbPhase * 2.3 + 1.7) * 0.25, 0.0, cos(pbPhase * 0.8 + 0.5) * 0.35);
  pbMove *= pbWind * 0.15 * pbHeight * pbBend;
  // Leaning away from what pushes through it.
  for (int i = 0; i < 8; i++)
  {
    if (i >= pbPushCount) break;
    vec3 pbAway = pbRoot - pbPushers[i].xyz;
    pbAway.y = 0.0;
    float pbDist = length(pbAway);
    float pbReach = pbPushers[i].w;
    if (pbDist < pbReach && pbDist > 0.0001)
    {
      float pbPush = 1.0 - pbDist / pbReach;
      pbMove += normalize(pbAway) * pbPush * pbBend * pbHeight;
      pbMove.y -= pbPush * pbBend * pbHeight * 0.4;
    }
  }
  transformed += inverse(mat3(pbTuft)) * pbMove;`);
    };
    material.needsUpdate = true;
    return material;
  }

  // Sprites turn to each camera that draws them.
  faceSprites(cameraWorld)
  {
    for (const { obj, world, sprite } of this.sprites)
    {
      mirrorInto(obj.matrix, spriteMatrix(this.spriteMatrix, world, cameraWorld, sprite).e);
      obj.matrixWorldNeedsUpdate = true;
    }
  }

  geometry(mesh)
  {
    const known = this.geometries.get(mesh.id);
    if (known && known.version === mesh.version)
    {
      if (known.pose !== mesh.pose) this.pose(known, mesh);
      return known.geometry;
    }
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
    if (mesh.colors) g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(mesh.colors), 4));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    for (const s of mesh.submeshes) g.addGroup(s.start, s.count, s.material);
    // A mesh that changes its pose (MD2) is culled by the box round all
    // its frames, not by the one it was first drawn in.
    if (mesh.pose === undefined) g.computeBoundingSphere();
    else
    {
      const b = mesh.bounds;
      const c = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
      g.boundingSphere = new THREE.Sphere(c, Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 2);
    }
    this.geometries.set(mesh.id, { geometry: g, version: mesh.version, pose: mesh.pose });
    return g;
  }

  // New positions and normals into the same buffers: nothing else of the
  // mesh changed.
  pose(known, mesh)
  {
    const position = known.geometry.getAttribute('position');
    const normal = known.geometry.getAttribute('normal');
    const p = position.array;
    const n = normal.array;
    p.set(mesh.positions);
    n.set(mesh.normals);
    for (let i = 2; i < p.length; i += 3)
    {
      p[i] = -p[i];
      n[i] = -n[i];
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
    known.pose = mesh.pose;
  }

  material(m)
  {
    const tex = m.texture && m.texture.loaded ? this.texture(m.texture) : null;
    const key = `${m.version}:${m.fullbright}:${tex ? tex.id + '.' + m.texture.version : '-'}`;
    const known = this.materials.get(m.id);
    if (known && known.key === key) return known.material;
    if (known) known.material.dispose();

    // Built-in shapes go by `alpha` and their texture's flags (TEX_ALPHA
    // blends, TEX_MASKED cuts out); model materials say how alpha is used.
    const flags = tex ? m.texture : null;
    const blend = m.alphaMode ? m.alphaMode === 'blend' : m.alpha < 1 || m.vertexAlpha || (flags !== null && flags.alpha);
    const cut = m.alphaMode === 'mask' ? m.alphaCutoff : (flags !== null && flags.masked ? 0.5 : 0);
    // EntityBlend: adding (glows, fire) and multiplying (shade, stains) do
    // not hide what is behind, so they do not write depth either.
    const mixing = m.blend === 'add' || m.blend === 'multiply';
    const options = {
      color: srgb(new THREE.Color(), m.color),
      map: tex,
      transparent: blend || mixing,
      opacity: m.alphaMode === 'opaque' ? 1 : m.alpha,
      alphaTest: cut,
      vertexColors: m.vertexColors,
      side: m.twoSided ? THREE.DoubleSide : THREE.FrontSide
    };
    if (m.blend === 'add') options.blending = THREE.AdditiveBlending;
    if (m.blend === 'multiply')
    {
      options.blending = THREE.MultiplyBlending;
      options.premultipliedAlpha = true;
    }
    if (mixing) options.depthWrite = false;
    // A decal lies on its surface: pulled towards the camera in depth, and
    // leaving the depth alone so decals over decals do not flicker.
    if (m.decal)
    {
      options.polygonOffset = true;
      options.polygonOffsetFactor = -1;
      options.polygonOffsetUnits = -4;
      options.depthWrite = false;
    }
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
    // Fully faded out (EntityAlpha 0) is not drawn at all, as in Blitz3D:
    // it hides nothing behind it and casts no shadow, and is still picked.
    material.visible = m.alphaMode === 'opaque' || m.alpha > 0;
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
    if (t.masked)
    {
      // Masked, as in Blitz3D: black pixels are not drawn.
      const pixels = t.pixels ? new Uint8Array(t.pixels) : imagePixels(t.image);
      if (!pixels) return null;
      for (let i = 0; i < pixels.length; i += 4)
      {
        if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) pixels[i + 3] = 0;
      }
      bleedEdges(pixels, t.width, t.height);
      texture = new THREE.DataTexture(pixels, t.width, t.height, THREE.RGBAFormat);
    }
    else if (t.image) texture = new THREE.Texture(t.image);
    else if (t.pixels) texture = new THREE.DataTexture(new Uint8Array(t.pixels), t.width, t.height, THREE.RGBAFormat);
    else return null;
    // Generated textures are usually pixel patterns, kept sharp; images
    // are smoothed.
    texture.magFilter = t.nearest ? THREE.NearestFilter : THREE.LinearFilter;
    // Our rows start at the top, like the images: no flipping.
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = WRAP[t.wrapU] || THREE.RepeatWrapping;
    texture.wrapT = WRAP[t.wrapV] || THREE.RepeatWrapping;
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
      light.castShadow = l.shadows > 0;
      if (l.type === 2)
      {
        light.distance = l.range;
        light.decay = 0;
        if (light.castShadow)
        {
          light.shadow.mapSize.set(POINT_MAP, POINT_MAP);
          light.shadow.camera.near = 0.05;
          light.shadow.camera.far = l.range > 0 ? l.range : 100;
          light.shadow.bias = -0.002;
          light.shadow.normalBias = 0.02;
        }
      }
      else
      {
        // A directional light shines along its entity's forward axis.
        light.userData.direction = new THREE.Vector3(w[8], w[9], -w[10]).normalize();
        light.userData.area = l.shadows;
        light.target.position.set(w[12] + w[8], w[13] + w[9], -(w[14] + w[10]));
        light.target.updateMatrixWorld();
      }
    }
    for (const [id, light] of this.lights)
    {
      if (!seen.has(id)) light.visible = false;
    }
  }

  // A directional light's shadows cover a square of `area` units around
  // what the camera looks at. Its centre moves in steps of one shadow texel
  // (in the light's own view), so the shadows' edges do not crawl as the
  // camera moves.
  fitShadows(camera)
  {
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    for (const light of this.lights.values())
    {
      if (!light.visible || !light.castShadow || light.type !== 'DirectionalLight') continue;
      const area = light.userData.area;
      const dir = light.userData.direction;
      const shadow = light.shadow;
      if (shadow.mapSize.x !== SUN_MAP) shadow.mapSize.set(SUN_MAP, SUN_MAP);
      const cam = shadow.camera;
      cam.left = -area / 2;
      cam.right = area / 2;
      cam.top = area / 2;
      cam.bottom = -area / 2;
      cam.near = 0.1;
      cam.far = area * 2;
      cam.updateProjectionMatrix();
      const texel = area / SUN_MAP;
      shadow.bias = -0.0005;
      shadow.normalBias = texel * 1.5;

      // The centre, a little ahead of the camera, snapped in light space.
      const centre = eye.clone().addScaledVector(forward, area * 0.35);
      const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const basis = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up);
      const inverse = basis.clone().invert();
      centre.applyMatrix4(inverse);
      centre.x = Math.round(centre.x / texel) * texel;
      centre.y = Math.round(centre.y / texel) * texel;
      centre.applyMatrix4(basis);
      light.target.position.copy(centre);
      light.position.copy(centre).addScaledVector(dir, -area);
      light.target.updateMatrixWorld();
      light.updateMatrixWorld();
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
