// The semantic pass: resolves names, gives every expression a type, inserts
// the implicit conversions between Int, Float and String, folds constant
// expressions and reports mistakes with a friendly message.
//
// The typing rules (which operand types give which result, implicit
// declaration of undeclared variables, constants folded in 32-bit integer
// arithmetic) follow the semantic pass of the Blitz3D compiler, derived from
// the Blitz3D compiler, (c) Blitz Research Ltd, zlib licence; see
// LICENSE-THIRD-PARTY.
//
// The pass rewrites the tree in place and returns a summary the code
// generator walks: types, globals, arrays, functions, the main body and the
// Data table.

import { CompileError } from './errors.js';
import { buildCommandTable } from './builtins.js';
import {
  INT, FLOAT, STRING, NULL, VOID,
  isNumeric, isObject, typeLabel, sigilType, canConvert
} from './types.js';
import { floatToInt, stringToInt, stringToFloat, floatToString } from '../runtime/convert.js';

// Functions the host calls every frame. They must be callable with no
// arguments.
export const FRAME_FUNCTIONS = ['update', 'draw'];

export function analyse(program, options = {})
{
  return new Analyser(program, options).run();
}

const fail = (message, pos) =>
{
  throw new CompileError(message, pos);
};

class Scope
{
  constructor(fn)
  {
    this.fn = fn;             // the function record, or null for the main program
    this.vars = new Map();    // lower-case name -> declaration
    this.loopDepth = 0;
    this.temps = 0;
  }
}

class Analyser
{
  constructor(program, options)
  {
    this.program = program;
    this.options = options;
    this.commands = buildCommandTable(options.commands || []);
    this.types = new Map();
    this.globals = new Map();
    this.arrays = new Map();
    this.funcs = new Map();
    this.warnings = [];
  }

  run()
  {
    const p = this.program;
    this.declareBuiltinConstants(this.options.constants || {});
    for (const t of p.types) this.declareType(t);
    for (const t of p.types) this.declareFields(t);
    for (const c of p.consts) this.declareConst(c);
    this.hoist(p.main, (s) => s.kind === 'global', (s) => this.declareGlobals(s));
    this.hoist(p.main, (s) => s.kind === 'dim', (s) => this.declareDims(s));
    for (const f of p.funcs) this.hoist(f.body, (s) => s.kind === 'dim', (s) => this.declareDims(s));
    for (const f of p.funcs) this.declareFunction(f);
    const data = p.datas.map((e) => this.dataValue(e));

    this.mainScope = new Scope(null);
    this.block(p.main, this.mainScope);
    const functions = [...this.funcs.values()];
    for (const fn of functions) this.functionBody(fn);

    return {
      types: [...this.types.values()],
      consts: p.consts,
      globals: [...this.globals.values()],
      arrays: [...this.arrays.values()],
      functions,
      main: { body: p.main, locals: [...this.mainScope.vars.values()], temps: this.mainScope.temps },
      data,
      update: this.funcs.get('update') || null,
      draw: this.funcs.get('draw') || null,
      files: p.files,
      warnings: this.warnings
    };
  }

  // Walks every statement list (into nested blocks) calling `visit` for the
  // statements that match. Used to find declarations before checking code.
  hoist(list, match, visit)
  {
    for (const s of list)
    {
      if (match(s)) visit(s);
      for (const key of ['body', 'thenBody', 'elseBody', 'defaultBody'])
      {
        if (Array.isArray(s[key])) this.hoist(s[key], match, visit);
      }
      if (s.cases) for (const c of s.cases) this.hoist(c.body, match, visit);
    }
  }

  // ------------------------------------------------------------ declarations

  tagType(tag)
  {
    if (!tag) return null;
    if (tag.sigil) return sigilType(tag.sigil);
    const t = this.types.get(tag.typeName.v);
    if (!t) fail(`There is no Type called '${tag.typeName.text}'`, tag.typeName);
    return t;
  }

  declareType(node)
  {
    const key = node.name.v;
    if (this.types.has(key)) fail(`Type '${node.name.text}' is declared twice`, node.pos);
    this.types.set(key, {
      kind: 'struct',
      name: node.name.text,
      key,
      js: 'T_' + key,
      list: 'L_' + key,
      fields: new Map(),
      node
    });
  }

