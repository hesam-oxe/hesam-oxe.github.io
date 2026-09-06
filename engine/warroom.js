// ============================================================================
// WAR ROOM — wires the arsenal to the DOM. Every panel runs real computation
// in the visitor's browser, live, with verifiable output.
// ============================================================================
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------ 1. COMPILER ----------------------------- */
  const DEMOS = {
    fib: `fn fib(n: int) -> int {
  if n < 2 { return n; }
  return fib(n-1) + fib(n-2);
}
fn main() -> int {
  print fib(20);
  return 0;
}`,
    optimize: `fn main() -> int {
  let folded = 2 * 3 + 4 * 5;   // folded to 26 at compile time
  let ident  = folded * 1 + 0;  // algebraic identity, erased
  print ident;
  if false { print 666; }       // dead branch, eliminated
  while false { print 1; }      // dead loop, eliminated
  return 0;
}`,
    sieve: `fn isprime(n: int) -> bool {
  if n < 2 { return false; }
  let d = 2;
  while d * d <= n {
    if n % d == 0 { return false; }
    d = d + 1;
  }
  return true;
}
fn main() -> int {
  let n = 2;
  let found = 0;
  while n < 60 {
    if isprime(n) { print n; found = found + 1; }
    n = n + 1;
  }
  print found;
  return 0;
}`,
    typeerror: `fn main() -> int {
  let x: int = true;   // <- type checker will reject this
  return 0;
}`,
    gcd: `fn gcd(a: int, b: int) -> int {
  while b != 0 {
    let t = b;
    b = a % b;
    a = t;
  }
  return a;
}
fn main() -> int {
  print gcd(1071, 462);
  print gcd(270, 192);
  return 0;
}`
  };

  const srcEl = $('csrc'), outEl = $('cout'), statEl = $('cstats');
  if (srcEl) {
    srcEl.value = DEMOS.fib;

    const paint = (txt, cls) => { outEl.innerHTML = ''; const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = txt; outEl.appendChild(s); };

    const doCompile = (execute) => {
      const src = srcEl.value;
      const opt = $('coptim') ? $('coptim').checked : true;
      try {
        const c = FORGE.compile(src, { optimize: opt });
        const s = c.stats;
        statEl.innerHTML =
          `<b>${s.tokens}</b> tokens · <b>${s.functions}</b> fns · <b>${s.bytecode}</b> instrs · ` +
          `folds <b class="g">${s.folds}</b> · dce <b class="g">${s.dce}</b> · ` +
          `lex ${s.lex}ms · parse ${s.parse}ms · typeck ${s.typecheck}ms · opt ${s.optimize}ms · gen ${s.codegen}ms · ` +
          `<b class="c">total ${s.total}ms</b>`;
        if (!execute) { paint(c.disasm().trim(), 'd'); return; }
        const t0 = performance.now();
        const r = c.run();
        const dt = (performance.now() - t0).toFixed(2);
        paint(`stdout:\n${r.output.join('\n') || '(no output)'}\n\n[${r.steps.toLocaleString()} VM steps in ${dt}ms]`, 'g');
      } catch (e) {
        paint(e.isCompileError ? e.format(src) : 'runtime ' + e.message, 'e');
        statEl.innerHTML = '<b class="e">compilation failed — diagnostics above</b>';
      }
    };

    $('crun').onclick = () => doCompile(true);
    $('casm').onclick = () => doCompile(false);
    document.querySelectorAll('[data-demo]').forEach(b => {
      b.onclick = () => { srcEl.value = DEMOS[b.dataset.demo]; doCompile(true); };
    });
    doCompile(true);
  }

  /* -------------------------------- 2. WASM ------------------------------- */
  (async function () {
    const el = $('wasmout'); if (!el) return;
    try {
      const b64 = await (await fetch('engine/core.wasm.b64')).text();
      const bin = Uint8Array.from(atob(b64.trim()), c => c.charCodeAt(0));
      const valid = WebAssembly.validate(bin);
      const { instance } = await WebAssembly.instantiate(bin, {});
      const e = instance.exports;
      const t0 = performance.now();
      let acc = 0;
      for (let i = 0; i < 120000; i++) acc += e.mandel(-0.7 + (i % 100) * 0.012, 0.28, 255);
      const dt = performance.now() - t0;
      el.innerHTML =
`<span class="g">module: ${bin.length} bytes — emitted byte-by-byte, no toolchain</span>
validate()      → <span class="c">${valid}</span>
exports         → <span class="c">${Object.keys(e).join(', ')}</span>
add(40, 2)      → <span class="g">${e.add(40, 2)}</span>
fib(30)         → <span class="g">${e.fib(30)}</span>  <span class="d">(expect 832040)</span>
mandel(-0.5,0)  → <span class="g">${e.mandel(-0.5, 0, 1000)}</span> <span class="d">(inside set → maxiter)</span>
mandel(1,1)     → <span class="g">${e.mandel(1, 1, 1000)}</span> <span class="d">(escapes fast)</span>
<span class="g">120,000 mandelbrot calls in ${dt.toFixed(1)}ms</span>`;
    } catch (err) { el.innerHTML = '<span class="e">wasm unavailable: ' + err.message + '</span>'; }
  })();

  /* -------------------------------- 3. SHA-256 ---------------------------- */
  (function () {
    const inp = $('shain'), out = $('shaout'), vec = $('shavec');
    if (!inp) return;
    const upd = () => {
      const t0 = performance.now();
      const h = ARSENAL.sha256(inp.value);
      const dt = (performance.now() - t0).toFixed(3);
      out.innerHTML = `<span class="c">${h.slice(0,32)}</span>\n<span class="c">${h.slice(32)}</span>\n<span class="d">${dt}ms · pure JS · FIPS 180-4</span>`;
    };
    inp.oninput = upd;
    inp.value = 'HESAM JAMALI';
    upd();
    vec.innerHTML = ARSENAL.verifySHA().map(r =>
      `<span class="${r.pass ? 'g' : 'e'}">[${r.pass ? 'PASS' : 'FAIL'}]</span> <span class="d">NIST vector "${r.input}"</span>`
    ).join('\n');
    $('shabench').onclick = () => {
      const data = 'x'.repeat(200000);
      const t0 = performance.now();
      ARSENAL.sha256(data);
      const dt = performance.now() - t0;
      $('shabenchout').innerHTML = `<span class="g">200 KB hashed in ${dt.toFixed(1)}ms → ${(0.2/(dt/1000)).toFixed(1)} MB/s</span>`;
    };
  })();

  /* ------------------------------ 4. RAYTRACER ---------------------------- */
  (function () {
    const cv = $('rtcv'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const info = $('rtinfo');
    const render = (depth) => {
      info.textContent = 'tracing…';
      setTimeout(() => {
        const W = cv.width, H = cv.height;
        const t0 = performance.now();
        const { pixels, rays } = ARSENAL.raytrace(W, H, { depth });
        const dt = performance.now() - t0;
        ctx.putImageData(new ImageData(pixels, W, H), 0, 0);
        info.innerHTML = `<span class="g">${W}×${H}</span> · depth <span class="c">${depth}</span> · ` +
          `<span class="g">${rays.toLocaleString()}</span> rays · <span class="c">${dt.toFixed(0)}ms</span> · ` +
          `<span class="g">${(rays/dt/1000).toFixed(2)}M rays/s</span> · recursive reflections + soft shadows + Fresnel`;
      }, 16);
    };
    let done = false;
    const kick = () => { if (!done) { done = true; render(3); } };
    const io = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) { io.unobserve(cv); kick(); } });
    }, { threshold: 0.05 });
    io.observe(cv);
    setTimeout(kick, 1200);            // guarantee a render even if never scrolled into view
    window.__rtRender = render;
    $('rtd2').onclick = () => render(1);
    $('rtd3').onclick = () => render(3);
    $('rtd5').onclick = () => render(5);
  })();

  /* -------------------------------- 5. N-BODY ----------------------------- */
  (function () {
    const cv = $('nbcv'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const sim = new ARSENAL.NBody(200);
    const E0 = sim.energy();
    const info = $('nbinfo');
    let frames = 0, fpsT = performance.now(), fps = 0, warmed = false;
    const vis = () => { const r = cv.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
    function stats(f) {
      const E = sim.energy();
      info.innerHTML = `<span class="g">${sim.n}</span> bodies · <span class="c">${(sim.n*(sim.n-1)/2).toLocaleString()}</span> pair-forces/step · ` +
        (f ? `<span class="g">${f.toFixed(0)} fps</span> · ` : '') + `velocity-Verlet · ` +
        `energy drift <span class="${Math.abs((E-E0)/E0) < 0.01 ? 'g' : 'e'}">${(Math.abs((E-E0)/E0)*100).toFixed(4)}%</span>`;
    }
    function draw() {
      const W = cv.width, H = cv.height, cx = W/2, cy = H/2;
      ctx.fillStyle = 'rgba(5,5,8,0.28)'; ctx.fillRect(0,0,W,H);
      for (let i = 0; i < sim.n; i++) {
        const x = cx + sim.px[i]*0.62, y = cy + sim.py[i]*0.62;
        if (x < 0 || x > W || y < 0 || y > H) continue;
        const sp = Math.hypot(sim.vx[i], sim.vy[i]);
        ctx.fillStyle = i === 0 ? '#ffb000' : (sp > 5 ? '#00e5ff' : sp > 3 ? '#b026ff' : '#dc143c');
        ctx.beginPath(); ctx.arc(x, y, i === 0 ? 5 : 1.4, 0, 7); ctx.fill();
      }
    }
    function loop() {
      requestAnimationFrame(loop);
      if (!warmed) { warmed = true; ctx.fillStyle = '#050508'; ctx.fillRect(0,0,cv.width,cv.height); for (let k=0;k<40;k++) sim.step(0.05); draw(); stats(0); }
      if (RM || !vis()) return;
      sim.step(0.05);
      draw();
      if (++frames % 30 === 0) {
        const now = performance.now(); fps = 30000/(now - fpsT); fpsT = now;
        stats(fps);
      }
    }
    requestAnimationFrame(loop);
  })();

  /* -------------------------------- 6. REGEX ------------------------------ */
  (function () {
    const p = $('rep'), s = $('res'), o = $('reout');
    if (!p) return;
    const upd = () => {
      try {
        const t0 = performance.now();
        const r = ARSENAL.regex(p.value, s.value);
        const dt = (performance.now() - t0).toFixed(3);
        o.innerHTML = `match: <span class="${r.matched ? 'g' : 'e'}">${r.matched}</span> · ` +
          `NFA states <span class="c">${r.states}</span> · peak active <span class="c">${r.maxActive}</span> · ` +
          `<span class="g">${dt}ms</span>`;
      } catch (e) { o.innerHTML = '<span class="e">bad pattern</span>'; }
    };
    p.oninput = s.oninput = upd;
    upd();
    $('reevil').onclick = () => {
      const pat = '(a|a)*b', inp = 'a'.repeat(40);
      const t0 = performance.now();
      const r = ARSENAL.regex(pat, inp);
      const dt = performance.now() - t0;
      p.value = pat; s.value = inp; upd();
      $('reevilout').innerHTML = `<span class="g">/${pat}/ on 40 a's → ${r.matched} in ${dt.toFixed(3)}ms.</span> ` +
        `<span class="d">Backtracking engines (JS, Perl, Python) need ~2⁴⁰ steps here. Thompson NFA is O(n·m). Always.</span>`;
    };
  })();

  /* ------------------------------ 7. SORT LAB ----------------------------- */
  (function () {
    const btn = $('sortrun'); if (!btn) return;
    btn.onclick = () => {
      const n = +$('sortn').value || 2000;
      $('sortout').textContent = 'running…';
      setTimeout(() => {
        const r = ARSENAL.sortLab(n);
        const rows = Object.entries(r).sort((a,b) => a[1].ms - b[1].ms);
        const fastest = rows[0][1].ms;
        $('sortout').innerHTML = rows.map(([k,v]) =>
          `<span class="c">${k.padEnd(12)}</span> <span class="g">${String(v.ms).padStart(8)}ms</span> ` +
          `<span class="d">${'█'.repeat(Math.max(1, Math.round(v.ms/fastest*3)))}</span> ` +
          `<span class="${v.sorted ? 'g' : 'e'}">${v.sorted ? '✓ verified' : '✗ BROKEN'}</span>`
        ).join('\n');
      }, 16);
    };
  })();

  /* ------------------------------ 8. BENCHMARK ---------------------------- */
  (function () {
    const btn = $('benchrun'); if (!btn) return;
    btn.onclick = () => {
      $('benchout').textContent = 'benchmarking your machine…';
      setTimeout(() => {
        const out = [];
        let t = performance.now();
        let s = 0; for (let i = 0; i < 5e6; i++) s += Math.sqrt(i);
        out.push(['5M sqrt (float)', performance.now() - t]);
        t = performance.now();
        ARSENAL.sha256('x'.repeat(500000));
        out.push(['SHA-256 500 KB', performance.now() - t]);
        t = performance.now();
        const c = FORGE.compile(DEMOS.sieve); c.run();
        out.push(['compile+run sieve', performance.now() - t]);
        t = performance.now();
        ARSENAL.raytrace(120, 80, { depth: 2 });
        out.push(['raytrace 120×80', performance.now() - t]);
        t = performance.now();
        const nb = new ARSENAL.NBody(150); for (let i = 0; i < 60; i++) nb.step();
        out.push(['n-body 150×60', performance.now() - t]);
        const total = out.reduce((a, [, v]) => a + v, 0);
        $('benchout').innerHTML = out.map(([k, v]) =>
          `<span class="c">${k.padEnd(20)}</span> <span class="g">${v.toFixed(1).padStart(8)}ms</span>`
        ).join('\n') + `\n<span class="d">─────────────────────────────</span>\n` +
        `<span class="c">${'TOTAL'.padEnd(20)}</span> <span class="g">${total.toFixed(1).padStart(8)}ms</span>\n` +
        `<span class="d">every number above was computed on YOUR device, right now, by code on this page.</span>`;
      }, 16);
    };
  })();
})();
