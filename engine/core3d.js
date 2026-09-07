/* ============================================================================
   core3d.js — a perspective 3D wireframe renderer in ~90 lines.
   Replaces the three.js CDN import. No libraries, no build step, no network.
   Subdivided icosahedron + two orbital rings, painter-sorted, depth-shaded.
   ========================================================================= */
'use strict';
(function () {
  const cv = document.getElementById('hero3d');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.style.display = 'none'; return; }

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- geometry -------------------------------------------------------- */
  function icosahedron() {
    const p = (1 + Math.sqrt(5)) / 2;
    const V = [[-1,p,0],[1,p,0],[-1,-p,0],[1,-p,0],[0,-1,p],[0,1,p],
               [0,-1,-p],[0,1,-p],[p,0,-1],[p,0,1],[-p,0,-1],[-p,0,1]];
    const E = [[0,1],[0,5],[0,7],[0,10],[0,11],[1,5],[1,7],[1,8],[1,9],[2,3],
               [2,4],[2,6],[2,10],[2,11],[3,4],[3,6],[3,8],[3,9],[4,5],[4,9],
               [4,11],[5,9],[5,11],[6,7],[6,8],[6,10],[7,8],[7,10],[8,9],[10,11]];
    const m = Math.hypot(1, p);
    return { V: V.map(v => v.map(c => c / m)), E };
  }
  function ring(radius, segs, tilt, spin) {
    const V = [], E = [];
    for (let i = 0; i < segs; i++) {
      const a = 2 * Math.PI * i / segs;
      let x = radius * Math.cos(a), y = 0, z = radius * Math.sin(a);
      // tilt about X, then spin about Y
      let y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
      let z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      const x2 = x * Math.cos(spin) + z2 * Math.sin(spin);
      z2 = -x * Math.sin(spin) + z2 * Math.cos(spin);
      V.push([x2, y2, z2]);
      E.push([i, (i + 1) % segs]);
    }
    return { V, E };
  }

  const core = icosahedron();
  const r1 = ring(2.15, 72, 1.20, 0.0);
  const r2 = ring(2.65, 72, 1.90, 0.4);

  /* ---- math ------------------------------------------------------------ */
  function rot(v, ax, ay, az) {
    let [x, y, z] = v;
    let c = Math.cos(ay), s = Math.sin(ay);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(ax); s = Math.sin(ax);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(az); s = Math.sin(az);
    [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  }

  let W = 0, H = 0, DPR = 1;
  function fit() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth || 600;
    H = 230;
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  fit();
  addEventListener('resize', fit, { passive: true });

  const FOV = 3.6;
  function draw(shape, ax, ay, az, scale, color, width, nodes) {
    const cx = W / 2, cy = H / 2;
    const P = shape.V.map(v => {
      const [x, y, z] = rot(v, ax, ay, az);
      const k = FOV / (FOV - z);
      return [cx + x * scale * k, cy + y * scale * k, z];
    });
    const edges = shape.E
      .map(([a, b]) => ({ a, b, d: (P[a][2] + P[b][2]) / 2 }))
      .sort((u, v) => u.d - v.d);                    // painter's algorithm
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    for (const e of edges) {
      const alpha = 0.16 + 0.66 * ((e.d + 1) / 2);
      ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(P[e.a][0], P[e.a][1]);
      ctx.lineTo(P[e.b][0], P[e.b][1]);
      ctx.stroke();
    }
    if (nodes) {
      for (const p of P) {
        const a = 0.25 + 0.7 * ((p[2] + 1) / 2);
        ctx.fillStyle = `rgba(${nodes},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 1.1 + 1.5 * ((p[2] + 1) / 2), 0, 6.2832);
        ctx.fill();
      }
    }
  }

  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    const s = Math.min(W, H * 2.6) * 0.135;
    const T = REDUCED ? 0 : t;
    // glow pass
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowBlur = 14; ctx.shadowColor = 'rgba(220,20,60,.75)';
    draw(core, T / 3600, T / 2400, T / 9000, s * 1.4, '220,20,60', 1.25, '255,120,140');
    ctx.restore();
    ctx.shadowBlur = 0;
    draw(r1, 0, 0, T / 5200, s * 1.4, '0,229,255', 1.0, null);
    draw(r2, 0, 0, -T / 7400, s * 1.4, '176,38,255', 0.9, null);
    if (!REDUCED) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