  declareFields(node)
  {
    const struct = this.types.get(node.name.v);
    for (const f of node.fields)
    {
      if (struct.fields.has(f.name.v)) fail(`Field '${f.name.text}' appears twice in Type ${struct.name}`, f.pos);
      const field = {
        name: f.name.text,
        key: f.name.v,
        type: this.tagType(f.tag) || INT,
        js: 'f_' + f.name.v,
        vector: f.size ? this.vectorSize(f.size) : null
      };
      struct.fields.set(field.key, field);
    }
  }

  // Named values provided by command sets (KEY_LEFT, LIGHT_POINT, ...).
  declareBuiltinConstants(constants)
  {
    for (const [name, value] of Object.entries(constants))
    {
      let type = STRING;
      if (typeof value === 'number') type = Number.isInteger(value) ? INT : FLOAT;
      this.globals.set(name.toLowerCase(), { kind: 'const', name, key: name.toLowerCase(), type, value, builtin: true });
    }
  }

  // A user declaration may not reuse the name of a Const or Global.
  checkFreeName(nameTok)
  {
    const known = this.globals.get(nameTok.v);
    if (!known) return;
    if (known.builtin) fail(`'${nameTok.text}' is a built-in constant; choose another name`, nameTok);
    fail(`'${nameTok.text}' is already declared as a ${known.kind === 'const' ? 'Const' : 'Global'}`, nameTok);
  }

  declareConst(node)
  {
    const key = node.name.v;
    this.checkFreeName(node.name);
    let type = this.tagType(node.tag);
    if (type && type.kind === 'struct') fail('A Const must be an Int, Float or String', node.pos);
    // Consts see only the consts declared before them.
    let value = this.expr(node.init, new Scope(null));
    type = type || (value.type === NULL ? INT : value.type);
    value = this.convert(value, type, node.init.pos);
    if (!isLiteral(value)) fail(`The value of Const '${node.name.text}' must be known before the program runs`, node.init.pos);
    this.globals.set(key, { kind: 'const', name: node.name.text, key, type, value: value.value });
  }

  declareGlobals(stmt)
  {
    for (const d of stmt.decls)
    {
      const key = d.name.v;
      this.checkFreeName(d.name);
      const decl = {
        kind: 'global',
        name: d.name.text,
        key,
        type: this.tagType(d.tag) || INT,
        js: 'g_' + key,
        vector: d.size ? this.vectorSize(d.size) : null,
        pos: d.pos
      };
      d.decl = decl;
      this.globals.set(key, decl);
    }
  }

  declareDims(stmt)
  {
    for (const d of stmt.dims)
    {
      const key = d.name.v;
      const elem = this.tagType(d.tag);
      const known = this.arrays.get(key);
      if (known)
      {
        if (known.rank !== d.sizes.length || (elem && elem !== known.elem))
        {
          fail(`Array '${d.name.text}' was first declared as ${describeArray(known)}; a later Dim must keep that shape and type`, d.pos);
        }
        d.array = known;
        continue;
      }
      const array = { name: d.name.text, key, elem: elem || INT, rank: d.sizes.length, js: 'd_' + key };
      this.arrays.set(key, array);
      d.array = array;
    }
  }

  vectorSize(expr)
  {
    const size = this.convert(this.expr(expr, new Scope(null)), INT, expr.pos);
    if (size.kind !== 'int') fail('The size of a [ ] array must be a constant', expr.pos);
    if (size.value < 0) fail('The size of an array cannot be negative', expr.pos);
    // `a[10]` has indices 0 to 10, like Dim.
    return size.value + 1;
  }

  declareFunction(node)
  {
    const key = node.name.v;
    if (this.funcs.has(key)) fail(`Function '${node.name.text}' is declared twice`, node.pos);
    if (this.commands.has(key) || SPECIAL.has(key))
    {
      fail(`'${node.name.text}' is a built-in command; choose another name for your Function`, node.pos);
    }
    const fn = {
      name: node.name.text,
      key,
      js: 'fn_' + key,
      ret: this.tagType(node.tag) || INT,
      params: [],
      node,
      scope: null
    };
    const scope = new Scope(fn);
    for (const p of node.params)
    {
      if (scope.vars.has(p.name.v)) fail(`Parameter '${p.name.text}' appears twice`, p.pos);
      const type = this.tagType(p.tag) || INT;
      let def = null;
      if (p.def)
      {
        def = this.convert(this.expr(p.def, new Scope(null)), type, p.def.pos);
        if (!isLiteral(def) && def.kind !== 'null') fail('A default parameter value must be a constant', p.def.pos);
      }
      const decl = { kind: 'param', name: p.name.text, key: p.name.v, type, js: 'l_' + p.name.v, def };
      scope.vars.set(decl.key, decl);
      fn.params.push(decl);
    }
    fn.scope = scope;
    if (FRAME_FUNCTIONS.includes(key) && fn.params.some((p) => !p.def))
    {
      fail(`${node.name.text}() is called by the frame loop with no arguments, so its parameters need default values`, node.pos);
    }
    this.funcs.set(key, fn);
  }

