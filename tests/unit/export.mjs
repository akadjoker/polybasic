// Projects out of the playground and back: .zip files and the one-page
// export.

import { projectToZip, projectFromZip, projectPage, embedJson, PROJECT_INFO } from '../../web/export.js';
import { writeZip, readZip } from '../../web/zip.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });
const enc = (t) => new TextEncoder().encode(t);
const dec = (b) => new TextDecoder().decode(b);

async function rejects(promise, pattern)
{
  try
  {
    await promise;
  }
  catch (e)
  {
    assert(pattern.test(e.message), e.message);
    return;
  }
  throw new Error('no error');
}

test('a project goes out as a .zip and comes back the same', async () =>
{
  const files = new Map([
    ['game.pb', enc('Include "lib/a.pb"\n')],
    ['lib/a.pb', enc('Print 1\n')],
    ['assets/a.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3])]
  ]);
  const zip = await projectToZip({ name: 'Space Game', main: 'game.pb' }, files);
  const names = (await readZip(zip)).map((e) => e.name);
  assert(names[0] === PROJECT_INFO, names.join());
  const back = await projectFromZip(zip, 'whatever.zip');
  assert(back.name === 'Space Game' && back.main === 'game.pb', JSON.stringify(back));
  assert(back.files.size === 3 && back.skipped.length === 0, [...back.files.keys()].join());
  for (const [path, bytes] of files) assert(back.files.get(path).join() === bytes.join(), path);
});

test('zips made by hand: one folder around everything, clutter, finding the main program', async () =>
{
  const handMade = await writeZip([
    { name: 'my-game/main.pb', data: 'Print 1\n' },
    { name: 'my-game/lib/x.pb', data: 'Print 2\n' },
    { name: '__MACOSX/my-game/._main.pb', data: 'junk' },
    { name: 'my-game/.DS_Store', data: 'junk' }
  ]);
  const a = await projectFromZip(handMade, 'my-game.zip');
  assert(a.name === 'my-game' && a.main === 'main.pb', JSON.stringify(a));
  assert([...a.files.keys()].sort().join() === 'lib/x.pb,main.pb', [...a.files.keys()].join());

  const one = await projectFromZip(await writeZip([{ name: 'shooter.pb', data: '' }, { name: 'art/ship.png', data: new Uint8Array(3) }]));
  assert(one.main === 'shooter.pb', one.main);
  await rejects(projectFromZip(await writeZip([{ name: 'a.pb', data: '' }, { name: 'b.pb', data: '' }])), /several programs/);
  await rejects(projectFromZip(await writeZip([{ name: 'readme.txt', data: 'hi' }])), /no PolyBasic program/);
  // A PROJECT_INFO naming a missing main program falls back to the rules.
  const odd = await projectFromZip(await writeZip([{ name: PROJECT_INFO, data: '{"name":"N","main":"gone.pb"}' }, { name: 'main.pb', data: '' }]));
  assert(odd.name === 'N' && odd.main === 'main.pb', JSON.stringify(odd));
});

test('the exported page carries everything, and no text inside can end its script blocks', () =>
{
  const tricky = 'a </script><script>alert(1)</script> <!-- b   c   d';
  const embedded = embedJson({ tricky });
  assert(!embedded.includes('<'), embedded);
  assert(JSON.parse(embedded).tricky === tricky, 'does not read back the same');

  const files = new Map([['main.pb', enc('Print "</script>"\n')], ['assets/a.bin', new Uint8Array([0, 255, 60, 47])]]);
  const html = projectPage({ name: 'My <Game>', main: 'main.pb', files, js: 'export const x = "</script>";', engine: 'export {}; // </script>', physics: null });
  assert(html.includes('<title>My &lt;Game&gt;</title>'), 'title not escaped');
  assert(!html.includes('id="pb-physics"'), 'physics included without being asked');
  const blocks = [...html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)];
  assert(blocks.map((b) => b[1]).join() === 'pb-game,pb-engine', blocks.map((b) => b[1]).join());
  const game = JSON.parse(blocks[0][2]);
  assert(game.main === 'main.pb' && game.js === 'export const x = "</script>";', JSON.stringify(game).slice(0, 200));
  const bin = Uint8Array.from(atob(game.files['assets/a.bin']), (c) => c.charCodeAt(0));
  assert(bin.join() === '0,255,60,47', bin.join());
  assert(dec(Uint8Array.from(atob(game.files['main.pb']), (c) => c.charCodeAt(0))) === 'Print "</script>"\n', 'text file');
  assert(JSON.parse(blocks[1][2]) === 'export {}; // </script>', 'engine text');
  const withPhysics = projectPage({ name: 'P', main: 'main.pb', files, js: '', engine: '', physics: 'export const RapierBackend = {};' });
  assert(withPhysics.includes('id="pb-physics"'), 'physics missing');
});

export default unit;
