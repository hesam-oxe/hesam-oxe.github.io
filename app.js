// Fortress v2: counters + radar + rain + boss + shell(history/tab/easter) + live API. Zero backend.
(function () {
  'use strict';
  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // reveal on scroll
  var rev = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); rev.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(function (el) { RM ? el.classList.add('in') : rev.observe(el); });
  // safety net: never leave content invisible (print, no-IO, odd viewports)
  setTimeout(function () { document.querySelectorAll('.reveal:not(.in)').forEach(function (el) {
    if (el.getBoundingClientRect().top < innerHeight * 3) el.classList.add('in');
  }); }, 2500);
  addEventListener('beforeprint', function () { document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); }); });

  // counters
  var cio = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target, target = +el.dataset.count || 0, t0 = null;
      cio.unobserve(el);
      if (RM) { el.textContent = target; return; }
      (function step(t) {
        t0 = t0 || t;
        var p = Math.min(1, (t - t0) / 1400);
        el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step); else el.textContent = target;
      })(performance.now());
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('[data-count]').forEach(function (el) { cio.observe(el); });

  // visibility helper: run rAF loops only while visible
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  }

  // radar
  var cv = document.getElementById('radarcv');
  if (cv) { var ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height, cx = 170, cy = 150, R = 120;
  var blips = [{ x: 215, y: 115, l: 'SR-DEV-01' }, { x: 130, y: 180, l: 'ARCH-07' }, { x: 195, y: 185, l: 'JR-404' }];
  var ang = 0, last = 0;
  function radar(t) {
    requestAnimationFrame(radar);
    if (!visible(cv)) { last = t; return; }
    if (!last) last = t;
    var dt = Math.min(50, t - last); last = t;
    if (!RM) ang = (ang + dt / 12000 * Math.PI * 2) % (Math.PI * 2);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050508'; ctx.fillRect(0, 0, W, H);
    [R, 80, 45].forEach(function (r) { ctx.strokeStyle = '#39ff1444'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); });
    ctx.strokeStyle = '#39ff1433';
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    var g = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    g.addColorStop(0, '#39ff1400'); g.addColorStop(1, '#39ff14cc');
    ctx.strokeStyle = g; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); ctx.stroke();
    ctx.lineWidth = 1;
    blips.forEach(function (b, i) {
      ctx.fillStyle = i === 2 ? '#ffb000' : '#ff1744';
      ctx.globalAlpha = RM ? 1 : 0.4 + 0.6 * Math.abs(Math.sin(t / (500 + i * 200)));
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, 7); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#dc143c'; ctx.font = '11px monospace';
      ctx.fillText(b.l + ' ☠', b.x + 8, b.y - 6);
    });
    ctx.fillStyle = '#39ff14'; ctx.font = '13px monospace';
    ctx.fillText('▶ SCAN: entire stack', 330, 80);
    ctx.fillStyle = '#ff1744'; ctx.fillText('▶ CONTACTS: 3 HOSTILE', 330, 108);
    ctx.fillStyle = '#39ff14'; ctx.fillText('▶ ETA: 0.03s', 330, 136);
    ctx.fillStyle = '#5c5c70'; ctx.fillText('▶ MERCY: 404', 330, 164);
    ctx.fillStyle = '#b026ff'; ctx.fillText('STATUS: ALL TARGETS LOCKED', 330, 200);
  }
  requestAnimationFrame(radar); }

  // opcode rain canvas
  var rc = document.getElementById('raincv');
  if (rc) { var rx = rc.getContext('2d');
  var RW = rc.width, RH = rc.height;
  var glyphs = '01ABCDEF$#ﾊﾐﾋｰｳｼﾅﾓﾆDEADBEEF'.split('');
  var cols = Math.floor(RW / 18), drops = [];
  for (var i = 0; i < cols; i++) drops[i] = Math.random() * -20;
  var palette = ['#dc143c', '#b026ff', '#39ff14', '#00e5ff'];
  var lastR = 0;
  function rain(t) {
    requestAnimationFrame(rain);
    if (!visible(rc)) { lastR = t; return; }
    if (RM) {
      rx.fillStyle = '#050508'; rx.fillRect(0, 0, RW, RH);
      rx.font = '14px monospace'; rx.fillStyle = '#dc143c';
      rx.fillText('0xDEAD 0xBEEF SEGFAULT — RING 0 · UNRESTRICTED', 90, 120);
      return;
    }
    if (t - lastR < 66) return; lastR = t;
    rx.fillStyle = 'rgba(5,5,8,0.18)'; rx.fillRect(0, 0, RW, RH);
    rx.font = '14px monospace';
    for (var c = 0; c < cols; c++) {
      var ch = glyphs[(Math.random() * glyphs.length) | 0];
      rx.fillStyle = palette[c % palette.length];
      rx.fillText(ch, c * 18 + 6, drops[c] * 18);
      if (drops[c] * 18 > RH && Math.random() > 0.976) drops[c] = 0;
      drops[c]++;
    }
  }
  rx.fillStyle = '#050508'; rx.fillRect(0, 0, RW, RH);
  requestAnimationFrame(rain); }

  // final boss HP loop (12s master)
  var fill = document.getElementById('bossfill'), blabel = document.getElementById('bosslabel'), blog = document.getElementById('bosslog');
  if (fill && blabel && blog) {
    var BOSS_T = 12000, bossT0 = null;
    var boss = function (t) {
      requestAnimationFrame(boss);
      if (RM) { fill.style.width = '0%'; blabel.textContent = '\u2620 BOSS DEFEATED'; return; }
      if (!visible(fill)) return;
      if (bossT0 === null) bossT0 = t;
      var p = ((t - bossT0) % BOSS_T) / BOSS_T, hp;
      hp = p < 0.85 ? 100 * (1 - p / 0.85) : 0;
      fill.style.width = hp.toFixed(1) + '%';
      fill.style.background = hp > 50 ? '#39ff14' : hp > 25 ? '#ffb000' : '#dc143c';
      if (hp <= 0) { blabel.textContent = '\u2620 BOSS DEFEATED'; blog.textContent = 'neutralized'; }
      else { blabel.textContent = 'HP ' + Math.ceil(hp) + '%'; blog.textContent = 'dealing damage'; }
    };
    requestAnimationFrame(boss);
  }

  // emulated shell: history + tab-complete + easter eggs
  var term = document.getElementById('term'), form = document.getElementById('termform'), input = document.getElementById('terminput');
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function line(html, cls) {
    var d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = html; term.appendChild(d); term.scrollTop = term.scrollHeight;
  }
  function prompt(cmd) { line('<span class="p">root@hellfire:~#</span> ' + esc(cmd)); }
  var CMDS = {
    help: function () { line('whoami · ls · cat · nmap · fear · mercy · rm · sudo · date · uname · uptime · banner · matrix · doom · hire · clear', 'c'); },
    whoami: function () { line('hesam-oxe — RING-0 OPERATOR · clearance: UNRESTRICTED', 'e'); },
    ls: function () { line('kernel/  arsenal/  fear/  seniors_terminated.log  mercy <span class="d">(not found)</span>', 'd'); },
    cat: function (a) {
      if (/seniors/.test(a)) line('1337 entries. 0 survivors. 0 regrets.', 'e');
      else if (/mercy/.test(a)) line('cat: mercy: No such file. good.', 'e');
      else line('usage: cat seniors_terminated.log', 'd');
    },
    nmap: function () { line('22/tcp ego — crushed · 443/tcp legacy-code — vaporized · 0.03s', 'c'); },
    fear: function () { line('fear module loaded — 1337 targets locked', 'e'); },
    mercy: function () { line('mercy.service not found — good.', 'e'); },
    rm: function () { line('rm -rf /mercy /fear /limits — done. nothing to forgive.', 'd'); },
    sudo: function (a) {
      if (/sandwich/.test(a)) line('okay. 🥪 one sandwich, extra fear.', 'g');
      else line('ROOT granted. it always was.', 'e');
    },
    date: function () { line(esc(new Date().toUTCString()) + ' — uptime ∞', 'd'); },
    uname: function () { line('Hellfire 6.6.6-ring0 x86_64 — mercy not compiled in', 'c'); },
    uptime: function () { line('up ∞ days, 0 mercy, load: 666.66 133.7 13.37', 'd'); },
    banner: function () { line('HESAM JAMALI · FULL-METAL STACK · <span class="e">1337 TERMINATED</span>', 'e'); },
    matrix: function () { line('wake up, senior… the matrix has you. follow the white rabbit hole: <span class="c">0xDEAD → 0xBEEF</span>', 'c'); },
    doom: function () { line('IDDQD accepted. <span class="g">GOD MODE: already on.</span>', 'g'); },
    iddqd: function () { line('<span class="g">GOD MODE: already on.</span>', 'g'); },
    hire: function () { line('correct choice. <span class="c">mailto:chngyzkhanwhsht@gmail.com</span>', 'c'); }
  };
  var NAMES = Object.keys(CMDS).concat(['clear', 'exit']);
  var hist = [], hi = -1;
  line('<span class="p">root@hellfire:~#</span> ./summon_operator.sh --annihilate');
  line('[ OK ] mounting /dev/soul ................. done');
  line('[FAIL] mercy.service not found — good.', 'e');
  line('type <span class="c">help</span> — Tab completes, ↑↓ recalls. try <span class="c">doom</span>.', 'd');
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowUp') { ev.preventDefault(); if (hist.length) { hi = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1); input.value = hist[hi]; } }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); if (hist.length) { hi = Math.min(hist.length - 1, hi + 1); input.value = hist[hi] || ''; if (hi >= hist.length - 1 && input.value === hist[hist.length - 1]) hi = hist.length; } }
    else if (ev.key === 'Tab') {
      ev.preventDefault();
      var v = input.value.toLowerCase();
      var hit = NAMES.filter(function (n) { return n.indexOf(v) === 0; });
      if (hit.length === 1) input.value = hit[0] + ' ';
      else if (hit.length > 1) line(hit.join(' · '), 'd');
    }
  });
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var raw = input.value.trim(); if (!raw) return;
    hist.push(raw); hi = hist.length; input.value = '';
    prompt(raw);
    var parts = raw.toLowerCase().split(/\s+/), c = parts[0], arg = parts.slice(1).join(' ');
    if (c === 'clear') { term.innerHTML = ''; return; }
    if (c === 'exit' || c === 'quit') { line('there is no exit. the fire hasn\'t ended.', 'e'); return; }
    var fn = CMDS[c];
    if (fn) fn(arg); else line('command not found: ' + esc(c) + ' — mercy neither.', 'e');
  });

  // live GitHub data (public API, graceful fallback)
  function timeout(ms) {
    var c; var p = new Promise(function (_, rej) { c = setTimeout(function () { rej(new Error('timeout')); }, ms); });
    p.cancel = function () { clearTimeout(c); }; return p;
  }
  function getJSON(url) {
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 8000);
    return fetch(url, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { clearTimeout(to); if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function (e) { clearTimeout(to); throw e; });
  }
  var reposEl = document.getElementById('repos');
  getJSON('https://api.github.com/users/hesam-oxe/repos?sort=updated&per_page=6').then(function (rs) {
    if (!Array.isArray(rs) || !rs.length) throw new Error('empty');
    reposEl.innerHTML = rs.map(function (r) {
      return '<a href="' + r.html_url + '"><b>' + esc(r.name) + '</b><p>' +
        esc(r.description || 'no description — classified') + '</p><small>★ ' +
        r.stargazers_count + ' · ' + esc(r.language || 'asm') + '</small></a>';
    }).join('');
  }).catch(function () {
    reposEl.innerHTML = ['line|Three.js + GSAP · RTL fortress|JS', 'site|classified|—', 'vyos|classified|—', 'seatunnel|data integration fork|Java']
      .map(function (s) {
        var p = s.split('|');
        return '<a href="https://github.com/hesam-oxe"><b>' + p[0] + '</b><p>' + p[1] + '</p><small>' + p[2] + '</small></a>';
      }).join('');
  });
  var actEl = document.getElementById('activity');
  var icons = { PushEvent: '🔥', PullRequestEvent: '⚔️', IssuesEvent: '🐛', CreateEvent: '✦' };
  getJSON('https://api.github.com/users/hesam-oxe/events/public?per_page=12').then(function (evs) {
    var rows = (evs || []).filter(function (e) { return icons[e.type]; }).slice(0, 5);
    if (!rows.length) throw new Error('empty');
    actEl.innerHTML = rows.map(function (e) {
      return '<li>' + icons[e.type] + ' <code>' + e.type + '</code> @ <a href="https://github.com/' +
        e.repo.name + '">' + e.repo.name + '</a> — ' + String(e.created_at).slice(0, 10) + '</li>';
    }).join('');
  }).catch(function () {
    actEl.innerHTML = '<li class="mono">transmissions jammed (API limit) — see <a href="https://github.com/hesam-oxe">profile</a>.</li>';
  });

  // copy email + back to top
  document.getElementById('copyemail').addEventListener('click', function () {
    var em = 'chngyzkhanwhsht@gmail.com', btn = this;
    (navigator.clipboard ? navigator.clipboard.writeText(em) : Promise.reject()).then(
      function () { btn.textContent = '✓ copied'; },
      function () { btn.textContent = em; });
  });
  var top = document.getElementById('totop');
  addEventListener('scroll', function () { top.classList.toggle('show', scrollY > 700); }, { passive: true });
  top.addEventListener('click', function () { scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); });

  // service worker (offline fortress)
  if ('serviceWorker' in navigator && /^https/.test(location.protocol)) {
    addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
