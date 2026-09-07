# hesam-oxe.github.io

**Not a portfolio. A proof.**

Every claim on this site executes in the visitor's browser, live, with verifiable output.
No backend. No frameworks. No build step. **Zero runtime dependencies** — the 3D hero is a
hand-written perspective renderer (`engine/core3d.js`), not three.js from a CDN.

And you don't have to take the claims on faith: **the page runs its own test suite in front
of you.** 42 assertions against values fixed before the code existed — NIST vectors, known
Fibonacci numbers, your browser's own gzip decoder, finite-difference gradients, conservation
of energy. If a row goes red, a claim on the page is false. That is the design.

🔗 **https://hesam-oxe.github.io/**

---

## What's actually in here

| Panel | What it really is | Verification |
|---|---|---|
| **FORGE compiler** | Lexer → Pratt parser → AST → type checker → constant folding + DCE → bytecode → stack VM | Editable live; `fib(20)` → `6765` in ~219k VM steps |
| **WebAssembly** | A 253-byte `.wasm` module emitted **byte by byte** — hand-written LEB128, section headers, opcodes | `WebAssembly.validate()` → `true`; `fib(30)` → `832040` |
| **Raytracer** | Analytic ray-sphere intersection, recursive reflections, Fresnel falloff, shadows, gamma correction | ~250k rays at ~2M rays/s, rendered to canvas |
| **N-body** | 200 bodies, 19,900 pair-forces/frame, **velocity-Verlet** symplectic integrator | Energy drift measured live: **0.0000%** |
| **SHA-256** | Full FIPS 180-4: message schedule, 64 rounds, correct padding | Passes all NIST vectors; matched against `node:crypto` on 200 random inputs |
| **Regex engine** | Recursive-descent parser → **Thompson NFA** → subset simulation with ε-closure | `(a\|a)*b` on 40 `a`s in **0.3 ms** — backtracking engines need ~2⁴⁰ steps |
| **Sorting lab** | Median-of-three quicksort, mergesort, LSD radix — vs V8's native TimSort | Sortedness asserted after every run |
| **DEFLATE / gzip** | RFC 1951 + 1952: LZ77 hash-chain matcher, canonical Huffman limited to 15 bits, dynamic/fixed/stored block selection by real bit cost, CRC-32 | Output handed to the browser's **own** `DecompressionStream('gzip')`; compresses `index.html` by **68%**, within **0.3%** of zlib level 9 |
| **Neural network** | MLP with hand-derived backprop, Xavier init, mini-batch SGD + momentum, trained live on the two-spiral problem | Analytic gradients vs central finite differences: worst relative error **~1e-8** |
| **Test suite** | 42 assertions across every engine, executed in the visitor's browser | Green/red board with per-assertion timings |
| **Benchmark** | Five real workloads timed on the visitor's own machine | Nothing pre-recorded |

## Why it matters

Anyone can list technologies on a résumé. This site ships the **implementations** — the
parts that are usually imported from a library — and lets you run them, inspect them, and
try to break them.

- The compiler doesn't fake type errors. It has a real type checker that rejects
  `let x: int = true;` with a source-mapped caret pointing at the offending line.
- The optimizer doesn't pretend. Toggle it off and watch instruction count rise, folds
  drop to zero, and dead branches reappear in the bytecode listing.
- The WASM module wasn't produced by a toolchain. It's raw bytes, and the byte count
  is printed next to the validation result.
- The regex engine's ReDoS immunity isn't a claim — there's a button that fires the
  bomb and times it.
- The compressor isn't graded by its own decoder. Its gzip output goes to
  `DecompressionStream('gzip')` — code written by the browser vendor, not by me. One wrong
  bit in the Huffman stream and it throws. There's a download button, too: run `gunzip`
  on the result yourself.
- The neural network's animation is the least interesting part. The button next to it
  compares every analytic gradient to a central finite-difference estimate of the same
  derivative. Backprop written wrong would show up there immediately.

## Structure

```
index.html              # markup, no framework
styles.css              # hand-written CSS, no preprocessor
app.js                  # reveal-on-scroll, shell, live GitHub API
sw.js                   # offline cache-first service worker
sitemap.xml robots.txt  # + JSON-LD Person schema inline in index.html
engine/
  compiler.js           # FORGE: full compiler toolchain + stack VM
  forge.js              # SHA-256, raytracer, N-body, Thompson NFA, sorting lab
  deflate.js            # LZ77 + canonical Huffman + CRC-32, gzip and gunzip
  nn.js                 # MLP, backprop, SGD+momentum, gradient checker
  core3d.js             # perspective 3D wireframe renderer — replaces three.js
  warroom.js            # wires the arsenal to the DOM
  lab.js                # wires the compressor and the neural net to the DOM
  ci.js                 # the 42-assertion suite and its runner
  hud.js                # command palette, scroll-spy, progress bar
  core.wasm.b64         # 253-byte hand-emitted WebAssembly module
assets/                 # 30 self-hosted animated SVG panels
```

## Interface

`⌘K` / `Ctrl-K` (or `/`) opens a command palette: fuzzy-jump to any section, or run any
engine directly — compile, run the test suite, compress the page, train the network, fire
the ReDoS bomb. Scroll-spy tracks the active section, a progress rail tracks the page.
`prefers-reduced-motion` is honoured throughout, and there's a "calm" toggle in the palette
that kills every animation on demand. Printing the page produces a clean, readable document
with PR URLs expanded inline.

## Upstream

The engines prove I can build. The `UPSTREAM` section proves maintainers merged it:
**13 patches merged across 25 organizations** — seven of them into the OWASP Agent Memory
Guard project (CrewAI and LlamaIndex adapters, a Prometheus exporter, a CI vulnerability
scanner, and a threat-model extension to its benchmark suite). Open PRs against LLVM, Go,
Apache SeaTunnel, Apache Gravitino, Meta's tritonparse and Sphinx are listed separately and
labelled honestly — as are six patches that were rejected.

## Verified

Driven headless in Chromium across desktop (1280×900) and mobile (390×844):
**zero JavaScript errors**, **42/42 assertions green**, no horizontal overflow.
Selected measured results:

```
wasm       module is exactly 253 bytes / validate() → true / fib(30) = 832040
sha256     agrees with SubtleCrypto on 32 random inputs, and at every padding
           boundary from 54 to 66 bytes
compiler   fib(20) → 6765 · gcd(1071,462) → 21 · folding: 20 → 10 instrs
regex      (a|a)*b on 40 a's → false in 0.20 ms
n-body     velocity-Verlet energy drift 0.00000% over 200 steps
deflate    index.html 26,399 → 8,389 bytes (−68.2%), byte-identical after a
           round trip through the browser's own gzip decoder
neural net analytic vs finite-difference gradients: worst rel. error 1.4e-8
```

The compressor was additionally fuzzed against `node:zlib` — 188/188 round trips
byte-identical across empty input, single bytes, 100 KB runs, CSPRNG noise and the
site's own source, at three compression levels.

Accessibility: skip link, ARIA labels, `aria-live` regions on computed output,
visible focus rings, and full `prefers-reduced-motion` support (all animation loops
halt; static equivalents render instead).

---

**Hesam Jamali** · [GitHub](https://github.com/hesam-oxe) · [LinkedIn](https://www.linkedin.com/in/hesam-jamali-218b93414/)
