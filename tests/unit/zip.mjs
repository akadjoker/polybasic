// The playground's zip files: our writer and reader against each other and
// against Python's zipfile, an independent implementation.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZip, readZip, crc32 } from '../../web/zip.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

// Bytes that do not compress (so the entry is stored, not deflated).
function noise(n)
{
  const out = new Uint8Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++)
  {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

const SAMPLE = [
  { name: 'main.pb', data: 'Graphics3D 800, 600\n'.repeat(50) },
  { name: 'lib/util.pb', data: 'Function Twice(x)\n  Return x * 2\nEnd Function\n' },
  { name: 'assets/noise.bin', data: noise(5000) },
  { name: 'empty.txt', data: '' },
  { name: 'ção/ünïcode ñame.pb', data: '; olá' }
];

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytesOf = (d) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);

function python(script, ...args)
{
  return execFileSync('python3', ['-c', script, ...args], { encoding: 'utf8' });
}

test('CRC-32 of known strings', () =>
{
  assert(crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'check value');
  assert(crc32(new Uint8Array(0)) === 0, 'empty');
});

test('what is written reads back the same, deflated or stored', async () =>
{
  const zip = await writeZip(SAMPLE);
  const files = await readZip(zip);
  assert(files.length === SAMPLE.length, `${files.length} files`);
  for (const [i, f] of files.entries())
  {
    assert(f.name === SAMPLE[i].name, `name ${f.name}`);
    assert(same(f.data, bytesOf(SAMPLE[i].data)), `data of ${f.name}`);
  }
  // The repeated text shrank; the noise was stored as it is.
  assert(zip.length < 5000 + 2000, `zip is ${zip.length} bytes`);
});

test('Python reads our zip files, and we read Python\'s', async () =>
{
  const dir = mkdtempSync(join(tmpdir(), 'pbzip-'));
  try
  {
    const ours = join(dir, 'ours.zip');
    writeFileSync(ours, await writeZip(SAMPLE));
    const listing = JSON.parse(python(`
import sys, zipfile, json, hashlib
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps([[i.filename, i.compress_type, hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()]))`, ours));
    assert(listing.length === SAMPLE.length, 'Python sees all the files');
    const { createHash } = await import('node:crypto');
    for (const [i, [name, method, hash]] of listing.entries())
    {
      assert(name === SAMPLE[i].name, `Python name ${name}`);
      assert(hash === createHash('sha256').update(bytesOf(SAMPLE[i].data)).digest('hex'), `Python data of ${name}`);
      if (name === 'assets/noise.bin') assert(method === 0, 'noise stored');
      if (name === 'main.pb') assert(method === 8, 'text deflated');
    }

    // Python writes one with folders, stored and deflated entries.
    const theirs = join(dir, 'theirs.zip');
    python(`
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('game/', '')
    z.writestr(zipfile.ZipInfo('game/main.pb'), 'Print "hi"\\n' * 100, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr(zipfile.ZipInfo('game/raw.bin'), bytes(range(256)), compress_type=zipfile.ZIP_STORED)
    z.comment = b'a comment at the end'`, theirs);
    const files = await readZip(readFileSync(theirs));
    assert(files.map((f) => f.name).join() === 'game/main.pb,game/raw.bin', files.map((f) => f.name).join());
    assert(new TextDecoder().decode(files[0].data) === 'Print "hi"\n'.repeat(100), 'deflated text');
    assert(same(files[1].data, Uint8Array.from({ length: 256 }, (_, i) => i)), 'stored bytes');
  }
  finally
  {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('damaged and foreign files are refused with a clear message', async () =>
{
  const zip = await writeZip(SAMPLE);
  const damaged = zip.slice();
  // Flip a byte inside the first entry's compressed data.
  damaged[40] ^= 0xff;
  let message = '';
  try
  {
    await readZip(damaged);
  }
  catch (e)
  {
    message = e.message;
  }
  assert(/damaged|check failed|invalid|incorrect/i.test(message), `damaged: ${message}`);

  message = '';
  try
  {
    await readZip(new TextEncoder().encode('just some text, not a zip'));
  }
  catch (e)
  {
    message = e.message;
  }
  assert(message === 'this is not a zip file', message);

  message = '';
  try
  {
    await writeZip([{ name: 'a.pb', data: '' }, { name: 'a.pb', data: '' }]);
  }
  catch (e)
  {
    message = e.message;
  }
  assert(/repeated/.test(message), message);
});

export default unit;