  functionBody(fn)
  {
    const scope = fn.scope;
    this.block(fn.node.body, scope);
    fn.body = fn.node.body;
    fn.locals = [...scope.vars.values()].filter((d) => d.kind === 'local');
    fn.temps = scope.temps;
  }

  dataValue(expr)
  {
    const value = this.expr(expr, new Scope(null));
    if (!isLiteral(value)) fail('Data values must be constants', expr.pos);
    return { value: value.value, type: value.type };
  }

  // ------------------------------------------------------------ statements

  block(list, scope)
  {
    for (const s of list) this.statement(s, scope);
  }

  statement(s, scope)
  {
    switch (s.kind)
    {
      case 'assign':
        s.target = this.lvalue(s.target, scope);
        s.expr = this.convert(this.expr(s.expr, scope), s.target.type, s.expr.pos);
        assigned(s.target);
        return;
      case 'callStmt':
        s.call = this.call(s.call, scope, true);
        return;
      case 'if':
        s.cond = this.condition(s.cond, scope);
        this.block(s.thenBody, scope);
        if (s.elseBody) this.block(s.elseBody, scope);
        return;
      case 'while':
        s.cond = this.condition(s.cond, scope);
        this.loop(s.body, scope);
        return;
      case 'repeat':
        this.loop(s.body, scope);
        if (s.cond) s.cond = this.condition(s.cond, scope);
        return;
      case 'for':
        return this.forLoop(s, scope);
      case 'forEach':
        return this.forEach(s, scope);
      case 'select':
        return this.select(s, scope);
      case 'exit':
        if (scope.loopDepth === 0) fail("'Exit' can only be used inside a loop", s.pos);
        return;
      case 'return':
        if (!scope.fn) fail("'Return' can only be used inside a Function (use End to stop the program)", s.pos);
        // A bare Return gives the zero value of the Function's type.
        if (s.expr) s.expr = this.convert(this.expr(s.expr, scope), scope.fn.ret, s.expr.pos);
        else if (scope.fn.ret.kind === 'struct') s.expr = { kind: 'null', pos: s.pos, type: scope.fn.ret };
        else s.expr = literal(scope.fn.ret, scope.fn.ret === STRING ? '' : 0, s.pos);
        return;
      case 'end':
      case 'restore':
        return;
      case 'delete':
        s.expr = this.expr(s.expr, scope);
        if (s.expr.type.kind !== 'struct') fail(`Delete needs an object, not ${typeLabel(s.expr.type)}`, s.pos);
        return;
      case 'deleteEach':
        s.struct = this.struct(s.typeName);
        return;
      case 'insert':
      {
        s.expr = this.expr(s.expr, scope);
        s.target = this.expr(s.target, scope);
        const a = s.expr.type;
        const b = s.target.type;
        if (a.kind !== 'struct' || b.kind !== 'struct') fail('Insert needs two objects', s.pos);
        if (a !== b) fail(`Insert cannot mix ${a.name} and ${b.name} objects`, s.pos);
        return;
      }
      case 'read':
        s.target = this.lvalue(s.target, scope);
        if (s.target.type.kind === 'struct') fail('Read can only fill Int, Float or String variables', s.pos);
        assigned(s.target);
        return;
      case 'dim':
        for (const d of s.dims) d.sizes = d.sizes.map((e) => this.convert(this.expr(e, scope), INT, e.pos));
        return;
      case 'local':
        return this.localDecls(s, scope);
      case 'global':
        for (const d of s.decls)
        {
          if (d.init) d.init = this.convert(this.expr(d.init, scope), d.decl.type, d.init.pos);
        }
        return;
      default:
        fail(`Internal error: unknown statement '${s.kind}'`, s.pos);
    }
  }

  loop(body, scope)
  {
    scope.loopDepth++;
    this.block(body, scope);
    scope.loopDepth--;
  }

