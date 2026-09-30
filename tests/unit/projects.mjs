// Playground projects: the store's rules, on its memory fallback (Node has
// no IndexedDB; the browser tests use the real one).

import { ProjectStore, cleanPath } from '../../web/projects.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });
const text = (bytes) => new TextDecoder().decode(bytes);

async function rejects(promise, pattern, what)
{
  try
  {
    await promise;
  }
  catch (e)
  {
    assert(pattern.test(e.message), `${what}: ${e.message}`);
    return;
  }
  throw new Error(`${what}: no error`);
}

test('file names: relative paths with "/" between folders', () =>
{
  assert(cleanPath('lib\\util.pb') === 'lib/util.pb', 'backslashes');
  assert(cleanPath('./main.pb') === 'main.pb', 'leading ./');
  for (const bad of ['', '/abs.pb', '../up.pb', 'a//b.pb', 'a/./b', 'what?.pb'])
  {
    assert(cleanPath(bad) instanceof Error, `"${bad}" accepted`);
  }
});

test('create, list, read, write, rename and delete files and projects', async () =>
{
  const store = await ProjectStore.open();
  assert(store.persistent === false, 'Node has no IndexedDB: memory');
  const a = await store.create('Game', { 'main.pb': 'Print 1\n', 'assets/a.png': new Uint8Array([1, 2, 3]) });
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.create('Other', { 'start.pb': 'Print 2\n' }, 'start.pb');
  assert((await store.list()).map((p) => p.name).join() === 'Other,Game', 'newest first');
  assert(a.paths.join() === 'assets/a.png,main.pb', a.paths.join());

  await store.writeFile(a.id, 'lib/util.pb', 'Function F()\nEnd Function\n');
  const files = await store.readAll(a.id);
  assert([...files.keys()].sort().join() === 'assets/a.png,lib/util.pb,main.pb', [...files.keys()].join());
  assert(text(files.get('main.pb')) === 'Print 1\n', 'text');
  assert((await store.get(a.id)).modified >= a.modified, 'modified');

  await store.renameFile(a.id, 'main.pb', 'game.pb');
  const renamed = await store.get(a.id);
  assert(renamed.main === 'game.pb' && renamed.paths.includes('game.pb') && !renamed.paths.includes('main.pb'), 'renamed main');
  assert(text(await store.readFile(a.id, 'game.pb')) === 'Print 1\n', 'data moved');
  await rejects(store.renameFile(a.id, 'game.pb', 'lib/util.pb'), /already a file/, 'rename onto another');
  await rejects(store.deleteFile(a.id, 'game.pb'), /main program cannot be deleted/, 'delete main');
  await store.deleteFile(a.id, 'assets/a.png');
  assert(!(await store.get(a.id)).paths.includes('assets/a.png'), 'deleted');
  await store.setMain(a.id, 'lib/util.pb');
  assert((await store.get(a.id)).main === 'lib/util.pb', 'main moved');
  await rejects(store.setMain(a.id, 'nope.pb'), /no file/, 'main that does not exist');

  await store.rename(b.id, 'Renamed');
  assert((await store.get(b.id)).name === 'Renamed', 'project renamed');
  await store.remove(b.id);
  assert((await store.get(b.id)) === null && (await store.readAll(b.id)).size === 0, 'project removed with its files');
  await rejects(store.create('X', { 'a.pb': '' }, 'main.pb'), /not among the files/, 'main missing');
});

export default unit;
