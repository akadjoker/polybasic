// Compiler entry point: PolyBasic source in, JavaScript module text out.

import { parse } from './parser.js';
import { analyse } from './semant.js';
import { generate } from './codegen.js';

export { CompileError } from './errors.js';
export { CORE_COMMANDS } from './builtins.js';

// options:
//   file      name of the source file, used in messages (default "main.pb")
//   readFile  (path) => text, needed for Include
//   resolve   (fromFile, name) => path for an Include (default: relative)
//   commands  extra command signatures (see builtins.js)
//
// Returns { js, warnings, info }. Throws CompileError on the first mistake.
export function compile(source, options = {})
{
  const ast = parse(source, options);
  const sem = analyse(ast, options);
  const js = generate(sem, options);
  return {
    js,
    warnings: sem.warnings,
    info: {
      hasUpdate: sem.update !== null,
      hasDraw: sem.draw !== null,
      functions: sem.functions.map((f) => f.name),
      types: sem.types.map((t) => t.name),
      files: sem.files
    }
  };
}