  forLoop(s, scope)
  {
    const v = this.lvalue(s.variable, scope);
    assigned(v);
    if (!isNumeric(v.type)) fail(`The loop variable of a For must be an Int or a Float, not ${typeLabel(v.type)}`, s.variable.pos);
    s.variable = v;
    s.from = this.convert(this.expr(s.from, scope), v.type, s.from.pos);
    s.to = this.convert(this.expr(s.to, scope), v.type, s.to.pos);
    if (s.step)
    {
      const step = this.convert(this.expr(s.step, scope), v.type, s.step.pos);
      if (!isLiteral(step)) fail('The Step of a For loop must be a constant, so the loop knows which way it counts', s.step.pos);
      if (step.value === 0) fail('The Step of a For loop cannot be 0', s.step.pos);
      s.step = step;
    }
    else s.step = { kind: v.type === INT ? 'int' : 'float', value: 1, type: v.type };
    this.loop(s.body, scope);
  }

  forEach(s, scope)
  {
    const struct = this.struct(s.typeName);
    if (!s.variable.tag && !this.findVar(s.variable.name.v, scope))
    {
      // `For p = Each Player` with a new name: give it the loop's type.
      s.variable.tag = { typeName: s.typeName };
    }
    const v = this.lvalue(s.variable, scope);
    assigned(v);
    if (v.type !== struct) fail(`The loop variable must be a ${struct.name} object (write ${s.variable.name.text}.${struct.name})`, s.variable.pos);
    s.variable = v;
    s.struct = struct;
    this.loop(s.body, scope);
  }

  select(s, scope)
  {
    s.expr = this.expr(s.expr, scope);
    const type = s.expr.type;
    if (isObject(type) || type === VOID) fail(`Select needs an Int, Float or String, not ${typeLabel(type)}`, s.expr.pos);
    s.temp = '$s' + ++scope.temps;
    for (const c of s.cases)
    {
      c.values = c.values.map((e) => this.convert(this.expr(e, scope), type, e.pos));
      this.block(c.body, scope);
    }
    if (s.defaultBody) this.block(s.defaultBody, scope);
  }

  localDecls(s, scope)
  {
    for (const d of s.decls)
    {
      const key = d.name.v;
      if (scope.vars.has(key))
      {
        fail(`Local '${d.name.text}' is already declared (or used) earlier in this ${scope.fn ? 'Function' : 'program'}`, d.pos);
      }
      const decl = {
        kind: 'local',
        name: d.name.text,
        key,
        type: this.tagType(d.tag) || INT,
        js: 'l_' + key,
        vector: d.size ? this.vectorSize(d.size) : null
      };
      scope.vars.set(key, decl);
      d.decl = decl;
      if (d.init) d.init = this.convert(this.expr(d.init, scope), decl.type, d.init.pos);
    }
  }

  // Conditions accept numbers (non-zero is true) and objects (not Null is
  // true). Strings are rejected: `If name$` is almost always a mistake.
  condition(e, scope)
  {
    const c = this.expr(e, scope);
    if (c.type === STRING) fail('A condition must be a number or an object, not a String (compare it, e.g. name$ <> "")', e.pos);
    if (c.type === VOID) fail(`${c.fnName} does not return a value, so it cannot be tested`, e.pos);
    return c;
  }

  // ------------------------------------------------------------ variables

  struct(nameTok)
  {
    const t = this.types.get(nameTok.v);
    if (!t) fail(`There is no Type called '${nameTok.text}'`, nameTok);
    return t;
  }

  findVar(key, scope)
  {
    return scope.vars.get(key) || this.globals.get(key) || null;
  }

