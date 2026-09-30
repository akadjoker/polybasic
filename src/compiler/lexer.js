// The lexer turns PolyBasic source text into a flat list of tokens.
//
// The tokenising rules follow the Blitz3D compiler's toker (derived from the
// Blitz3D compiler, (c) Blitz Research Ltd, zlib licence; see
// LICENSE-THIRD-PARTY): the language is line based, so newlines are tokens,
// `;` starts a comment, keywords and identifiers ignore case, and a few
// keywords are spelled as two words ("End If", "Else If").

import { CompileError } from './errors.js';

// Every keyword, keyed by its lower-case spelling. The value is the canonical
// token name the parser matches on. Two-word forms map to the same name as
// their one-word forms.
const KEYWORDS = new Map([
  ['dim', 'dim'], ['exit', 'exit'], ['return', 'return'],
  ['if', 'if'], ['then', 'then'], ['else', 'else'], ['elseif', 'elseif'],
  ['endif', 'endif'], ['while', 'while'], ['wend', 'wend'],
  ['for', 'for'], ['to', 'to'], ['step', 'step'], ['next', 'next'], ['each', 'each'],
  ['function', 'function'], ['endfunction', 'endfunction'],
  ['type', 'type'], ['endtype', 'endtype'], ['field', 'field'],
  ['global', 'global'], ['local', 'local'], ['const', 'const'],
  ['select', 'select'], ['case', 'case'], ['default', 'default'], ['endselect', 'endselect'],
  ['repeat', 'repeat'], ['until', 'until'], ['forever', 'forever'],
  ['data', 'data'], ['read', 'read'], ['restore', 'restore'],
  ['include', 'include'], ['end', 'end'],
  ['new', 'new'], ['delete', 'delete'], ['first', 'first'], ['last', 'last'],
  ['insert', 'insert'], ['before', 'before'], ['after', 'after'], ['null', 'null'],
  ['and', 'and'], ['or', 'or'], ['xor', 'xor'], ['not', 'not'],
  ['mod', 'mod'], ['shl', 'shl'], ['shr', 'shr'], ['sar', 'sar'],
  ['pi', 'pi'], ['true', 'true'], ['false', 'false']
]);

// "End" and "Else" combine with the following word into one keyword.
const TWO_WORD = new Map([
  ['end if', 'endif'], ['end function', 'endfunction'], ['end type', 'endtype'],
  ['end select', 'endselect'], ['else if', 'elseif']
]);

// Keywords removed from the language on purpose. Recognising them lets the
// parser explain what to do instead of reporting a confusing syntax error.
export const RETIRED = new Map([
  ['goto', 'Goto is not part of PolyBasic: use loops, Exit and functions instead'],
  ['gosub', 'Gosub is not part of PolyBasic: move the code into a Function and call it']
]);

const isDigit = (c) => c >= '0' && c <= '9';
const isHex = (c) => isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isAlnum = (c) => isAlpha(c) || isDigit(c);

