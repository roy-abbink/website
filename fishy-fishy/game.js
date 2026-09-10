(function () {
  'use strict';

  // ============================================================
  // Canvas setup — fixed 9:16 logical resolution, HiDPI-crisp
  // ============================================================
  const W = 450, H = 800;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const hintEl = document.getElementById('hint');

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const scale = rect.width / W;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / (rect.width / W),
      y: (clientY - rect.top) / (rect.height / H),
    };
  }

  // ============================================================
  // Utility
  // ============================================================
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function pointInRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ============================================================
  // Layout zones (logical 450x800 space)
  // ============================================================
  const ZONES = {
    topBar: { y0: 0, y1: H * 0.10 },
    catZone: { y0: H * 0.10, y1: H * 0.25 },
    floor: { y0: H * 0.25, y1: H * 0.75 },
    tanks: { y0: H * 0.75, y1: H },
  };

  const catX = W / 2;
  const catY = ZONES.catZone.y0 + 46;
  const CRATE_W = 54, CRATE_H = 40;

  const freshwaterRect = { x: 10, y: H * 0.75 + 8, w: W / 2 - 18, h: H * 0.25 - 16 };
  const saltwaterRect = { x: W / 2 + 8, y: H * 0.75 + 8, w: W / 2 - 18, h: H * 0.25 - 16 };
  const restartButtonRect = { x: W / 2 - 95, y: H * 0.62, w: 190, h: 54 };

  function isOverTankX(x) {
    return (x >= freshwaterRect.x && x <= freshwaterRect.x + freshwaterRect.w) ||
      (x >= saltwaterRect.x && x <= saltwaterRect.x + saltwaterRect.w);
  }

  // ============================================================
  // Fish species
  // ============================================================
  const FISH_TYPES = {
    guppy: {
      label: 'Guppy (Zoet)',
      tank: 'zoet',
      lifespan: 9,
      color: '#ffb020',
      colorAccent: '#fff2c2',
      size: 24,
      weight: 1,
      behavior: 'gentle',
    },
    clownfish: {
      label: 'Clownvis (Zout)',
      tank: 'zout',
      lifespan: 6,
      color: '#ff5a2e',
      colorAccent: '#ffffff',
      size: 22,
      weight: 1,
      behavior: 'burst',
    },
    catfish: {
      label: 'Meerval (Zoet)',
      tank: 'zoet',
      lifespan: 12,
      color: '#4a5568',
      colorAccent: '#8a99ab',
      size: 32,
      weight: 1.7,
      behavior: 'still',
    },
  };
  const FISH_KEYS = Object.keys(FISH_TYPES);
  function pickFishType() { return FISH_KEYS[Math.floor(rand(0, FISH_KEYS.length))]; }

  // ============================================================
  // Physics constants
  // ============================================================
  const GRAVITY_FALL = 650;
  const GRAVITY_LOOSE = 280;
  const FRICTION = 0.98;
  const BOUNCE = 0.5;
  const FLICK_MIN = 90;
  const HOLD_DURATION = 1.0;
  const THROW_DURATION = 0.22;
  const SQUASH_TIME = 0.16;
  const SCORE_FADE_TIME = 0.45;
  const FAIL_FADE_TIME = 0.3;
  const DEATH_TIME = 0.6;

  // ============================================================
  // Audio (procedural, WebAudio)
  // ============================================================
  let actx = null;
  function ensureAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return; }
    }
    if (actx.state === 'suspended') actx.resume();
  }

  function tone(freq0, freq1, dur, type, peak) {
    if (!actx) return;
    const t0 = actx.currentTime;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freq1, 1), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak || 0.3, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noiseBurst(dur, filterFreq) {
    if (!actx) return;
    const t0 = actx.currentTime;
    const bufferSize = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = actx.createBufferSource();
    src.buffer = buffer;
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    const gain = actx.createGain();
    gain.gain.setValueAtTime(0.5, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(actx.destination);
    src.start(t0);
  }

  const SFX = {
    pickup() { tone(520, 920, 0.08, 'sine', 0.15); },
    drop() { tone(420, 140, 0.16, 'sine', 0.2); },
    splash() { noiseBurst(0.35, 1800); },
    fail() { tone(150, 60, 0.22, 'sawtooth', 0.22); },
    gameOver() {
      if (!actx) return;
      [440, 349, 294, 220].forEach((f, i) => {
        setTimeout(() => tone(f, f * 0.9, 0.22, 'triangle', 0.2), i * 140);
      });
    },
  };

  // ============================================================
  // Game state
  // ============================================================
  let state = 'start'; // start | playing | gameover
  let score = 0, lives = 3;
  let highScore = +(localStorage.getItem('fishyFishyHighScore') || 0);
  let fishes = [];
  let particles = [];
  let draggingFish = null;
  let pointerHistory = [];
  let dropsCount = 0;
  let animTime = 0;
  let tankBubbleTimer = 0.3;
  let fishIdSeq = 0;

  const cat = {
    phase: 'idle', timer: 0.6, heldFish: null,
    mood: 'normal', moodTimer: 0,
    blinking: false, blinkT: 0, blinkTimer: rand(2, 4),
  };

  function getDropInterval() { return Math.max(0.9, 3.5 - dropsCount * 0.12); }

  function initRun() {
    score = 0; lives = 3; fishes = []; particles = [];
    dropsCount = 0; draggingFish = null; pointerHistory = [];
    cat.phase = 'idle'; cat.timer = 0.6; cat.heldFish = null;
    cat.mood = 'normal'; cat.moodTimer = 0;
  }

  function startGame() {
    hintEl.classList.add('hidden');
    initRun();
    state = 'playing';
  }

  function restartGame() {
    initRun();
    state = 'playing';
  }

  function endGame() {
    lives = 0;
    state = 'gameover';
    if (score > highScore) {
      highScore = score;
      localStorage.setItem('fishyFishyHighScore', String(highScore));
    }
    draggingFish = null;
    SFX.gameOver();
  }

  function checkGameOver() { if (lives <= 0) endGame(); }

  // ============================================================
  // Fish factory
  // ============================================================
  function createFish(type, x, y) {
    const def = FISH_TYPES[type];
    return {
      id: fishIdSeq++,
      type, def,
      x, y, vx: 0, vy: 0,
      facing: 1,
      state: 'falling',
      targetY: rand(ZONES.floor.y0 + 70, ZONES.floor.y1 - 55),
      life: 1, age: 0, lifeStarted: false,
      wobblePhase: rand(0, Math.PI * 2),
      behaviorTimer: rand(0.4, 1.1),
      scaleX: 1, scaleY: 1, squashT: 0,
      scoreT: 0, scoreFade: 1, deathT: 0, deathFlop: 0,
      dragOffsetX: 0, dragOffsetY: -38,
      removeMe: false,
    };
  }

  function spawnFishFromCat(type) {
    const x = clamp(catX + rand(-70, 70), 50, W - 50);
    const y = catY + 26;
    const f = createFish(type, x, y);
    f.vx = rand(-25, 25);
    f.vy = 10;
    fishes.push(f);
  }

  function squash(fish) { fish.squashT = SQUASH_TIME; }

  // ============================================================
  // Input
  // ============================================================
  let activePointer = null; // 'touch' | 'mouse'

  function findFishAt(x, y) {
    for (let i = fishes.length - 1; i >= 0; i--) {
      const f = fishes[i];
      if (f.state !== 'loose' && f.state !== 'falling') continue;
      const r = f.def.size * 0.95 + 14;
      if (Math.hypot(f.x - x, f.y - y) <= r) return f;
    }
    return null;
  }

  function grabFish(fish, x, y) {
    fish.state = 'dragging';
    fish.x = x + fish.dragOffsetX;
    fish.y = y + fish.dragOffsetY;
    fish.vx = 0; fish.vy = 0;
    fish.lifeStarted = true;
    draggingFish = fish;
    pointerHistory = [{ x, y, t: performance.now() }];
    squash(fish);
    SFX.pickup();
  }

  function computeReleaseVelocity() {
    if (pointerHistory.length < 2) return { vx: 0, vy: 0 };
    const newest = pointerHistory[pointerHistory.length - 1];
    let oldest = pointerHistory[0];
    for (let i = pointerHistory.length - 2; i >= 0; i--) {
      if (newest.t - pointerHistory[i].t <= 120) oldest = pointerHistory[i];
      else break;
    }
    const dt = Math.max(1, newest.t - oldest.t) / 1000;
    let vx = (newest.x - oldest.x) / dt;
    let vy = (newest.y - oldest.y) / dt;
    const speed = Math.hypot(vx, vy);
    const MAXSPEED = 1400;
    if (speed > MAXSPEED) { const s = MAXSPEED / speed; vx *= s; vy *= s; }
    return { vx, vy };
  }

  function onPointerDown(x, y) {
    if (state === 'start') { startGame(); return; }
    if (state === 'gameover') {
      if (pointInRect(x, y, restartButtonRect)) restartGame();
      return;
    }
    const fish = findFishAt(x, y);
    if (fish) grabFish(fish, x, y);
  }

  function onPointerMove(x, y) {
    if (!draggingFish) return;
    draggingFish.x = clamp(x + draggingFish.dragOffsetX, 16, W - 16);
    draggingFish.y = clamp(y + draggingFish.dragOffsetY, ZONES.floor.y0 - 20, H - 8);
    pointerHistory.push({ x, y, t: performance.now() });
    if (pointerHistory.length > 6) pointerHistory.shift();
  }

  function onPointerUp() {
    if (!draggingFish) return;
    const fish = draggingFish;
    let { vx, vy } = computeReleaseVelocity();
    const speed = Math.hypot(vx, vy);
    if (speed < FLICK_MIN) { vx = 0; vy = 0; }
    else {
      const weight = fish.def.weight || 1;
      vx /= weight; vy /= weight;
    }
    fish.vx = vx; fish.vy = vy;
    fish.state = 'loose';
    draggingFish = null;
    pointerHistory = [];
  }

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    ensureAudio();
    const t = e.changedTouches[0];
    const p = toLogical(t.clientX, t.clientY);
    activePointer = 'touch';
    onPointerDown(p.x, p.y);
  }, { passive: false });

  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (activePointer !== 'touch') return;
    const t = e.changedTouches[0];
    const p = toLogical(t.clientX, t.clientY);
    onPointerMove(p.x, p.y);
  }, { passive: false });

  canvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    if (activePointer !== 'touch') return;
    onPointerUp();
    activePointer = null;
  }, { passive: false });

  canvas.addEventListener('touchcancel', function (e) {
    e.preventDefault();
    if (activePointer !== 'touch') return;
    onPointerUp();
    activePointer = null;
  }, { passive: false });

  canvas.addEventListener('mousedown', function (e) {
    if (activePointer === 'touch') return;
    ensureAudio();
    const p = toLogical(e.clientX, e.clientY);
    activePointer = 'mouse';
    onPointerDown(p.x, p.y);
  });
  window.addEventListener('mousemove', function (e) {
    if (activePointer !== 'mouse') return;
    const p = toLogical(e.clientX, e.clientY);
    onPointerMove(p.x, p.y);
  });
  window.addEventListener('mouseup', function () {
    if (activePointer !== 'mouse') return;
    onPointerUp();
    activePointer = null;
  });

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.body.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  // ============================================================
  // Update
  // ============================================================
  function updateCat(dt) {
    cat.blinkTimer -= dt;
    if (cat.blinkTimer <= 0) { cat.blinking = true; cat.blinkT = 0.12; cat.blinkTimer = rand(2.5, 5.5); }
    if (cat.blinking) { cat.blinkT -= dt; if (cat.blinkT <= 0) cat.blinking = false; }
    if (cat.moodTimer > 0) { cat.moodTimer -= dt; if (cat.moodTimer <= 0) cat.mood = 'normal'; }

    if (state !== 'playing') return;

    cat.timer -= dt;
    if (cat.phase === 'idle') {
      if (cat.timer <= 0) {
        cat.phase = 'hold';
        cat.timer = HOLD_DURATION;
        cat.heldFish = { type: pickFishType() };
      }
    } else if (cat.phase === 'hold') {
      if (cat.timer <= 0) {
        cat.phase = 'throw';
        cat.timer = THROW_DURATION;
        spawnFishFromCat(cat.heldFish.type);
        cat.heldFish = null;
        SFX.drop();
      }
    } else if (cat.phase === 'throw') {
      if (cat.timer <= 0) {
        cat.phase = 'idle';
        dropsCount++;
        cat.timer = getDropInterval();
      }
    }
  }

  function tickLife(fish, dt) {
    if (!fish.lifeStarted) return;
    fish.age += dt;
    fish.life = clamp(1 - fish.age / fish.def.lifespan, 0, 1);
    if (fish.life <= 0 && fish.state !== 'dying') killFish(fish);
  }

  function killFish(fish) {
    fish.state = 'dying';
    fish.deathT = DEATH_TIME;
    if (fish === draggingFish) draggingFish = null;
    lives--;
    SFX.fail();
    checkGameOver();
  }

  function checkTankHit(fish) {
    if (pointInRect(fish.x, fish.y, freshwaterRect)) resolveTank(fish, 'zoet');
    else if (pointInRect(fish.x, fish.y, saltwaterRect)) resolveTank(fish, 'zout');
  }

  function resolveTank(fish, tank) {
    if (fish === draggingFish) draggingFish = null;
    if (fish.def.tank === tank) {
      score += 100;
      fish.state = 'scoring';
      fish.scoreT = SCORE_FADE_TIME;
      spawnSplash(fish.x, fish.y, tank);
      SFX.splash();
    } else {
      lives--;
      fish.state = 'failing';
      fish.scoreT = FAIL_FADE_TIME;
      spawnFailMark(fish.x, fish.y);
      SFX.fail();
      cat.mood = 'smirk';
      cat.moodTimer = 1.0;
      checkGameOver();
    }
  }

  function updateFlopBehavior(fish, dt, speed) {
    if (speed > 40) return;
    fish.behaviorTimer -= dt;
    if (fish.behaviorTimer > 0) return;
    let factor = 1;
    if (fish.life < 0.25) factor = 0.35;
    else if (fish.life < 0.6) factor = 0.65;
    switch (fish.def.behavior) {
      case 'gentle':
        fish.vx += rand(-40, 40) * factor;
        fish.vy -= rand(30, 70) * factor;
        fish.behaviorTimer = rand(1.4, 2.6) / factor;
        squash(fish);
        break;
      case 'burst':
        fish.vx += rand(-160, 160) * factor;
        fish.vy -= rand(50, 110) * factor;
        fish.behaviorTimer = rand(0.35, 0.9) / factor;
        squash(fish);
        break;
      case 'still':
        fish.vx += rand(-10, 10) * factor;
        fish.behaviorTimer = rand(1.5, 3);
        break;
    }
  }

  function updateFish(fish, dt) {
    if (fish.squashT > 0) {
      fish.squashT -= dt;
      const t = clamp(fish.squashT / SQUASH_TIME, 0, 1);
      fish.scaleX = lerp(1, 1.2, t);
      fish.scaleY = lerp(1, 0.8, t);
    } else { fish.scaleX = 1; fish.scaleY = 1; }

    if (fish.state === 'falling') {
      fish.vy += GRAVITY_FALL * dt;
      fish.x += fish.vx * dt;
      fish.y += fish.vy * dt;
      if (fish.y >= fish.targetY) {
        fish.y = fish.targetY;
        fish.vx = 0; fish.vy = 0;
        fish.state = 'loose';
        fish.lifeStarted = true;
        squash(fish);
        spawnDust(fish.x, fish.y + fish.def.size * 0.3);
      }
      return;
    }

    if (fish.state === 'dragging') {
      checkTankHit(fish);
      tickLife(fish, dt);
      return;
    }

    if (fish.state === 'loose') {
      fish.vy += GRAVITY_LOOSE * dt;
      const fr = Math.pow(FRICTION, dt * 60);
      fish.vx *= fr; fish.vy *= fr;
      fish.x += fish.vx * dt;
      fish.y += fish.vy * dt;

      const r = fish.def.size * 0.6;
      const minX = r, maxX = W - r, minY = ZONES.floor.y0 + r;
      if (fish.x < minX) { fish.x = minX; fish.vx = -fish.vx * BOUNCE; }
      if (fish.x > maxX) { fish.x = maxX; fish.vx = -fish.vx * BOUNCE; }
      if (fish.y < minY) { fish.y = minY; fish.vy = -fish.vy * BOUNCE; }

      const floorBottom = ZONES.floor.y1;
      if (fish.y > floorBottom - r && !isOverTankX(fish.x)) {
        fish.y = floorBottom - r;
        fish.vy = -Math.abs(fish.vy) * BOUNCE;
      }
      const hardBottom = H - 20;
      if (fish.y > hardBottom) { fish.y = hardBottom; fish.vy = -fish.vy * BOUNCE; }

      if (fish.vx > 8) fish.facing = 1;
      else if (fish.vx < -8) fish.facing = -1;

      const speed = Math.hypot(fish.vx, fish.vy);
      updateFlopBehavior(fish, dt, speed);
      checkTankHit(fish);
      tickLife(fish, dt);
      return;
    }

    if (fish.state === 'scoring') {
      fish.scoreT -= dt;
      fish.y += 40 * dt;
      fish.scoreFade = clamp(fish.scoreT / SCORE_FADE_TIME, 0, 1);
      if (fish.scoreT <= 0) fish.removeMe = true;
      return;
    }

    if (fish.state === 'failing') {
      fish.scoreT -= dt;
      fish.scoreFade = clamp(fish.scoreT / FAIL_FADE_TIME, 0, 1);
      if (fish.scoreT <= 0) fish.removeMe = true;
      return;
    }

    if (fish.state === 'dying') {
      fish.deathT -= dt;
      fish.deathFlop += dt * 20;
      if (fish.deathT <= 0) fish.removeMe = true;
      return;
    }
  }

  function spawnBubble(rect, color) {
    particles.push({
      type: 'bubble', x: rect.x + rand(10, rect.w - 10), y: rect.y + rect.h - 4,
      vy: -rand(20, 40), r: rand(2, 4), life: 2, age: 0, color,
    });
  }

  function spawnSplash(x, y, tank) {
    const color = tank === 'zoet' ? '#1fd8c0' : '#2b6bff';
    particles.push({ type: 'ring', x, y, r: 4, growth: 90, life: 0.4, age: 0, color });
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(60, 160);
      particles.push({
        type: 'droplet', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
        life: 0.6, age: 0, color,
      });
    }
  }

  function spawnFailMark(x, y) {
    particles.push({ type: 'fail', x, y, life: 0.5, age: 0 });
  }

  function spawnDust(x, y) {
    for (let i = 0; i < 6; i++) {
      particles.push({
        type: 'dust', x: x + rand(-8, 8), y,
        vx: rand(-30, 30), vy: rand(-40, -10),
        r: rand(1.5, 3), life: 0.4, age: 0,
      });
    }
  }

  function updateParticles(dt) {
    tankBubbleTimer -= dt;
    if (tankBubbleTimer <= 0) {
      tankBubbleTimer = rand(0.18, 0.42);
      spawnBubble(freshwaterRect, '#1fd8c0');
      spawnBubble(saltwaterRect, '#2b6bff');
    }
    for (const p of particles) {
      p.age += dt;
      if (p.type === 'bubble') {
        p.y += p.vy * dt;
        p.x += Math.sin(p.age * 6) * 6 * dt;
      } else if (p.type === 'droplet') {
        p.vy += 300 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      } else if (p.type === 'dust') {
        p.vy += 40 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      } else if (p.type === 'ring') {
        p.r += p.growth * dt;
      }
    }
    particles = particles.filter(function (p) { return p.age < p.life; });
  }

  function update(dt) {
    animTime += dt;
    updateCat(dt);
    if (state === 'playing') {
      for (const f of fishes) updateFish(f, dt);
      fishes = fishes.filter(function (f) { return !f.removeMe; });
    }
    updateParticles(dt);
  }

  // ============================================================
  // Draw
  // ============================================================
  function drawFishBody(s, color, accent, fish) {
    ctx.beginPath();
    ctx.moveTo(-s * 1.15, 0);
    ctx.lineTo(-s * 1.7, -s * 0.55);
    ctx.lineTo(-s * 1.7, s * 0.55);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.55);
    ctx.lineTo(s * 0.15, -s * 1.0);
    ctx.lineTo(s * 0.4, -s * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    if (fish.type === 'clownfish') {
      ctx.strokeStyle = accent; ctx.lineWidth = s * 0.22;
      [-0.4, 0.1, 0.55].forEach(function (px) {
        ctx.beginPath();
        ctx.moveTo(s * px, -s * 0.6);
        ctx.lineTo(s * px, s * 0.6);
        ctx.stroke();
      });
    }
    if (fish.type === 'catfish') {
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s * 0.85, s * 0.1); ctx.lineTo(s * 1.25, s * 0.35);
      ctx.moveTo(s * 0.85, -s * 0.05); ctx.lineTo(s * 1.3, -s * 0.1);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(s * 0.55, -s * 0.08, s * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s * 0.6, -s * 0.08, s * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();

    if (fish.life != null && fish.life < 0.25 && fish.state !== 'dying') {
      const gaspR = 1.5 + Math.abs(Math.sin(animTime * 10)) * 1.5;
      ctx.beginPath();
      ctx.arc(s * 0.95, s * 0.05, gaspR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawSkeleton(s, flop) {
    ctx.rotate(Math.sin(flop) * 0.4);
    ctx.strokeStyle = '#8a97a6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.35); ctx.lineTo(s * 0.5, s * 0.35);
    ctx.moveTo(-s * 0.5, s * 0.35); ctx.lineTo(s * 0.5, -s * 0.35);
    ctx.stroke();
  }

  function drawLabel(text, x, y) {
    ctx.save();
    ctx.font = '600 13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(10,14,20,0.75)';
    roundRect(x - w / 2, y, w, 22, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 11);
    ctx.restore();
  }

  function drawFish(fish) {
    const def = fish.def;
    ctx.save();
    ctx.translate(fish.x, fish.y);
    let rot = 0;
    if (fish.state === 'loose' || fish.state === 'dragging') {
      rot = Math.sin(animTime * 5 + fish.wobblePhase) * 0.08;
    }
    if (fish.state !== 'dying') rot += clamp(fish.vx / 900, -0.3, 0.3);
    ctx.rotate(rot);
    ctx.scale(fish.facing * fish.scaleX, fish.scaleY);

    let alpha = 1;
    if (fish.state === 'scoring' || fish.state === 'failing') alpha = fish.scoreFade;
    ctx.globalAlpha = alpha;

    const s = def.size;
    let bodyColor = def.color;
    if (fish.state !== 'dying') {
      let flicker = false;
      if (fish.life < 0.6 && fish.life >= 0.25) flicker = Math.floor(animTime * 8) % 2 === 0;
      else if (fish.life < 0.25) flicker = Math.floor(animTime * 16) % 2 === 0;
      if (flicker) bodyColor = '#ff3b3b';
    }

    if (fish.state === 'dying') drawSkeleton(s, fish.deathFlop);
    else drawFishBody(s, bodyColor, def.colorAccent, fish);

    ctx.restore();

    if (fish.state === 'dragging') drawLabel(def.label, fish.x, fish.y - def.size - 34);
  }

  function drawCrate(x, y) {
    ctx.fillStyle = '#5c4530';
    roundRect(x, y, CRATE_W, CRATE_H, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * CRATE_W / 4, y);
      ctx.lineTo(x + i * CRATE_W / 4, y + CRATE_H);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x, y + CRATE_H / 2);
    ctx.lineTo(x + CRATE_W, y + CRATE_H / 2);
    ctx.stroke();
  }

  function drawCat() {
    const bob = Math.sin(animTime * 2.4) * 3;
    ctx.save();
    ctx.translate(catX, catY + bob);

    ctx.fillStyle = '#3d4a5c';
    ctx.beginPath(); ctx.moveTo(-34, -30); ctx.lineTo(-18, -52); ctx.lineTo(-6, -28); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(34, -30); ctx.lineTo(18, -52); ctx.lineTo(6, -28); ctx.closePath(); ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fillStyle = '#465469';
    ctx.fill();

    ctx.strokeStyle = '#0a0e14'; ctx.fillStyle = '#0a0e14'; ctx.lineWidth = 3;
    [-13, 13].forEach(function (ex) {
      if (cat.blinking) {
        ctx.beginPath(); ctx.moveTo(ex - 7, -4); ctx.lineTo(ex + 7, -4); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.ellipse(ex, -4, 6, 8, 0, 0, Math.PI * 2); ctx.fill();
      }
    });

    ctx.beginPath();
    if (cat.mood === 'smirk') {
      ctx.moveTo(-10, 14); ctx.quadraticCurveTo(0, 24, 10, 14);
    } else {
      ctx.moveTo(-8, 14); ctx.quadraticCurveTo(0, 18, 0, 14);
      ctx.moveTo(8, 14); ctx.quadraticCurveTo(0, 18, 0, 14);
    }
    ctx.strokeStyle = '#0a0e14'; ctx.lineWidth = 2; ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.2;
    [-1, 1].forEach(function (side) {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(side * 20, 6 + i * 4);
        ctx.lineTo(side * 40, 2 + i * 6);
        ctx.stroke();
      }
    });

    const pawDrop = cat.phase === 'throw' ? (1 - cat.timer / THROW_DURATION) : 0;
    const pawY = 30 + pawDrop * 36;
    ctx.fillStyle = '#3d4a5c';
    ctx.beginPath(); ctx.ellipse(-20, pawY, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(20, pawY, 10, 7, 0, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function drawHeldFish() {
    if (cat.phase !== 'hold' || !cat.heldFish) return;
    const def = FISH_TYPES[cat.heldFish.type];
    const fx = catX, fy = catY + 40 + Math.sin(animTime * 6) * 2;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(0.8, 0.8);
    drawFishBody(def.size, def.color, def.colorAccent, { type: cat.heldFish.type });
    ctx.restore();
    drawLabel(def.label, fx, fy - def.size * 0.8 - 26);
  }

  function drawCatZone() {
    drawCrate(24, catY + 18);
    drawCrate(W - 24 - CRATE_W, catY + 18);
    drawCat();
    drawHeldFish();
  }

  function drawFloorArea() {
    ctx.fillStyle = '#121a24';
    ctx.fillRect(0, 0, W, ZONES.floor.y0);
    ctx.fillStyle = '#1b2735';
    ctx.fillRect(0, ZONES.floor.y0, W, ZONES.floor.y1 - ZONES.floor.y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let gx = 0; gx <= W; gx += 30) {
      ctx.beginPath(); ctx.moveTo(gx, ZONES.floor.y0); ctx.lineTo(gx, ZONES.floor.y1); ctx.stroke();
    }
    for (let gy = ZONES.floor.y0; gy <= ZONES.floor.y1; gy += 30) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }
  }

  function drawTank(rect, accent, base, label) {
    ctx.save();
    ctx.fillStyle = base;
    roundRect(rect.x, rect.y, rect.w, rect.h, 10);
    ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
    roundRect(rect.x, rect.y, rect.w, rect.h, 10);
    ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(rect.x + 6, rect.y); ctx.lineTo(rect.x + rect.w - 6, rect.y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.font = '700 15px -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h - 10);
    ctx.restore();
  }

  function drawTanks() {
    ctx.fillStyle = '#0d151c';
    ctx.fillRect(0, ZONES.tanks.y0 - 8, W, H - (ZONES.tanks.y0 - 8));
    drawTank(freshwaterRect, '#1fd8c0', '#0f5c52', 'ZOET');
    drawTank(saltwaterRect, '#2b6bff', '#0a2a66', 'ZOUT');
  }

  function drawHeart(cx, cy, filled) {
    const s = 8;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.3);
    ctx.bezierCurveTo(0, -s * 0.3, -s, -s * 0.3, -s, s * 0.1);
    ctx.bezierCurveTo(-s, s * 0.6, 0, s * 0.8, 0, s * 1.1);
    ctx.bezierCurveTo(0, s * 0.8, s, s * 0.6, s, s * 0.1);
    ctx.bezierCurveTo(s, -s * 0.3, 0, -s * 0.3, 0, s * 0.3);
    ctx.closePath();
    if (filled) { ctx.fillStyle = '#ff4d6d'; ctx.fill(); }
    else { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.restore();
  }

  function drawTopBar() {
    ctx.font = '700 20px -apple-system, sans-serif';
    ctx.fillStyle = '#e8edf5';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('SCORE: ' + String(score).padStart(4, '0'), 16, ZONES.topBar.y1 / 2);

    const heartsY = ZONES.topBar.y1 / 2;
    for (let i = 0; i < 3; i++) {
      drawHeart(W - 16 - i * 26, heartsY, i < lives);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = 1 - p.age / p.life;
      ctx.globalAlpha = clamp(t, 0, 1);
      if (p.type === 'bubble') {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.4; ctx.stroke();
      } else if (p.type === 'droplet') {
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = p.color; ctx.fill();
      } else if (p.type === 'dust') {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = '#c9b28a'; ctx.fill();
      } else if (p.type === 'ring') {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; ctx.stroke();
      } else if (p.type === 'fail') {
        ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(p.x - 10, p.y - 10); ctx.lineTo(p.x + 10, p.y + 10);
        ctx.moveTo(p.x + 10, p.y - 10); ctx.lineTo(p.x - 10, p.y + 10);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawStartOverlay() {
    ctx.fillStyle = 'rgba(5,8,12,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.font = '700 32px -apple-system, sans-serif';
    ctx.fillText('FISHY FISHY', W / 2, H * 0.42);
    ctx.font = '500 15px -apple-system, sans-serif';
    ctx.fillStyle = '#c8d3e0';
    ctx.fillText('Sleep en flick de vissen naar de juiste bak', W / 2, H * 0.48);
  }

  function drawGameOverOverlay() {
    ctx.fillStyle = 'rgba(5,8,12,0.82)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.font = '700 30px -apple-system, sans-serif';
    ctx.fillText('GAME OVER', W / 2, H * 0.36);

    ctx.font = '500 18px -apple-system, sans-serif';
    ctx.fillStyle = '#c8d3e0';
    ctx.fillText('Score: ' + score, W / 2, H * 0.44);
    ctx.fillText('High Score: ' + highScore, W / 2, H * 0.49);

    const r = restartButtonRect;
    ctx.fillStyle = '#1fd8c0';
    roundRect(r.x, r.y, r.w, r.h, 14);
    ctx.fill();
    ctx.fillStyle = '#04211d';
    ctx.font = '700 18px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('NOG EEN KEER', W / 2, r.y + r.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawFloorArea();
    drawTanks();

    const drawOrder = fishes.slice().sort(function (a, b) {
      return (a === draggingFish ? 1 : 0) - (b === draggingFish ? 1 : 0);
    });
    for (const f of drawOrder) drawFish(f);

    drawCatZone();
    drawParticles();
    drawTopBar();

    if (state === 'start') drawStartOverlay();
    else if (state === 'gameover') drawGameOverOverlay();
  }

  // ============================================================
  // Main loop
  // ============================================================
  let lastT = 0;
  function frame(t) {
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
