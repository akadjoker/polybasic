// Every example compiles without warnings and runs 300 Updates on the
// headless engine without a runtime error.

import { readdirSync, readFileSync } from 'node:fs';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { assert } from './assert.mjs';

const dir = new URL('../../examples/', import.meta.url);

export default readdirSync(dir).filter((f) => f.endsWith('.pb')).sort().map((file) => ({
  name: `examples/${file} runs headless`,
  async fn()
  {
    const { js, warnings } = compile(readFileSync(new URL(file, dir), 'utf8'), { file });
    assert(warnings.length === 0, `warnings: ${warnings.map((w) => w.message).join('; ')}`);
    const host = new CaptureHost();
    const result = await runProgram(await loadProgram(js), host, { engine: new Engine(), maxUpdates: 300 });
    assert(result.status !== 'error', `${result.error && result.error.message} (line ${result.error && result.error.line})`);
  }
}));
