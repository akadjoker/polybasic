// The compile-time types of PolyBasic.
//
//   Int      32-bit whole number (sigil %), the default for untagged names
//   Float    double precision number (sigil #)
//   String   text (sigil $)
//   Type     a reference to an object of a user Type (tag .Name), or Null
//
// Arrays are not values: a Dim array or a fixed-size `[n]` array is always
// reached through its name, so they only appear as declaration kinds.

export const INT = { kind: 'int', name: 'Int', sigil: '%' };
export const FLOAT = { kind: 'float', name: 'Float', sigil: '#' };
export const STRING = { kind: 'string', name: 'String', sigil: '$' };
export const NULL = { kind: 'null', name: 'Null' };
export const VOID = { kind: 'void', name: 'nothing' };

export function isNumeric(t)
{
  return t === INT || t === FLOAT;
}

export function isObject(t)
{
  return t.kind === 'struct' || t === NULL;
}

// What a value of this type is called in an error message.
export function typeLabel(t)
{
  if (t === NULL) return 'Null';
  if (t === VOID) return 'nothing (it does not return a value)';
  const name = t.kind === 'struct' ? `${t.name} object` : t.name;
  return (/^[AEIOU]/i.test(name) ? 'an ' : 'a ') + name;
}

export function sigilType(sigil)
{
  if (sigil === '%') return INT;
  if (sigil === '#') return FLOAT;
  return STRING;
}

// Int, Float and String convert into each other freely; objects only into
// objects of the same Type (Null fits any Type).
export function canConvert(from, to)
{
  if (from === to) return true;
  if (from.kind === 'struct' || to.kind === 'struct') return from === NULL && to.kind === 'struct';
  if (from === NULL || from === VOID || to === VOID) return false;
  return true;
}

// The zero value a variable of this type starts with.
export function zeroValue(t)
{
  if (t === INT || t === FLOAT) return 0;
  if (t === STRING) return '';
  return null;
}
