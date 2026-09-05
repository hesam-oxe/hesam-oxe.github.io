// Fortress front-end: counters + radar canvas + emulated shell. Zero backend.
(function () {
  'use strict';
  // counters
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target, target = +el.dataset.count || 0, t0 = null;
      io.unobserve(el);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = target; return; }
      (function step(t) {
        t0 = t0 || t;
        var p = Math.min(1, (t - t0) / 1400);
        el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step); else el.textContent = target;
      })(performance.now());
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('[data-count]').forEach(function (el) { io.observe(el); });

  // radar
  var cv = document.getElementById('radarcv'), ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height, cx = 170, cy = 150, R = 120;
  var blips = [{ x: 215, y: 115, l: 'SR-DEV-01' }, { x: 130, y: 180, l: 'ARCH-07' }, { x: 195, y: 185, l: 'JR-404' }];
  var ang = 0, last = 0;
  function radar(t) {
    if (!last) last = t;
    var dt = Math.min(50, t - last); last = t;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) ang = (ang + dt / 12000 * Math.PI * 2) % (Math.PI * 2);
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
    var glow = (Math.sin(t / 300) + 1) / 2;
    blips.forEach(function (b, i) {
      ctx.fillStyle = i === 2 ? '#ffb000' : '#ff1744';
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t / (500 + i * 200)));
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, 7); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#dc143c'; ctx.font = '11px monospace';
      ctx.fillText(b.l + ' ☠', b.x + 8, b.y - 6);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#39ff14'; ctx.font = '13px monospace';
    ctx.fillText('▶ SCAN: entire stack', 330, 80);
    ctx.fillStyle = '#ff1744'; ctx.fillText('▶ CONTACTS: 3 HOSTILE', 330, 108);
    ctx.fillStyle = '#39ff14'; ctx.fillText('▶ ETA: 0.03s', 330, 136);
    ctx.fillStyle = 0.5 + glow * 0.5 > 0.75 ? '#dc143c' : '#5c5c70';
    ctx.fillText('▶ MERCY: 404', 330, 164);
    ctx.fillStyle = '#b026ff'; ctx.fillText('STATUS: ALL TARGETS LOCKED', 330, 200);
    requestAnimationFrame(radar);
  }
  requestAnimationFrame(radar);

  // emulated shell
  var term = document.getElementById('term'), form = document.getElementById('termform'), input = document.getElementById('terminput');
  function line(html, cls) {
    var d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = html; term.appendChild(d); term.scrollTop = term.scrollHeight;
  }
  function prompt(cmd) { line('<span class="p">root@hellfire:~#</span> ' + cmd.replace(/</g, '&lt;')); }
  var CMDS = {
    help: function () { line('commands: whoami · ls · nmap · fear · mercy · rm · sudo · clear', 'c'); },
    whoami: function () { line('hesam-oxe — RING-0 OPERATOR · clearance: UNRESTRICTED', 'e'); },
    ls: function () { line('kernel/  arsenal/  fear/  seniors_terminated.log  mercy (not found)', 'd'); },
    nmap: function () { line('22/tcp ego — crushed · 443/tcp legacy-code — vaporized · 0.03s', 'c'); },
    fear: function () { line('fear module loaded — 1337 targets locked', 'e'); },
    mercy: function () { line('mercy.service not found — good.', 'e'); },
    rm: function () { line('rm -rf /mercy /fear /limits — done. nothing to forgive.', 'd'); },
    sudo: function () { line('ROOT granted. it always was.', 'e'); }
  };
  line('<span class="p">root@hellfire:~#</span> ./summon_operator.sh --annihilate');
  line('[ OK ] mounting /dev/soul ................. done');
  line('[FAIL] mercy.service not found — good.', 'e');
  line('type <span class="c">help</span> — the fire listens.', 'd');
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var raw = input.value.trim(); if (!raw) return;
    prompt(raw); input.value = '';
    var c = raw.toLowerCase().split(/\s+/)[0];
    if (c === 'clear') { term.innerHTML = ''; return; }
    if (c === 'exit' || c === 'quit') { line('there is no exit. the fire hasn\'t ended.', 'e'); return; }
    (CMDS[c] || function () { line('command not found: ' + c.replace(/</g, '&lt;') + ' — mercy neither.', 'e'); })();
  });
})();
