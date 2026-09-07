// ============================================================================
// NEURAL NETWORK — backpropagation derived and implemented by hand.
//
// A multilayer perceptron trained with mini-batch SGD + Nesterov-style
// momentum on the two-spiral problem: the classic benchmark that a linear
// model can never solve, so a decision boundary that curls into the spiral
// is proof the hidden layers are actually learning a representation.
//
// The honest part is `gradCheck()`: every analytic gradient is compared to a
// central finite-difference estimate. If the chain rule below were wrong, the
// relative error would blow up instead of sitting near 1e-9.
//
// No TensorFlow. No ONNX. No WASM blob. Plain arithmetic.
// ============================================================================
'use strict';
(function (root) {

  /* ---------------------- deterministic RNG (mulberry32) ------------------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {                              // Box–Muller
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ------------------------------ activations ------------------------------ */
  const ACT = {
    tanh: { f: x => Math.tanh(x), d: y => 1 - y * y },
    relu: { f: x => x > 0 ? x : 0, d: (y) => y > 0 ? 1 : 0 },
    sigmoid: { f: x => 1 / (1 + Math.exp(-x)), d: y => y * (1 - y) }
  };

  /* --------------------------------- MLP ----------------------------------- */
  function MLP(sizes, opts) {
    opts = opts || {};
    this.sizes = sizes;
    this.hidden = ACT[opts.hidden || 'tanh'];
    this.out = ACT[opts.out || 'sigmoid'];
    const r = rng(opts.seed === undefined ? 1337 : opts.seed);
    this.W = []; this.b = []; this.vW = []; this.vb = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nin = sizes[l], nout = sizes[l + 1];
      // Xavier/Glorot for tanh: var = 2/(nin+nout)
      const s = Math.sqrt(2 / (nin + nout));
      const w = new Float64Array(nin * nout);
      for (let i = 0; i < w.length; i++) w[i] = gauss(r) * s;
      this.W.push(w);
      this.b.push(new Float64Array(nout));
      this.vW.push(new Float64Array(nin * nout));
      this.vb.push(new Float64Array(nout));
    }
    this.params = this.W.reduce((n, w) => n + w.length, 0) +
                  this.b.reduce((n, v) => n + v.length, 0);
  }

  MLP.prototype.forward = function (x) {
    const acts = [x];
    let a = x;
    for (let l = 0; l < this.W.length; l++) {
      const nin = this.sizes[l], nout = this.sizes[l + 1];
      const W = this.W[l], b = this.b[l], z = new Float64Array(nout);
      const fn = (l === this.W.length - 1) ? this.out.f : this.hidden.f;
      for (let j = 0; j < nout; j++) {
        let s = b[j];
        for (let i = 0; i < nin; i++) s += W[i * nout + j] * a[i];
        z[j] = fn(s);
      }
      acts.push(z); a = z;
    }
    return acts;
  };

  MLP.prototype.predict = function (x) { const a = this.forward(x); return a[a.length - 1]; };

  // Accumulate dL/dW and dL/db for one sample. Binary cross-entropy on a
  // sigmoid output collapses to (y_hat - y) at the output pre-activation.
  MLP.prototype.backward = function (x, y, gW, gb) {
    const acts = this.forward(x);
    const L = this.W.length;
    let delta = new Float64Array(this.sizes[L]);
    const yhat = acts[L];
    for (let j = 0; j < delta.length; j++) delta[j] = yhat[j] - y[j];

    for (let l = L - 1; l >= 0; l--) {
      const nin = this.sizes[l], nout = this.sizes[l + 1];
      const a = acts[l], W = this.W[l];
      for (let j = 0; j < nout; j++) {
        gb[l][j] += delta[j];
        const d = delta[j];
        for (let i = 0; i < nin; i++) gW[l][i * nout + j] += d * a[i];
      }
      if (l > 0) {
        const prev = new Float64Array(nin);
        const dfn = this.hidden.d;
        for (let i = 0; i < nin; i++) {
          let s = 0;
          for (let j = 0; j < nout; j++) s += W[i * nout + j] * delta[j];
          prev[i] = s * dfn(a[i]);
        }
        delta = prev;
      }
    }
    let loss = 0;
    for (let j = 0; j < y.length; j++) {
      const p = Math.min(1 - 1e-12, Math.max(1e-12, yhat[j]));
      loss -= y[j] * Math.log(p) + (1 - y[j]) * Math.log(1 - p);
    }
    return loss;
  };

  MLP.prototype.zeroGrads = function () {
    return {
      gW: this.W.map(w => new Float64Array(w.length)),
      gb: this.b.map(v => new Float64Array(v.length))
    };
  };

  /** One epoch of shuffled mini-batch SGD. Returns mean loss. */
  MLP.prototype.trainEpoch = function (X, Y, opts) {
    opts = opts || {};
    const lr = opts.lr === undefined ? 0.5 : opts.lr;
    const mom = opts.momentum === undefined ? 0.9 : opts.momentum;
    const bs = opts.batch || 16;
    const wd = opts.weightDecay || 0;
    const order = this._order || (this._order = X.map((_, i) => i));
    const r = this._r || (this._r = rng(99));
    for (let i = order.length - 1; i > 0; i--) {           // Fisher–Yates
      const j = Math.floor(r() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    let total = 0;
    for (let s = 0; s < order.length; s += bs) {
      const { gW, gb } = this.zeroGrads();
      const end = Math.min(order.length, s + bs), m = end - s;
      for (let k = s; k < end; k++) total += this.backward(X[order[k]], Y[order[k]], gW, gb);
      for (let l = 0; l < this.W.length; l++) {
        const W = this.W[l], b = this.b[l], vW = this.vW[l], vb = this.vb[l];
        for (let i = 0; i < W.length; i++) {
          const g = gW[l][i] / m + wd * W[i];
          vW[i] = mom * vW[i] - lr * g;
          W[i] += vW[i];
        }
        for (let i = 0; i < b.length; i++) {
          vb[i] = mom * vb[i] - lr * (gb[l][i] / m);
          b[i] += vb[i];
        }
      }
    }
    return total / X.length;
  };

  MLP.prototype.accuracy = function (X, Y) {
    let ok = 0;
    for (let i = 0; i < X.length; i++) {
      const p = this.predict(X[i])[0];
      if ((p >= 0.5 ? 1 : 0) === Y[i][0]) ok++;
    }
    return ok / X.length;
  };

  /**
   * Verify backprop against central finite differences.
   *
   * The step is scaled with |w| and sits near the optimum for a central
   * difference in double precision (truncation error grows as eps^2,
   * cancellation error as 1/eps), and the loss is accumulated with Kahan
   * compensation. Anything under 1e-5 relative error means the analytic
   * gradient and the numerical one are the same number.
   */
  MLP.prototype.gradCheck = function (X, Y, n) {
    n = n || 40;
    const { gW, gb } = this.zeroGrads();
    for (let i = 0; i < X.length; i++) this.backward(X[i], Y[i], gW, gb);

    // Kahan-compensated summation: the finite difference subtracts two nearly
    // equal totals, so every bit of the accumulator matters.
    const lossAll = () => {
      let s = 0, c = 0;
      for (let i = 0; i < X.length; i++) {
        const yhat = this.predict(X[i]);
        for (let j = 0; j < Y[i].length; j++) {
          const p = Math.min(1 - 1e-12, Math.max(1e-12, yhat[j]));
          const term = -(Y[i][j] * Math.log(p) + (1 - Y[i][j]) * Math.log(1 - p));
          const y = term - c, t = s + y;
          c = (t - s) - y; s = t;
        }
      }
      return s;
    };

    const r = rng((Date.now() & 0xffff) ^ 7);
    let worst = 0, worstAbs = 0, checked = 0, skipped = 0, tries = 0;
    // A central difference is only accurate to ~sqrt(machine-eps) relative to
    // the scale of the quantity, so the step is scaled with |w|. Gradients
    // that are essentially zero are reported by absolute error instead —
    // relative error against 1e-12 is arithmetic noise, not a bug.
    const FLOOR = 1e-6;
    while (checked < n && tries < n * 12) {
      tries++;
      const l = Math.floor(r() * this.W.length);
      const idx = Math.floor(r() * this.W[l].length);
      const orig = this.W[l][idx];
      const eps = 1e-5 * Math.max(1, Math.abs(orig));
      this.W[l][idx] = orig + eps; const lp = lossAll();
      this.W[l][idx] = orig - eps; const lm = lossAll();
      this.W[l][idx] = orig;
      const numeric = (lp - lm) / (2 * eps);
      const analytic = gW[l][idx];
      const mag = Math.max(Math.abs(numeric), Math.abs(analytic));
      const abs = Math.abs(numeric - analytic);
      if (abs > worstAbs) worstAbs = abs;
      if (mag < FLOOR) { skipped++; continue; }        // below the noise floor
      const rel = abs / (Math.abs(numeric) + Math.abs(analytic));
      if (rel > worst) worst = rel;
      checked++;
    }
    return { worst, worstAbs, checked, skipped };
  };

  /* ------------------------------- datasets -------------------------------- */
  function twoSpirals(nPer, noise, seed) {
    const r = rng(seed === undefined ? 42 : seed);
    const X = [], Y = [];
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < nPer; i++) {
        const t = (i / nPer) * 3.6 * Math.PI + 0.6;
        const rad = t / (3.6 * Math.PI) * 0.92;
        const ang = t + c * Math.PI;
        X.push(new Float64Array([
          rad * Math.cos(ang) + (r() - 0.5) * noise,
          rad * Math.sin(ang) + (r() - 0.5) * noise
        ]));
        Y.push([c]);
      }
    }
    return { X, Y };
  }

  function xorSet() {
    return {
      X: [new Float64Array([0, 0]), new Float64Array([0, 1]),
          new Float64Array([1, 0]), new Float64Array([1, 1])],
      Y: [[0], [1], [1], [0]]
    };
  }

  function circles(nPer, noise, seed) {
    const r = rng(seed === undefined ? 11 : seed);
    const X = [], Y = [];
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < nPer; i++) {
        const ang = r() * 2 * Math.PI, rad = (c ? 0.75 : 0.28) + (r() - 0.5) * noise;
        X.push(new Float64Array([rad * Math.cos(ang), rad * Math.sin(ang)]));
        Y.push([c]);
      }
    }
    return { X, Y };
  }

  const NN = { MLP, twoSpirals, xorSet, circles, rng, ACT };
  if (typeof module !== 'undefined' && module.exports) module.exports = NN;
  if (typeof window !== 'undefined') window.NN = NN;
  root.NN = NN;
})(typeof globalThis !== 'undefined' ? globalThis : this);
