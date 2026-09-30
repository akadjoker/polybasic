// What a WAV file holds, read from its header: enough for the headless
// engine to know how long a loaded sound plays without decoding it.

// { sampleRate, channels, bits, frames, seconds } for a WAV file, or null
// for anything else (OGG, MP3, a damaged file).
export function readWavInfo(bytes)
{
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 12) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let format = null;
  let at = 12;
  while (at + 8 <= b.length)
  {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= b.length)
    {
      format = {
        code: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true)
      };
    }
    else if (id === 'data' && format)
    {
      // PCM (1), float (3) and "extensible" (0xfffe) keep one frame per
      // channels * bits / 8 bytes.
      if (![1, 3, 0xfffe].includes(format.code) || !format.channels || !format.sampleRate || !format.bits) return null;
      const frameBytes = format.channels * Math.ceil(format.bits / 8);
      const dataBytes = Math.min(size, b.length - body);
      const frames = Math.floor(dataBytes / frameBytes);
      return { sampleRate: format.sampleRate, channels: format.channels, bits: format.bits, frames, seconds: frames / format.sampleRate };
    }
    at = body + size + (size & 1);   // chunks are padded to an even size
  }
  return null;
}