  // Resolves a variable reference. Unknown names are declared on the spot as
  // locals of the current Function (or of the main program), like Blitz.
  variable(node, scope)
  {
    switch (node.kind)
    {
      case 'var':
      {
        const key = node.name.v;
        const tagType = this.tagType(node.tag);
        let decl = this.findVar(key, scope);
        if (!decl)
        {
          if (this.arrays.has(key)) fail(`'${node.name.text}' is an array; use it with an index, like ${node.name.text}(0)`, node.pos);
          decl = { kind: 'local', name: node.name.text, key, type: tagType || INT, js: 'l_' + key, vector: null };
          decl.implicit = true;
          decl.assigned = false;
          scope.vars.set(key, decl);
        }
        else if (tagType && tagType !== decl.type)
        {
          fail(`'${decl.name}' is ${typeLabel(decl.type)} but is used here as ${typeLabel(tagType)}`, node.pos);
        }
        return { kind: 'var', pos: node.pos, decl, type: decl.type };
      }
      case 'index':
      {
        const array = this.arrays.get(node.name.v);
        const tagType = this.tagType(node.tag);
        if (tagType && tagType !== array.elem) fail(`Array '${array.name}' holds ${array.elem.name} values, not ${tagType.name}`, node.pos);
        if (node.indices.length !== array.rank)
        {
          fail(`Array '${array.name}' has ${array.rank} dimension${array.rank > 1 ? 's' : ''} but ${node.indices.length} index${node.indices.length > 1 ? 'es were' : ' was'} given`, node.pos);
        }
        const indices = node.indices.map((e) => this.convert(this.expr(e, scope), INT, e.pos));
        return { kind: 'index', pos: node.pos, array, indices, type: array.elem };
      }
      case 'field':
      {
        const object = this.expr(node.object, scope);
        if (object.type.kind !== 'struct') fail(`'\\${node.name.text}' needs an object on its left, not ${typeLabel(object.type)}`, node.pos);
        const field = object.type.fields.get(node.name.v);
        if (!field) fail(`Type ${object.type.name} has no field called '${node.name.text}'`, node.pos);
        const tagType = this.tagType(node.tag);
        if (tagType && tagType !== field.type) fail(`Field '${field.name}' is ${typeLabel(field.type)}, not ${typeLabel(tagType)}`, node.pos);
        return { kind: 'field', pos: node.pos, object, field, type: field.type, vector: field.vector };
      }
      case 'element':
      {
        const base = this.variable(node.vector, scope);
        const size = base.kind === 'var' ? base.decl.vector : base.vector;
        if (!size) fail("Only arrays declared with a size in [ ] can be indexed with [ ]", node.pos);
        const index = this.convert(this.expr(node.index, scope), INT, node.index.pos);
        if (index.kind === 'int' && (index.value < 0 || index.value >= size))
        {
          fail(`Index ${index.value} is outside the array (0 to ${size - 1})`, node.index.pos);
        }
        return { kind: 'element', pos: node.pos, base, index, size, type: base.type };
      }
      default:
        fail('Expected a variable', node.pos);
    }
  }

  // A Function that reads an undeclared variable which has the same name as
  // a variable of the main program is the classic Blitz bug: the programmer
  // meant the main program's variable, which needs to be Global. Reading
  // before any assignment is the tell; `For i = ...` in a Function is fine.
  checkShadowedMainLocal(decl, node, scope)
  {
    if (!scope.fn || !decl.implicit || decl.assigned || decl.warned) return;
    if (this.mainScope && this.mainScope.vars.has(decl.key))
    {
      decl.warned = true;
      this.warnings.push({
        file: node.pos.file,
        line: node.pos.line,
        column: node.pos.col,
        message: `'${decl.name}' in Function ${scope.fn.name} is a new local variable, not the one from the main program. Declare it with Global to share it.`
      });
    }
  }

  lvalue(node, scope)
  {
    if (node.kind === 'var')
    {
      const known = this.findVar(node.name.v, scope);
      if (known && known.kind === 'const') fail(`'${known.name}' is a Const and cannot be changed`, node.pos);
    }
    const v = this.variable(node, scope);
    if ((v.kind === 'var' && v.decl.vector) || (v.kind === 'field' && v.vector))
    {
      fail(`'${v.kind === 'var' ? v.decl.name : v.field.name}' is an array; assign to one element, like ${v.kind === 'var' ? v.decl.name : v.field.name}[0]`, node.pos);
    }
    return v;
  }

  // ---------------------------------------------------------- expressions

  expr(node, scope)
  {
    switch (node.kind)
    {
      case 'int':
        return { ...node, type: INT };
      case 'float':
        return { ...node, type: FLOAT };
      case 'string':
        return { ...node, type: STRING };
      case 'null':
        return { ...node, type: NULL };
      case 'var':
      {
        const known = this.findVar(node.name.v, scope);
        if (known && known.kind === 'const')
        {
          const tagType = this.tagType(node.tag);
          if (tagType && tagType !== known.type) fail(`Const '${known.name}' is ${typeLabel(known.type)}, not ${typeLabel(tagType)}`, node.pos);
          return literal(known.type, known.value, node.pos);
        }
        return this.rvalue(node, scope);
      }
      case 'index':
      case 'field':
      case 'element':
        return this.rvalue(node, scope);
      case 'call':
        return this.call(node, scope, false);
      case 'unary':
        return this.unary(node, scope);
      case 'not':
        return this.not(node, scope);
      case 'binary':
        return this.binary(node, scope);
      case 'new':
      case 'first':
      case 'last':
      {
        const struct = this.struct(node.typeName);
        return { kind: node.kind, pos: node.pos, struct, type: struct };
      }
      case 'before':
      case 'after':
      {
        const e = this.expr(node.expr, scope);
        if (e.type.kind !== 'struct') fail(`'${node.kind === 'before' ? 'Before' : 'After'}' needs an object, not ${typeLabel(e.type)}`, node.pos);
        return { kind: node.kind, pos: node.pos, expr: e, type: e.type };
      }
      default:
        fail(`Internal error: unknown expression '${node.kind}'`, node.pos);
    }
  }

