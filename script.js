(() => {
  'use strict';

  /* ================= KONFIGURASI ================= */
  const W = 960, H = 540;
  const GY = 420;          // tinggi tanah
  const LEAD_X = 250;      // posisi zombie terdepan di layar
  const MAX_Z = 200;       // batas zombie yang digambar
  const G = 0.62;          // gravitasi
  const JUMP = 14.5;       // kecepatan lompat
  const STEP = 1 / 60;     // timestep tetap

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const gameEl = document.getElementById('game');
  const menuEl = document.getElementById('menu');
  const overEl = document.getElementById('over');
  const muteBtn = document.getElementById('mute');

  const rnd = (a, b) => a + Math.random() * (b - a);
  const hash = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

  /* ================= STATE ================= */
  let state = 'menu';      // menu | play | over
  let frame = 0, cam = 0, speed = 5, dist = 0, shake = 0, overAt = 0;
  let zombies = [], reserve = 0;
  let humans = [], pits = [], cars = [], soldiers = [], bullets = [], brains = [], parts = [];
  let nextX = 0, segs = 0;
  let lh = 0, lvy = 0, jumpBuf = 0, hp = 0, maxZ = 0;
  const hist = new Float32Array(512);
  let best = 0;
  try { best = +localStorage.getItem('zr_best') || 0; } catch (e) {}

  const stars = Array.from({ length: 70 }, () => ({ x: rnd(0, W), y: rnd(0, GY * 0.6), r: rnd(0.6, 1.8) }));
  const SHIRTS = ['#6a4c93', '#b5651d', '#2a6f97', '#8d99ae', '#9e2a2b', '#4f772d'];
  const CAR_COLORS = ['#d62828', '#f77f00', '#2a9d8f', '#4361ee', '#e9c46a', '#9d4edd'];

  /* ================= AUDIO ================= */
  let actx = null, muted = false;
  const lastSfx = {};
  const SFX = {
    jump:  [300, 600, 'sine', .12, .06],
    eat:   [180, 360, 'triangle', .14, .09],
    hit:   [140, 50, 'sawtooth', .12, .07],
    shoot: [700, 200, 'square', .08, .03],
    brain: [500, 1000, 'sine', .2, .09],
    boom:  [120, 30, 'sawtooth', .3, .12],
    fall:  [400, 80, 'sine', .25, .05]
  };
  function ensureAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }
  function sfx(name) {
    if (muted || !actx) return;
    const now = performance.now();
    if (now - (lastSfx[name] || 0) < 70) return;
    lastSfx[name] = now;
    const [f0, f1, type, dur, vol] = SFX[name];
    try {
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }

  /* ================= GAME SETUP ================= */
  function addZombie(x, dz) {
    if (zombies.length >= MAX_Z) { reserve++; return; }
    zombies.push({
      x, rx: Math.random(), dz: dz === undefined ? rnd(0, 38) : dz,
      h: 0, vy: 0, falling: false, dead: false,
      ph: rnd(0, 6.28), jit: (Math.random() * 4) | 0,
      shirt: SHIRTS[(Math.random() * SHIRTS.length) | 0]
    });
  }

  function reset() {
    cam = 0; speed = 5; dist = 0; shake = 0; segs = 0;
    zombies = []; reserve = 0;
    humans = []; pits = []; cars = []; soldiers = []; bullets = []; brains = []; parts = [];
    lh = 0; lvy = 0; jumpBuf = 0; hp = 0; hist.fill(0); maxZ = 0;
    nextX = 900;
    for (let i = 0; i < 6; i++) addZombie(LEAD_X - rnd(0, 60));
  }

  function pitAt(wx) {
    for (const p of pits) if (wx > p.wx && wx < p.wx + p.w) return true;
    return false;
  }

  function burst(wx, y, col, n, sp = 3) {
    for (let i = 0; i < n; i++) {
      parts.push({ wx, y, vx: rnd(-sp, sp), vy: rnd(-sp * 1.5, sp * 0.3), life: rnd(20, 40), col, s: rnd(2, 5) });
    }
  }

  function killZ(z) {
    z.dead = true;
    burst(cam + z.x, GY + z.dz - z.h - 20, '#b30000', 8);
    burst(cam + z.x, GY + z.dz - z.h - 20, '#6fa84f', 4);
    sfx('hit');
  }

  /* ================= SPAWNER ================= */
  function spawnHumans(wx, n) {
    for (let i = 0; i < n; i++) {
      humans.push({
        wx: wx + i * 34 + rnd(0, 12), dz: rnd(0, 38), vx: rnd(0.5, 1.4),
        ph: rnd(0, 6), shirt: SHIRTS[(Math.random() * SHIRTS.length) | 0], dead: false
      });
    }
  }

  function spawnAhead() {
    while (nextX < cam + W + 300) {
      const diff = Math.min(1, dist / 1200);
      const wx = nextX;
      let r = Math.random();
      if (segs < 2) r = 0; // awal selalu banyak manusia
      segs++;

      const pHuman = 0.40 - 0.12 * diff;
      const pPit = pHuman + 0.20;
      const pCar = pPit + 0.18 + 0.08 * diff;
      const pSoldier = pCar + 0.10 + 0.10 * diff;

      if (r < pHuman) {
        const n = 3 + ((Math.random() * (5 + diff * 5)) | 0);
        spawnHumans(wx, n);
        nextX = wx + n * 34 + rnd(200, 320);
      } else if (r < pPit) {
        const w = rnd(110, 160 + diff * 60);
        pits.push({ wx, w });
        if (Math.random() < 0.55) brains.push({ wx: wx + w / 2, h: 100 });
        if (Math.random() < 0.6) spawnHumans(wx + w + 90, 2 + ((Math.random() * 3) | 0));
        nextX = wx + w + rnd(300, 420);
      } else if (r < pCar) {
        cars.push({
          wx, w: 84, h: 46, flash: 0,
          hp: 3 + ((diff * 7) | 0) + ((Math.random() * 3) | 0),
          color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0]
        });
        nextX = wx + rnd(380, 460);
      } else if (r < pSoldier) {
        const n = diff < 0.3 ? 1 : (Math.random() < 0.5 ? 1 : 2);
        for (let i = 0; i < n; i++) {
          soldiers.push({ wx: wx + i * 130, dz: 22, cool: rnd(30, 80), recoil: 0, dead: false });
        }
        nextX = wx + n * 130 + rnd(280, 380);
      } else {
        for (let i = 0; i < 3; i++) brains.push({ wx: wx + i * 90, h: 95 + (i === 1 ? 25 : 0) });
        spawnHumans(wx, 3);
        nextX = wx + 3 * 90 + rnd(250, 340);
      }
    }
  }

  /* ================= UPDATE ================= */
  function step() {
    frame++;
    if (state !== 'play') { cam += 1.6; return; }

    const diff = Math.min(1, dist / 1200);
    speed = 5 + 5 * diff;
    cam += speed;
    dist = cam / 30;

    // Lompatan "pemimpin" virtual, zombie lain meniru dengan jeda
    if (jumpBuf > 0) {
      jumpBuf--;
      if (lh <= 0) { lvy = JUMP; lh = 0.01; jumpBuf = 0; sfx('jump'); }
    }
    if (lh > 0) {
      lh += lvy; lvy -= G;
      if (lh <= 0) { lh = 0; lvy = 0; }
    }
    hp = (hp + 1) & 511;
    hist[hp] = lh;

    // Zombie
    const spread = Math.min(40 + 11 * Math.sqrt(zombies.length), 230);
    for (const z of zombies) {
      if (z.dead) continue;
      z.x += (LEAD_X - z.rx * spread - z.x) * 0.08;
      const wx = cam + z.x;
      if (z.falling) {
        z.vy -= G; z.h += z.vy;
        if (z.h < -280) z.dead = true;
      } else {
        const d = Math.min(300, Math.max(0, Math.round((LEAD_X - z.x) / speed)) + z.jit);
        z.h = hist[(hp - d) & 511];
        if (z.h <= 0.5 && pitAt(wx)) { z.falling = true; z.vy = -1; z.h = 0; sfx('fall'); }
      }
    }

    // Mobil
    for (const c of cars) {
      const sx = c.wx - cam;
      if (c.flash > 0) c.flash--;
      if (sx > W + 50 || sx + c.w < -50) continue;
      for (const z of zombies) {
        if (c.hp <= 0) break;
        if (z.dead || z.falling) continue;
        if (z.h < c.h - 2 && z.x + 8 > sx && z.x - 8 < sx + c.w) {
          killZ(z); c.hp--; c.flash = 4;
          if (c.hp <= 0) {
            burst(c.wx + c.w / 2, GY - 10, c.color, 22, 5);
            burst(c.wx + c.w / 2, GY - 10, '#555', 14, 4);
            shake = 8; sfx('boom');
          }
        }
      }
    }

    // Tentara
    for (const s of soldiers) {
      const sx = s.wx - cam;
      s.cool--;
      if (s.recoil > 0) s.recoil--;
      if (s.cool <= 0 && sx < W - 40 && sx > LEAD_X + 80) {
        bullets.push({ wx: s.wx - 14, dead: false });
        s.cool = rnd(70, 110); s.recoil = 6; sfx('shoot');
      }
      for (const z of zombies) {
        if (z.dead || z.falling) continue;
        if (z.h < 40 && Math.abs(z.x - sx) < 22) {
          s.dead = true;
          burst(s.wx, GY - 10, '#8fe36b', 10);
          addZombie(sx, s.dz);
          sfx('eat');
          break;
        }
      }
    }

    // Peluru
    for (const b of bullets) {
      b.wx -= 9;
      const sx = b.wx - cam;
      if (sx < -40) { b.dead = true; continue; }
      for (const z of zombies) {
        if (z.dead || z.falling) continue;
        if (z.h < 22 && Math.abs(z.x - sx) < 12) { killZ(z); b.dead = true; break; }
      }
    }

    // Manusia
    for (const hm of humans) {
      hm.wx += hm.vx;
      const sx = hm.wx - cam;
      if (sx < -60) { hm.dead = true; continue; }
      for (const z of zombies) {
        if (z.dead || z.falling) continue;
        if (z.h < 30 && Math.abs(z.x - sx) < 18 && Math.abs(z.dz - hm.dz) < 30) {
          hm.dead = true;
          burst(hm.wx, GY + hm.dz - 24, '#8fe36b', 8, 2.5);
          addZombie(sx, hm.dz);
          sfx('eat');
          break;
        }
      }
    }

    // Otak
    for (const b of brains) {
      const sx = b.wx - cam;
      if (sx < -60) { b.dead = true; continue; }
      for (const z of zombies) {
        if (z.dead || z.falling) continue;
        if (Math.abs(z.x - sx) < 20 && Math.abs(z.h + 20 - b.h) < 30) {
          b.dead = true;
          burst(b.wx, GY - b.h, '#ff8fb1', 14, 3);
          for (let i = 0; i < 4; i++) addZombie(sx + i * 6);
          sfx('brain');
          break;
        }
      }
    }

    // Bersihkan
    const before = zombies.length;
    zombies = zombies.filter(z => !z.dead);
    if (before - zombies.length >= 5) shake = Math.max(shake, 6);
    humans = humans.filter(o => !o.dead);
    soldiers = soldiers.filter(o => !o.dead && o.wx - cam > -80);
    bullets = bullets.filter(o => !o.dead);
    brains = brains.filter(o => !o.dead);
    cars = cars.filter(c => c.hp > 0 && c.wx + c.w - cam > -100);
    pits = pits.filter(p => p.wx + p.w - cam > -150);

    if (reserve > 0 && zombies.length < MAX_Z) {
      const n = Math.min(reserve, MAX_Z - zombies.length);
      for (let i = 0; i < n; i++) addZombie(LEAD_X - 120);
      reserve -= n;
    }
    maxZ = Math.max(maxZ, zombies.length + reserve);

    spawnAhead();

    for (const p of parts) { p.wx += p.vx; p.y += p.vy; p.vy += 0.3; p.life--; }
    parts = parts.filter(p => p.life > 0);
    if (shake > 0) shake = Math.max(0, shake - 0.5);

    if (zombies.length + reserve === 0) endGame();
  }

  /* ================= GAME FLOW ================= */
  function start() {
    reset();
    state = 'play';
    menuEl.classList.add('hidden');
    overEl.classList.add('hidden');
    ensureAudio();
  }

  function endGame() {
    state = 'over';
    overAt = performance.now();
    const m = Math.floor(dist);
    if (m > best) { best = m; try { localStorage.setItem('zr_best', String(best)); } catch (e) {} }
    document.getElementById('finalDist').textContent = m;
    document.getElementById('finalMax').textContent = maxZ;
    document.getElementById('finalBest').textContent = best;
    overEl.classList.remove('hidden');
  }

  function action() {
    if (state === 'menu') start();
    else if (state === 'over') { if (performance.now() - overAt > 700) start(); }
    else jumpBuf = 7;
  }

  /* ================= GAMBAR ================= */
  function drawZombie(x, y, s, ph, shirt, airborne) {
    const t = frame * 0.25 + ph;
    const leg = airborne ? 5 : Math.sin(t) * 6;
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2c3d2a'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-2, -16); ctx.lineTo(-2 + leg, 0);
    ctx.moveTo(2, -16); ctx.lineTo(2 - leg, 0);
    ctx.stroke();
    ctx.fillStyle = shirt; ctx.fillRect(-7, -34, 14, 20);
    ctx.strokeStyle = '#7fb069'; ctx.lineWidth = 4;
    const aw = airborne ? -6 : Math.sin(t * 0.5) * 2;
    ctx.beginPath(); ctx.moveTo(4, -30); ctx.lineTo(19, -30 + aw); ctx.stroke();
    ctx.fillStyle = '#8fc070';
    ctx.beginPath(); ctx.arc(1, -42, 8, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5, -43, 2.4, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#b00'; ctx.beginPath(); ctx.arc(5.8, -43, 1.1, 0, 6.3); ctx.fill();
    ctx.restore();
  }

  function drawHuman(x, y, ph, shirt) {
    const t = frame * 0.3 + ph;
    const leg = Math.sin(t) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#33415c'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-2, -16); ctx.lineTo(-2 + leg, 0);
    ctx.moveTo(2, -16); ctx.lineTo(2 - leg, 0);
    ctx.stroke();
    ctx.fillStyle = shirt; ctx.fillRect(-7, -34, 14, 20);
    ctx.strokeStyle = '#f2c9a0'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(-8 + Math.sin(t) * 4, -22); ctx.stroke();
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath(); ctx.arc(0, -42, 8, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#4a2c17'; ctx.beginPath(); ctx.arc(-1, -45, 8, 3.14, 6.28); ctx.fill();
    ctx.fillStyle = '#000'; ctx.fillRect(3, -43, 2, 3);
    ctx.restore();
  }

  function drawSoldier(s) {
    const x = s.wx - cam, y = GY + s.dz;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#2f3e2e'; ctx.fillRect(-9, -16, 6, 16); ctx.fillRect(2, -16, 6, 16);
    ctx.fillStyle = '#3d5a3a'; ctx.fillRect(-9, -36, 18, 22);
    ctx.fillStyle = '#e0b48a'; ctx.beginPath(); ctx.arc(0, -43, 8, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#2d4a2b'; ctx.beginPath(); ctx.arc(0, -45, 9, 3.14, 6.28); ctx.fill();
    ctx.fillRect(-10, -46, 20, 3);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-30, -29, 26, 5); ctx.fillRect(-12, -26, 8, 8);
    if (s.recoil > 0) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(-34, -27, 6 + s.recoil * 0.4, 0, 6.3); ctx.fill();
    }
    ctx.restore();
  }

  function drawCar(c) {
    const x = c.wx - cam, y = GY + 20;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = c.flash > 0 ? '#fff' : c.color;
    ctx.fillRect(0, -30, 84, 22);
    ctx.fillRect(16, -46, 48, 18);
    ctx.fillStyle = '#9ad1ff';
    ctx.fillRect(22, -42, 17, 12); ctx.fillRect(43, -42, 17, 12);
    ctx.fillStyle = '#ffeb99'; ctx.fillRect(80, -26, 4, 6);
    ctx.fillStyle = '#c1121f'; ctx.fillRect(0, -26, 3, 6);
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(18, -8, 9, 0, 6.3); ctx.arc(66, -8, 9, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.arc(18, -8, 4, 0, 6.3); ctx.arc(66, -8, 4, 0, 6.3); ctx.fill();
    // bar HP
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(14, -58, 56, 6);
    ctx.fillStyle = '#ff4d4d'; ctx.fillRect(15, -57, Math.min(54, c.hp * 6), 4);
    ctx.restore();
  }

  function drawBrain(b) {
    const x = b.wx - cam;
    const y = GY - b.h + Math.sin(frame * 0.1 + b.wx) * 5;
    const gr = ctx.createRadialGradient(x, y, 2, x, y, 28);
    gr.addColorStop(0, 'rgba(255,143,177,.55)'); gr.addColorStop(1, 'rgba(255,143,177,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - 28, y - 28, 56, 56);
    ctx.fillStyle = '#ff8fb1';
    ctx.beginPath(); ctx.arc(x - 5, y, 9, 0, 6.3); ctx.arc(x + 5, y, 9, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#d6537f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8);
    ctx.moveTo(x - 9, y - 2); ctx.lineTo(x - 3, y + 1);
    ctx.moveTo(x + 9, y - 2); ctx.lineTo(x + 3, y + 1);
    ctx.stroke();
  }

  function skyline(par, col, bw, hmin, hmax, seed, windows) {
    const off = cam * par;
    const first = Math.floor(off / bw);
    const count = Math.ceil(W / bw) + 2;
    for (let i = first; i < first + count; i++) {
      const bh = hmin + hash(i + seed) * (hmax - hmin);
      const x = i * bw - off;
      ctx.fillStyle = col;
      ctx.fillRect(x, GY - bh, bw - 4, bh);
      if (windows) {
        ctx.fillStyle = 'rgba(255,220,120,.55)';
        for (let wy = GY - bh + 10; wy < GY - 16; wy += 18) {
          for (let wx = x + 6; wx < x + bw - 16; wx += 14) {
            if (hash(i * 17 + wy * 0.31 + wx * 0.07) > 0.78) ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
    }
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, GY);
    sky.addColorStop(0, '#140a2e'); sky.addColorStop(0.55, '#5a2a6b'); sky.addColorStop(1, '#e8704f');
    ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, GY + 20);

    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(frame * 0.03 + s.x);
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    const mg = ctx.createRadialGradient(780, 110, 20, 780, 110, 110);
    mg.addColorStop(0, 'rgba(253,243,208,.45)'); mg.addColorStop(1, 'rgba(253,243,208,0)');
    ctx.fillStyle = mg; ctx.fillRect(660, 0, 240, 230);
    ctx.fillStyle = '#fdf3d0'; ctx.beginPath(); ctx.arc(780, 110, 38, 0, 6.3); ctx.fill();

    skyline(0.12, '#3a1d5c', 70, 120, 260, 1, false);
    skyline(0.35, '#1d0f38', 90, 80, 200, 7, true);

    // tiang lampu
    const lampGap = 520;
    const l0 = Math.floor(cam / lampGap);
    for (let i = l0; i < l0 + 3; i++) {
      const x = i * lampGap - cam + 100;
      ctx.fillStyle = '#2a2a38'; ctx.fillRect(x, GY - 120, 5, 120);
      ctx.fillRect(x, GY - 120, 26, 5);
      const lg = ctx.createRadialGradient(x + 24, GY - 112, 2, x + 24, GY - 112, 50);
      lg.addColorStop(0, 'rgba(255,230,150,.6)'); lg.addColorStop(1, 'rgba(255,230,150,0)');
      ctx.fillStyle = lg; ctx.fillRect(x - 30, GY - 160, 110, 110);
    }

    // tanah
    ctx.fillStyle = '#3b3b48'; ctx.fillRect(-20, GY, W + 40, H - GY + 20);
    ctx.fillStyle = '#6b6b7a'; ctx.fillRect(-20, GY, W + 40, 6);
    ctx.fillStyle = '#4a4a58'; ctx.fillRect(-20, GY + 6, W + 40, 10);
    ctx.fillStyle = '#8a8a99';
    const off = cam % 100;
    for (let x = -off; x < W; x += 100) ctx.fillRect(x, GY + 86, 50, 4);

    // lubang
    for (const p of pits) {
      const sx = p.wx - cam;
      if (sx > W + 10 || sx + p.w < -10) continue;
      const pg = ctx.createLinearGradient(0, GY, 0, H);
      pg.addColorStop(0, '#1a0508'); pg.addColorStop(1, '#000');
      ctx.fillStyle = pg; ctx.fillRect(sx, GY, p.w, H - GY + 20);
      ctx.fillStyle = '#6b6b7a'; ctx.fillRect(sx - 4, GY, 4, 14); ctx.fillRect(sx + p.w, GY, 4, 14);
    }
  }

  function drawEntities() {
    for (const c of cars) { const sx = c.wx - cam; if (sx < W + 60 && sx > -120) drawCar(c); }
    for (const s of soldiers) { const sx = s.wx - cam; if (sx < W + 60) drawSoldier(s); }
    for (const b of brains) { const sx = b.wx - cam; if (sx < W + 60) drawBrain(b); }
    for (const hm of humans) {
      const sx = hm.wx - cam;
      if (sx < W + 60) drawHuman(sx, GY + hm.dz, hm.ph, hm.shirt);
    }

    zombies.sort((a, b) => a.dz - b.dz);
    for (const z of zombies) {
      const s = 0.95 + 0.15 * (z.dz / 38);
      drawZombie(z.x, GY + z.dz - z.h, s, z.ph, z.shirt, z.h > 3);
    }

    ctx.fillStyle = '#ffd166';
    for (const b of bullets) {
      const sx = b.wx - cam;
      ctx.fillRect(sx - 6, GY - 2, 12, 3);
    }

    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, p.life / 40);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.wx - cam, p.y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    if (state === 'menu') return;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(14, 12, 150, 44);
    ctx.fillRect(W / 2 - 70, 12, 140, 44);
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8fe36b'; ctx.textAlign = 'left';
    ctx.fillText('🧟 ' + (zombies.length + reserve), 24, 35);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(Math.floor(dist) + ' m', W / 2, 35);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left';
    ctx.fillText('Rekor: ' + Math.max(best, Math.floor(dist)) + ' m', 24, 74);

    if (state === 'play' && cam < 1500) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + 0.5 * Math.sin(frame * 0.1)) + ')';
      ctx.fillText('KETUK / SPASI = LOMPAT', W / 2, 130);
    }
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake), rnd(-shake, shake));
    drawBackground();
    drawEntities();
    ctx.restore();
    drawHUD();
  }

  /* ================= INPUT ================= */
  gameEl.addEventListener('pointerdown', e => { e.preventDefault(); action(); });
  window.addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'KeyW', 'Enter'].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) { ensureAudio(); action(); }
    }
  });
  muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
  muteBtn.addEventListener('click', e => {
    e.stopPropagation();
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  /* ================= LOOP ================= */
  reset();
  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= STEP) { step(); acc -= STEP; }
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
