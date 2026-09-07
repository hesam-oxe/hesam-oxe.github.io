// ============================================================================
// DEFLATE — RFC 1951 / RFC 1952, written from scratch.
//
// LZ77 sliding window with hash-chain match search, canonical Huffman coding
// (length-limited to 15 bits), dynamic + fixed + stored block selection,
// CRC-32 (IEEE 802.3 polynomial), and a gzip container.
//
// There is a matching INFLATE decoder below, so the round trip is entirely
// hand-written. But the real proof is external: the output of this file is
// handed to the browser's own DecompressionStream('gzip') — an independent,
// spec-conformant implementation written by someone else — and it has to
// give the original bytes back. If a single bit is wrong, that fails loudly.
//
// No pako. No fflate. No zlib. Nothing imported.
// ============================================================================
'use strict';
(function (root) {

  /* ------------------------------- CRC-32 -------------------------------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* --------------------------- RFC 1951 TABLES ---------------------------- */
  // Length codes 257..285
  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
                    67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
                     4, 4, 4, 4, 5, 5, 5, 5, 0];
  // Distance codes 0..29
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
                     769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
                      9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  // The famously weird transmission order of the code-length code lengths
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  const LEN_CODE = new Uint16Array(259);   // match length -> symbol index (0..28)
  for (let i = 0, l = 3; i < 29; i++) {
    const hi = (i === 28) ? 258 : LEN_BASE[i] + (1 << LEN_EXTRA[i]) - 1;
    for (; l <= hi; l++) LEN_CODE[l] = i;
  }
  function distCode(d) {
    for (let i = 29; i >= 0; i--) if (d >= DIST_BASE[i]) return i;
    return 0;
  }

  /* ------------------------------ BIT WRITER ------------------------------ */
  function BitWriter() {
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
    this.acc = 0;
    this.nbits = 0;
  }
  BitWriter.prototype._grow = function (n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  };
  // Write n (<=16) bits of v, least-significant bit first.
  BitWriter.prototype.bits = function (v, n) {
    let a = this.acc | ((v >>> 0) << this.nbits);
    let nb = this.nbits + n;
    this._grow((nb >> 3) + 1);
    while (nb >= 8) { this.buf[this.len++] = a & 0xFF; a >>>= 8; nb -= 8; }
    this.acc = a; this.nbits = nb;
  };
  // Huffman codes go out most-significant bit first, so reverse them.
  BitWriter.prototype.huff = function (code, len) {
    let r = 0;
    for (let i = 0; i < len; i++) r = (r << 1) | ((code >>> i) & 1);
    this.bits(r, len);
  };
  BitWriter.prototype.align = function () {
    if (this.nbits) { this._grow(1); this.buf[this.len++] = this.acc & 0xFF; this.acc = 0; this.nbits = 0; }
  };
  BitWriter.prototype.bytes = function (arr) {
    this.align(); this._grow(arr.length);
    this.buf.set(arr, this.len); this.len += arr.length;
  };
  BitWriter.prototype.finish = function () { this.align(); return this.buf.slice(0, this.len); };

  /* --------------------------- HUFFMAN BUILDING --------------------------- */
  // Build code lengths from symbol frequencies, limited to `limit` bits.
  // Over-long trees are fixed by halving frequencies and rebuilding — crude,
  // but it converges fast and never produces an invalid tree.
  function codeLengths(freq, limit) {
    const n = freq.length;
    let f = Array.from(freq);
    for (;;) {
      const nodes = [];
      for (let i = 0; i < n; i++) if (f[i] > 0) nodes.push({ f: f[i], sym: i, l: null, r: null });
      const out = new Uint8Array(n);
      if (nodes.length === 0) return out;
      if (nodes.length === 1) { out[nodes[0].sym] = 1; return out; }

      const q = nodes.sort((a, b) => a.f - b.f || a.sym - b.sym);
      while (q.length > 1) {
        const a = q.shift(), b = q.shift();
        const m = { f: a.f + b.f, sym: -1, l: a, r: b };
        let lo = 0, hi = q.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (q[mid].f <= m.f) lo = mid + 1; else hi = mid; }
        q.splice(lo, 0, m);
      }
      let max = 0;
      (function walk(nd, d) {
        if (nd.sym >= 0) { const dd = d || 1; out[nd.sym] = dd; if (dd > max) max = dd; return; }
        walk(nd.l, d + 1); walk(nd.r, d + 1);
      })(q[0], 0);

      if (max <= limit) return out;
      for (let i = 0; i < n; i++) if (f[i]) f[i] = Math.max(1, f[i] >> 1);
    }
  }

  // RFC 1951 §3.2.2 — canonical code assignment from lengths.
  function canonical(lengths) {
    let maxb = 0;
    for (let i = 0; i < lengths.length; i++) if (lengths[i] > maxb) maxb = lengths[i];
    const codes = new Uint16Array(lengths.length);
    if (!maxb) return codes;
    const count = new Array(maxb + 1).fill(0);
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) count[lengths[i]]++;
    const next = new Array(maxb + 1).fill(0);
    let code = 0;
    for (let b = 1; b <= maxb; b++) { code = (code + count[b - 1]) << 1; next[b] = code; }
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) codes[i] = next[lengths[i]]++;
    return codes;
  }

  /* -------------------------------- LZ77 ---------------------------------- */
  // Hash-chain matcher: hash 3 bytes, walk the chain of previous positions
  // with the same hash, keep the longest match inside the 32 KiB window.
  const WSIZE = 32768, MIN_MATCH = 3, MAX_MATCH = 258;

  function lz77(data, level) {
    const maxChain = level >= 9 ? 4096 : level >= 6 ? 512 : 64;
    const lazy = level >= 5;
    const n = data.length;
    const head = new Int32Array(1 << 15).fill(-1);
    const prev = new Int32Array(n).fill(-1);
    const tokens = [];               // literal: b ; match: -(len<<16 | dist)
    const litFreq = new Uint32Array(288);
    const distFreq = new Uint32Array(30);
    const H = (i) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & 0x7FFF;

    function findMatch(pos, limitLen) {
      if (pos + MIN_MATCH > n) return null;
      let best = 0, bestDist = 0;
      let cur = head[H(pos)], chain = maxChain;
      const maxLen = Math.min(MAX_MATCH, n - pos);
      while (cur >= 0 && chain-- > 0) {
        const dist = pos - cur;
        if (dist <= 0 || dist > WSIZE) break;
        if (data[cur + best] === data[pos + best]) {
          let l = 0;
          while (l < maxLen && data[cur + l] === data[pos + l]) l++;
          if (l > best) { best = l; bestDist = dist; if (l >= maxLen) break; }
        }
        cur = prev[cur];
      }
      if (best >= MIN_MATCH && best > limitLen) return { len: best, dist: bestDist };
      return null;
    }

    function insert(pos) {
      if (pos + MIN_MATCH <= n) { const h = H(pos); prev[pos] = head[h]; head[h] = pos; }
    }

    let i = 0;
    while (i < n) {
      const m = findMatch(i, MIN_MATCH - 1);
      let use = m;
      if (m && lazy && i + 1 < n) {
        insert(i);
        const m2 = findMatch(i + 1, m.len);
        if (m2) {                                  // next position matches better
          tokens.push(data[i]); litFreq[data[i]]++;
          i++;
          continue;
        }
      } else if (m) { insert(i); }

      if (use) {
        tokens.push(-((use.len << 16) | use.dist));
        litFreq[257 + LEN_CODE[use.len]]++;
        distFreq[distCode(use.dist)]++;
        for (let k = 1; k < use.len; k++) insert(i + k);
        i += use.len;
      } else {
        tokens.push(data[i]); litFreq[data[i]]++;
        if (!m) insert(i);
        i++;
      }
    }
    litFreq[256]++;                                // end-of-block
    return { tokens, litFreq, distFreq };
  }

  /* --------------------------- CODE-LENGTH RLE ---------------------------- */
  function rleLengths(all) {
    const syms = [];                                // {s, extra, ebits}
    let i = 0;
    while (i < all.length) {
      const v = all[i];
      let run = 1;
      while (i + run < all.length && all[i + run] === v) run++;
      if (v === 0) {
        while (run >= 11) { const c = Math.min(138, run); syms.push([18, c - 11, 7]); run -= c; i += c; }
        while (run >= 3) { const c = Math.min(10, run); syms.push([17, c - 3, 3]); run -= c; i += c; }
        while (run-- > 0) { syms.push([0, 0, 0]); i++; }
      } else {
        syms.push([v, 0, 0]); i++; run--;
        while (run >= 3) { const c = Math.min(6, run); syms.push([16, c - 3, 2]); run -= c; i += c; }
        while (run-- > 0) { syms.push([v, 0, 0]); i++; }
      }
    }
    return syms;
  }

  /* ------------------------------- ENCODER -------------------------------- */
  function emitTokens(bw, tokens, litCodes, litLens, distCodes, distLens) {
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (tok >= 0) { bw.huff(litCodes[tok], litLens[tok]); continue; }
      const packed = -tok, len = packed >>> 16, dist = packed & 0xFFFF;
      const lc = LEN_CODE[len], sym = 257 + lc;
      bw.huff(litCodes[sym], litLens[sym]);
      if (LEN_EXTRA[lc]) bw.bits(len - LEN_BASE[lc], LEN_EXTRA[lc]);
      const dc = distCode(dist);
      bw.huff(distCodes[dc], distLens[dc]);
      if (DIST_EXTRA[dc]) bw.bits(dist - DIST_BASE[dc], DIST_EXTRA[dc]);
    }
    bw.huff(litCodes[256], litLens[256]);
  }

  function fixedTables() {
    const litLens = new Uint8Array(288);
    for (let i = 0; i < 144; i++) litLens[i] = 8;
    for (let i = 144; i < 256; i++) litLens[i] = 9;
    for (let i = 256; i < 280; i++) litLens[i] = 7;
    for (let i = 280; i < 288; i++) litLens[i] = 8;
    const distLens = new Uint8Array(30).fill(5);
    return { litLens, distLens, litCodes: canonical(litLens), distCodes: canonical(distLens) };
  }

  function bitCost(tokens, litLens, distLens) {
    let bits = 0;
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (tok >= 0) { bits += litLens[tok]; continue; }
      const packed = -tok, len = packed >>> 16, dist = packed & 0xFFFF;
      const lc = LEN_CODE[len], dc = distCode(dist);
      bits += litLens[257 + lc] + LEN_EXTRA[lc] + distLens[dc] + DIST_EXTRA[dc];
    }
    return bits + litLens[256];
  }

  /**
   * Raw DEFLATE stream (RFC 1951). Returns {out, stats}.
   */
  function deflateRaw(data, level) {
    level = level === undefined ? 9 : level;
    const bw = new BitWriter();
    const stats = { blockType: 'stored', tokens: 0, literals: 0, matches: 0, matchBytes: 0,
                    longestMatch: 0, dynamicBits: 0, fixedBits: 0 };

    if (data.length === 0) {
      bw.bits(1, 1); bw.bits(1, 2);                 // final, fixed
      const f = fixedTables();
      bw.huff(f.litCodes[256], f.litLens[256]);
      stats.blockType = 'fixed';
      return { out: bw.finish(), stats };
    }

    const { tokens, litFreq, distFreq } = lz77(data, level);
    stats.tokens = tokens.length;
    for (const t of tokens) {
      if (t >= 0) stats.literals++;
      else {
        const len = (-t) >>> 16;
        stats.matches++; stats.matchBytes += len;
        if (len > stats.longestMatch) stats.longestMatch = len;
      }
    }

    // --- dynamic tables
    let litLens = codeLengths(litFreq, 15);
    let distLens = codeLengths(distFreq, 15);
    let numLit = 286; while (numLit > 257 && !litLens[numLit - 1]) numLit--;
    let numDist = 30; while (numDist > 1 && !distLens[numDist - 1]) numDist--;
    if (!distLens.some(Boolean)) { distLens = new Uint8Array(30); distLens[0] = 1; numDist = 1; }

    const combined = [];
    for (let i = 0; i < numLit; i++) combined.push(litLens[i]);
    for (let i = 0; i < numDist; i++) combined.push(distLens[i]);
    const rle = rleLengths(combined);

    const clFreq = new Uint32Array(19);
    for (const [s] of rle) clFreq[s]++;
    const clLens = codeLengths(clFreq, 7);
    const clCodes = canonical(clLens);
    let numCL = 19; while (numCL > 4 && !clLens[CL_ORDER[numCL - 1]]) numCL--;

    const litCodes = canonical(litLens), distCodes = canonical(distLens);

    // --- pick the cheapest representation
    let headerBits = 3 + 5 + 5 + 4 + numCL * 3;
    for (const [s, , eb] of rle) headerBits += clLens[s] + eb;
    const dynBits = headerBits + bitCost(tokens, litLens, distLens);
    const fx = fixedTables();
    const fixBits = 3 + bitCost(tokens, fx.litLens, fx.distLens);
    const storedBits = 3 + 8 + 32 + data.length * 8;   // worst case, byte-aligned
    stats.dynamicBits = dynBits; stats.fixedBits = fixBits;

    if (storedBits < dynBits && storedBits < fixBits) {
      bw.bits(1, 1); bw.bits(0, 2); bw.align();
      const n = data.length;
      bw.bytes(new Uint8Array([n & 255, (n >> 8) & 255, (~n) & 255, ((~n) >> 8) & 255]));
      bw.bytes(data);
      stats.blockType = 'stored';
    } else if (fixBits <= dynBits) {
      bw.bits(1, 1); bw.bits(1, 2);
      emitTokens(bw, tokens, fx.litCodes, fx.litLens, fx.distCodes, fx.distLens);
      stats.blockType = 'fixed Huffman';
    } else {
      bw.bits(1, 1); bw.bits(2, 2);
      bw.bits(numLit - 257, 5); bw.bits(numDist - 1, 5); bw.bits(numCL - 4, 4);
      for (let i = 0; i < numCL; i++) bw.bits(clLens[CL_ORDER[i]], 3);
      for (const [s, extra, eb] of rle) { bw.huff(clCodes[s], clLens[s]); if (eb) bw.bits(extra, eb); }
      emitTokens(bw, tokens, litCodes, litLens, distCodes, distLens);
      stats.blockType = 'dynamic Huffman';
    }
    return { out: bw.finish(), stats };
  }

  /** gzip container (RFC 1952) around the raw stream. */
  function gzip(data, level) {
    const { out, stats } = deflateRaw(data, level);
    const head = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff]);
    const crc = crc32(data), size = data.length >>> 0;
    const tail = new Uint8Array([crc & 255, (crc >>> 8) & 255, (crc >>> 16) & 255, (crc >>> 24) & 255,
                                 size & 255, (size >>> 8) & 255, (size >>> 16) & 255, (size >>> 24) & 255]);
    const res = new Uint8Array(head.length + out.length + tail.length);
    res.set(head, 0); res.set(out, head.length); res.set(tail, head.length + out.length);
    stats.crc32 = crc;
    return { out: res, stats };
  }

  /* ------------------------------- INFLATE -------------------------------- */
  // Our own decoder, so the round trip never leaves this file.
  function BitReader(buf, pos) { this.b = buf; this.p = pos || 0; this.bit = 0; }
  BitReader.prototype.bits = function (n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v |= ((this.b[this.p] >> this.bit) & 1) << i;
      if (++this.bit === 8) { this.bit = 0; this.p++; }
    }
    return v;
  };
  BitReader.prototype.align = function () { if (this.bit) { this.bit = 0; this.p++; } };

  function huffTable(lengths) {
    const codes = canonical(lengths), map = new Map();
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) map.set(lengths[i] + ':' + codes[i], i);
    return map;
  }
  function decodeSym(br, table) {
    let code = 0;
    for (let len = 1; len <= 15; len++) {
      code = (code << 1) | br.bits(1);
      const s = table.get(len + ':' + code);
      if (s !== undefined) return s;
    }
    throw new Error('inflate: bad Huffman code');
  }

  function inflateRaw(buf, pos) {
    const br = new BitReader(buf, pos || 0);
    let out = new Uint8Array(1 << 16), len = 0;
    const push = (b) => {
      if (len === out.length) { const n = new Uint8Array(out.length * 2); n.set(out); out = n; }
      out[len++] = b;
    };
    for (;;) {
      const final = br.bits(1), type = br.bits(2);
      if (type === 0) {
        br.align();
        const n = buf[br.p] | (buf[br.p + 1] << 8); br.p += 4;
        for (let i = 0; i < n; i++) push(buf[br.p++]);
      } else {
        let litT, distT;
        if (type === 1) {
          const f = fixedTables();
          litT = huffTable(f.litLens); distT = huffTable(f.distLens);
        } else if (type === 2) {
          const numLit = br.bits(5) + 257, numDist = br.bits(5) + 1, numCL = br.bits(4) + 4;
          const clLens = new Uint8Array(19);
          for (let i = 0; i < numCL; i++) clLens[CL_ORDER[i]] = br.bits(3);
          const clT = huffTable(clLens);
          const all = [];
          while (all.length < numLit + numDist) {
            const s = decodeSym(br, clT);
            if (s < 16) all.push(s);
            else if (s === 16) { const r = br.bits(2) + 3, p = all[all.length - 1]; for (let i = 0; i < r; i++) all.push(p); }
            else if (s === 17) { const r = br.bits(3) + 3; for (let i = 0; i < r; i++) all.push(0); }
            else { const r = br.bits(7) + 11; for (let i = 0; i < r; i++) all.push(0); }
          }
          litT = huffTable(Uint8Array.from(all.slice(0, numLit)));
          distT = huffTable(Uint8Array.from(all.slice(numLit)));
        } else throw new Error('inflate: reserved block type');

        for (;;) {
          const s = decodeSym(br, litT);
          if (s === 256) break;
          if (s < 256) { push(s); continue; }
          const lc = s - 257;
          const l = LEN_BASE[lc] + br.bits(LEN_EXTRA[lc]);
          const dc = decodeSym(br, distT);
          const d = DIST_BASE[dc] + br.bits(DIST_EXTRA[dc]);
          for (let i = 0; i < l; i++) push(out[len - d]);
        }
      }
      if (final) break;
    }
    return out.slice(0, len);
  }

  function gunzip(buf) {
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error('not gzip');
    let p = 10;
    const flg = buf[3];
    if (flg & 4) { p += 2 + (buf[p] | (buf[p + 1] << 8)); }
    if (flg & 8) { while (buf[p++]); }
    if (flg & 16) { while (buf[p++]); }
    if (flg & 2) p += 2;
    const data = inflateRaw(buf, p);
    const n = buf.length;
    const crc = (buf[n - 8] | (buf[n - 7] << 8) | (buf[n - 6] << 16) | (buf[n - 5] << 24)) >>> 0;
    if (crc32(data) !== crc) throw new Error('gunzip: CRC-32 mismatch');
    return data;
  }

  const DEFLATE = { crc32, deflateRaw, gzip, inflateRaw, gunzip, canonical, codeLengths, LEN_CODE };
  if (typeof module !== 'undefined' && module.exports) module.exports = DEFLATE;
  if (typeof window !== 'undefined') window.DEFLATE = DEFLATE;
  root.DEFLATE = DEFLATE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
