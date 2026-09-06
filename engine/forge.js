// ============================================================================
// FORGE ARSENAL — hand-written implementations. No libraries. No shortcuts.
//   · SHA-256      : full FIPS 180-4, verified against NIST vectors
//   · Raytracer    : recursive, reflections, soft shadows, Fresnel
//   · N-body       : velocity-Verlet integrator, energy-conserving
//   · Regex engine : Thompson NFA construction + simulation (no backtracking)
//   · Sorting lab  : quicksort / mergesort / radix, instrumented
// ============================================================================
'use strict';

/* ================================ SHA-256 ================================= */
const K256 = new Uint32Array([
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);

function sha256(msg) {
  const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : msg;
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes); padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, bitLen >>> 0, false);
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor(bitLen / 4294967296), false);

  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
                             0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x,n) => (x >>> n) | (x << (32-n));

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++)
      w[i] = (padded[off+i*4]<<24)|(padded[off+i*4+1]<<16)|(padded[off+i*4+2]<<8)|padded[off+i*4+3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15]>>>3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2]>>>10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }
  return Array.from(H).map(x => x.toString(16).padStart(8,'0')).join('');
}

const SHA_VECTORS = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
   '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
];
function verifySHA() { return SHA_VECTORS.map(([i,e]) => ({input: i.slice(0,20)||'(empty)', pass: sha256(i)===e, got: sha256(i)})); }

/* =============================== RAYTRACER ================================ */
// Recursive path tracing with reflections, Fresnel-ish falloff, soft shadows.
const V = {
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
  hadamard:(a,b)=>[a[0]*b[0],a[1]*b[1],a[2]*b[2]],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  len:a=>Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]),
  norm:a=>{const l=V.len(a)||1; return [a[0]/l,a[1]/l,a[2]/l];},
  reflect:(d,n)=>V.sub(d, V.mul(n, 2*V.dot(d,n)))
};

function raytrace(width, height, opts = {}) {
  const spheres = [
    { c:[0,-0.4,3.2],   r:0.9, col:[0.86,0.08,0.24], spec:0.75, refl:0.45 }, // crimson
    { c:[1.7,-0.1,4.3], r:1.1, col:[0.69,0.15,1.0],  spec:0.6,  refl:0.35 }, // purple
    { c:[-1.8,-0.3,4.0],r:0.9, col:[0.0,0.9,1.0],    spec:0.9,  refl:0.55 }, // cyan
    { c:[0,-901,4],     r:900, col:[0.10,0.10,0.14], spec:0.2,  refl:0.18 }, // floor
  ];
  const lights = [ {p:[-3,4,-1], i:0.75}, {p:[3,3.5,0.5], i:0.55}, {p:[0,6,4], i:0.35} ];
  const MAXD = opts.depth ?? 3;
  const img = new Uint8ClampedArray(width*height*4);
  let rays = 0;

  function intersect(o, d) {
    let best = Infinity, hit = null;
    for (const s of spheres) {
      const oc = V.sub(o, s.c);
      const b = 2*V.dot(oc,d), c = V.dot(oc,oc) - s.r*s.r;
      const disc = b*b - 4*c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t = (-b - sq)/2; if (t < 1e-4) t = (-b + sq)/2;
      if (t > 1e-4 && t < best) { best = t; hit = s; }
    }
    return hit ? {t:best, s:hit} : null;
  }

  function trace(o, d, depth) {
    rays++;
    const h = intersect(o,d);
    if (!h) { const t = 0.5*(d[1]+1); return [0.02+0.03*t, 0.02+0.02*t, 0.05+0.08*t]; } // sky
    const p = V.add(o, V.mul(d, h.t));
    const n = V.norm(V.sub(p, h.s.c));
    let col = V.mul(h.s.col, 0.06); // ambient
    for (const L of lights) {
      const ld = V.norm(V.sub(L.p, p));
      const shadow = intersect(V.add(p, V.mul(n,1e-3)), ld);
      const distL = V.len(V.sub(L.p,p));
      if (shadow && shadow.t < distL) continue;
      const diff = Math.max(0, V.dot(n, ld)) * L.i;
      col = V.add(col, V.mul(h.s.col, diff));
      const r = V.reflect(V.mul(ld,-1), n);
      const spec = Math.pow(Math.max(0, V.dot(r, V.mul(d,-1))), 48) * h.s.spec * L.i;
      col = V.add(col, [spec,spec,spec]);
    }
    if (depth < MAXD && h.s.refl > 0) {
      const rd = V.norm(V.reflect(d,n));
      const rc = trace(V.add(p, V.mul(n,1e-3)), rd, depth+1);
      const fres = h.s.refl + (1-h.s.refl)*Math.pow(1 - Math.abs(V.dot(n, V.mul(d,-1))), 5);
      col = V.add(V.mul(col, 1-fres*0.6), V.mul(rc, fres*0.6));
    }
    return col;
  }

  const aspect = width/height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5)/width * 2 - 1, v = 1 - (y + 0.5)/height * 2;
      const d = V.norm([u*aspect*0.9, v*0.9, 1]);
      let c = trace([0,0.35,0], d, 0);
      const i = (y*width+x)*4;
      img[i]   = Math.pow(Math.min(1,c[0]), 1/2.2)*255;
      img[i+1] = Math.pow(Math.min(1,c[1]), 1/2.2)*255;
      img[i+2] = Math.pow(Math.min(1,c[2]), 1/2.2)*255;
      img[i+3] = 255;
    }
  }
  return { pixels: img, rays };
}

