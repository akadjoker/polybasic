// Textures are our own objects: either pixels we generated (RGBA bytes,
// top row first) or an image loaded from a URL. The backend uploads them
// and re-uploads when `version` changes.

let nextTextureId = 1;

// Texture flags, with Blitz3D's values.
export const TEX_COLOR = 1;
export const TEX_ALPHA = 2;       // the alpha channel blends with what is behind
export const TEX_MASKED = 4;      // black pixels (and alpha below a half) are not drawn
export const TEX_MIPMAP = 8;      // always on here
export const TEX_CLAMPU = 16;
export const TEX_CLAMPV = 32;
export const TEX_SPHEREMAP = 64;
export const TEX_CUBEMAP = 128;

export class Texture
{
  constructor(width = 0, height = 0)
  {
    this.id = nextTextureId++;
    this.version = 0;
    this.width = width;
    this.height = height;
    this.pixels = width && height ? new Uint8ClampedArray(width * height * 4) : null;
    this.url = null;
    this.image = null;      // platform image (HTMLImageElement, ImageBitmap) once loaded
    this.loaded = this.pixels !== null;
    this.failed = false;
    this.scaleU = 1;
    this.scaleV = 1;
    // Past the edges: 'repeat', 'clamp' or 'mirror'. Close up: blend
    // pixels, or keep them sharp (`nearest`, the default for created ones).
    this.wrapU = 'repeat';
    this.wrapV = 'repeat';
    this.nearest = this.pixels !== null;
    this.flags = TEX_COLOR;
  }

  // Sets the Blitz3D texture flags (TEX_* above).
  setFlags(flags)
  {
    this.flags = flags;
    this.wrapU = flags & TEX_CLAMPU ? 'clamp' : 'repeat';
    this.wrapV = flags & TEX_CLAMPV ? 'clamp' : 'repeat';
    this.version++;
    return this;
  }

  get alpha()
  {
    return (this.flags & TEX_ALPHA) !== 0;
  }

  get masked()
  {
    return (this.flags & TEX_MASKED) !== 0;
  }

  fill(r, g, b, a = 255)
  {
    const p = this.pixels;
    for (let i = 0; i < p.length; i += 4)
    {
      p[i] = r;
      p[i + 1] = g;
      p[i + 2] = b;
      p[i + 3] = a;
    }
    this.version++;
    return this;
  }

  setPixel(x, y, r, g, b, a = 255)
  {
    if (!this.pixels || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels[i] = r;
    this.pixels[i + 1] = g;
    this.pixels[i + 2] = b;
    this.pixels[i + 3] = a;
    this.version++;
  }

  checker(cells, c1, c2)
  {
    const cell = Math.max(1, Math.floor(this.width / Math.max(1, cells)));
    for (let y = 0; y < this.height; y++)
    {
      for (let x = 0; x < this.width; x++)
      {
        const c = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) ? c2 : c1;
        const i = (y * this.width + x) * 4;
        this.pixels[i] = c[0];
        this.pixels[i + 1] = c[1];
        this.pixels[i + 2] = c[2];
        this.pixels[i + 3] = 255;
      }
    }
    this.version++;
    return this;
  }
}
