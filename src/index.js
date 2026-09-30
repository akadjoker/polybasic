// PolyBasic: compile and run in one place.

import { compile } from './compiler/index.js';
import { loadProgram, runProgram } from './runtime/index.js';

export { compile, CompileError, CORE_COMMANDS } from './compiler/index.js';
export * from './runtime/index.js';

// Compiles `source`, loads it and runs it on `host`. Compile errors are
// thrown (CompileError); runtime results come back from runProgram.
export async function runSource(source, host, options = {})
{
  const { js, warnings } = compile(source, options);
  const module = await loadProgram(js);
  const result = await runProgram(module, host, options);
  return { ...result, warnings };
}
