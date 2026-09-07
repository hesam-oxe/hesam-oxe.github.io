// ============================================================================
// LAB — DOM wiring for the compressor and the neural network.
// Both run entirely on the visitor's machine. Nothing is precomputed.
// ============================================================================
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enc = new TextEncoder();
  const fmt = n => n.toLocaleString('en-US');

  /* ======================================================================== */
  /*                            1. THE COMPRESSOR                             */
  /* ======================================================================== */
  (function () {
    const out = $('gzout'), stat = $('gzstat');
    if (!out) return;
    let lastGz = null, lastName = 'payload.gz';

    const paint = html => { out.innerHTML = html; };

    async function compress(bytes, label) {
      paint('<span class="d">compressing ' + fmt(bytes.length) + ' bytes…</span>');
      await new Promise(r => setTimeout(r, 16));

      const t0 = performance.now();
      const g = DEFLATE.gzip(bytes, 9);
      const ms = performance.now() - t0;
      lastGz = g.out;
      lastName = label.replace(/[^\w.-]+/g, '_') + '.gz';

      // verification 1 — our own inflate
      let mine = '✗';
      try {
        const back = DEFLATE.gunzip(g.out);
        let same = back.length === bytes.length;
        if (same) for (let i = 0; i < bytes.length; i++) if (back[i] !== bytes[i]) { same = false; break; }
        mine = same ? '<span class="g">byte-identical</span>' : '<span class="e">MISMATCH</span>';
      } catch (e) { mine = '<span class="e">' + e.message + '</span>'; }

      // verification 2 — the browser's own gzip decoder, which we did not write
      let theirs = '<span class="d">unavailable in this browser</span>';
      if (typeof DecompressionStream !== 'undefined') {
        try {
          const st = new Blob([g.out]).stream().pipeThrough(new DecompressionStream('gzip'));
          const back = new Uint8Array(await new Response(st).arrayBuffer());
          let same = back.length === bytes.length;
          if (same) for (let i = 0; i < bytes.length; i++) if (back[i] !== bytes[i]) { same = false; break; }
          theirs = same ? '<span class="g">byte-identical</span>' : '<span class="e">MISMATCH</span>';
        } catch (e) { theirs = '<span class="e">rejected: ' + e.message + '</span>'; }
      }

      const ratio = bytes.length ? (100 - g.out.length / bytes.length * 100) : 0;
      const thru = ms > 0 ? (bytes.length / 1024 / (ms / 1000)) : 0;
      const s = g.stats;

      paint(
`<span class="c">input</span>          ${fmt(bytes.length)} bytes  <span class="d">${label}</span>
<span class="c">gzip output</span>    ${fmt(g.out.length)} bytes  <span class="g">−${ratio.toFixed(1)}%</span>  <span class="d">(${(bytes.length / Math.max(1, g.out.length)).toFixed(2)}:1)</span>
<span class="c">block type</span>     ${s.blockType}
<span class="c">LZ77</span>           ${fmt(s.tokens)} tokens · ${fmt(s.literals)} literals · ${fmt(s.matches)} back-references
<span class="c">longest match</span>  ${s.longestMatch} bytes  <span class="d">(window 32 KiB, max match 258)</span>
<span class="c">huffman</span>        dynamic ${fmt(Math.ceil(s.dynamicBits / 8))} B vs fixed ${fmt(Math.ceil(s.fixedBits / 8))} B  <span class="d">→ cheaper one wins</span>
<span class="c">CRC-32</span>         0x${s.crc32.toString(16).toUpperCase().padStart(8, '0')}
<span class="c">time</span>           ${ms.toFixed(1)} ms  <span class="d">(${thru.toFixed(0)} KB/s)</span>

<span class="c">verify · our inflate</span>        ${mine}
<span class="c">verify · YOUR browser's gzip</span> ${theirs}
<span class="d">  ↑ DecompressionStream('gzip') is written by your browser vendor, not by me.
    If a single bit of the Huffman stream were wrong, it would throw.</span>`);

      stat.innerHTML = 'compressed <b>' + fmt(bytes.length) + '</b> B → <b class="g">' + fmt(g.out.length) +
        '</b> B in <b>' + ms.toFixed(1) + '</b> ms · download it and run <code>gunzip</code> on it if you don\'t believe the page.';
      const dl = $('gzdl'); if (dl) dl.disabled = false;
    }

    $('gzpage').addEventListener('click', async () => {
      let bytes;
      try { bytes = new Uint8Array(await (await fetch('index.html')).arrayBuffer()); }
      catch (_) { bytes = enc.encode(document.documentElement.outerHTML); }
      compress(bytes, 'index.html');
    });
    $('gzengine').addEventListener('click', async () => {
      const parts = [];
      for (const f of ['engine/compiler.js', 'engine/forge.js', 'engine/deflate.js', 'engine/nn.js']) {
        try { parts.push(await (await fetch(f)).text()); } catch (_) {}
      }
      compress(enc.encode(parts.join('\n')), 'engines.js');
    });
    $('gztext').addEventListener('click', () => {
      const v = $('gzin').value || '';
      if (!v) { paint('<span class="e">type something in the box first.</span>'); return; }
      compress(enc.encode(v), 'text.txt');
    });
    $('gzrandom').addEventListener('click', () => {
      const b = new Uint8Array(64 * 1024);
      crypto.getRandomValues(b);
      compress(b, '64 KB of CSPRNG noise');
    });
    $('gzdl').addEventListener('click', () => {
      if (!lastGz) return;
      const url = URL.createObjectURL(new Blob([lastGz], { type: 'application/gzip' }));
      const a = document.createElement('a');
      a.href = url; a.download = lastName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });

    // drop a file on the output panel
    const drop = out.parentElement;
    ['dragover', 'drop'].forEach(ev => drop.addEventListener(ev, e => e.preventDefault()));
    drop.addEventListener('drop', async e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { paint('<span class="e">keep it under 8 MB.</span>'); return; }
      compress(new Uint8Array(await f.arrayBuffer()), f.name);
    });
  })();

  /* ======================================================================== */
  /*                          2. THE NEURAL NETWORK                           */
  /* ======================================================================== */
  (function () {
    const cv = $('nncv');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const lossCv = $('nnloss'), lctx = lossCv ? lossCv.getContext('2d') : null;

    const DATASETS = {
      spirals: () => NN.twoSpirals(50, 0.05, 42),
      circles: () => NN.circles(60, 0.14, 11),
      xor: () => {
        const r = NN.rng(5), X = [], Y = [];
        for (let i = 0; i < 120; i++) {
          const x = r() * 2 - 1, y = r() * 2 - 1;
          X.push(new Float64Array([x * 0.9, y * 0.9]));
          Y.push([(x > 0) === (y > 0) ? 0 : 1]);
        }
        return { X, Y };
      }
    };

    let dsName = 'spirals', data = DATASETS[dsName]();
    let net = new NN.MLP([2, 32, 32, 1], { seed: 3 });
    let epoch = 0, loss = NaN, running = false, raf = 0;
    const history = [];
    const LR = () => parseFloat($('nnlr').value) || 0.02;

    const GRID = 68;
    const boundary = ctx.createImageData(GRID, GRID);

    function drawBoundary() {
      const d = boundary.data;
      const inp = new Float64Array(2);
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          inp[0] = (gx / (GRID - 1)) * 2.2 - 1.1;
          inp[1] = 1.1 - (gy / (GRID - 1)) * 2.2;
          const p = net.predict(inp)[0];
          const i = (gy * GRID + gx) * 4;
          // class 0 = crimson, class 1 = cyan, confidence = saturation
          const t = p;
          d[i]     = Math.round(220 * (1 - t) + 0 * t);
          d[i + 1] = Math.round(20 * (1 - t) + 200 * t);
          d[i + 2] = Math.round(60 * (1 - t) + 255 * t);
          d[i + 3] = Math.round(38 + 150 * Math.abs(p - 0.5) * 2);
        }
      }
      // upscale the field
      const off = document.createElement('canvas');
      off.width = GRID; off.height = GRID;
      off.getContext('2d').putImageData(boundary, 0, 0);
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, cv.width, cv.height);

      // data points
      const px = v => (v + 1.1) / 2.2 * cv.width;
      const py = v => (1.1 - v) / 2.2 * cv.height;
      for (let i = 0; i < data.X.length; i++) {
        const c = data.Y[i][0];
        ctx.beginPath();
        ctx.arc(px(data.X[i][0]), py(data.X[i][1]), 3.1, 0, 7);
        ctx.fillStyle = c ? '#00e5ff' : '#ff2d55';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#00000099';
        ctx.stroke();
      }
      ctx.strokeStyle = '#ffffff14';
      ctx.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
    }

    function drawLoss() {
      if (!lctx) return;
      const W = lossCv.width, H = lossCv.height;
      lctx.fillStyle = '#050508'; lctx.fillRect(0, 0, W, H);
      if (history.length < 2) return;
      const max = Math.max.apply(null, history), min = Math.min.apply(null, history);
      const span = Math.max(1e-6, max - min);
      lctx.strokeStyle = '#1c2430'; lctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = H * i / 4;
        lctx.beginPath(); lctx.moveTo(0, y); lctx.lineTo(W, y); lctx.stroke();
      }
      lctx.beginPath();
      lctx.lineWidth = 1.6;
      lctx.strokeStyle = '#39ff14';
      for (let i = 0; i < history.length; i++) {
        const x = i / (history.length - 1) * W;
        const y = H - ((history[i] - min) / span) * (H - 8) - 4;
        i ? lctx.lineTo(x, y) : lctx.moveTo(x, y);
      }
      lctx.stroke();
      lctx.fillStyle = '#0a0d13';
      lctx.fillRect(0, 0, 96, 15);
      lctx.fillRect(0, H - 15, 78, 15);
      lctx.fillStyle = '#6a6a80';
      lctx.font = '10px ui-monospace,monospace';
      lctx.fillText('loss ' + max.toFixed(4), 6, 11);
      lctx.fillText('min ' + min.toFixed(4), 6, H - 5);
    }

    function report() {
      const acc = net.accuracy(data.X, data.Y) * 100;
      $('nnstat').innerHTML =
        'epoch <b>' + fmt(epoch) + '</b> · loss <b>' + (isNaN(loss) ? '—' : loss.toFixed(4)) +
        '</b> · train accuracy <b class="' + (acc > 98 ? 'g' : '') + '">' + acc.toFixed(1) +
        '%</b> · <b>' + fmt(net.params) + '</b> parameters · <b>' + data.X.length + '</b> points · architecture <b>' +
        net.sizes.join('–') + '</b>';
    }

    function reset(keepData) {
      cancelAnimationFrame(raf); running = false;
      $('nnrun').textContent = '▶ TRAIN';
      if (!keepData) data = DATASETS[dsName]();
      const arch = $('nnarch').value.split('-').map(Number);
      net = new NN.MLP([2].concat(arch).concat([1]), { seed: (Math.random() * 1e9) | 0 });
      epoch = 0; loss = NaN; history.length = 0;
      drawBoundary(); drawLoss(); report();
      $('nngc').textContent = '';
    }

    function tick() {
      const per = 12;
      for (let i = 0; i < per; i++) {
        loss = net.trainEpoch(data.X, data.Y, { lr: LR(), batch: 10, momentum: 0.9 });
        epoch++;
      }
      history.push(loss);
      if (history.length > 400) history.shift();
      drawBoundary(); drawLoss(); report();
      if (running) raf = requestAnimationFrame(tick);
    }

    $('nnrun').addEventListener('click', () => {
      running = !running;
      $('nnrun').textContent = running ? '❚❚ PAUSE' : '▶ TRAIN';
      if (running) raf = requestAnimationFrame(tick);
      else cancelAnimationFrame(raf);
    });
    $('nnreset').addEventListener('click', () => reset(false));
    $('nnarch').addEventListener('change', () => reset(true));
    document.querySelectorAll('[data-ds]').forEach(b => b.addEventListener('click', () => {
      dsName = b.dataset.ds;
      document.querySelectorAll('[data-ds]').forEach(x => x.classList.toggle('primary', x === b));
      reset(false);
    }));
    $('nngcrun').addEventListener('click', () => {
      const r = net.gradCheck(data.X.slice(0, 24), data.Y.slice(0, 24), 40);
      const good = r.worst < 1e-5;
      $('nngc').innerHTML = (good ? '<span class="g">✓ PASS</span>' : '<span class="e">✗ FAIL</span>') +
        ' — worst relative error between the analytic gradient and a central finite difference: <b>' +
        r.worst.toExponential(2) + '</b> across ' + r.checked + ' randomly sampled weights (step scaled with |w|, Kahan-compensated loss). ' +
        (good ? 'The chain rule above is implemented correctly.' : 'Backprop is wrong.');
    });

    reset(false);
    if (!RM && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => {
        if (es[0].isIntersecting && !running && epoch === 0) {
          io.disconnect();
          running = true; $('nnrun').textContent = '❚❚ PAUSE';
          raf = requestAnimationFrame(tick);
        }
      }, { threshold: 0.35 });
      io.observe($('nn'));
    }
  })();
})();
