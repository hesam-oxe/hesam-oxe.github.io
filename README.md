# hesam-oxe.github.io

**Not a portfolio. A proof.**

Every claim on this site executes in the visitor's browser, live, with verifiable output.
No backend. No frameworks. No build step. **Zero runtime dependencies.**

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

## Structure

```
index.html              # markup, no framework
styles.css              # hand-written CSS, no preprocessor
app.js                  # reveal-on-scroll, shell, live GitHub API
engine/
  compiler.js           # FORGE: full compiler toolchain + stack VM
  forge.js              # SHA-256, raytracer, N-body, Thompson NFA, sorting lab
  warroom.js            # wires the arsenal to the DOM
  core.wasm.b64         # 253-byte hand-emitted WebAssembly module
```

## Verified

Tested headless in Chromium 152 across desktop (1280×900) and mobile (390×844):
**zero JavaScript errors**, no horizontal overflow, all NIST vectors passing, all
sorting algorithms verified correct, energy drift 0.0000%.

Accessibility: skip link, ARIA labels, `aria-live` regions on computed output,
visible focus rings, and full `prefers-reduced-motion` support (all animation loops
halt; static equivalents render instead).

---

**Hesam Jamali** · [GitHub](https://github.com/hesam-oxe) · [LinkedIn](https://www.linkedin.com/in/hesam-jamali-218b93414/)