  rvalue(node, scope)
  {
    const v = this.variable(node, scope);
    if (v.kind === 'var') this.checkShadowedMainLocal(v.decl, node, scope);
    if ((v.kind === 'var' && v.decl.vector) || (v.kind === 'field' && v.vector))
    {
      fail(`'${v.kind === 'var' ? v.decl.name : v.field.name}' is an array; use one element, like ${v.kind === 'var' ? v.decl.name : v.field.name}[0]`, node.pos);
    }
    return v;
  }

  // Implicit conversion to `type`, folded when the value is a constant.
  convert(e, type, pos)
  {
    if (e.type === type) return e;
    if (e.type === VOID) fail(`${e.fnName} does not return a value`, pos);
    if (!canConvert(e.type, type)) fail(`Cannot use ${typeLabel(e.type)} where ${typeLabel(type)} is expected`, pos);
    if (e.type === NULL) return { ...e, type };
    if (isLiteral(e)) return literal(type, convertValue(e.value, e.type, type), e.pos);
    return { kind: 'cast', pos: e.pos, expr: e, type };
  }

  unary(node, scope)
  {
    const e = this.expr(node.expr, scope);
    if (node.op === '~')
    {
      const v = this.convert(e, INT, node.pos);
      if (isLiteral(v)) return literal(INT, ~v.value, node.pos);
      return { kind: 'unary', pos: node.pos, op: '~', expr: v, type: INT };
    }
    if (!isNumeric(e.type)) fail(`'${node.op}' needs a number, not ${typeLabel(e.type)}`, node.pos);
    if (node.op === '+') return e;
    if (isLiteral(e)) return literal(e.type, e.type === INT ? (-e.value) | 0 : -e.value, node.pos);
    return { kind: 'unary', pos: node.pos, op: '-', expr: e, type: e.type };
  }

  not(node, scope)
  {
    const e = this.expr(node.expr, scope);
    if (e.type === VOID) fail(`${e.fnName} does not return a value`, node.pos);
    if (isLiteral(e)) return literal(INT, (e.value === 0 || e.value === '') ? 1 : 0, node.pos);
    if (e.type === NULL) return literal(INT, 1, node.pos);
    return { kind: 'not', pos: node.pos, expr: e, type: INT };
  }

  binary(node, scope)
  {
    const op = node.op;
    let l = this.expr(node.left, scope);
    let r = this.expr(node.right, scope);
    if (l.type === VOID) fail(`${l.fnName} does not return a value`, node.left.pos);
    if (r.type === VOID) fail(`${r.fnName} does not return a value`, node.right.pos);

    // Bitwise and logical operators work on Ints. Comparisons give 0 or 1,
    // so `a > 0 And b > 0` behaves as expected.
    if (op === 'and' || op === 'or' || op === 'xor' || op === 'shl' || op === 'shr' || op === 'sar')
    {
      if (isObject(l.type) || isObject(r.type))
      {
        fail(`'${opName(op)}' works on numbers; to test an object use  obj <> Null`, node.pos);
      }
      l = this.convert(l, INT, node.left.pos);
      r = this.convert(r, INT, node.right.pos);
      if (isLiteral(l) && isLiteral(r)) return literal(INT, foldInt(op, l.value, r.value, node.pos), node.pos);
      return { kind: 'binary', pos: node.pos, op, left: l, right: r, type: INT, opType: INT };
    }

    if (['=', '<>', '<', '>', '<=', '>='].includes(op)) return this.compare(node, l, r);

    // Arithmetic: String if either side is a String (only + is allowed),
    // Float if either side is a Float or the operator is ^, else Int.
    if (isObject(l.type) || isObject(r.type)) fail(`'${opName(op)}' cannot be used on objects`, node.pos);
    let type;
    if (l.type === STRING || r.type === STRING)
    {
      if (op !== '+') fail(`'${opName(op)}' cannot be used on Strings (only + joins them)`, node.pos);
      type = STRING;
    }
    else if (op === '^' || l.type === FLOAT || r.type === FLOAT) type = FLOAT;
    else type = INT;
    l = this.convert(l, type, node.left.pos);
    r = this.convert(r, type, node.right.pos);
    if (type === INT && (op === '/' || op === 'mod') && isLiteral(r) && r.value === 0)
    {
      fail('Division by zero', node.pos);
    }
    if (isLiteral(l) && isLiteral(r))
    {
      let value;
      if (type === STRING) value = l.value + r.value;
      else if (type === INT) value = foldInt(op, l.value, r.value, node.pos);
      else value = foldFloat(op, l.value, r.value);
      return literal(type, value, node.pos);
    }
    return { kind: 'binary', pos: node.pos, op, left: l, right: r, type, opType: type };
  }

