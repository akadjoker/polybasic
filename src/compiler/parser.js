// The parser builds the abstract syntax tree of a PolyBasic program.
//
// Its structure (statement sequences that stop at the first token they do
// not understand, the look-ahead that tells `Foo (a) * 2` from `Foo(a)`, the
// operator levels) follows the parser of the Blitz3D compiler, derived from
// the Blitz3D compiler, (c) Blitz Research Ltd, zlib licence; see
// LICENSE-THIRD-PARTY. PolyBasic simplifies it in places: there are no
// labels, Goto or Gosub, and `Not` sits just above And/Or instead of below
// them.
//
// Nodes are plain objects: { kind, pos, ...fields }. `pos` is
// { file, line, col } and is what every error message points at.

import { CompileError } from './errors.js';
import { tokenize } from './lexer.js';

// Parse a whole program. `readFile(path)` returns the text of an Include
// file (or throws); `resolve(fromFile, name)` turns an Include name into
// the path handed to readFile.
export function parse(source, options = {})
{
  const file = options.file || 'main.pb';
  const parser = new Parser(options);
  return parser.parseProgram(source, file);
}

const STATEMENT_END = new Set(['nl', 'eof']);

class Parser
{
  constructor(options)
  {
    this.readFile = options.readFile || null;
    this.resolve = options.resolve || defaultResolve;
    this.program = { types: [], consts: [], funcs: [], datas: [], main: [], files: [] };
    this.arrays = new Set();
    this.included = new Set();
    this.inFunction = null;
  }

  // ---------------------------------------------------------------- tokens

  get tok()
  {
    return this.tokens[this.index];
  }

  peek(n)
  {
    return this.tokens[Math.min(this.index + n, this.tokens.length - 1)];
  }

  next()
  {
    const t = this.tokens[this.index];
    if (this.index < this.tokens.length - 1) this.index++;
    return t;
  }

  isKw(name, tok = this.tok)
  {
    return tok.t === 'kw' && tok.v === name;
  }

  isOp(sym, tok = this.tok)
  {
    return tok.t === 'op' && tok.v === sym;
  }

  // True at the end of a statement: newline, `:`, end of file.
  atStatementEnd(tok = this.tok)
  {
    return STATEMENT_END.has(tok.t) || this.isOp(':', tok);
  }

  error(message, tok = this.tok)
  {
    return new CompileError(message, tok);
  }

  describe(tok)
  {
    if (tok.t === 'nl') return 'the end of the line';
    if (tok.t === 'eof') return 'the end of the file';
    return `'${tok.text}'`;
  }

  expected(what)
  {
    const tok = this.tok;
    // A closing keyword with no opener is the most common beginner mistake;
    // say so directly instead of "expected expression".
    const orphan = {
      next: "'Next' without a matching 'For'",
      wend: "'Wend' without a matching 'While'",
      else: "'Else' without a matching 'If'",
      elseif: "'ElseIf' without a matching 'If'",
      endif: "'EndIf' without a matching 'If'",
      endfunction: "'End Function' without a matching 'Function'",
      endtype: "'End Type' without a matching 'Type'",
      until: "'Until' without a matching 'Repeat'",
      forever: "'Forever' without a matching 'Repeat'",
      case: "'Case' without a matching 'Select'",
      default: "'Default' without a matching 'Select'",
      endselect: "'End Select' without a matching 'Select'"
    };
    if (tok.t === 'kw' && orphan[tok.v] && what !== 'expression') return this.error(orphan[tok.v]);
    return this.error(`Expected ${what} but found ${this.describe(tok)}`);
  }

  expectOp(sym)
  {
    if (!this.isOp(sym)) throw this.expected(`'${sym}'`);
    return this.next();
  }

  expectIdent(what = 'a name')
  {
    if (this.tok.t !== 'ident')
    {
      if (this.tok.t === 'kw') throw this.error(`'${this.tok.text}' is a keyword and cannot be used as ${what}`);
      throw this.expected(what);
    }
    return this.next();
  }

  // Closing keyword of a block, with a message naming where the block began.
  expectClose(kw, spelling, opener, openTok)
  {
    if (this.isKw(kw)) return this.next();
    if (this.tok.t === 'eof')
    {
      throw this.error(`${opener} on line ${openTok.line} is missing its '${spelling}'`);
    }
    throw this.expected(`'${spelling}' to close the ${opener} on line ${openTok.line}`);
  }

