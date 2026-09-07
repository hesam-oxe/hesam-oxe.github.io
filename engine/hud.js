// ============================================================================
// HUD — command palette, scroll progress, scroll-spy, keyboard shortcuts.
// ~7 KB of vanilla JS doing what people normally reach for a framework to do.
// ============================================================================
'use strict';
(function () {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);

  /* --------------------------- scroll progress ---------------------------- */
  const bar = document.createElement('div');
  bar.className = 'progress';
  bar.innerHTML = '<i></i>';
  document.body.appendChild(bar);
  const fill = bar.firstChild;
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const h = document.documentElement.scrollHeight - innerHeight;
      fill.style.width = (h > 0 ? (scrollY / h) * 100 : 0).toFixed(2) + '%';
      ticking = false;
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  onScroll();

  /* ------------------------------ scroll-spy ------------------------------ */
  const links = [...document.querySelectorAll('nav a[href^="#"]')];
  const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const sections = [...document.querySelectorAll('main section[id]')].filter(s => byId.has(s.id));
  if ('IntersectionObserver' in window && sections.length) {
    const seen = new Set();
    const spy = new IntersectionObserver(entries => {
      entries.forEach(e => e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
      let top = null;
      for (const s of sections) if (seen.has(s.id)) { top = s.id; break; }
      links.forEach(a => a.classList.remove('active'));
      if (top && byId.get(top)) {
        byId.get(top).classList.add('active');
        const a = byId.get(top);
        const nav = a.parentElement;
        if (nav.scrollWidth > nav.clientWidth) {
          const want = a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2;
          nav.scrollTo({ left: want, behavior: RM ? 'auto' : 'smooth' });
        }
      }
    }, { rootMargin: '-70px 0px -55% 0px', threshold: 0 });
    sections.forEach(s => spy.observe(s));
  }

  /* --------------------------- command palette ---------------------------- */
  const ACTIONS = [];
  const add = (label, hint, run, keys) => ACTIONS.push({ label, hint, run, keys: keys || '' });

    add('Run the compiler', 'FORGE · compile & execute', () => { location.hash = '#compiler'; setTimeout(() => $('crun') && $('crun').click(), 350); });
  add('Show bytecode', 'FORGE · disassembler', () => { location.hash = '#compiler'; setTimeout(() => $('casm') && $('casm').click(), 350); });
  add('Run the full CI suite', 'verify every claim on this page', () => { location.hash = '#ci'; setTimeout(() => $('cirun') && $('cirun').click(), 400); });
  add('Benchmark this machine', 'five real workloads', () => { location.hash = '#bench'; setTimeout(() => $('benchrun') && $('benchrun').click(), 350); });
  add('Compress this page', 'hand-written DEFLATE → gzip', () => { location.hash = '#gzip'; setTimeout(() => $('gzpage') && $('gzpage').click(), 350); });
  add('Train the neural net', 'backprop on two spirals', () => { location.hash = '#nn'; setTimeout(() => $('nnrun') && $('nnrun').click(), 350); });
  add('Gradient check', 'analytic vs finite differences', () => { location.hash = '#nn'; setTimeout(() => $('nngcrun') && $('nngcrun').click(), 350); });
  add('Fire the ReDoS bomb', 'Thompson NFA stays linear', () => { location.hash = '#regex'; setTimeout(() => $('reevil') && $('reevil').click(), 350); });
  add('Race the sorting algorithms', 'quicksort · mergesort · radix · V8', () => { location.hash = '#sortlab'; setTimeout(() => $('sortrun') && $('sortrun').click(), 350); });
  add('Copy email address', 'chngyzkhanwhsht@gmail.com', () => { $('copyemail') && $('copyemail').click(); });
  add('View the source of this page', 'nothing is minified or hidden', () => open('https://github.com/hesam-oxe/hesam-oxe.github.io', '_blank'));
  add('GitHub profile', 'github.com/hesam-oxe', () => open('https://github.com/hesam-oxe', '_blank'));
  add('LinkedIn', 'hesam-jamali', () => open('https://www.linkedin.com/in/hesam-jamali-218b93414/', '_blank'));
  add('Toggle reduced motion', 'kill every animation on the page', () => {
    document.documentElement.classList.toggle('calm');
  });
  add('Back to top', 'scroll home', () => scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }));

  // sections last: the actions above are what people actually came for
  const SECTION_NAMES = {
    proof: 'The premise', compiler: 'FORGE compiler', wasm: 'WebAssembly module',
    raytracer: 'Raytracer', nbody: 'N-body simulation', crypto: 'SHA-256',
    regex: 'Regex engine', sortlab: 'Sorting lab', gzip: 'DEFLATE compressor',
    nn: 'Neural network', ci: 'Test suite', bench: 'Benchmarks', shell: 'Live shell',
    upstream: 'Upstream contributions', repos: 'Repositories', activity: 'Recent activity',
    contact: 'Contact'
  };
  Object.keys(SECTION_NAMES).forEach(id => {
    if (!document.getElementById(id)) return;
    add('Go to ' + SECTION_NAMES[id], 'section · #' + id, () => { location.hash = '#' + id; });
  });

  const pal = document.createElement('div');
  pal.className = 'palette';
  pal.setAttribute('role', 'dialog');
  pal.setAttribute('aria-modal', 'true');
  pal.setAttribute('aria-label', 'command palette');
  pal.innerHTML =
    '<div class="pal-box">' +
    '<input id="palin" autocomplete="off" spellcheck="false" placeholder="jump to a section, or run something…" aria-label="command"/>' +
    '<ul id="pallist" role="listbox"></ul>' +
    '<div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> run</span><span><kbd>esc</kbd> close</span></div>' +
    '</div>';
  document.body.appendChild(pal);
  const input = $('palin'), list = $('pallist');
  let filtered = ACTIONS.slice(), cursor = 0, open_ = false;

  // subsequence fuzzy match, scored by how tight the match is
  function score(hay, needle) {
    if (!needle) return 1;
    hay = hay.toLowerCase(); needle = needle.toLowerCase();
    let i = 0, first = -1, last = 0, hits = 0;
    for (let j = 0; j < hay.length && i < needle.length; j++) {
      if (hay[j] === needle[i]) { if (first < 0) first = j; last = j; i++; hits++; }
    }
    if (i < needle.length) return 0;
    return 1000 - (last - first) - first * 0.5 + hits * 2;
  }

  function render() {
    list.innerHTML = filtered.map((a, i) =>
      '<li role="option" class="' + (i === cursor ? 'sel' : '') + '" data-i="' + i + '">' +
      '<span class="pal-label">' + a.label + '</span>' +
      '<span class="pal-hint">' + a.hint + '</span></li>').join('') ||
      '<li class="pal-empty">nothing matches that.</li>';
    const sel = list.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function refilter() {
    const q = input.value.trim();
    filtered = ACTIONS
      .map(a => ({ a, s: Math.max(score(a.label, q), score(a.hint, q) * 0.8) }))
      .filter(x => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .map(x => x.a);
    cursor = 0; render();
  }

  function openPal() {
    open_ = true; pal.classList.add('on');
    input.value = ''; refilter();
    setTimeout(() => input.focus(), 20);
  }
  function closePal() { open_ = false; pal.classList.remove('on'); }
  function runSel() {
    const a = filtered[cursor];
    closePal();
    if (a) setTimeout(a.run, 60);
  }

  input.addEventListener('input', refilter);
  list.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) { cursor = +li.dataset.i; runSel(); }
  });
  pal.addEventListener('mousedown', e => { if (e.target === pal) closePal(); });

  addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); open_ ? closePal() : openPal(); return;
    }
    if (!open_ && e.key === '/' && !typing) { e.preventDefault(); openPal(); return; }
    if (!open_ && e.key === '?' && !typing) { e.preventDefault(); openPal(); return; }
    if (!open_) return;
    if (e.key === 'Escape') { e.preventDefault(); closePal(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(filtered.length - 1, cursor + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(0, cursor - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); runSel(); }
  });

  document.querySelectorAll('[data-palette]').forEach(b => b.addEventListener('click', openPal));

  /* ------------------------- console calling card ------------------------- */
  try {
    console.log('%c HESAM JAMALI ', 'background:#dc143c;color:#fff;font:700 15px monospace;padding:6px 12px',
      '\n\nEverything on this page is hand-written and runs locally.\nNo framework, no CDN, no backend, no analytics.\n\n' +
      'window.FORGE    — the compiler (lexer → parser → typechecker → VM)\n' +
      'window.ARSENAL  — sha256, raytrace, NBody, regex, sortLab\n' +
      'window.DEFLATE  — gzip / gunzip, RFC 1951 + 1952\n' +
      'window.NN       — MLP with hand-derived backprop\n' +
      'window.__CI.run() — re-run the whole test suite\n\n' +
      'Try:  DEFLATE.gzip(new TextEncoder().encode("hello".repeat(500))).out.length\n');
  } catch (_) {}
})();