  compare(node, l, r)
  {
    const op = node.op;
    let opType;
    if (isObject(l.type) || isObject(r.type))
    {
      if (op !== '=' && op !== '<>') fail(`Objects can only be compared with = and <>`, node.pos);
      if (!isObject(l.type) || !isObject(r.type)) fail(`Cannot compare ${typeLabel(l.type)} with ${typeLabel(r.type)}`, node.pos);
      if (l.type !== NULL && r.type !== NULL && l.type !== r.type) fail(`Cannot compare ${typeLabel(l.type)} with ${typeLabel(r.type)}`, node.pos);
      if (l.type === NULL && r.type === NULL) return literal(INT, op === '=' ? 1 : 0, node.pos);
      return { kind: 'binary', pos: node.pos, op, left: l, right: r, type: INT, opType: l.type === NULL ? r.type : l.type };
    }
    if (l.type === STRING || r.type === STRING) opType = STRING;
    else if (l.type === FLOAT || r.type === FLOAT) opType = FLOAT;
    else opType = INT;
    l = this.convert(l, opType, node.left.pos);
    r = this.convert(r, opType, node.right.pos);
    if (isLiteral(l) && isLiteral(r)) return literal(INT, compareValues(op, l.value, r.value) ? 1 : 0, node.pos);
    return { kind: 'binary', pos: node.pos, op, left: l, right: r, type: INT, opType };
  }

  // Calls to user Functions, conversions (Int, Float, Str), the generic
  // maths commands (Abs, Sgn, Min, Max) and built-in commands.
  call(node, scope, asStatement)
  {
    const key = node.name.v;
    const name = node.name.text;
    const tagType = this.tagType(node.tag);
    const fn = this.funcs.get(key);
    if (fn)
    {
      if (tagType && tagType !== fn.ret) fail(`Function ${fn.name} returns ${typeLabel(fn.ret)}, not ${typeLabel(tagType)}`, node.pos);
      const args = this.arguments(node, fn.name, fn.params, scope);
      return { kind: 'call', pos: node.pos, fn, args, type: fn.ret, fnName: fn.name };
    }
    if (SPECIAL.has(key)) return this.special(node, key, scope, tagType);
    const cmd = this.commands.get(key);
    if (!cmd)
    {
      if (this.arrays.has(key)) fail(`'${name}' is an array; use it as ${name}(index)`, node.pos);
      if (asStatement && node.args.length === 0 && this.findVar(key, scope))
      {
        fail(`'${name}' on its own does nothing; did you mean to assign it, like ${name} = 1?`, node.pos);
      }
      fail(`'${name}' is not a command or a Function`, node.pos);
    }
    if (tagType && tagType !== cmd.ret) fail(`${cmd.name} returns ${typeLabel(cmd.ret)}, not ${typeLabel(tagType)}`, node.pos);
    const params = cmd.params.map((p) => ({
      name: p.name,
      type: p.type,
      def: p.def === undefined ? null : literal(p.type, p.def, node.pos)
    }));
    const args = this.arguments(node, cmd.name, params, scope);
    return { kind: 'call', pos: node.pos, cmd, args, type: cmd.ret, fnName: cmd.name };
  }

