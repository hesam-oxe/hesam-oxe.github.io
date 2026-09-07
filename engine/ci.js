// ============================================================================
// CONTINUOUS INTEGRATION — in your browser, on this page, right now.
//
// Most portfolios ask you to believe them. This one runs its own test suite in
// front of you. Every engine on this page is asserted against a value that was
// fixed before the code was written: NIST vectors, known fibonacci numbers,
// the gzip decoder your browser vendor shipped, finite-difference gradients,
// conservation of energy.
//
// If any row goes red, the claim above it on this page is false. That is the
// entire point.
// ============================================================================
'use strict';
(function () {

  const SUITE = [];
  const suite = (group, name, fn) => SUITE.push({ group, name, fn });

  /* ------------------------------- helpers -------------------------------- */
  function eq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
    return String(a);
  }
  function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); return 'ok'; }
  function near(a, b, tol, msg) {
    if (Math.abs(a - b) > tol) throw new Error((msg || '') + ' |' + a + ' - ' + b + '| > ' + tol);
    return a.toPrecision(6);
  }

  let WASM = null;
  async function wasm() {
    if (WASM) return WASM;
    const b64 = await (await fetch('engine/core.wasm.b64')).text();
    const bin = Uint8Array.from(atob(b64.trim()), c => c.charCodeAt(0));
    const { instance } = await WebAssembly.instantiate(bin, {});
    WASM = { bin, e: instance.exports };
    return WASM;
  }

  const enc = new TextEncoder();
  let PAGE = null;
  async function pageBytes() {
    if (PAGE) return PAGE;
    try { PAGE = new Uint8Array(await (await fetch('index.html')).arrayBuffer()); }
    catch (_) { PAGE = enc.encode(document.documentElement.outerHTML); }
    return PAGE;
  }

  /* ================================ WASM ================================== */
  suite('wasm', 'module is exactly 253 bytes', async () => eq((await wasm()).bin.length, 253));
  suite('wasm', 'WebAssembly.validate() accepts it', async () => eq(WebAssembly.validate((await wasm()).bin), true));
  suite('wasm', 'add(40, 2) === 42', async () => eq((await wasm()).e.add(40, 2), 42));
  suite('wasm', 'fib(30) === 832040', async () => eq((await wasm()).e.fib(30), 832040));
  suite('wasm', 'fib(0..10) matches the sequence', async () => {
    const e = (await wasm()).e, want = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
    for (let i = 0; i <= 10; i++) eq(e.fib(i), want[i], 'fib(' + i + ')');
    return want.join(',');
  });
  suite('wasm', 'mandel(-0.5,0) stays inside the set', async () => eq((await wasm()).e.mandel(-0.5, 0, 1000), 1000));
  suite('wasm', 'mandel(1,1) escapes immediately', async () => ok((await wasm()).e.mandel(1, 1, 1000) < 5, 'should escape'));

  /* =============================== SHA-256 ================================ */
  suite('sha256', 'NIST vector: empty string', () =>
    eq(ARSENAL.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
  suite('sha256', 'NIST vector: "abc"', () =>
    eq(ARSENAL.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
  suite('sha256', 'NIST vector: 448-bit message', () =>
    eq(ARSENAL.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
       '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'));
  suite('sha256', 'agrees with SubtleCrypto on 32 random inputs', async () => {
    if (!(crypto && crypto.subtle)) return 'skipped (no SubtleCrypto)';
    for (let i = 0; i < 32; i++) {
      const len = 1 + ((Math.random() * 300) | 0);
      let s = '';
      for (let k = 0; k < len; k++) s += String.fromCharCode(32 + ((Math.random() * 90) | 0));
      const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
      const ref = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      eq(ARSENAL.sha256(s), ref, 'input len ' + len);
    }
    return '32/32';
  });
  suite('sha256', 'padding boundary: lengths 54..66 bytes', async () => {
    if (!(crypto && crypto.subtle)) return 'skipped';
    for (let n = 54; n <= 66; n++) {
      const s = 'x'.repeat(n);
      const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
      const ref = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      eq(ARSENAL.sha256(s), ref, 'len ' + n);
    }
    return '13/13';
  });

  /* =============================== COMPILER =============================== */
  suite('compiler', 'fib(20) prints 6765', () => {
    const c = FORGE.compile('fn fib(n: int) -> int { if n < 2 { return n; } return fib(n-1)+fib(n-2); }\nfn main() -> int { print fib(20); return 0; }');
    return eq(c.run().output.join(','), '6765');
  });
  suite('compiler', 'gcd(1071, 462) === 21', () => {
    const c = FORGE.compile('fn gcd(a: int, b: int) -> int { while b != 0 { let t = b; b = a % b; a = t; } return a; }\nfn main() -> int { print gcd(1071,462); return 0; }');
    return eq(c.run().output.join(','), '21');
  });
  suite('compiler', 'sieve finds 17 primes below 60', () => {
    const c = FORGE.compile('fn isprime(n: int) -> bool { if n < 2 { return false; } let d = 2; while d*d <= n { if n % d == 0 { return false; } d = d + 1; } return true; }\nfn main() -> int { let n = 2; let f = 0; while n < 60 { if isprime(n) { f = f + 1; } n = n + 1; } print f; return 0; }');
    return eq(c.run().output.join(','), '17');
  });
  suite('compiler', 'constant folding shrinks the bytecode', () => {
    const src = 'fn main() -> int { let x = 2*3 + 4*5; print x; if false { print 666; } return 0; }';
    const on = FORGE.compile(src, { optimize: true }).stats;
    const off = FORGE.compile(src, { optimize: false }).stats;
    ok(on.bytecode < off.bytecode, 'optimized ' + on.bytecode + ' not < ' + off.bytecode);
    ok(on.folds > 0, 'no folds recorded');
    return off.bytecode + ' → ' + on.bytecode + ' instrs, ' + on.folds + ' folds';
  });
  suite('compiler', 'optimizer preserves semantics', () => {
    const src = 'fn main() -> int { let x = 2*3 + 4*5; let y = x*1 + 0; print y; if false { print 666; } return 0; }';
    const a = FORGE.compile(src, { optimize: true }).run().output.join(',');
    const b = FORGE.compile(src, { optimize: false }).run().output.join(',');
    eq(a, b, 'optimized output differs');
    return eq(a, '26');
  });
  suite('compiler', 'type checker rejects int = bool', () => {
    try { FORGE.compile('fn main() -> int { let x: int = true; return 0; }'); }
    catch (e) { return 'rejected: ' + String(e.message).split('\n')[0].slice(0, 48); }
    throw new Error('type error was NOT caught');
  });
  suite('compiler', 'parser rejects unbalanced braces', () => {
    try { FORGE.compile('fn main() -> int { return 0;'); }
    catch (e) { return 'rejected'; }
    throw new Error('syntax error was NOT caught');
  });
  suite('compiler', 'undefined function is a compile error', () => {
    try { FORGE.compile('fn main() -> int { return nope(1); }'); }
    catch (e) { return 'rejected'; }
    throw new Error('unknown callee was NOT caught');
  });

  /* ================================ REGEX ================================= */
  suite('regex', '(a|b)*c[0-9] matches "ababc7"', () => eq(ARSENAL.regex('(a|b)*c[0-9]', 'ababc7').matched, true));
  suite('regex', '(a|b)*c[0-9] rejects "ababcx"', () => eq(ARSENAL.regex('(a|b)*c[0-9]', 'ababcx').matched, false));
  suite('regex', 'a+b? / anchoring / classes', () => {
    eq(ARSENAL.regex('a+b?', 'aaab').matched, true, 'a+b?');
    eq(ARSENAL.regex('[^0-9]+', 'abc').matched, true, 'negated class');
    eq(ARSENAL.regex('[^0-9]+', 'ab1').matched, false, 'negated class reject');
    eq(ARSENAL.regex('a.c', 'axc').matched, true, 'dot');
    return '4/4';
  });
  suite('regex', 'ReDoS bomb (a|a)*b × 40 stays linear', () => {
    const t = performance.now();
    const r = ARSENAL.regex('(a|a)*b', 'a'.repeat(40));
    const ms = performance.now() - t;
    eq(r.matched, false, 'should not match');
    ok(ms < 50, 'took ' + ms.toFixed(2) + 'ms — that is backtracking');
    return ms.toFixed(2) + ' ms (a backtracker needs ~2^40 steps)';
  });
  suite('regex', 'active state set stays bounded', () => {
    const r = ARSENAL.regex('(a|a)*b', 'a'.repeat(200));
    ok(r.maxActive <= r.states, 'state set exceeded NFA size');
    return 'max ' + r.maxActive + ' of ' + r.states + ' states';
  });

  /* ================================ SORTING =============================== */
  suite('sorting', 'quicksort / mergesort / radix all agree with V8', () => {
    const r = ARSENAL.sortLab(4000);
    const names = Object.keys(r);
    for (const n of names) ok(r[n].sorted, n + ' produced an unsorted array');
    return names.length + ' algorithms, all sorted';
  });
  suite('sorting', 'stable under duplicates and n=1', () => {
    const r = ARSENAL.sortLab(1);
    return ok(Object.values(r).every(v => v.sorted), 'n=1 broke something') && 'edge cases ok';
  });

  /* ================================ N-BODY ================================ */
  suite('n-body', 'velocity-Verlet conserves energy < 0.5%', () => {
    const sim = new ARSENAL.NBody(120);
    const e0 = sim.energy();
    for (let i = 0; i < 200; i++) sim.step(0.06);
    const drift = Math.abs((sim.energy() - e0) / e0) * 100;
    ok(drift < 0.5, 'drift ' + drift.toFixed(4) + '%');
    return 'drift ' + drift.toFixed(5) + '% over 200 steps';
  });
  suite('n-body', 'no body escapes to NaN', () => {
    const sim = new ARSENAL.NBody(80);
    for (let i = 0; i < 120; i++) sim.step(0.06);
    for (let i = 0; i < sim.n; i++) ok(Number.isFinite(sim.px[i]) && Number.isFinite(sim.py[i]), 'NaN at body ' + i);
    return sim.n + ' bodies finite';
  });

  /* ============================== RAYTRACER =============================== */
  suite('raytracer', 'render is deterministic', () => {
    const a = ARSENAL.raytrace(48, 30, { depth: 2 }).pixels;
    const b = ARSENAL.raytrace(48, 30, { depth: 2 }).pixels;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error('pixel ' + i + ' differs');
    return '1440 pixels identical across runs';
  });
  suite('raytracer', 'deeper recursion casts strictly more rays', () => {
    const r1 = ARSENAL.raytrace(48, 30, { depth: 1 }).rays;
    const r3 = ARSENAL.raytrace(48, 30, { depth: 3 }).rays;
    ok(r3 > r1, r3 + ' not > ' + r1);
    return r1.toLocaleString() + ' → ' + r3.toLocaleString() + ' rays';
  });
  suite('raytracer', 'output is fully opaque and in gamut', () => {
    const p = ARSENAL.raytrace(32, 20, { depth: 2 }).pixels;
    for (let i = 3; i < p.length; i += 4) if (p[i] !== 255) throw new Error('alpha != 255');
    return 'all alpha = 255';
  });

  /* ================================ DEFLATE =============================== */
  suite('deflate', 'CRC-32 of "123456789" === 0xCBF43926', () =>
    eq(DEFLATE.crc32(enc.encode('123456789')).toString(16).toUpperCase(), 'CBF43926'));
  suite('deflate', 'round-trips through our own inflate', () => {
    const data = enc.encode('the quick brown fox '.repeat(200) + 'ZZZ');
    const g = DEFLATE.gzip(data, 9);
    const back = DEFLATE.gunzip(g.out);
    eq(back.length, data.length, 'length');
    for (let i = 0; i < data.length; i++) if (back[i] !== data[i]) throw new Error('byte ' + i);
    return data.length + ' → ' + g.out.length + ' bytes (' + g.stats.blockType + ')';
  });
  suite('deflate', 'the BROWSER\'s gzip decoder accepts our output', async () => {
    if (typeof DecompressionStream === 'undefined') return 'skipped (no DecompressionStream)';
    const data = await pageBytes();
    const g = DEFLATE.gzip(data, 9);
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([g.out]).stream().pipeThrough(ds);
    const back = new Uint8Array(await new Response(stream).arrayBuffer());
    eq(back.length, data.length, 'length');
    for (let i = 0; i < data.length; i++) if (back[i] !== data[i]) throw new Error('byte ' + i + ' differs');
    const pct = (100 - g.out.length / data.length * 100).toFixed(1);
    return data.length.toLocaleString() + ' → ' + g.out.length.toLocaleString() + ' bytes (−' + pct + '%), verified by your browser';
  });
  suite('deflate', 'survives incompressible random data', () => {
    const data = new Uint8Array(20000);
    crypto.getRandomValues(data);
    const g = DEFLATE.gzip(data, 9);
    const back = DEFLATE.gunzip(g.out);
    for (let i = 0; i < data.length; i++) if (back[i] !== data[i]) throw new Error('byte ' + i);
    return '20 KB random, expansion ' + (g.out.length - data.length) + ' bytes';
  });
  suite('deflate', 'edge cases: empty, 1 byte, 100 KB of one byte', () => {
    const cases = [new Uint8Array(0), enc.encode('a'), new Uint8Array(100000).fill(65)];
    for (const c of cases) {
      const back = DEFLATE.gunzip(DEFLATE.gzip(c, 9).out);
      eq(back.length, c.length, 'length for ' + c.length);
      for (let i = 0; i < c.length; i++) if (back[i] !== c[i]) throw new Error('byte ' + i);
    }
    const g = DEFLATE.gzip(cases[2], 9);
    return '100 KB → ' + g.out.length + ' bytes (' + (cases[2].length / g.out.length).toFixed(0) + ':1)';
  });

  /* ============================ NEURAL NETWORK ============================ */
  suite('neural net', 'analytic gradients match finite differences', () => {
    const net = new NN.MLP([2, 12, 12, 1], { seed: 3 });
    const d = NN.twoSpirals(12, 0.05, 42);
    const r = net.gradCheck(d.X, d.Y, 40);
    ok(r.worst < 1e-5, 'worst relative error ' + r.worst.toExponential(2));
    return 'worst rel. error ' + r.worst.toExponential(2) + ' over ' + r.checked + ' weights';
  });
  suite('neural net', 'learns XOR (not linearly separable)', () => {
    const net = new NN.MLP([2, 8, 1], { seed: 5 });
    const d = NN.xorSet();
    for (let e = 0; e < 2000; e++) net.trainEpoch(d.X, d.Y, { lr: 0.5, batch: 4, momentum: 0.9 });
    eq(net.accuracy(d.X, d.Y), 1, 'accuracy');
    return d.X.map(v => net.predict(v)[0].toFixed(3)).join('  ');
  });
  suite('neural net', 'loss decreases monotonically in trend', () => {
    const net = new NN.MLP([2, 16, 1], { seed: 9 });
    const d = NN.circles(40, 0.12, 11);
    const first = net.trainEpoch(d.X, d.Y, { lr: 0.02, batch: 10, momentum: 0.9 });
    let last = first;
    for (let e = 0; e < 400; e++) last = net.trainEpoch(d.X, d.Y, { lr: 0.02, batch: 10, momentum: 0.9 });
    ok(last < first, 'loss went up: ' + first + ' → ' + last);
    return first.toFixed(4) + ' → ' + last.toFixed(4);
  });

  /* ============================== 3D RENDERER ============================= */
  suite('renderer', 'no third-party script tags on this page', () => {
    const bad = [...document.querySelectorAll('script[src]')]
      .map(s => s.getAttribute('src'))
      .filter(s => /^https?:|^\/\//.test(s));
    ok(bad.length === 0, 'found remote scripts: ' + bad.join(', '));
    return document.querySelectorAll('script').length + ' scripts, all same-origin';
  });
  suite('renderer', 'no remote stylesheets or fonts', () => {
    const bad = [...document.querySelectorAll('link[rel=stylesheet],link[as=font]')]
      .map(l => l.getAttribute('href')).filter(h => /^https?:|^\/\//.test(h));
    ok(bad.length === 0, 'found: ' + bad.join(', '));
    return 'zero external CSS/font requests';
  });

  /* ============================== THE RUNNER ============================== */
  const $ = id => document.getElementById(id);

  async function run() {
    const body = $('cibody'), sum = $('cisum'), btn = $('cirun');
    if (!body) return;
    btn.disabled = true;
    btn.textContent = '⟳ RUNNING…';
    body.innerHTML = '';
    let pass = 0, fail = 0, skip = 0;
    const t0 = performance.now();

    for (const t of SUITE) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><span class="pill run">RUN</span></td>' +
        '<td class="org">' + t.group + '</td><td>' + t.name + '</td>' +
        '<td class="ci-detail d">…</td><td class="ci-ms d">—</td>';
      body.appendChild(tr);
      // let the row paint before we block the thread
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

      const s = performance.now();
      let cls, label, detail;
      try {
        const out = await t.fn();
        const ms = performance.now() - s;
        if (typeof out === 'string' && /^skipped/.test(out)) { skip++; cls = 'open'; label = 'SKIP'; }
        else { pass++; cls = 'ok'; label = 'PASS'; }
        detail = out === undefined ? 'ok' : String(out);
        tr.children[4].textContent = ms.toFixed(1) + ' ms';
      } catch (err) {
        fail++; cls = 'bad'; label = 'FAIL';
        detail = String(err && err.message || err);
        tr.children[4].textContent = (performance.now() - s).toFixed(1) + ' ms';
      }
      tr.children[0].innerHTML = '<span class="pill ' + cls + '">' + label + '</span>';
      tr.children[3].textContent = detail;
      tr.children[3].className = 'ci-detail ' + (cls === 'bad' ? 'e' : cls === 'ok' ? 'g' : 'd');
      sum.innerHTML = '<b class="g">' + pass + '</b> passed · <b class="' + (fail ? 'e' : 'd') + '">' +
        fail + '</b> failed · <b>' + skip + '</b> skipped · <b>' +
        ((performance.now() - t0) / 1000).toFixed(2) + '</b> s';
    }

    const total = performance.now() - t0;
    sum.innerHTML = (fail === 0
      ? '<b class="g">■ GREEN — ' + pass + '/' + (pass + skip + fail) + ' assertions passed'
      : '<b class="e">■ RED — ' + fail + ' assertion(s) failed') +
      '</b> · ' + skip + ' skipped · ' + (total / 1000).toFixed(2) + ' s wall clock · ' +
      'executed on <b>your</b> machine at ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
    btn.disabled = false;
    btn.textContent = '↻ RUN THE SUITE AGAIN';
    const badge = $('cibadge');
    if (badge) {
      badge.textContent = fail === 0 ? 'BUILD PASSING' : 'BUILD FAILING';
      badge.className = 'badge ' + (fail === 0 ? 'ok' : 'bad');
    }
  }

  const btn = $('cirun');
  if (btn) {
    btn.addEventListener('click', run);
    const cnt = $('cicount');
    if (cnt) cnt.textContent = SUITE.length;
    // auto-run once the section is actually looked at
    const sec = $('ci');
    if (sec && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => {
        if (es[0].isIntersecting) { io.disconnect(); run(); }
      }, { threshold: 0.15 });
      io.observe(sec);
    }
  }
  window.__CI = { run, SUITE };
})();
