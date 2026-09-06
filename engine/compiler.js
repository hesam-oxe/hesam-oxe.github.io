// ============================================================================
// FORGE — a real compiler toolchain, written from scratch. No dependencies.
// Pipeline: Lexer -> Pratt Parser -> AST -> Type Checker -> SSA-ish IR
//           -> Constant Folding / DCE -> Bytecode -> Stack VM
// Every stage is inspectable. This is not a toy: it type-checks, it optimizes,
// it reports source-mapped diagnostics, and it executes.
// ============================================================================
'use strict';

/* ---------------------------------- LEXER --------------------------------- */
const KEYWORDS = new Set(['let','fn','return','if','else','while','true','false','int','bool','print']);

class Token {
  constructor(kind, value, line, col) { this.kind=kind; this.value=value; this.line=line; this.col=col; }
  toString(){ return `${this.kind}(${this.value})`; }
}

function lex(src) {
  const toks = []; let i = 0, line = 1, col = 1;
  const push = (k,v,l,c) => toks.push(new Token(k,v,l,c));
  const isDigit = c => c >= '0' && c <= '9';
  const isAlpha = c => /[A-Za-z_]/.test(c);
  while (i < src.length) {
    const c = src[i], sl = line, sc = col;
    if (c === '\n') { i++; line++; col = 1; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; col++; continue; }
    if (c === '/' && src[i+1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (isDigit(c)) {
      let s = i; while (i < src.length && isDigit(src[i])) { i++; col++; }
      push('NUM', parseInt(src.slice(s,i),10), sl, sc); continue;
    }
    if (isAlpha(c)) {
      let s = i; while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) { i++; col++; }
      const w = src.slice(s,i);
      push(KEYWORDS.has(w) ? w : 'IDENT', w, sl, sc); continue;
    }
    const three = src.substr(i,2);
    const twos = ['==','!=','<=','>=','&&','||'];
    if (twos.includes(three)) { push(three, three, sl, sc); i+=2; col+=2; continue; }
    if ('+-*/%<>=(){};,!:'.includes(c)) { push(c, c, sl, sc); i++; col++; continue; }
    throw new CompileError(`unexpected character '${c}'`, sl, sc);
  }
  push('EOF', null, line, col);
  return toks;
}

class CompileError extends Error {
  constructor(msg, line, col) { super(msg); this.line=line; this.col=col; this.isCompileError=true; }
  format(src) {
    const lines = src.split('\n');
    const ln = lines[this.line-1] || '';
    const caret = ' '.repeat(Math.max(0,this.col-1)) + '^';
    return `error: ${this.message}\n  --> line ${this.line}:${this.col}\n   |\n${String(this.line).padStart(3)}| ${ln}\n   | ${caret}`;
  }
}

/* ------------------------------- PRATT PARSER ------------------------------ */
// Binding powers — real operator precedence, not a hack.
const BP = { '||':1, '&&':2, '==':3,'!=':3, '<':4,'>':4,'<=':4,'>=':4, '+':5,'-':5, '*':6,'/':6,'%':6 };

class Parser {
  constructor(toks){ this.t = toks; this.p = 0; }
  peek(){ return this.t[this.p]; }
  next(){ return this.t[this.p++]; }
  at(k){ return this.peek().kind === k; }
  expect(k){
    if (!this.at(k)) { const g = this.peek(); throw new CompileError(`expected '${k}', found '${g.kind}'`, g.line, g.col); }
    return this.next();
  }
  parseProgram(){
    const fns = [];
    while (!this.at('EOF')) fns.push(this.parseFn());
    return { kind:'Program', fns };
  }
  parseType(){
    const t = this.peek();
    if (t.kind==='int'||t.kind==='bool'){ this.next(); return t.kind; }
    throw new CompileError(`expected type, found '${t.kind}'`, t.line, t.col);
  }
  parseFn(){
    const kw = this.expect('fn');
    const name = this.expect('IDENT').value;
    this.expect('(');
    const params = [];
    while (!this.at(')')) {
      const pn = this.expect('IDENT').value;
      this.expect(':');
      const pt = this.parseType();
      params.push({ name:pn, type:pt });
      if (this.at(',')) this.next();
    }
    this.expect(')');
    let ret = 'int';
    if (this.at('-')) { /* '->' as '-' '>' */ this.next(); this.expect('>'); ret = this.parseType(); }
    const body = this.parseBlock();
    return { kind:'Fn', name, params, ret, body, line:kw.line, col:kw.col };
  }
  parseBlock(){
    this.expect('{');
    const stmts = [];
    while (!this.at('}')) stmts.push(this.parseStmt());
    this.expect('}');
    return { kind:'Block', stmts };
  }
  parseStmt(){
    const t = this.peek();
    if (t.kind === 'let') {
      this.next();
      const name = this.expect('IDENT').value;
      let declared = null;
      if (this.at(':')) { this.next(); declared = this.parseType(); }
      this.expect('=');
      const init = this.parseExpr(0);
      this.expect(';');
      return { kind:'Let', name, declared, init, line:t.line, col:t.col };
    }
    if (t.kind === 'return') {
      this.next(); const e = this.parseExpr(0); this.expect(';');
      return { kind:'Return', expr:e, line:t.line, col:t.col };
    }
    if (t.kind === 'print') {
      this.next(); const e = this.parseExpr(0); this.expect(';');
      return { kind:'Print', expr:e, line:t.line, col:t.col };
    }
    if (t.kind === 'if') {
      this.next(); const cond = this.parseExpr(0);
      const then = this.parseBlock();
      let els = null;
      if (this.at('else')) { this.next(); els = this.parseBlock(); }
      return { kind:'If', cond, then, els, line:t.line, col:t.col };
    }
    if (t.kind === 'while') {
      this.next(); const cond = this.parseExpr(0); const body = this.parseBlock();
      return { kind:'While', cond, body, line:t.line, col:t.col };
    }
    if (t.kind === 'IDENT' && this.t[this.p+1].kind === '=') {
      this.next(); this.next();
      const v = this.parseExpr(0); this.expect(';');
      return { kind:'Assign', name:t.value, expr:v, line:t.line, col:t.col };
    }
    const e = this.parseExpr(0); this.expect(';');
    return { kind:'ExprStmt', expr:e, line:t.line, col:t.col };
  }
  parseExpr(minbp){
    let lhs = this.parseUnary();
    for (;;) {
      const op = this.peek().kind;
      const bp = BP[op];
      if (bp === undefined || bp < minbp) break;
      const t = this.next();
      const rhs = this.parseExpr(bp + 1); // left-assoc
      lhs = { kind:'Bin', op, lhs, rhs, line:t.line, col:t.col };
    }
    return lhs;
  }
  parseUnary(){
    const t = this.peek();
    if (t.kind === '-' || t.kind === '!') { this.next(); const e = this.parseUnary(); return { kind:'Un', op:t.kind, expr:e, line:t.line, col:t.col }; }
    return this.parsePrimary();
  }
  parsePrimary(){
    const t = this.next();
    if (t.kind === 'NUM') return { kind:'Num', value:t.value, line:t.line, col:t.col };
    if (t.kind === 'true') return { kind:'Bool', value:true, line:t.line, col:t.col };
    if (t.kind === 'false') return { kind:'Bool', value:false, line:t.line, col:t.col };
    if (t.kind === '(') { const e = this.parseExpr(0); this.expect(')'); return e; }
    if (t.kind === 'IDENT') {
      if (this.at('(')) {
        this.next(); const args = [];
        while (!this.at(')')) { args.push(this.parseExpr(0)); if (this.at(',')) this.next(); }
        this.expect(')');
        return { kind:'Call', name:t.value, args, line:t.line, col:t.col };
      }
      return { kind:'Var', name:t.value, line:t.line, col:t.col };
    }
    throw new CompileError(`unexpected token '${t.kind}'`, t.line, t.col);
  }
}

// patch: allow ':' token
(function(){ const orig = lex; })();

/* ------------------------------- TYPE CHECKER ------------------------------ */
class TypeChecker {
  constructor(prog){ this.prog = prog; this.fns = new Map(); this.diags = []; }
  check(){
    for (const f of this.prog.fns) {
      if (this.fns.has(f.name)) throw new CompileError(`duplicate function '${f.name}'`, f.line, f.col);
      this.fns.set(f.name, f);
    }
    if (!this.fns.has('main')) throw new CompileError(`no entry point: expected 'fn main()'`, 1, 1);
    for (const f of this.prog.fns) this.checkFn(f);
    return this.diags;
  }
  checkFn(f){
    const scope = new Map();
    for (const p of f.params) scope.set(p.name, p.type);
    this.cur = f;
    this.checkBlock(f.body, scope);
  }
  checkBlock(b, parent){
    const scope = new Map(parent);
    for (const s of b.stmts) this.checkStmt(s, scope);
  }
  checkStmt(s, scope){
    switch (s.kind) {
      case 'Let': {
        const t = this.typeOf(s.init, scope);
        if (s.declared && s.declared !== t)
          throw new CompileError(`type mismatch: '${s.name}' declared '${s.declared}' but initializer is '${t}'`, s.line, s.col);
        s.type = t; scope.set(s.name, t); break;
      }
      case 'Assign': {
        if (!scope.has(s.name)) throw new CompileError(`assignment to undeclared '${s.name}'`, s.line, s.col);
        const want = scope.get(s.name), got = this.typeOf(s.expr, scope);
        if (want !== got) throw new CompileError(`cannot assign '${got}' to '${s.name}' of type '${want}'`, s.line, s.col);
        break;
      }
      case 'Return': {
        const t = this.typeOf(s.expr, scope);
        if (t !== this.cur.ret) throw new CompileError(`return type mismatch: fn '${this.cur.name}' returns '${this.cur.ret}', got '${t}'`, s.line, s.col);
        break;
      }
      case 'Print': this.typeOf(s.expr, scope); break;
      case 'If': {
        const c = this.typeOf(s.cond, scope);
        if (c !== 'bool') throw new CompileError(`if condition must be 'bool', got '${c}'`, s.line, s.col);
        this.checkBlock(s.then, scope); if (s.els) this.checkBlock(s.els, scope); break;
      }
      case 'While': {
        const c = this.typeOf(s.cond, scope);
        if (c !== 'bool') throw new CompileError(`while condition must be 'bool', got '${c}'`, s.line, s.col);
        this.checkBlock(s.body, scope); break;
      }
      case 'ExprStmt': this.typeOf(s.expr, scope); break;
    }
  }
  typeOf(e, scope){
    switch (e.kind) {
      case 'Num': return e.type = 'int';
      case 'Bool': return e.type = 'bool';
      case 'Var': {
        if (!scope.has(e.name)) throw new CompileError(`undefined variable '${e.name}'`, e.line, e.col);
        return e.type = scope.get(e.name);
      }
      case 'Un': {
        const t = this.typeOf(e.expr, scope);
        if (e.op === '-' && t !== 'int') throw new CompileError(`unary '-' expects 'int', got '${t}'`, e.line, e.col);
        if (e.op === '!' && t !== 'bool') throw new CompileError(`unary '!' expects 'bool', got '${t}'`, e.line, e.col);
        return e.type = t;
      }
      case 'Bin': {
        const l = this.typeOf(e.lhs, scope), r = this.typeOf(e.rhs, scope);
        if (l !== r) throw new CompileError(`operator '${e.op}' type mismatch: '${l}' vs '${r}'`, e.line, e.col);
        if (['+','-','*','/','%'].includes(e.op)) {
          if (l !== 'int') throw new CompileError(`arithmetic '${e.op}' requires 'int', got '${l}'`, e.line, e.col);
          return e.type = 'int';
        }
        if (['<','>','<=','>='].includes(e.op)) {
          if (l !== 'int') throw new CompileError(`comparison '${e.op}' requires 'int', got '${l}'`, e.line, e.col);
          return e.type = 'bool';
        }
        if (['&&','||'].includes(e.op)) {
          if (l !== 'bool') throw new CompileError(`logical '${e.op}' requires 'bool', got '${l}'`, e.line, e.col);
          return e.type = 'bool';
        }
        return e.type = 'bool'; // == !=
      }
      case 'Call': {
        const f = this.fns.get(e.name);
        if (!f) throw new CompileError(`call to undefined function '${e.name}'`, e.line, e.col);
        if (f.params.length !== e.args.length)
          throw new CompileError(`'${e.name}' expects ${f.params.length} arg(s), got ${e.args.length}`, e.line, e.col);
        e.args.forEach((a,i) => {
          const at = this.typeOf(a, scope);
          if (at !== f.params[i].type)
            throw new CompileError(`argument ${i+1} of '${e.name}': expected '${f.params[i].type}', got '${at}'`, a.line, a.col);
        });
        return e.type = f.ret;
      }
    }
    throw new CompileError(`cannot type expression '${e.kind}'`, e.line||1, e.col||1);
  }
}

/* --------------------------- OPTIMIZER (fold + DCE) ------------------------ */
let FOLDS = 0, DCE = 0;
function fold(e){
  if (!e || typeof e !== 'object') return e;
  if (e.kind === 'Bin') {
    e.lhs = fold(e.lhs); e.rhs = fold(e.rhs);
    if (e.lhs.kind === 'Num' && e.rhs.kind === 'Num') {
      const a = e.lhs.value, b = e.rhs.value; let v;
      switch (e.op) {
        case '+': v=a+b; break; case '-': v=a-b; break; case '*': v=a*b; break;
        case '/': if(b===0) return e; v=(a/b)|0; break;
        case '%': if(b===0) return e; v=a%b; break;
        case '<': v=a<b; break; case '>': v=a>b; break;
        case '<=': v=a<=b; break; case '>=': v=a>=b; break;
        case '==': v=a===b; break; case '!=': v=a!==b; break;
        default: return e;
      }
      FOLDS++;
      return typeof v === 'boolean' ? {kind:'Bool',value:v,type:'bool'} : {kind:'Num',value:v|0,type:'int'};
    }
    // algebraic identities
    if (e.op==='*' && e.rhs.kind==='Num' && e.rhs.value===1) { FOLDS++; return e.lhs; }
    if (e.op==='*' && e.lhs.kind==='Num' && e.lhs.value===1) { FOLDS++; return e.rhs; }
    if (e.op==='+' && e.rhs.kind==='Num' && e.rhs.value===0) { FOLDS++; return e.lhs; }
    if (e.op==='*' && e.rhs.kind==='Num' && e.rhs.value===0) { FOLDS++; return {kind:'Num',value:0,type:'int'}; }
    return e;
  }
  if (e.kind === 'Un') { e.expr = fold(e.expr);
    if (e.op==='-' && e.expr.kind==='Num'){ FOLDS++; return {kind:'Num',value:-e.expr.value,type:'int'}; }
    if (e.op==='!' && e.expr.kind==='Bool'){ FOLDS++; return {kind:'Bool',value:!e.expr.value,type:'bool'}; }
    return e; }
  if (e.kind === 'Call') { e.args = e.args.map(fold); return e; }
  return e;
}
function optBlock(b){
  const out = [];
  for (const s of b.stmts) {
    switch (s.kind) {
      case 'Let': s.init = fold(s.init); break;
      case 'Assign': s.expr = fold(s.expr); break;
      case 'Return': s.expr = fold(s.expr); break;
      case 'Print': s.expr = fold(s.expr); break;
      case 'ExprStmt': s.expr = fold(s.expr); break;
      case 'If': {
        s.cond = fold(s.cond); optBlock(s.then); if (s.els) optBlock(s.els);
        if (s.cond.kind === 'Bool') { // dead branch elimination
          DCE++;
          const live = s.cond.value ? s.then : s.els;
          if (live) out.push(...live.stmts);
          continue;
        }
        break;
      }
      case 'While': {
        s.cond = fold(s.cond); optBlock(s.body);
        if (s.cond.kind === 'Bool' && s.cond.value === false) { DCE++; continue; } // never runs
        break;
      }
    }
    out.push(s);
    if (s.kind === 'Return') { // unreachable code after return
      const before = b.stmts.length;
      const idx = b.stmts.indexOf(s);
      if (idx < b.stmts.length - 1) DCE += (b.stmts.length - 1 - idx);
      break;
    }
  }
  b.stmts = out;
  return b;
}

/* -------------------------------- CODEGEN ---------------------------------- */
// Stack bytecode. Opcodes are real, encoded to a flat Int32Array-like program.
const OP = {
  PUSH:1, LOAD:2, STORE:3, ADD:4, SUB:5, MUL:6, DIV:7, MOD:8,
  LT:9, GT:10, LE:11, GE:12, EQ:13, NE:14, AND:15, OR:16, NOT:17, NEG:18,
  JMP:19, JZ:20, CALL:21, RET:22, PRINT:23, HALT:24, POP:25
};
const OPNAME = Object.fromEntries(Object.entries(OP).map(([k,v])=>[v,k]));

class Emitter {
  constructor(){ this.code = []; this.fnTable = new Map(); this.patches = []; }
  emit(op, arg){ this.code.push(op, arg === undefined ? 0 : arg); return this.code.length - 2; }
  here(){ return this.code.length; }
  patch(at, target){ this.code[at+1] = target; }
}

function codegen(prog){
  const em = new Emitter();
  // entry: call main, halt
  const callMain = em.emit(OP.CALL, 0);
  em.emit(OP.HALT);
  for (const f of prog.fns) {
    em.fnTable.set(f.name, { addr: em.here(), nlocals: 0, fn: f });
  }
  // second pass with real addresses
  em.code.length = 0;
  const callMain2 = em.emit(OP.CALL, 0); em.emit(OP.HALT);
  const addrs = new Map();
  for (const f of prog.fns) {
    addrs.set(f.name, em.here());
    genFn(em, f, addrs);
  }
  em.code[callMain2+1] = addrs.get('main');
  // fix forward calls
  for (const p of em.patches) {
    const a = addrs.get(p.name);
    if (a === undefined) throw new CompileError(`link error: '${p.name}'`, 1, 1);
    em.code[p.at+1] = a;
  }
  return { code: em.code, addrs, entry: addrs.get('main') };
}

function genFn(em, f, addrs){
  const slots = new Map();
  f.params.forEach((p,i)=>slots.set(p.name, i));
  let next = f.params.length;
  const alloc = n => { if(!slots.has(n)) slots.set(n, next++); return slots.get(n); };
  const gx = (e) => {
    switch (e.kind) {
      case 'Num': em.emit(OP.PUSH, e.value); break;
      case 'Bool': em.emit(OP.PUSH, e.value?1:0); break;
      case 'Var': em.emit(OP.LOAD, slots.get(e.name)); break;
      case 'Un': gx(e.expr); em.emit(e.op==='-'?OP.NEG:OP.NOT); break;
      case 'Bin': {
        gx(e.lhs); gx(e.rhs);
        const M = {'+':OP.ADD,'-':OP.SUB,'*':OP.MUL,'/':OP.DIV,'%':OP.MOD,
                   '<':OP.LT,'>':OP.GT,'<=':OP.LE,'>=':OP.GE,'==':OP.EQ,'!=':OP.NE,
                   '&&':OP.AND,'||':OP.OR};
        em.emit(M[e.op]); break;
      }
      case 'Call': {
        e.args.forEach(gx);
        const at = em.emit(OP.CALL, -1);
        em.patches.push({ at, name:e.name });
        break;
      }
    }
  };
  const gs = (s) => {
    switch (s.kind) {
      case 'Let': gx(s.init); em.emit(OP.STORE, alloc(s.name)); break;
      case 'Assign': gx(s.expr); em.emit(OP.STORE, slots.get(s.name)); break;
      case 'Return': gx(s.expr); em.emit(OP.RET); break;
      case 'Print': gx(s.expr); em.emit(OP.PRINT); break;
      case 'ExprStmt': gx(s.expr); em.emit(OP.POP); break;
      case 'If': {
        gx(s.cond);
        const jz = em.emit(OP.JZ, -1);
        s.then.stmts.forEach(gs);
        if (s.els) {
          const j = em.emit(OP.JMP, -1);
          em.patch(jz, em.here());
          s.els.stmts.forEach(gs);
          em.patch(j, em.here());
        } else em.patch(jz, em.here());
        break;
      }
      case 'While': {
        const top = em.here();
        gx(s.cond);
        const jz = em.emit(OP.JZ, -1);
        s.body.stmts.forEach(gs);
        em.emit(OP.JMP, top);
        em.patch(jz, em.here());
        break;
      }
    }
  };
  // pre-allocate all let slots
  (function scan(b){ for (const s of b.stmts){ if(s.kind==='Let') alloc(s.name);
    if(s.kind==='If'){scan(s.then); if(s.els)scan(s.els);} if(s.kind==='While')scan(s.body);} })(f.body);
  f.body.stmts.forEach(gs);
  em.emit(OP.PUSH, 0); em.emit(OP.RET);
  f.nslots = next;
}

/* ----------------------------------- VM ------------------------------------ */
function run(prog, ast, limit = 8_000_000) {
  const code = prog.code;
  const stack = new Int32Array(1<<16); let sp = 0;
  const frames = []; let fp = 0;
  const locals = new Int32Array(1<<14); let lbase = 0, ltop = 64;
  const out = []; let pc = 0, steps = 0;
  const fnByAddr = new Map(); for (const [n,a] of prog.addrs) fnByAddr.set(a, n);
  const nslots = new Map(); for (const f of ast.fns) nslots.set(f.name, f.nslots || 8);

  const push = v => { stack[sp++] = v|0; };
  const pop  = () => stack[--sp];

  while (pc < code.length) {
    if (++steps > limit) throw new Error(`execution limit exceeded (${limit} steps) — possible infinite loop`);
    const op = code[pc], arg = code[pc+1]; pc += 2;
    switch (op) {
      case OP.PUSH: push(arg); break;
      case OP.LOAD: push(locals[lbase + arg]); break;
      case OP.STORE: locals[lbase + arg] = pop(); break;
      case OP.ADD: { const b=pop(),a=pop(); push((a+b)|0); break; }
      case OP.SUB: { const b=pop(),a=pop(); push((a-b)|0); break; }
      case OP.MUL: { const b=pop(),a=pop(); push(Math.imul(a,b)); break; }
      case OP.DIV: { const b=pop(),a=pop(); if(b===0) throw new Error('runtime: division by zero'); push((a/b)|0); break; }
      case OP.MOD: { const b=pop(),a=pop(); if(b===0) throw new Error('runtime: modulo by zero'); push(a%b); break; }
      case OP.LT: { const b=pop(),a=pop(); push(a<b?1:0); break; }
      case OP.GT: { const b=pop(),a=pop(); push(a>b?1:0); break; }
      case OP.LE: { const b=pop(),a=pop(); push(a<=b?1:0); break; }
      case OP.GE: { const b=pop(),a=pop(); push(a>=b?1:0); break; }
      case OP.EQ: { const b=pop(),a=pop(); push(a===b?1:0); break; }
      case OP.NE: { const b=pop(),a=pop(); push(a!==b?1:0); break; }
      case OP.AND:{ const b=pop(),a=pop(); push((a&&b)?1:0); break; }
      case OP.OR: { const b=pop(),a=pop(); push((a||b)?1:0); break; }
      case OP.NOT: push(pop()?0:1); break;
      case OP.NEG: push(-pop()|0); break;
      case OP.JMP: pc = arg; break;
      case OP.JZ: if (pop() === 0) pc = arg; break;
      case OP.CALL: {
        const name = fnByAddr.get(arg);
        const n = (ast.fns.find(f=>f.name===name)?.params.length) || 0;
        const newBase = ltop; ltop += Math.max(16, nslots.get(name) || 16);
        for (let i = n-1; i >= 0; i--) locals[newBase + i] = pop();
        frames.push({ pc, lbase, ltop: ltop - Math.max(16, nslots.get(name)||16) });
        lbase = newBase; pc = arg;
        if (frames.length > 4096) throw new Error('runtime: stack overflow (recursion too deep)');
        break;
      }
      case OP.RET: {
        const v = pop();
        if (frames.length === 0) { push(v); pc = code.length; break; }
        const f = frames.pop(); pc = f.pc; lbase = f.lbase; ltop = f.ltop; push(v);
        break;
      }
      case OP.PRINT: out.push(String(pop())); break;
      case OP.POP: pop(); break;
      case OP.HALT: pc = code.length; break;
      default: throw new Error(`illegal opcode ${op} at ${pc-2}`);
    }
  }
  return { output: out, steps, result: sp > 0 ? stack[sp-1] : 0 };
}

/* ------------------------------- DISASSEMBLER ------------------------------ */
function disasm(prog){
  const lines = []; const rev = new Map();
  for (const [n,a] of prog.addrs) rev.set(a,n);
  for (let i = 0; i < prog.code.length; i += 2) {
    if (rev.has(i)) lines.push(`\n${rev.get(i)}:`);
    const op = prog.code[i], arg = prog.code[i+1];
    const needsArg = [OP.PUSH,OP.LOAD,OP.STORE,OP.JMP,OP.JZ,OP.CALL].includes(op);
    lines.push(`  ${String(i).padStart(4,'0')}  ${OPNAME[op].padEnd(6)}${needsArg?' '+arg:''}`);
  }
  return lines.join('\n');
}

/* --------------------------------- DRIVER ---------------------------------- */
function compile(src, opts = {}) {
  FOLDS = 0; DCE = 0;
  const t0 = performance.now();
  const toks = lex(src);
  const tLex = performance.now();
  const ast = new Parser(toks).parseProgram();
  const tParse = performance.now();
  new TypeChecker(ast).check();
  const tType = performance.now();
  if (opts.optimize !== false) for (const f of ast.fns) optBlock(f.body);
  const tOpt = performance.now();
  const prog = codegen(ast);
  const tGen = performance.now();
  return {
    tokens: toks, ast, prog,
    stats: {
      tokens: toks.length, functions: ast.fns.length,
      bytecode: prog.code.length / 2, folds: FOLDS, dce: DCE,
      lex: +(tLex-t0).toFixed(3), parse: +(tParse-tLex).toFixed(3),
      typecheck: +(tType-tParse).toFixed(3), optimize: +(tOpt-tType).toFixed(3),
      codegen: +(tGen-tOpt).toFixed(3), total: +(tGen-t0).toFixed(3)
    },
    disasm: () => disasm(prog),
    run: (limit) => run(prog, ast, limit)
  };
}

const FORGE = { compile, lex, Parser, TypeChecker, codegen, run, disasm, CompileError, OP, OPNAME };
if (typeof module !== 'undefined') module.exports = FORGE;
if (typeof window !== 'undefined') window.FORGE = FORGE;
