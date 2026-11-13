'use strict';
// Start Player: fingers on the screen, play a few-second mini game, one player is chosen to start.
// Mini game: Quick Draw. Hold until NOW!, then lift fast. Fast reactions add a small bonus to your odds;
// the winner is still a weighted random draw, so luck dominates and skill only nudges.
(() => {
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, S = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.max(0.75, Math.min(1.4, Math.min(W, H) / 400));
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- tuning ----------
  const COLORS = ['#ff3b6b', '#ffc400', '#2ee86f', '#00c8ff', '#b05cff', '#ff7a1a', '#ff4fd8', '#c6ff00', '#00e5c0', '#ffffff'];
  const MIN_PLAYERS = 2;
  const STABLE_MS = 1500;          // fingers must stay put this long before the round starts
  const HOLD_MIN = 1300, HOLD_MAX = 2600; // random wait before NOW!
  const NOW_WINDOW = 1200;         // time to react after NOW!
  const R = 46;                    // blob radius at S = 1
  const BG = '#1b0b3a';

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function tickets(p) {
    if (p.early) return 0.5;           // lifted before NOW!
    if (p.rt == null) return 0.8;      // never lifted
    return 1 + clamp((650 - p.rt) / 450, 0, 1); // 200 ms or faster = double odds, 650 ms+ = base odds
  }

  // ---------- state ----------
  const players = new Map(); // pointerId -> player
  const ignored = new Set(); // pointers that joined mid-round
  let state = 'lobby', stateAt = performance.now(), lastChange = stateAt;
  let holdMs = 0, nowAt = 0, winner = null, hops = [], hopIdx = -1;
  let confetti = [], secondBurst = false;

  function setState(s, t) { state = s; stateAt = t; }

  function resetLobby(t) {
    players.clear(); ignored.clear();
    winner = null; hops = []; hopIdx = -1; confetti = [];
    setState('lobby', t); lastChange = t;
  }

  function freeColor() {
    const used = new Set([...players.values()].map((p) => p.ci));
    for (let i = 0; i < COLORS.length; i++) if (!used.has(i)) return i;
    return players.size % COLORS.length;
  }

  const active = new Set(); // every finger currently down, players or not
  const DEBUG = /[?&]debug/.test(location.search);
  const log = [];
  function dbg(msg) {
    if (!DEBUG) return;
    log.push(`${(performance.now() / 1000).toFixed(2)} ${msg}`);
    if (log.length > 14) log.shift();
  }

  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} }

  // ---------- input ----------
  function onDown(e) {
    e.preventDefault();
    const t = performance.now();
    active.add(e.pointerId);
    dbg(`down #${e.pointerId} ${e.pointerType} [${state}] active=${active.size}`);
    wake();
    if (state === 'winner') {
      if (t - stateAt < 900) { ignored.add(e.pointerId); return; }
      resetLobby(t);
    }
    if (state !== 'lobby') { ignored.add(e.pointerId); return; }
    const ci = freeColor();
    players.set(e.pointerId, {
      id: e.pointerId, x: e.clientX, y: e.clientY, ci, color: COLORS[ci], born: t,
      seed: Math.random() * 1000, lifted: false, liftAt: 0, rt: null, early: false, odds: 0,
    });
    lastChange = t;
    buzz(15);
  }

  function onMove(e) {
    const p = players.get(e.pointerId);
    if (!p || p.lifted || state === 'reveal' || state === 'winner') return;
    p.x = e.clientX; p.y = e.clientY;
  }

  function onUp(e) {
    const t = performance.now();
    active.delete(e.pointerId);
    dbg(`${e.type === 'pointercancel' ? 'CANCEL' : 'up'} #${e.pointerId} [${state}] active=${active.size}`);
    // Going fullscreen resizes the page, and Android Chrome cancels every touch that is down when that happens.
    // So only try it when this was the last finger on the screen.
    if (e.type === 'pointerup' && active.size === 0 && (state === 'lobby' || state === 'winner')) maybeFullscreen();
    if (ignored.delete(e.pointerId)) return;
    const p = players.get(e.pointerId);
    if (!p || p.lifted) return;
    if (state === 'lobby') { players.delete(e.pointerId); lastChange = t; return; }
    if (state === 'hold') { p.lifted = true; p.liftAt = t; p.early = true; buzz(90); }
    else if (state === 'now') { p.lifted = true; p.liftAt = t; p.rt = t - nowAt; buzz(20); }
    else return;
    if ([...players.values()].every((q) => q.lifted)) startReveal(t);
  }

  const opts = { passive: false };
  window.addEventListener('pointerdown', onDown, opts);
  window.addEventListener('pointermove', onMove, opts);
  window.addEventListener('pointerup', onUp, opts);
  window.addEventListener('pointercancel', onUp, opts);
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'gesturestart'])
    document.addEventListener(ev, (e) => e.preventDefault(), opts);
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  let fsTried = false;
  function maybeFullscreen() {
    if (fsTried) return;
    fsTried = true;
    const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
    const el = document.documentElement;
    if (!installed && !document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  }

  let lock = null;
  async function wake() {
    try {
      if ('wakeLock' in navigator && !lock && document.visibilityState === 'visible') {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      }
    } catch (_) { lock = null; }
  }
  document.addEventListener('fullscreenchange', () => dbg(`fullscreen ${!!document.fullscreenElement}`));
  window.addEventListener('resize', () => dbg(`resize ${innerWidth}x${innerHeight}`));
  document.addEventListener('visibilitychange', () => {
    dbg(`visibility ${document.visibilityState}`);
    active.clear();
    if (document.visibilityState === 'visible') wake();
    else resetLobby(performance.now());
  });

  // ---------- game flow ----------
  function startGame(t) {
    setState('hold', t);
    holdMs = rand(HOLD_MIN, HOLD_MAX);
    buzz(30);
  }

  function startReveal(t) {
    const list = [...players.values()];
    let sum = 0;
    for (const p of list) { p.w = tickets(p); sum += p.w; }
    for (const p of list) p.odds = p.w / sum;
    let r = Math.random() * sum;
    winner = list[list.length - 1];
    for (const p of list) { r -= p.w; if (r <= 0) { winner = p; break; } }

    // spotlight hops that slow down and land on the winner
    const n = 9;
    const seq = new Array(n);
    seq[n - 1] = winner;
    for (let i = n - 2; i >= 0; i--) {
      const opts = list.filter((p) => p !== seq[i + 1]);
      seq[i] = opts[Math.floor(Math.random() * opts.length)];
    }
    let at = t + 350;
    hops = seq.map((p, i) => {
      const hop = { p, at };
      at += 50 + 260 * Math.pow(i / (n - 1), 2.5);
      return hop;
    });
    hopIdx = -1;
    setState('reveal', t);
  }

  function startWinner(t) {
    setState('winner', t);
    secondBurst = false;
    burst(winner.x, winner.y, 140);
    buzz([70, 40, 70, 40, 250]);
  }

  function burst(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(3, 13) * S;
      confetti.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4 * S,
        rot: Math.random() * 6, vr: rand(-0.3, 0.3),
        w: rand(6, 12) * S, h: rand(10, 18) * S,
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
  }

  function update(t, dt) {
    if (state === 'lobby') {
      if (players.size >= MIN_PLAYERS && t - lastChange >= STABLE_MS) startGame(t);
    } else if (state === 'hold') {
      if (t - stateAt >= holdMs) { setState('now', t); nowAt = t; buzz(140); }
    } else if (state === 'now') {
      if (t - nowAt >= NOW_WINDOW) startReveal(t);
    } else if (state === 'reveal') {
      let idx = -1;
      for (let i = 0; i < hops.length; i++) if (t >= hops[i].at) idx = i;
      if (idx !== hopIdx) { hopIdx = idx; if (idx >= 0) buzz(12); }
      if (hopIdx === hops.length - 1 && t - hops[hopIdx].at > 450) startWinner(t);
    } else if (state === 'winner') {
      if (!secondBurst && t - stateAt > 350) { secondBurst = true; burst(W / 2, -20, 90); }
    }
    for (const c of confetti) {
      c.vy += 0.35 * S * dt; c.vx *= Math.pow(0.99, dt);
      c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
    }
    if (confetti.length) confetti = confetti.filter((c) => c.y < H + 40);
  }

  // ---------- drawing ----------
  const GLOWS = ['#ff2d95', '#00d4ff', '#ffd400'];

  function drawBackground(t) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const big = Math.max(W, H);
    for (let k = 0; k < GLOWS.length; k++) {
      const x = W * (0.5 + 0.38 * Math.sin(t / 2900 + k * 2.1));
      const y = H * (0.5 + 0.38 * Math.cos(t / 3600 + k * 1.7));
      const g = ctx.createRadialGradient(x, y, 0, x, y, big * 0.6);
      g.addColorStop(0, GLOWS[k] + '55');
      g.addColorStop(1, GLOWS[k] + '00');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (state === 'hold') {
      ctx.fillStyle = `rgba(10,0,25,${0.55 * clamp((t - stateAt) / 1200, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
    } else if (state === 'now') {
      const f = 1 - clamp((t - nowAt) / 450, 0, 1);
      ctx.fillStyle = `rgba(255,242,0,${0.85 * f})`;
      ctx.fillRect(0, 0, W, H);
    } else if (state === 'reveal') {
      ctx.fillStyle = 'rgba(10,0,25,0.45)';
      ctx.fillRect(0, 0, W, H);
    } else if (state === 'winner') {
      const e = t - stateAt;
      const rad = easeOut(clamp(e / 650, 0, 1)) * Math.hypot(W, H);
      ctx.fillStyle = winner.color;
      ctx.beginPath(); ctx.arc(winner.x, winner.y, rad, 0, Math.PI * 2); ctx.fill();
      // rotating sunburst
      ctx.save();
      ctx.translate(winner.x, winner.y);
      ctx.rotate(t / 2500);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      const rays = 14, len = Math.hypot(W, H) * 1.2;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, Math.min(rad, len), a, a + Math.PI / rays);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  function text(str, x, y, size, fill = '#fff', rot = 0, stroke = BG) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.font = `900 ${size}px system-ui, -apple-system, Roboto, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.2; ctx.strokeStyle = stroke;
    ctx.strokeText(str, 0, 0);
    ctx.fillStyle = fill; ctx.fillText(str, 0, 0);
    ctx.restore();
  }

  function rainbowText(str, x, y, size, t) {
    ctx.font = `900 ${size}px system-ui, -apple-system, Roboto, sans-serif`;
    const widths = [...str].map((ch) => ctx.measureText(ch).width);
    let cx = x - widths.reduce((a, b) => a + b, 0) / 2;
    [...str].forEach((ch, i) => {
      const bob = Math.sin(t / 220 + i * 0.6) * size * 0.08;
      text(ch, cx + widths[i] / 2, y + bob, size, COLORS[i % 9], Math.sin(t / 300 + i) * 0.08);
      cx += widths[i];
    });
  }

  function drawFace(p, x, y, r, t, mood) {
    // eyes look toward the screen centre
    const dx = W / 2 - x, dy = H / 2 - y, d = Math.hypot(dx, dy) || 1;
    const lx = (dx / d) * r * 0.08, ly = (dy / d) * r * 0.08;
    const blink = (t + p.seed * 7) % 3200 < 130 && mood !== 'win' ? 0.15 : 1;
    const ex = r * 0.34, ey = -r * 0.14;
    ctx.fillStyle = '#1b0b3a'; ctx.strokeStyle = '#1b0b3a';
    ctx.lineCap = 'round';
    if (mood === 'oops') {
      ctx.lineWidth = r * 0.09;
      for (const s of [-1, 1]) {
        const cx = x + s * ex, cy = y + ey, k = r * 0.12;
        ctx.beginPath();
        ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k);
        ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y + r * 0.45, r * 0.22, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      return;
    }
    const eyeR = (mood === 'tense' || mood === 'now') ? r * 0.25 : r * 0.21;
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(x + s * ex, y + ey, eyeR, eyeR * blink, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b0b3a';
      ctx.beginPath(); ctx.ellipse(x + s * ex + lx, y + ey + ly, eyeR * 0.5, eyeR * 0.5 * blink, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = r * 0.08;
    if (mood === 'win' || mood === 'now') {
      ctx.beginPath(); ctx.arc(x, y + r * 0.2, r * 0.3, 0, Math.PI); ctx.closePath(); ctx.fill();
    } else if (mood === 'tense') {
      ctx.beginPath(); ctx.moveTo(x - r * 0.2, y + r * 0.32); ctx.lineTo(x + r * 0.2, y + r * 0.32); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y + r * 0.12, r * 0.3, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke();
    }
  }

  function drawCrown(x, y, r, t) {
    const w = r * 1.1, h = r * 0.6, by = y - r * 0.95 + Math.sin(t / 200) * r * 0.05;
    ctx.save();
    ctx.translate(x, by); ctx.rotate(Math.sin(t / 350) * 0.12);
    ctx.fillStyle = '#ffd400'; ctx.strokeStyle = '#1b0b3a'; ctx.lineWidth = r * 0.08; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h); ctx.lineTo(-w / 4, -h * 0.45); ctx.lineTo(0, -h * 1.15);
    ctx.lineTo(w / 4, -h * 0.45); ctx.lineTo(w / 2, -h); ctx.lineTo(w / 2, 0); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(p, t) {
    const base = R * S;
    let r = base * (1 + 0.06 * Math.sin(t / 170 + p.seed));
    let x = p.x, y = p.y, alpha = 1, mood = 'happy';
    const age = t - p.born;
    if (age < 260) r *= 0.4 + 0.6 * easeOut(age / 260) + Math.sin((age / 260) * Math.PI) * 0.25;

    if (state === 'hold' && !p.lifted) {
      const shake = 1.5 + 4 * clamp((t - stateAt) / 2000, 0, 1);
      x += Math.sin(t / 23 + p.seed) * shake * S; y += Math.cos(t / 29 + p.seed) * shake * S;
      mood = 'tense';
    }
    if (state === 'now' && !p.lifted) { mood = 'now'; r *= 1.1; }
    if (p.early) { mood = 'oops'; }
    if (p.lifted && (state === 'hold' || state === 'now')) { alpha = 0.6; r *= 0.85; }

    let spot = false;
    if (state === 'reveal') {
      spot = hopIdx >= 0 && hops[hopIdx].p === p;
      alpha = spot ? 1 : 0.45;
      if (spot) r *= 1.25;
    }
    if (state === 'winner') {
      if (p === winner) { mood = 'win'; r *= 1.5 + 0.08 * Math.sin(t / 120); }
      else { alpha = 0.3; r *= 0.75; }
    }

    ctx.globalAlpha = alpha;
    // ripple when a finger lands
    if (age < 500 && state === 'lobby') {
      ctx.strokeStyle = p.color; ctx.lineWidth = 4 * S;
      ctx.globalAlpha = alpha * (1 - age / 500);
      ctx.beginPath(); ctx.arc(x, y, base + (age / 500) * base * 1.6, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = alpha;
    }
    if (spot) {
      const g = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.4);
      g.addColorStop(0, p.color + 'cc'); g.addColorStop(1, p.color + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = p.color;
    ctx.strokeStyle = '#1b0b3a'; ctx.lineWidth = 5 * S;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // shine
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.42, y - r * 0.5, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2); ctx.fill();
    drawFace(p, x, y, r, t, mood);
    if (mood === 'win') drawCrown(x, y, r, t);

    // lobby countdown ring
    if (state === 'lobby' && players.size >= MIN_PLAYERS) {
      const prog = clamp((t - lastChange) / STABLE_MS, 0, 1);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 6 * S; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y, r + 14 * S, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke();
    }

    // result labels
    let label = null, sub = null;
    if (p.early && state !== 'lobby') label = 'TOO SOON!';
    else if (state === 'now' && p.rt != null) label = `⚡${Math.round(p.rt)} ms`;
    if (state === 'reveal' || (state === 'winner' && p === winner)) {
      label = p.early ? 'TOO SOON!' : p.rt == null ? 'ZZZ…' : `⚡${Math.round(p.rt)} ms`;
      sub = `${Math.round(p.odds * 100)}% chance`;
    }
    if (label) {
      const below = y + r + 26 * S < H - 30 * S;
      const ly = below ? y + r + 24 * S : y - r - 40 * S;
      text(label, x, ly, 20 * S, '#fff');
      if (sub) text(sub, x, ly + 22 * S, 15 * S, '#ffe36e');
    }
    ctx.globalAlpha = 1;
  }

  function drawConfetti() {
    for (const c of confetti) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.fillStyle = c.c; ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * Math.abs(Math.cos(c.rot * 2)) + 2);
      ctx.restore();
    }
  }

  function drawHud(t) {
    const cx = W / 2, cy = H / 2;
    if (state === 'lobby') {
      if (players.size === 0) {
        rainbowText('WHO STARTS?', cx, cy - 40 * S, 48 * S, t);
        text('Everyone put a finger on the screen', cx, cy + 20 * S, 18 * S);
        text('then lift it fast when it says NOW!', cx, cy + 46 * S, 18 * S);
      } else if (players.size < MIN_PLAYERS) {
        text('More fingers!', cx, 70 * S, 34 * S, '#ffe36e', Math.sin(t / 250) * 0.05);
      } else {
        text('GET READY!', cx, 70 * S, 40 * S, '#ffe36e', Math.sin(t / 200) * 0.06);
        text('Keep holding… lift on NOW!', cx, 112 * S, 18 * S);
      }
    } else if (state === 'hold') {
      const s = 1 + 0.06 * Math.sin(t / 90);
      text('WAIT FOR IT…', cx + Math.sin(t / 31) * 3, 80 * S, 42 * S * s, '#fff');
      text('lift too early and your odds drop', cx, 124 * S, 16 * S, '#ffb3c8');
    } else if (state === 'now') {
      const e = clamp((t - nowAt) / 200, 0, 1);
      text('NOW!!!', cx, cy, Math.min(120 * S, W / 4.4) * (0.6 + 0.4 * easeOut(e)), '#ff3b6b', Math.sin(t / 60) * 0.06, '#fff');
    } else if (state === 'reveal') {
      text('AND THE STARTER IS…', cx, 70 * S, 30 * S, '#fff', Math.sin(t / 150) * 0.03);
    } else if (state === 'winner') {
      const e = t - stateAt;
      const pop = easeOut(clamp(e / 400, 0, 1));
      const above = winner.y > H * 0.45;
      const ty = above ? Math.max(70 * S, winner.y - 170 * S) : Math.min(H - 100 * S, winner.y + 170 * S);
      text('YOU START!', cx, ty, 58 * S * pop, '#fff', Math.sin(t / 180) * 0.07);
      if (e > 1000) text('tap to play again', cx, H - 36 * S, 18 * S, '#fff');
    }
  }

  function drawDebug() {
    ctx.save();
    ctx.font = `${12 * S}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const lh = 15 * S, lines = [`maxTouchPoints=${navigator.maxTouchPoints} active=${active.size} players=${players.size}`, ...log];
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, H - lines.length * lh - 8, W, lines.length * lh + 8);
    ctx.fillStyle = '#7CFF9B';
    lines.forEach((l, i) => ctx.fillText(l, 6, H - lines.length * lh - 4 + i * lh));
    ctx.restore();
  }

  let last = performance.now();
  function frame(t) {
    const dt = clamp((t - last) / 16.67, 0, 3);
    last = t;
    update(t, dt);
    drawBackground(t);
    const list = [...players.values()];
    for (const p of list) if (p !== winner) drawPlayer(p, t);
    if (winner) drawPlayer(winner, t);
    drawConfetti();
    drawHud(t);
    if (DEBUG) drawDebug();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // test hook (read-only snapshot)
  window.__sp = () => ({ state, players: [...players.values()].map((p) => ({ id: p.id, rt: p.rt, early: p.early, odds: p.odds })), winner: winner && winner.id });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    // A new version took over: reload once nobody is touching the screen, so updates show up without a second launch.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      const tryReload = () => (active.size === 0 && state === 'lobby' ? location.reload() : setTimeout(tryReload, 1000));
      tryReload();
    });
  }
})();