// Token shape: { t, v, text, line, col, file, glued }
//   t     'ident' | 'int' | 'float' | 'string' | 'kw' | 'op' | 'nl' | 'eof'
//   v     keyword name, operator symbol, lower-case identifier or literal value
//   text  the source spelling (identifiers keep it for friendly messages)
//   glued true when no whitespace separates this token from the previous one;
//         type sigils (`x%`, `name$`, `v.Vec`) must be glued to their name.
export function tokenize(source, file)
{
  const tokens = [];
  const src = source.replace(/\r\n?/g, '\n');
  let pos = 0;
  let line = 1;
  let lineStart = 0;
  let glued = false;

  const push = (t, v, text, start) =>
  {
    tokens.push({ t, v, text, line, col: start - lineStart + 1, file, glued });
    glued = true;
  };
  const fail = (message, start) =>
  {
    throw new CompileError(message, { file, line, col: start - lineStart + 1 });
  };

  while (pos < src.length)
  {
    const c = src[pos];
    const start = pos;

    if (c === '\n')
    {
      push('nl', '\n', '\n', start);
      pos++;
      line++;
      lineStart = pos;
      glued = false;
      continue;
    }
    if (c === ' ' || c === '\t')
    {
      pos++;
      glued = false;
      continue;
    }
    if (c === ';')
    {
      while (pos < src.length && src[pos] !== '\n') pos++;
      continue;
    }

    // Numbers: 12, 1.5, .5 and 3. are all accepted.
    if (isDigit(c) || (c === '.' && isDigit(src[pos + 1] || '')))
    {
      while (isDigit(src[pos] || '')) pos++;
      let isFloat = false;
      if (src[pos] === '.' && !isAlpha(src[pos + 1] || ''))
      {
        isFloat = true;
        pos++;
        while (isDigit(src[pos] || '')) pos++;
      }
      const text = src.slice(start, pos);
      if (isFloat) push('float', parseFloat(text), text, start);
      else push('int', parseIntLiteral(text, 10), text, start);
      continue;
    }

    // $FF hex and %1010 binary literals. A `$` or `%` glued to a name is a
    // type sigil instead (`name$`, `count%`), so only read a literal when
    // the previous token cannot own a sigil.
    const prev = tokens[tokens.length - 1];
    const canTakeSigil = glued && prev && (prev.t === 'ident' || prev.t === 'kw');
    if (c === '$' && isHex(src[pos + 1] || '') && !canTakeSigil)
    {
      pos++;
      while (isHex(src[pos] || '')) pos++;
      push('int', parseIntLiteral(src.slice(start + 1, pos), 16), src.slice(start, pos), start);
      continue;
    }
    if (c === '%' && (src[pos + 1] === '0' || src[pos + 1] === '1') && !canTakeSigil)
    {
      pos++;
      while (src[pos] === '0' || src[pos] === '1') pos++;
      push('int', parseIntLiteral(src.slice(start + 1, pos), 2), src.slice(start, pos), start);
      continue;
    }

    if (isAlpha(c))
    {
      while (isAlnum(src[pos] || '')) pos++;
      let text = src.slice(start, pos);
      let lower = text.toLowerCase();

      // Try to join "End If", "Else If" and friends into one keyword.
      if (lower === 'end' || lower === 'else')
      {
        let k = pos;
        while (src[k] === ' ' || src[k] === '\t') k++;
        if (k > pos && isAlpha(src[k] || ''))
        {
          let e = k;
          while (isAlnum(src[e] || '')) e++;
          const joined = TWO_WORD.get(lower + ' ' + src.slice(k, e).toLowerCase());
          if (joined)
          {
            text = src.slice(start, e);
            lower = joined;
            pos = e;
          }
        }
      }

      if (KEYWORDS.has(lower)) push('kw', KEYWORDS.get(lower), text, start);
      else if (RETIRED.has(lower)) fail(RETIRED.get(lower), start);
      else push('ident', lower, text, start);
      continue;
    }

    if (c === '"')
    {
      pos++;
      while (pos < src.length && src[pos] !== '"' && src[pos] !== '\n') pos++;
      if (src[pos] !== '"') fail('This string is missing its closing quote (")', start);
      pos++;
      push('string', src.slice(start + 1, pos - 1), src.slice(start, pos), start);
      continue;
    }

    // Two-character comparison operators. Blitz also accepted the reversed
    // spellings (=<, =>, ><); PolyBasic keeps only the usual ones.
    const two = src.slice(pos, pos + 2);
    if (two === '<>' || two === '<=' || two === '>=')
    {
      pos += 2;
      push('op', two, two, start);
      continue;
    }

    if ('+-*/^=<>(),:\\[]%#$.~'.includes(c))
    {
      pos++;
      push('op', c, c, start);
      continue;
    }

    fail(`Unexpected character '${c}'`, start);
  }

  push('nl', '\n', '\n', pos);
  tokens.push({ t: 'eof', v: 'eof', text: 'end of file', line, col: pos - lineStart + 1, file, glued: false });
  return tokens;
}

// Integer literals keep 32-bit semantics: $FFFFFFFF is -1, like in Blitz.
function parseIntLiteral(digits, base)
{
  let value = 0;
  for (const d of digits) value = (value * base + parseInt(d, base)) % 4294967296;
  return value | 0;
}
