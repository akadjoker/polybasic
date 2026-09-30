// Built-in commands the compiler knows about.
//
// Each command is described by a signature written in PolyBasic itself:
//
//   'Mid$(text$, start, count = -1)'
//
// The sigil after the name is the return type (none means the command
// returns nothing), parameters use the usual sigils (none means Int) and may
// have constant defaults. The runtime provides a function with the same
// lower-case name (see src/runtime/commands.js).
//
// Later phases add command sets (graphics, 3D, input) by passing more
// signatures to the compiler and more implementations to the runtime; the
// compiler itself does not change.

import { INT, STRING, VOID, sigilType } from './types.js';

export const CORE_COMMANDS = [
  // Output
  'Print(text$ = "")',
  'Write(text$)',
  'DebugLog(text$)',
  'RuntimeError(message$)',

  // Strings
  'Len%(text$)',
  'Left$(text$, count)',
  'Right$(text$, count)',
  'Mid$(text$, start, count = -1)',
  'Instr%(text$, find$, from = 1)',
  'Replace$(text$, find$, replacement$)',
  'Upper$(text$)',
  'Lower$(text$)',
  'Trim$(text$)',
  'LSet$(text$, size)',
  'RSet$(text$, size)',
  'Chr$(code)',
  'Asc%(text$)',
  'Hex$(value)',
  'Bin$(value)',
  'String$(text$, count)',

  // Maths (angles in degrees)
  'Sin#(degrees#)',
  'Cos#(degrees#)',
  'Tan#(degrees#)',
  'ASin#(value#)',
  'ACos#(value#)',
  'ATan#(value#)',
  'ATan2#(y#, x#)',
  'Sqr#(value#)',
  'Floor#(value#)',
  'Ceil#(value#)',
  'Exp#(value#)',
  'Log#(value#)',
  'Log10#(value#)',
  'Rnd#(from#, to# = 0)',
  'Rand%(from, to = 1)',
  'SeedRnd(seed)',
  'RndSeed%()',

  // Time and the frame loop
  'MilliSecs%()',
  'DeltaTime#()',
  'FrameCount%()'
];

// Commands whose type depends on their argument, or that are conversions.
// The semantic pass handles these by name; they are listed here so the name
// is reserved and documented in one place.
export const SPECIAL_COMMANDS = ['Int', 'Float', 'Str', 'Abs', 'Sgn', 'Min', 'Max'];

// Small maths commands are written straight into the generated code so hot
// loops do not pay for a call. `$0`, `$1` are the argument expressions.
const INLINE = {
  sin: 'Math.sin($0 * 0.017453292519943295)',
  cos: 'Math.cos($0 * 0.017453292519943295)',
  tan: 'Math.tan($0 * 0.017453292519943295)',
  asin: '(Math.asin($0) * 57.29577951308232)',
  acos: '(Math.acos($0) * 57.29577951308232)',
  atan: '(Math.atan($0) * 57.29577951308232)',
  atan2: '(Math.atan2($0, $1) * 57.29577951308232)',
  sqr: 'Math.sqrt($0)',
  floor: 'Math.floor($0)',
  ceil: 'Math.ceil($0)',
  exp: 'Math.exp($0)',
  log: 'Math.log($0)',
  log10: 'Math.log10($0)',
  len: '$0.length'
};

// Parses a signature string into { name, key, ret, params, inline }.
export function parseSignature(sig)
{
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)([%#$]?)\s*\((.*)\)\s*$/.exec(sig);
  if (!m) throw new Error(`Bad command signature: ${sig}`);
  const [, name, retSigil, paramText] = m;
  const params = [];
  for (const part of splitParams(paramText))
  {
    const p = /^\s*([A-Za-z_][A-Za-z0-9_]*)([%#$]?)\s*(?:=\s*(.+?))?\s*$/.exec(part);
    if (!p) throw new Error(`Bad parameter "${part}" in signature: ${sig}`);
    const type = p[2] ? sigilType(p[2]) : INT;
    let def;
    if (p[3] !== undefined)
    {
      const text = p[3];
      if (type === STRING) def = JSON.parse(text);
      else def = Number(text);
    }
    params.push({ name: p[1], type, def });
  }
  const key = name.toLowerCase();
  return {
    name,
    key,
    ret: retSigil ? sigilType(retSigil) : VOID,
    params,
    inline: INLINE[key] || null
  };
}

function splitParams(text)
{
  const parts = [];
  let current = '';
  let inString = false;
  for (const c of text)
  {
    if (c === '"') inString = !inString;
    if (c === ',' && !inString)
    {
      parts.push(current);
      current = '';
    }
    else current += c;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// Builds the lookup table the semantic pass uses.
export function buildCommandTable(extra = [])
{
  const table = new Map();
  for (const sig of [...CORE_COMMANDS, ...extra])
  {
    const cmd = parseSignature(sig);
    table.set(cmd.key, cmd);
  }
  return table;
}
