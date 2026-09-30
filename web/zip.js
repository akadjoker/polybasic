// Zip files, written and read with no library: projects are exported and
// imported as .zip. Entries are deflated with the platform's
// CompressionStream (browsers and Node 18+) unless that makes them bigger,
// then stored. Reading accepts stored and deflated entries, checks every
// CRC-32, and says clearly what it cannot read (encryption, Zip64, other
// compression methods).
//
//   await writeZip([{ name, data: Uint8Array | string, date? }]) -> Uint8Array
//   await readZip(bytes) -> [{ name, data: Uint8Array, date }]   (files only)

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() =>
{
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++)
  {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes)
{
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(bytes, stream)
{
  const piped = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

// MS-DOS date and time, as zip keeps them (local time, 2-second steps).
function dosDateTime(date)
{
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

function fromDos(date, time)
{
  return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

export async function writeZip(entries)
{
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const seen = new Set();
  for (const entry of entries)
  {
    const name = entry.name.replace(/\\/g, '/');
    if (!name || name.startsWith('/') || seen.has(name)) throw new Error(`bad or repeated file name in zip: "${entry.name}"`);
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const deflated = raw.length ? await pipe(raw, new CompressionStream('deflate-raw')) : raw;
    const method = deflated.length < raw.length ? 8 : 0;
    const body = method === 8 ? deflated : raw;
    const crc = crc32(raw);
    const { time, date } = dosDateTime(entry.date);
    if (raw.length > 0xfffffffe || offset > 0xfffffffe) throw new Error('the project is too big for a zip without Zip64');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, 20, true);              // version needed: 2.0
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, CENTRAL, true);
    dir.setUint16(4, 20, true);                // made by: 2.0 (MS-DOS attributes)
    dir.setUint16(6, 20, true);
    dir.setUint16(8, UTF8_FLAG, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all)
  {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function readZip(input)
{
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is in the last 64 KB + 22 bytes (after a comment).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--)
  {
    if (view.getUint32(i, true) === END)
    {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('this is not a zip file');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error('Zip64 files are not supported');
  const decoder = new TextDecoder();
  const files = [];
  for (let i = 0; i < count; i++)
  {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new Error('the zip file is damaged (central directory)');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;   // a folder
    if (flags & 1) throw new Error(`"${name}" is encrypted, which is not supported`);
    if (method !== 0 && method !== 8) throw new Error(`"${name}" uses a compression method that is not supported (${method})`);
    if (view.getUint32(localAt, true) !== LOCAL) throw new Error(`the zip file is damaged (entry "${name}")`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (dataAt + compressed > bytes.length) throw new Error(`the zip file is cut short (entry "${name}")`);
    const body = bytes.subarray(dataAt, dataAt + compressed);
    const data = method === 8 ? await pipe(body, new DecompressionStream('deflate-raw')) : body.slice();
    if (data.length !== size || crc32(data) !== crc) throw new Error(`"${name}" in the zip file is damaged (check failed)`);
    files.push({ name, data, date: fromDos(date, time) });
  }
  return files;
}