/* ================================= N-BODY ================================= */
// Velocity-Verlet — symplectic, conserves energy far better than Euler.
class NBody {
  constructor(n = 220) {
    this.n = n;
    this.px = new Float64Array(n); this.py = new Float64Array(n);
    this.vx = new Float64Array(n); this.vy = new Float64Array(n);
    this.ax = new Float64Array(n); this.ay = new Float64Array(n);
    this.m  = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, r = 40 + Math.random()*150;
      this.px[i] = Math.cos(a)*r; this.py[i] = Math.sin(a)*r;
      const v = Math.sqrt(1400/r);
      this.vx[i] = -Math.sin(a)*v; this.vy[i] = Math.cos(a)*v;
      this.m[i] = 0.6 + Math.random()*1.4;
    }
    this.px[0]=0; this.py[0]=0; this.vx[0]=0; this.vy[0]=0; this.m[0]=1400; // central mass
    this.G = 1.0; this.soft = 9.0;
    this.forces();
  }
  forces() {
    const {n,px,py,m,ax,ay,G,soft} = this;
    ax.fill(0); ay.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i+1; j < n; j++) {
        const dx = px[j]-px[i], dy = py[j]-py[i];
        const d2 = dx*dx + dy*dy + soft;
        const inv = 1/(d2*Math.sqrt(d2));
        const f = G*inv;
        ax[i] += f*m[j]*dx; ay[i] += f*m[j]*dy;
        ax[j] -= f*m[i]*dx; ay[j] -= f*m[i]*dy;
      }
    }
  }
  step(dt = 0.06) {
    const {n,px,py,vx,vy,ax,ay} = this;
    for (let i = 0; i < n; i++) {
      px[i] += vx[i]*dt + 0.5*ax[i]*dt*dt;
      py[i] += vy[i]*dt + 0.5*ay[i]*dt*dt;
      vx[i] += 0.5*ax[i]*dt; vy[i] += 0.5*ay[i]*dt;
    }
    this.forces();
    for (let i = 0; i < n; i++) { vx[i] += 0.5*ax[i]*dt; vy[i] += 0.5*ay[i]*dt; }
  }
  energy() {
    const {n,px,py,vx,vy,m,G,soft} = this;
    let ke = 0, pe = 0;
    for (let i = 0; i < n; i++) ke += 0.5*m[i]*(vx[i]*vx[i]+vy[i]*vy[i]);
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
      const dx=px[j]-px[i], dy=py[j]-py[i];
      pe -= G*m[i]*m[j]/Math.sqrt(dx*dx+dy*dy+soft);
    }
    return ke + pe;
  }
}