  // ---------------------------------------------------------------- program

  parseProgram(source, file)
  {
    this.loadTokens(source, file);
    const body = this.parseStatements('main');
    if (this.tok.t !== 'eof') throw this.expected('a statement');
    this.program.main = body;
    return this.program;
  }

  loadTokens(source, file)
  {
    this.tokens = tokenize(source, file);
    this.index = 0;
    this.included.add(file);
    this.program.files.push(file);
    // Arrays are called like functions (`grid(x, y)`), so the parser needs
    // to know every Dim'd name up front to tell the two apart.
    for (let i = 0; i + 1 < this.tokens.length; i++)
    {
      if (this.isKw('dim', this.tokens[i]) && this.tokens[i + 1].t === 'ident')
      {
        this.arrays.add(this.tokens[i + 1].v);
      }
    }
  }

  // Reads statements until a token that cannot start one. `mode` is 'main'
  // (the program's top level), 'block' (inside a loop, If, ...) or 'line'
  // (the rest of a single-line If, which stops at the newline).
  parseStatements(mode)
  {
    const list = [];
    for (;;)
    {
      while (this.isOp(':') || (mode !== 'line' && this.tok.t === 'nl')) this.next();
      const stmt = this.parseStatement(mode, list);
      if (stmt === null) return list;
      if (stmt !== undefined) list.push(stmt);
    }
  }

