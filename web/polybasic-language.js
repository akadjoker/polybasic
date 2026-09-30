// PolyBasic support for the playground's CodeMirror editor: highlighting,
// completion and live error checking. The word lists come from the
// compiler and the engine themselves, so the editor always agrees with
// what the compiler accepts.

import {
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
  linter,
  lintGutter,
  autocompletion,
  tags
} from './vendor/codemirror.js';
import {
  compile, KEYWORDS, CORE_COMMANDS, ENGINE_COMMANDS, SPECIAL_COMMANDS, ENGINE_CONSTANTS, parseSignature
} from '../dist/polybasic.js';

const KEYWORD_SET = new Set([...KEYWORDS.keys(), 'end', 'else']);
const COMMANDS = new Map();
for (const sig of [...CORE_COMMANDS, ...ENGINE_COMMANDS])
{
  const c = parseSignature(sig);
  COMMANDS.set(c.key, { name: c.name, signature: sig });
}
for (const name of SPECIAL_COMMANDS) COMMANDS.set(name.toLowerCase(), { name, signature: `${name}(value)` });
const CONSTANTS = new Map(Object.keys(ENGINE_CONSTANTS).map((k) => [k.toLowerCase(), k]));
const DECLARING = new Set(['function', 'type']);

// Keyword spellings for completion: the canonical forms, capitalised the
// way the documentation writes them.
const KEYWORD_LABELS = [
  'Dim', 'Exit', 'Return', 'If', 'Then', 'Else', 'ElseIf', 'EndIf', 'While', 'Wend', 'For', 'To', 'Step',
  'Next', 'Each', 'Function', 'End Function', 'Type', 'End Type', 'Field', 'Global', 'Local', 'Const',
  'Select', 'Case', 'Default', 'End Select', 'Repeat', 'Until', 'Forever', 'Data', 'Read', 'Restore',
  'Include', 'End', 'New', 'Delete', 'First', 'Last', 'Insert', 'Before', 'After', 'Null', 'And', 'Or',
  'Xor', 'Not', 'Mod', 'Shl', 'Shr', 'Sar', 'Pi', 'True', 'False'
];

const streamParser = {
  name: 'polybasic',
  startState()
  {
    return { expectName: false, afterName: false, lastWord: '' };
  },
  token(stream, state)
  {
    const afterName = state.afterName;
    state.afterName = false;
    if (stream.eatSpace()) return null;
    if (stream.eat(';'))
    {
      stream.skipToEnd();
      return 'comment';
    }
    const ch = stream.peek();
    if (ch === '"')
    {
      stream.next();
      stream.skipTo('"') ? stream.next() : stream.skipToEnd();
      return 'string';
    }
    // Sigils glued to a name: x%, speed#, name$, player.Ship
    if (afterName && (ch === '%' || ch === '#' || ch === '$'))
    {
      stream.next();
      return 'typeName';
    }
    if (afterName && ch === '.' && stream.match(/^\.[A-Za-z_][A-Za-z0-9_]*/))
    {
      state.afterName = false;
      return 'typeName';
    }
    if (stream.match(/^\$[0-9A-Fa-f]+/) || stream.match(/^%[01]+/) || stream.match(/^(\d+\.?\d*|\.\d+)/))
    {
      return 'number';
    }
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/))
    {
      const word = stream.current().toLowerCase();
      const previous = state.lastWord;
      state.lastWord = word;
      state.afterName = true;
      if (state.expectName)
      {
        state.expectName = false;
        return 'def';
      }
      if (KEYWORD_SET.has(word))
      {
        // "Function Name" declares a name; "End Function" does not.
        state.expectName = DECLARING.has(word) && previous !== 'end';
        state.afterName = false;
        return 'keyword';
      }
      if (CONSTANTS.has(word)) return 'atom';
      if (COMMANDS.has(word)) return 'builtin';
      return 'variableName';
    }
    stream.next();
    return 'operator';
  },
  languageData: {
    commentTokens: { line: ';' }
  },
  tokenTable: {
    def: tags.definition(tags.function(tags.variableName)),
    builtin: tags.standard(tags.variableName),
    typeName: tags.typeName
  }
};

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea', fontWeight: '600' },
  { tag: tags.atom, color: '#f78c6c' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.string, color: '#c3e88d' },
  { tag: tags.comment, color: '#6b7f94', fontStyle: 'italic' },
  { tag: tags.typeName, color: '#ffcb6b' },
  { tag: tags.standard(tags.variableName), color: '#82aaff' },
  { tag: tags.definition(tags.function(tags.variableName)), color: '#89ddff', fontWeight: '600' },
  { tag: tags.operator, color: '#89ddff' }
]);

// Compile the whole document; a CompileError becomes an error diagnostic
// at its line and column, warnings become warnings. Nothing runs.
// `readFile` reads Include files (a project's). Problems found in another
// file are shown on the first line, naming that file.
export function compileDiagnostics(source, doc, file, readFile = null)
{
  const here = (d) => !d.file || d.file === file;
  const elsewhere = (d) => ({ message: `${d.message} (in ${d.file}, line ${d.line})`, line: 1, column: 1 });
  try
  {
    const { warnings } = compile(source, { file, readFile: readFile || undefined });
    return warnings.filter(here).map((w) => toDiagnostic(w, doc, 'warning'));
  }
  catch (err)
  {
    return [toDiagnostic(here(err) ? err : elsewhere(err), doc, 'error')];
  }
}

export function toDiagnostic(err, doc, severity = 'error')
{
  const message = err.message || String(err);
  if (!Number.isInteger(err.line) || err.line < 1 || err.line > doc.lines)
  {
    return { from: 0, to: Math.min(doc.length, doc.line(1).to), severity, message };
  }
  const line = doc.line(err.line);
  const from = Math.min(line.from + Math.max(0, (err.column || 1) - 1), line.to);
  const word = doc.sliceString(from, line.to).match(/^[A-Za-z0-9_]+/);
  const to = word ? from + word[0].length : Math.min(from + 1, line.to);
  return { from, to: Math.max(to, from), severity, message };
}

// Names the program declares, for completion.
function declaredNames(text)
{
  const names = new Set();
  const re = /\b(?:function|global|local|const|type)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(text)) !== null) names.add(m[1]);
  return names;
}

function completionSource()
{
  const fixed = [
    ...KEYWORD_LABELS.map((k) => ({ label: k, type: 'keyword' })),
    ...[...CONSTANTS.values()].map((c) => ({ label: c, type: 'constant' })),
    ...[...COMMANDS.values()].map((c) => ({ label: c.name, type: 'function', detail: c.signature.slice(c.signature.indexOf('(')) }))
  ];
  return (context) =>
  {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const own = [...declaredNames(context.state.doc.toString())].map((name) => ({ label: name, type: 'variable' }));
    return { from: word.from, options: [...own, ...fixed], validFor: /^[A-Za-z0-9_]*$/ };
  };
}

// `context()` gives { file, readFile } for the document being edited.
export function polybasicLanguage(context)
{
  return [
    StreamLanguage.define(streamParser),
    syntaxHighlighting(highlightStyle),
    autocompletion({ override: [completionSource()] }),
    lintGutter(),
    linter((view) =>
    {
      const { file, readFile } = context();
      return compileDiagnostics(view.state.doc.toString(), view.state.doc, file, readFile);
    }, { delay: 400 })
  ];
}