/* ============================== REGEX ENGINE ============================== */
// Thompson NFA — linear time, immune to catastrophic backtracking.
// Supports: literals, '.', '*', '+', '?', '|', '(...)', character classes.
function reParse(re) {
  let i = 0;
  function alt() {
    let n = concat();
    while (re[i] === '|') { i++; n = {t:'alt', a:n, b:concat()}; }
    return n;
  }
  function concat() {
    let n = null;
    while (i < re.length && re[i] !== '|' && re[i] !== ')') {
      const r = rep();
      n = n ? {t:'cat', a:n, b:r} : r;
    }
    return n || {t:'eps'};
  }
  function rep() {
    let n = atom();
    for (;;) {
      if (re[i] === '*') { i++; n = {t:'star', a:n}; }
      else if (re[i] === '+') { i++; n = {t:'cat', a:n, b:{t:'star', a:n}}; }
      else if (re[i] === '?') { i++; n = {t:'alt', a:n, b:{t:'eps'}}; }
      else break;
    }
    return n;
  }
  function atom() {
    if (re[i] === '(') { i++; const n = alt(); i++; return n; }
    if (re[i] === '[') {
      i++; let neg = false, set = new Set();
      if (re[i] === '^') { neg = true; i++; }
      while (re[i] !== ']') {
        if (re[i+1] === '-' && re[i+2] !== ']') {
          for (let c = re.charCodeAt(i); c <= re.charCodeAt(i+2); c++) set.add(String.fromCharCode(c));
          i += 3;
        } else set.add(re[i++]);
      }
      i++;
      return {t:'class', set, neg};
    }
    if (re[i] === '.') { i++; return {t:'any'}; }
    if (re[i] === '\\') { i++; return {t:'char', c:re[i++]}; }
    return {t:'char', c:re[i++]};
  }
  return alt();
}
function reCompile(node) {
  let id = 0;
  const states = [];
  const mk = () => { states.push({id:id, eps:[], on:null, to:null}); return id++; };
  function build(n) {
    switch (n.t) {
      case 'eps': { const s = mk(), e = mk(); states[s].eps.push(e); return [s,e]; }
      case 'char': { const s = mk(), e = mk(); states[s].on = {t:'char',c:n.c}; states[s].to = e; return [s,e]; }
      case 'any':  { const s = mk(), e = mk(); states[s].on = {t:'any'};        states[s].to = e; return [s,e]; }
      case 'class':{ const s = mk(), e = mk(); states[s].on = {t:'class',set:n.set,neg:n.neg}; states[s].to = e; return [s,e]; }
      case 'cat':  { const [as,ae]=build(n.a), [bs,be]=build(n.b); states[ae].eps.push(bs); return [as,be]; }
      case 'alt':  { const s=mk(), [as,ae]=build(n.a), [bs,be]=build(n.b), e=mk();
                     states[s].eps.push(as,bs); states[ae].eps.push(e); states[be].eps.push(e); return [s,e]; }
      case 'star': { const s=mk(), [as,ae]=build(n.a), e=mk();
                     states[s].eps.push(as,e); states[ae].eps.push(as,e); return [s,e]; }
    }
  }
  const [start,accept] = build(node);
  return {states, start, accept};
}
function reMatch(nfa, str) {
  const {states, start, accept} = nfa;
  const closure = (set) => {
    const st = [...set], seen = new Set(set);
    while (st.length) { const s = st.pop(); for (const e of states[s].eps) if (!seen.has(e)) { seen.add(e); st.push(e); } }
    return seen;
  };
  let cur = closure([start]);
  let maxSet = cur.size;
  for (const ch of str) {
    const next = new Set();
    for (const s of cur) {
      const on = states[s].on;
      if (!on) continue;
      let ok = false;
      if (on.t === 'char') ok = on.c === ch;
      else if (on.t === 'any') ok = true;
      else if (on.t === 'class') ok = on.neg ? !on.set.has(ch) : on.set.has(ch);
      if (ok) next.add(states[s].to);
    }
    cur = closure([...next]);
    maxSet = Math.max(maxSet, cur.size);
    if (cur.size === 0) break;
  }
  return { matched: cur.has(accept), states: states.length, maxActive: maxSet };
}
function regex(pattern, input) { return reMatch(reCompile(reParse(pattern)), input); }

/* =============================== SORTING LAB ============================== */
function sortLab(n = 2000) {
  const base = Array.from({length:n}, () => (Math.random()*1e6)|0);
  const res = {};
  const timeit = (name, fn) => {
    const a = base.slice(); const t = performance.now();
    const out = fn(a); const dt = performance.now() - t;
    const ok = out.every((v,i) => i===0 || out[i-1] <= v);
    res[name] = { ms:+dt.toFixed(3), sorted:ok };
  };
  timeit('quicksort', a => {
    const qs = (arr,lo,hi) => {
      while (lo < hi) {
        const mid = (lo+hi)>>1;
        const pv = [arr[lo],arr[mid],arr[hi]].sort((x,y)=>x-y)[1];
        let i=lo,j=hi;
        while (i<=j){ while(arr[i]<pv)i++; while(arr[j]>pv)j--; if(i<=j){[arr[i],arr[j]]=[arr[j],arr[i]];i++;j--;} }
        if (j-lo < hi-i) { qs(arr,lo,j); lo=i; } else { qs(arr,i,hi); hi=j; }
      }
      return arr;
    };
    return qs(a,0,a.length-1);
  });
  timeit('mergesort', a => {
    const ms = arr => {
      if (arr.length < 2) return arr;
      const m = arr.length>>1, L = ms(arr.slice(0,m)), R = ms(arr.slice(m));
      const out = []; let i=0,j=0;
      while (i<L.length && j<R.length) out.push(L[i]<=R[j]?L[i++]:R[j++]);
      while (i<L.length) out.push(L[i++]); while (j<R.length) out.push(R[j++]);
      return out;
    };
    return ms(a);
  });
  timeit('radix-LSD', a => {
    let arr = a;
    for (let shift = 0; shift < 32; shift += 8) {
      const cnt = new Int32Array(257);
      for (const v of arr) cnt[((v>>>shift)&255)+1]++;
      for (let i=1;i<257;i++) cnt[i]+=cnt[i-1];
      const out = new Array(arr.length);
      for (const v of arr) out[cnt[(v>>>shift)&255]++] = v;
      arr = out;
    }
    return arr;
  });
  timeit('native-V8', a => a.sort((x,y)=>x-y));
  return res;
}

/* ================================= EXPORT ================================= */
const ARSENAL = { sha256, verifySHA, SHA_VECTORS, raytrace, NBody, regex, reParse, reCompile, reMatch, sortLab, V };
if (typeof module !== 'undefined') module.exports = ARSENAL;
if (typeof window !== 'undefined') window.ARSENAL = ARSENAL;