  // Returns a node, `undefined` when the statement produced nothing (it was
  // hoisted, like Function or Const), or null at the end of the sequence.
  parseStatement(mode, list)
  {
    const tok = this.tok;
    if (tok.t === 'ident') return this.parseIdentStatement();
    if (this.isOp('.')) throw this.error('Labels are not part of PolyBasic (there is no Goto or Gosub)');
    if (tok.t !== 'kw') return null;

    switch (tok.v)
    {
      case 'if':
        this.next();
        return this.parseIf(tok);
      case 'while':
        return this.parseWhile();
      case 'repeat':
        return this.parseRepeat();
      case 'for':
        return this.parseFor();
      case 'select':
        return this.parseSelect();
      case 'exit':
        this.next();
        return { kind: 'exit', pos: tok };
      case 'return':
        this.next();
        return { kind: 'return', pos: tok, expr: this.parseExprOpt() };
      case 'end':
        this.next();
        return { kind: 'end', pos: tok };
      case 'delete':
        this.next();
        if (this.isKw('each'))
        {
          this.next();
          return { kind: 'deleteEach', pos: tok, typeName: this.expectIdent('a Type name') };
        }
        return { kind: 'delete', pos: tok, expr: this.parseExpr() };
      case 'insert':
        return this.parseInsert();
      case 'read':
        this.next();
        for (;;)
        {
          list.push({ kind: 'read', pos: this.tok, target: this.parseVariable() });
          if (!this.isOp(',')) return undefined;
          this.next();
        }
      case 'restore':
        this.next();
        if (this.tok.t === 'ident') throw this.error('Restore takes no label in PolyBasic: it always goes back to the first Data item');
        return { kind: 'restore', pos: tok };
      case 'data':
        if (this.inFunction) throw this.error("'Data' can only be used in the main program, not inside a Function");
        do
        {
          this.next();
          this.program.datas.push(this.parseExpr());
        } while (this.isOp(','));
        return undefined;
      case 'dim':
        this.next();
        return this.parseDim(tok);
      case 'local':
        this.next();
        return { kind: 'local', pos: tok, decls: this.parseDeclList('local') };
      case 'global':
        if (this.inFunction) throw this.error("'Global' can only be used in the main program; declare the global outside the Function");
        this.next();
        if (this.isKw('dim'))
        {
          this.next();
          return this.parseDim(tok);
        }
        return { kind: 'global', pos: tok, decls: this.parseDeclList('global') };
      case 'const':
        if (this.inFunction) throw this.error("'Const' can only be used in the main program");
        this.next();
        for (const d of this.parseDeclList('const')) this.program.consts.push(d);
        return undefined;
      case 'type':
        if (mode !== 'main') throw this.error("'Type' can only be declared at the top level of the program");
        this.program.types.push(this.parseType());
        return undefined;
      case 'function':
        if (mode !== 'main') throw this.error("'Function' can only be declared at the top level of the program");
        this.program.funcs.push(this.parseFunction());
        return undefined;
      case 'include':
        if (mode !== 'main') throw this.error("'Include' can only be used at the top level of the program");
        this.parseInclude(list);
        return undefined;
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ statements

  // A statement starting with a name is a call (`Print "hi"`, `Spawn(1, 2)`)
  // or an assignment (`x = 1`, `grid(1, 2) = 3`, `p\x = 4`, `v[2] = 1`).
  parseIdentStatement()
  {
    const nameTok = this.tok;
    const tagged = this.peekTag(1);
    const after = this.peek(1 + tagged);
    const isArray = this.arrays.has(nameTok.v);
    const isAssign = this.isOp('=', after) || this.isOp('\\', after) || this.isOp('[', after);
    if (!isArray && !isAssign)
    {
      this.next();
      const tag = this.parseTag();
      let args;
      if (this.isOp('('))
      {
        // `Foo(1, 2)` and `Foo (1 + 2) * 3` both start with a bracket. The
        // brackets belong to the call only when nothing follows the match.
        if (this.bracketsEndStatement())
        {
          this.next();
          args = this.parseArgs(')');
          this.expectOp(')');
        }
        else args = this.parseArgs(null);
      }
      else args = this.parseArgs(null);
      return { kind: 'callStmt', pos: nameTok, call: { kind: 'call', pos: nameTok, name: nameTok, tag, args } };
    }
    const target = this.parseVariable();
    if (!this.isOp('=')) throw this.expected("'=' (an assignment)");
    this.next();
    return { kind: 'assign', pos: nameTok, target, expr: this.parseExpr() };
  }

  bracketsEndStatement()
  {
    let depth = 0;
    for (let k = 0; ; k++)
    {
      const t = this.peek(k);
      if (t.t === 'nl' || t.t === 'eof') throw this.error('This bracket is never closed', this.tok);
      if (this.isOp('(', t)) depth++;
      else if (this.isOp(')', t) && --depth === 0)
      {
        const after = this.peek(k + 1);
        return this.atStatementEnd(after) || this.isKw('else', after) || this.isKw('elseif', after);
      }
    }
  }

  // Comma separated arguments; empty when the statement ends right away.
  parseArgs(closer)
  {
    const args = [];
    if (closer && this.isOp(closer)) return args;
    if (!closer && (this.atStatementEnd() || this.isKw('else') || this.isKw('elseif'))) return args;
    for (;;)
    {
      args.push(this.parseExpr());
      if (!this.isOp(',')) return args;
      this.next();
    }
  }

  parseIf(ifTok)
  {
    const cond = this.parseExpr();
    if (this.isKw('then')) this.next();
    // Nothing after Then on the same line means a block If closed by EndIf.
    const block = this.tok.t === 'nl' || this.tok.t === 'eof';
    const thenBody = this.parseStatements(block ? 'block' : 'line');
    let elseBody = null;
    if (this.isKw('elseif'))
    {
      const t = this.next();
      elseBody = [this.parseIf(t)];
      return { kind: 'if', pos: ifTok, cond, thenBody, elseBody };
    }
    if (this.isKw('else'))
    {
      this.next();
      elseBody = this.parseStatements(block ? 'block' : 'line');
    }
    if (block) this.expectClose('endif', 'EndIf', 'If', ifTok);
    else if (!(this.tok.t === 'nl' || this.tok.t === 'eof')) throw this.expected('the end of the line');
    return { kind: 'if', pos: ifTok, cond, thenBody, elseBody };
  }

  parseWhile()
  {
    const tok = this.next();
    const cond = this.parseExpr();
    const body = this.parseStatements('block');
    this.expectClose('wend', 'Wend', 'While', tok);
    return { kind: 'while', pos: tok, cond, body };
  }

  parseRepeat()
  {
    const tok = this.next();
    const body = this.parseStatements('block');
    if (this.isKw('forever'))
    {
      this.next();
      return { kind: 'repeat', pos: tok, body, cond: null };
    }
    if (!this.isKw('until'))
    {
      if (this.tok.t === 'eof') throw this.error(`Repeat on line ${tok.line} is missing its 'Until' or 'Forever'`);
      throw this.expected(`'Until' or 'Forever' to close the Repeat on line ${tok.line}`);
    }
    this.next();
    return { kind: 'repeat', pos: tok, body, cond: this.parseExpr() };
  }

  parseFor()
  {
    const tok = this.next();
    const nameTok = this.expectIdent('a loop variable');
    const tag = this.parseTag();
    const variable = { kind: 'var', pos: nameTok, name: nameTok, tag };
    this.expectOp('=');
    if (this.isKw('each'))
    {
      this.next();
      const typeName = this.expectIdent('a Type name');
      const body = this.parseStatements('block');
      this.expectClose('next', 'Next', 'For Each', tok);
      this.skipNextName(nameTok);
      return { kind: 'forEach', pos: tok, variable, typeName, body };
    }
    const from = this.parseExpr();
    if (!this.isKw('to')) throw this.expected("'To'");
    this.next();
    const to = this.parseExpr();
    let step = null;
    if (this.isKw('step'))
    {
      this.next();
      step = this.parseExpr();
    }
    const body = this.parseStatements('block');
    this.expectClose('next', 'Next', 'For', tok);
    this.skipNextName(nameTok);
    return { kind: 'for', pos: tok, variable, from, to, step, body };
  }

  // `Next i` is allowed as a reminder of which loop is closing; it has to
  // name the loop's own variable.
  skipNextName(nameTok)
  {
    if (this.tok.t !== 'ident') return;
    if (this.tok.v !== nameTok.v)
    {
      throw this.error(`'Next ${this.tok.text}' does not match the loop variable '${nameTok.text}'`);
    }
    this.next();
    this.parseTag();
  }

  parseSelect()
  {
    const tok = this.next();
    const expr = this.parseExpr();
    const cases = [];
    let defaultBody = null;
    for (;;)
    {
      while (this.tok.t === 'nl' || this.isOp(':')) this.next();
      if (this.isKw('case'))
      {
        const caseTok = this.next();
        if (defaultBody) throw this.error("'Case' cannot come after 'Default'", caseTok);
        const values = this.parseArgs(null);
        if (!values.length) throw this.expected('a value after Case');
        cases.push({ pos: caseTok, values, body: this.parseStatements('block') });
      }
      else if (this.isKw('default'))
      {
        const defTok = this.next();
        if (defaultBody) throw this.error("A Select can only have one 'Default'", defTok);
        defaultBody = this.parseStatements('block');
      }
      else if (this.isKw('endselect'))
      {
        this.next();
        return { kind: 'select', pos: tok, expr, cases, defaultBody };
      }
      else if (this.tok.t === 'eof')
      {
        throw this.error(`Select on line ${tok.line} is missing its 'End Select'`);
      }
      else throw this.expected("'Case', 'Default' or 'End Select'");
    }
  }

  parseInsert()
  {
    const tok = this.next();
    const expr = this.parseExpr();
    if (!this.isKw('before') && !this.isKw('after')) throw this.expected("'Before' or 'After'");
    const before = this.next().v === 'before';
    return { kind: 'insert', pos: tok, expr, target: this.parseExpr(), before };
  }

  parseDim(tok)
  {
    const dims = [];
    do
    {
      if (dims.length) this.next();
      const nameTok = this.expectIdent('an array name');
      const tag = this.parseTag();
      this.expectOp('(');
      const sizes = this.parseArgs(')');
      this.expectOp(')');
      if (!sizes.length) throw this.error('An array needs at least one dimension', nameTok);
      dims.push({ pos: nameTok, name: nameTok, tag, sizes });
    } while (this.isOp(','));
    return { kind: 'dim', pos: tok, dims };
  }

  // Declarations after Local, Global, Const and Field:
  //   name[tag] [= expr]   or   name[tag][size]   (a fixed-size array)
  parseDeclList(kind)
  {
    const decls = [];
    for (;;)
    {
      const nameTok = this.expectIdent('a variable name');
      const tag = this.parseTag();
      const decl = { pos: nameTok, name: nameTok, tag, init: null, size: null };
      if (this.isOp('['))
      {
        if (kind === 'const') throw this.error('A Const cannot be an array');
        this.next();
        decl.size = this.parseExpr();
        this.expectOp(']');
      }
      else if (this.isOp('='))
      {
        if (kind === 'field') throw this.error('Fields cannot have a starting value; set it after New');
        this.next();
        decl.init = this.parseExpr();
      }
      else if (kind === 'const')
      {
        throw this.error(`Const '${nameTok.text}' needs a value, like: Const ${nameTok.text} = 10`);
      }
      decls.push(decl);
      if (!this.isOp(',')) return decls;
      this.next();
    }
  }

  parseType()
  {
    const tok = this.next();
    const nameTok = this.expectIdent('a Type name');
    const fields = [];
    for (;;)
    {
      while (this.tok.t === 'nl' || this.isOp(':')) this.next();
      if (!this.isKw('field')) break;
      this.next();
      for (const d of this.parseDeclList('field')) fields.push(d);
    }
    this.expectClose('endtype', 'End Type', 'Type', tok);
    return { kind: 'type', pos: nameTok, name: nameTok, fields };
  }

  parseFunction()
  {
    const tok = this.next();
    const nameTok = this.expectIdent('a function name');
    const tag = this.parseTag();
    this.expectOp('(');
    const params = [];
    if (!this.isOp(')'))
    {
      for (;;)
      {
        const pTok = this.expectIdent('a parameter name');
        const pTag = this.parseTag();
        let def = null;
        if (this.isOp('='))
        {
          this.next();
          def = this.parseExpr();
        }
        params.push({ pos: pTok, name: pTok, tag: pTag, def });
        if (!this.isOp(',')) break;
        this.next();
      }
    }
    this.expectOp(')');
    const fn = { kind: 'function', pos: nameTok, name: nameTok, tag, params, body: null };
    this.inFunction = fn;
    fn.body = this.parseStatements('block');
    this.inFunction = null;
    fn.endPos = this.tok;
    this.expectClose('endfunction', 'End Function', 'Function', tok);
    return fn;
  }

  parseInclude(list)
  {
    const tok = this.next();
    if (this.tok.t !== 'string') throw this.expected('a file name in quotes after Include');
    const name = this.next().v;
    const path = this.resolve(tok.file, name);
    if (this.included.has(path)) return;
    if (!this.readFile) throw this.error('Include is not available here (no file reader was given to the compiler)', tok);
    let text;
    try
    {
      text = this.readFile(path);
    }
    catch
    {
      throw this.error(`Cannot open the Include file "${name}"`, tok);
    }
    // Parse the included file with its own tokens, then carry on here.
    const saved = { tokens: this.tokens, index: this.index };
    this.loadTokens(text, path);
    const body = this.parseStatements('main');
    if (this.tok.t !== 'eof') throw this.expected('a statement');
    this.tokens = saved.tokens;
    this.index = saved.index;
    for (const s of body) list.push(s);
  }

  // ----------------------------------------------------------- variables

  // Number of tokens a glued type tag occupies at offset `k` (0, 1 or 2).
  peekTag(k)
  {
    const t = this.peek(k);
    if (!t.glued || t.t !== 'op') return 0;
    if (t.v === '%' || t.v === '#' || t.v === '$') return 1;
    if (t.v === '.' && this.peek(k + 1).t === 'ident' && this.peek(k + 1).glued) return 2;
    return 0;
  }

  // Type tags: `%` Int, `#` Float, `$` String, `.Name` a Type.
  parseTag()
  {
    const n = this.peekTag(0);
    if (n === 0) return null;
    const t = this.next();
    if (n === 1) return { pos: t, sigil: t.v };
    const nameTok = this.next();
    return { pos: t, typeName: nameTok };
  }

  parseVariable()
  {
    const nameTok = this.expectIdent('a variable name');
    const tag = this.parseTag();
    let node;
    if (this.arrays.has(nameTok.v) && this.isOp('('))
    {
      this.next();
      const indices = this.parseArgs(')');
      this.expectOp(')');
      node = { kind: 'index', pos: nameTok, name: nameTok, tag, indices };
    }
    else node = { kind: 'var', pos: nameTok, name: nameTok, tag };
    return this.parsePostfix(node);
  }

  // `obj\field` and `vec[index]` chains.
  parsePostfix(node)
  {
    for (;;)
    {
      if (this.isOp('\\'))
      {
        this.next();
        const fTok = this.expectIdent('a field name');
        const tag = this.parseTag();
        node = { kind: 'field', pos: fTok, object: node, name: fTok, tag };
      }
      else if (this.isOp('['))
      {
        const t = this.next();
        const index = this.parseExpr();
        this.expectOp(']');
        node = { kind: 'element', pos: t, vector: node, index };
      }
      else return node;
    }
  }

  // ---------------------------------------------------------- expressions
  //
  // Precedence, lowest first:
  //   And Or Xor  |  Not  |  = <> < > <= >=  |  + -  |  Shl Shr Sar
  //   * / Mod  |  ^  |  unary + - ~  |  primary

  parseExprOpt()
  {
    if (this.atStatementEnd() || this.isKw('else') || this.isKw('elseif')) return null;
    return this.parseExpr();
  }

  parseExpr()
  {
    let left = this.parseNot();
    for (;;)
    {
      const t = this.tok;
      if (!(this.isKw('and') || this.isKw('or') || this.isKw('xor'))) return left;
      this.next();
      left = { kind: 'binary', pos: t, op: t.v, left, right: this.parseNot() };
    }
  }

  parseNot()
  {
    if (this.isKw('not'))
    {
      const t = this.next();
      return { kind: 'not', pos: t, expr: this.parseNot() };
    }
    return this.parseCompare();
  }

  parseCompare()
  {
    let left = this.parseAdd();
    for (;;)
    {
      const t = this.tok;
      if (!(t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v))) return left;
      this.next();
      left = { kind: 'binary', pos: t, op: t.v, left, right: this.parseAdd() };
    }
  }

  parseAdd()
  {
    let left = this.parseShift();
    for (;;)
    {
      const t = this.tok;
      if (!(this.isOp('+') || this.isOp('-'))) return left;
      this.next();
      left = { kind: 'binary', pos: t, op: t.v, left, right: this.parseShift() };
    }
  }

  parseShift()
  {
    let left = this.parseMul();
    for (;;)
    {
      const t = this.tok;
      if (!(this.isKw('shl') || this.isKw('shr') || this.isKw('sar'))) return left;
      this.next();
      left = { kind: 'binary', pos: t, op: t.v, left, right: this.parseMul() };
    }
  }

  parseMul()
  {
    let left = this.parsePow();
    for (;;)
    {
      const t = this.tok;
      if (!(this.isOp('*') || this.isOp('/') || this.isKw('mod'))) return left;
      this.next();
      left = { kind: 'binary', pos: t, op: t.v, left, right: this.parsePow() };
    }
  }

  parsePow()
  {
    let left = this.parseUnary();
    for (;;)
    {
      const t = this.tok;
      if (!this.isOp('^')) return left;
      this.next();
      left = { kind: 'binary', pos: t, op: '^', left, right: this.parseUnary() };
    }
  }

  parseUnary()
  {
    const t = this.tok;
    if (this.isOp('-') || this.isOp('+') || this.isOp('~'))
    {
      this.next();
      return { kind: 'unary', pos: t, op: t.v, expr: this.parseUnary() };
    }
    if (this.isKw('before') || this.isKw('after'))
    {
      this.next();
      return { kind: t.v, pos: t, expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary()
  {
    const t = this.tok;
    switch (t.t)
    {
      case 'int':
        this.next();
        return { kind: 'int', pos: t, value: t.v };
      case 'float':
        this.next();
        return { kind: 'float', pos: t, value: t.v };
      case 'string':
        this.next();
        return { kind: 'string', pos: t, value: t.v };
      case 'ident':
        return this.parseNamePrimary();
      case 'op':
        if (t.v === '(')
        {
          this.next();
          const expr = this.parseExpr();
          this.expectOp(')');
          return expr;
        }
        break;
      case 'kw':
        switch (t.v)
        {
          case 'true':
            this.next();
            return { kind: 'int', pos: t, value: 1 };
          case 'false':
            this.next();
            return { kind: 'int', pos: t, value: 0 };
          case 'pi':
            this.next();
            return { kind: 'float', pos: t, value: Math.PI };
          case 'null':
            this.next();
            return { kind: 'null', pos: t };
          case 'new':
          case 'first':
          case 'last':
            this.next();
            return { kind: t.v, pos: t, typeName: this.expectIdent('a Type name') };
        }
        break;
    }
    throw this.expected('an expression');
  }

  parseNamePrimary()
  {
    const nameTok = this.tok;
    if (this.isOp('(', this.peek(1 + this.peekTag(1))) && !this.arrays.has(nameTok.v))
    {
      this.next();
      const tag = this.parseTag();
      this.next();
      const args = this.parseArgs(')');
      this.expectOp(')');
      return this.parsePostfix({ kind: 'call', pos: nameTok, name: nameTok, tag, args });
    }
    return this.parseVariable();
  }
}

// Include paths are relative to the file that includes them.
function defaultResolve(fromFile, name)
{
  if (name.startsWith('/')) return name;
  const slash = fromFile.lastIndexOf('/');
  const dir = slash >= 0 ? fromFile.slice(0, slash + 1) : '';
  const parts = [];
  for (const part of (dir + name).split('/'))
  {
    if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}
