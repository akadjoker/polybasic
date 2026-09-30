// The playground's examples, as "Save as project" copies them: each one
// runs with only its own .pb and the assets the manifest lists for it, so
// a copied project needs nothing else from the site.

import { readFileSync } from 'node:fs';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { loadRapier } from '../../src/node.js';
import { assert } from './assert.mjs';

const WEB = new URL('../../web/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('programs/manifest.json', WEB), 'utf8'));

export default manifest.programs.map((entry) => ({
  name: `${entry.id} runs from its project files alone`,
  async fn()
  {
    assert(Array.isArray(entry.assets), 'no assets list in the manifest');
    // Example paths are relative to the playground page, web/index.html.
    const exampleUrl = new URL(entry.file, WEB);
    const main = entry.file.split('/').pop();
    const files = new Map([[main, readFileSync(exampleUrl)]]);
    for (const asset of entry.assets) files.set(asset, readFileSync(new URL(asset, exampleUrl)));
    const read = (url) =>
    {
      const path = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
      const bytes = files.get(path);
      if (!bytes) return Promise.reject(new Error(`not in the project: ${path}`));
      return Promise.resolve(bytes);
    };
    const engine = new Engine({ baseUrl: `polybasic-project:///${main}`, loadFile: read, loadPhysics: loadRapier });
    const host = new CaptureHost();
    const warnings = [];
    host.debug = (text) => warnings.push(text);
    const { js } = compile(files.get(main).toString('utf8'), { file: main });
    const result = await runProgram(await loadProgram(js), host, { engine, maxUpdates: 120 });
    assert(result.status !== 'error', result.error && result.error.message);
    assert(warnings.length === 0, `warnings: ${warnings.join('; ')}`);
  }
}));