  arguments(node, name, params, scope)
  {
    if (node.args.length > params.length)
    {
      fail(`${name} takes ${params.length === 0 ? 'no' : 'at most ' + params.length} argument${params.length === 1 ? '' : 's'} but ${node.args.length} ${node.args.length === 1 ? 'was' : 'were'} given`, node.args[params.length].pos);
    }
    return params.map((p, i) =>
    {
      if (i < node.args.length) return this.convert(this.expr(node.args[i], scope), p.type, node.args[i].pos);
      if (!p.def) fail(`${name} needs a value for '${p.name}'`, node.pos);
      return { ...p.def, pos: node.pos };
    });
  }

  special(node, key, scope, tagType)
  {
    const count = { int: 1, float: 1, str: 1, abs: 1, sgn: 1, min: 2, max: 2 }[key];
    const title = key === 'str' ? 'Str' : key[0].toUpperCase() + key.slice(1);
    if (node.args.length !== count)
    {
      fail(`${title} takes ${count} argument${count > 1 ? 's' : ''}`, node.pos);
    }
    const args = node.args.map((a) => this.expr(a, scope));
    const check = (type) =>
    {
      if (tagType && tagType !== type) fail(`${title} returns ${typeLabel(type)}, not ${typeLabel(tagType)}`, node.pos);
      return type;
    };
    if (key === 'int' || key === 'float' || key === 'str')
    {
      const type = check(key === 'int' ? INT : key === 'float' ? FLOAT : STRING);
      if (isObject(args[0].type)) fail(`${title} cannot convert an object`, node.args[0].pos);
      return this.convert(args[0], type, node.args[0].pos);
    }
    // Abs, Sgn, Min, Max keep Ints as Ints and Floats as Floats.
    for (let i = 0; i < args.length; i++)
    {
      if (!isNumeric(args[i].type)) fail(`${title} needs a number, not ${typeLabel(args[i].type)}`, node.args[i].pos);
    }
    const type = check(args.some((a) => a.type === FLOAT) ? FLOAT : INT);
    const conv = args.map((a, i) => this.convert(a, type, node.args[i].pos));
    if (conv.every(isLiteral))
    {
      const v = conv.map((a) => a.value);
      let value;
      if (key === 'abs') value = Math.abs(v[0]);
      else if (key === 'sgn') value = Math.sign(v[0]);
      else if (key === 'min') value = Math.min(v[0], v[1]);
      else value = Math.max(v[0], v[1]);
      return literal(type, type === INT ? value | 0 : value, node.pos);
    }
    return { kind: 'special', pos: node.pos, name: key, args: conv, type };
  }
}

const SPECIAL = new Set(['int', 'float', 'str', 'abs', 'sgn', 'min', 'max']);

// Marks a variable as written, for the shadowing warning above.
function assigned(v)
{
  if (v.kind === 'var') v.decl.assigned = true;
}

function isLiteral(e)
{
  return e.kind === 'int' || e.kind === 'float' || e.kind === 'string';
}

function literal(type, value, pos)
{
  return { kind: type === INT ? 'int' : type === FLOAT ? 'float' : 'string', pos, value, type };
}

function convertValue(value, from, to)
{
  if (to === INT) return from === FLOAT ? floatToInt(value) : stringToInt(value);
  if (to === FLOAT) return from === INT ? value : stringToFloat(value);
  return from === INT ? String(value) : floatToString(value);
}

function foldInt(op, a, b, pos)
{
  switch (op)
  {
    case '+': return (a + b) | 0;
    case '-': return (a - b) | 0;
    case '*': return Math.imul(a, b);
    case '/':
      if (b === 0) fail('Division by zero', pos);
      return (a / b) | 0;
    case 'mod':
      if (b === 0) fail('Division by zero', pos);
      return (a % b) | 0;
    case 'and': return a & b;
    case 'or': return a | b;
    case 'xor': return a ^ b;
    case 'shl': return a << b;
    case 'shr': return (a >>> b) | 0;
    case 'sar': return a >> b;
  }
  throw new Error('fold ' + op);
}

function foldFloat(op, a, b)
{
  switch (op)
  {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case 'mod': return a % b;
    case '^': return Math.pow(a, b);
  }
  throw new Error('fold ' + op);
}

function compareValues(op, a, b)
{
  switch (op)
  {
    case '=': return a === b;
    case '<>': return a !== b;
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
  }
  return false;
}

function opName(op)
{
  const names = { and: 'And', or: 'Or', xor: 'Xor', shl: 'Shl', shr: 'Shr', sar: 'Sar', mod: 'Mod' };
  return names[op] || op;
}

function describeArray(a)
{
  return `${a.elem.name} with ${a.rank} dimension${a.rank > 1 ? 's' : ''}`;
}
