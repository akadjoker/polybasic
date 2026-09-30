// Decodes BMP and PNG files to RGBA pixels, in the same way in Node and in
// the browser (the engine needs the pixels of a heightmap, not a picture to
// draw). PNG data is inflated with DecompressionStream.
//
//   decodeImage(bytes) -> Promise<{ width, height, data: Uint8ClampedArray }>
//
// Pixels run from the top-left, 4 bytes each (r, g, b, a).

export async function decodeImage(bytes)
{
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x42 && b[1] === 0x4d) return decodeBmp(b);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return decodePng(b);
  throw new Error('only BMP and PNG images can be read here');
}

// -------------------------------------------------------------------- BMP

export function decodeBmp(b)
{
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const offset = v.getUint32(10, true);
  const header = v.getUint32(14, true);
  const width = v.getInt32(18, true);
  const rawHeight = v.getInt32(22, true);
  const bits = v.getUint16(28, true);
  const compression = header >= 40 ? v.getUint32(30, true) : 0;
  // 3 is BI_BITFIELDS, which for 32 bits is the usual BGRA layout.
  if (compression !== 0 && !(compression === 3 && bits === 32)) throw new Error('compressed BMP files cannot be read; save it uncompressed');
  if (![1, 4, 8, 24, 32].includes(bits)) throw new Error(`BMP files with ${bits} bits per pixel cannot be read`);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;

  let palette = null;
  if (bits <= 8)
  {
    const used = v.getUint32(46, true) || (1 << bits);
    palette = new Uint8Array(used * 4);
    const at = 14 + header;
    for (let i = 0; i < used; i++)
    {
      palette[i * 4] = b[at + i * 4 + 2];
      palette[i * 4 + 1] = b[at + i * 4 + 1];
      palette[i * 4 + 2] = b[at + i * 4];
      palette[i * 4 + 3] = 255;
    }
  }

  const stride = ((width * bits + 31) >> 5) << 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
  {
    const row = offset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++)
    {
      const o = (y * width + x) * 4;
      if (palette)
      {
        const perByte = 8 / bits;
        const byte = b[row + Math.floor(x / perByte)];
        const shift = 8 - bits * (x % perByte + 1);
        const p = ((byte >> shift) & ((1 << bits) - 1)) * 4;
        data[o] = palette[p];
        data[o + 1] = palette[p + 1];
        data[o + 2] = palette[p + 2];
        data[o + 3] = 255;
      }
      else
      {
        const p = row + x * (bits / 8);
        data[o] = b[p + 2];
        data[o + 1] = b[p + 1];
        data[o + 2] = b[p];
        data[o + 3] = bits === 32 ? b[p + 3] : 255;
      }
    }
  }
  return { width, height, data };
}

// -------------------------------------------------------------------- PNG

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export async function decodePng(b)
{
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let palette = null;
  let alpha = null;
  const idat = [];
  while (pos < b.length)
  {
    const length = v.getUint32(pos);
    const name = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const body = b.subarray(pos + 8, pos + 8 + length);
    if (name === 'IHDR')
    {
      width = v.getUint32(pos + 8);
      height = v.getUint32(pos + 12);
      depth = body[8];
      type = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNG files cannot be read; save it without interlacing');
    }
    else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') alpha = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    pos += 12 + length;
  }
  if (!(type in CHANNELS)) throw new Error(`PNG colour type ${type} cannot be read`);

  const packed = await inflate(idat);
  const channels = CHANNELS[type];
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil(width * bitsPerPixel / 8);
  const step = Math.max(1, bitsPerPixel >> 3);   // bytes back to the pixel on the left
  const rows = unfilter(packed, height, stride, step);

  const data = new Uint8ClampedArray(width * height * 4);
  // A sample of the row at pixel x, channel c, scaled to 0..255.
  const sample = (row, x, c) =>
  {
    if (depth === 8) return rows[row + x * channels + c];
    if (depth === 16) return rows[row + (x * channels + c) * 2];
    const perByte = 8 / depth;
    const byte = rows[row + Math.floor(x / perByte)];
    const value = (byte >> (8 - depth * (x % perByte + 1))) & ((1 << depth) - 1);
    return type === 3 ? value : Math.round(value * 255 / ((1 << depth) - 1));
  };
  for (let y = 0; y < height; y++)
  {
    const row = y * stride;
    for (let x = 0; x < width; x++)
    {
      const o = (y * width + x) * 4;
      if (type === 3)
      {
        const i = sample(row, x, 0);
        data[o] = palette[i * 3];
        data[o + 1] = palette[i * 3 + 1];
        data[o + 2] = palette[i * 3 + 2];
        data[o + 3] = alpha && i < alpha.length ? alpha[i] : 255;
      }
      else if (type === 0 || type === 4)
      {
        const g = sample(row, x, 0);
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = type === 4 ? sample(row, x, 1) : 255;
      }
      else
      {
        data[o] = sample(row, x, 0);
        data[o + 1] = sample(row, x, 1);
        data[o + 2] = sample(row, x, 2);
        data[o + 3] = type === 6 ? sample(row, x, 3) : 255;
      }
    }
  }
  return { width, height, data };
}

async function inflate(parts)
{
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Undoes the per-row filters (none, sub, up, average, Paeth).
function unfilter(src, height, stride, step)
{
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++)
  {
    const filter = src[y * (stride + 1)];
    const inRow = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    for (let i = 0; i < stride; i++)
    {
      const x = src[inRow + i];
      const a = i >= step ? out[row + i - step] : 0;
      const c = y > 0 && i >= step ? out[up + i - step] : 0;
      const bUp = y > 0 ? out[up + i] : 0;
      let value;
      switch (filter)
      {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + bUp; break;
        case 3: value = x + ((a + bUp) >> 1); break;
        case 4:
        {
          const p = a + bUp - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - bUp);
          const pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? bUp : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      out[row + i] = value & 255;
    }
  }
  return out;
}
