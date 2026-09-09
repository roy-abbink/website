(function () {
  'use strict';

  var GAME_WIDTH = 874;
  var GAME_HEIGHT = 402;
  var BALL_SIZE = 44;
  var LEFT_ZONE_END = GAME_WIDTH * 0.2;
  var RIGHT_ZONE_START = GAME_WIDTH * 0.8;
  var BALL_LIFETIME_MS = 10000;
  var BLINK_SLOW_AT_MS = 5000;
  var BLINK_FAST_AT_MS = 7500;
  var INITIAL_SPAWN_INTERVAL_MS = 2000;
  var SPAWN_SPEEDUP_PERIOD_MS = 10000;
  var SPAWN_SPEEDUP_FACTOR = 0.9;
  var MAX_LIVES = 3;
  var BALL_SPEED_MIN = 40;
  var BALL_SPEED_MAX = 80;

  var gameEl = document.getElementById('game');
  var livesHud = document.getElementById('lives-hud');
  var scoreHud = document.getElementById('score-hud');
  var startOverlayEl = document.getElementById('start-overlay');
  var gameOverOverlayEl = document.getElementById('game-over-overlay');
  var finalScoreEl = document.getElementById('final-score');
  var startBtn = document.getElementById('start-btn');
  var restartBtn = document.getElementById('restart-btn');
  var zoneEls = Array.prototype.slice.call(gameEl.querySelectorAll('.zone'));

  var state = null;
  var animationFrameId = null;
  var lastFrameTs = null;

  function createState() {
    return {
      score: 0,
      explosions: 0,
      running: false,
      gameOver: false,
      startTime: 0,
      spawnTimeoutId: null,
      balls: {},
      nextBallId: 1
    };
  }

  function computeSpawnInterval(elapsedMs) {
    var period = Math.floor(elapsedMs / SPAWN_SPEEDUP_PERIOD_MS);
    return INITIAL_SPAWN_INTERVAL_MS * Math.pow(SPAWN_SPEEDUP_FACTOR, period);
  }

  function updateHud() {
    var livesLeft = Math.max(0, MAX_LIVES - state.explosions);
    livesHud.textContent = 'Levens: ' + livesLeft;
    scoreHud.textContent = String(state.score);
  }

  function zoneForCenterX(centerX) {
    if (centerX < LEFT_ZONE_END) return 'left';
    if (centerX > RIGHT_ZONE_START) return 'right';
    return 'middle';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function randomVelocity() {
    var angle = Math.random() * Math.PI * 2;
    var speed = BALL_SPEED_MIN + Math.random() * (BALL_SPEED_MAX - BALL_SPEED_MIN);
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed
    };
  }

  function spawnBall() {
    if (state.gameOver) return;

    var color = Math.random() < 0.5 ? 'blue' : 'red';
    var minX = LEFT_ZONE_END;
    var maxX = RIGHT_ZONE_START - BALL_SIZE;
    var x = minX + Math.random() * (maxX - minX);
    var y = Math.random() * (GAME_HEIGHT - BALL_SIZE);
    var velocity = randomVelocity();

    var id = state.nextBallId++;
    var el = document.createElement('div');
    el.className = 'ball ball-' + color;
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    var visual = document.createElement('div');
    visual.className = 'ball-visual';
    el.appendChild(visual);

    gameEl.appendChild(el);

    var ball = {
      id: id,
      color: color,
      el: el,
      x: x,
      y: y,
      vx: velocity.vx,
      vy: velocity.vy,
      dragging: false,
      spawnTime: performance.now(),
      status: 'alive',
      timeouts: []
    };
    state.balls[id] = ball;

    ball.timeouts.push(setTimeout(function () {
      if (ball.status === 'alive') el.classList.add('blink-slow');
    }, BLINK_SLOW_AT_MS));

    ball.timeouts.push(setTimeout(function () {
      if (ball.status === 'alive') {
        el.classList.remove('blink-slow');
        el.classList.add('blink-fast');
      }
    }, BLINK_FAST_AT_MS));

    ball.timeouts.push(setTimeout(function () {
      if (ball.status === 'alive') explodeBall(ball);
    }, BALL_LIFETIME_MS));

    attachDragHandlers(ball);
  }

  function clearBallTimeouts(ball) {
    ball.timeouts.forEach(function (t) { clearTimeout(t); });
    ball.timeouts.length = 0;
  }

  function removeBall(ball) {
    clearBallTimeouts(ball);
    delete state.balls[ball.id];
    if (ball.el.parentNode) ball.el.parentNode.removeChild(ball.el);
  }

  function spawnExplosionFx(centerX, centerY) {
    var fx = document.createElement('div');
    fx.className = 'explosion-fx';
    fx.style.left = centerX + 'px';
    fx.style.top = centerY + 'px';
    gameEl.appendChild(fx);
    setTimeout(function () {
      if (fx.parentNode) fx.parentNode.removeChild(fx);
    }, 450);
  }

  function spawnScorePopup(centerX, centerY, points) {
    var popup = document.createElement('div');
    popup.className = 'score-popup';
    popup.style.left = centerX + 'px';
    popup.style.top = centerY + 'px';
    popup.textContent = '+' + points;
    gameEl.appendChild(popup);
    setTimeout(function () {
      if (popup.parentNode) popup.parentNode.removeChild(popup);
    }, 850);
  }

  function explodeBall(ball) {
    if (ball.status !== 'alive') return;
    ball.status = 'exploding';
    clearBallTimeouts(ball);

    var centerX = ball.x + BALL_SIZE / 2;
    var centerY = ball.y + BALL_SIZE / 2;
    spawnExplosionFx(centerX, centerY);

    ball.el.classList.add('exploding');
    setTimeout(function () { removeBall(ball); }, 350);

    state.explosions++;
    updateHud();

    if (state.explosions > MAX_LIVES) {
      endGame();
    }
  }

  function resolveBallSuccess(ball) {
    if (ball.status !== 'alive') return;
    ball.status = 'resolved';
    clearBallTimeouts(ball);

    var elapsed = performance.now() - ball.spawnTime;
    var remaining = Math.max(0, BALL_LIFETIME_MS - elapsed);
    var points = Math.round(remaining / 100);
    state.score += points;
    updateHud();

    var centerX = ball.x + BALL_SIZE / 2;
    var centerY = ball.y + BALL_SIZE / 2;
    spawnScorePopup(centerX, centerY, points);

    removeBall(ball);
  }

  function highlightZone(zoneName) {
    zoneEls.forEach(function (z) {
      z.classList.toggle('zone-highlight', z.dataset.zone === zoneName && zoneName !== 'middle');
    });
  }

  function attachDragHandlers(ball) {
    var el = ball.el;
    var dragOffsetX = 0;
    var dragOffsetY = 0;

    function onPointerDown(evt) {
      if (state.gameOver || ball.status !== 'alive') return;
      evt.preventDefault();
      var rect = gameEl.getBoundingClientRect();
      var pointerX = evt.clientX - rect.left;
      var pointerY = evt.clientY - rect.top;
      dragOffsetX = pointerX - ball.x;
      dragOffsetY = pointerY - ball.y;
      ball.dragging = true;
      el.classList.add('dragging');
      el.setPointerCapture(evt.pointerId);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(evt) {
      if (ball.status !== 'alive') return;
      var rect = gameEl.getBoundingClientRect();
      var pointerX = evt.clientX - rect.left;
      var pointerY = evt.clientY - rect.top;
      var newX = clamp(pointerX - dragOffsetX, 0, GAME_WIDTH - BALL_SIZE);
      var newY = clamp(pointerY - dragOffsetY, 0, GAME_HEIGHT - BALL_SIZE);
      ball.x = newX;
      ball.y = newY;
      el.style.left = newX + 'px';
      el.style.top = newY + 'px';

      var centerX = newX + BALL_SIZE / 2;
      highlightZone(zoneForCenterX(centerX));
    }

    function onPointerUp(evt) {
      ball.dragging = false;
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      try { el.releasePointerCapture(evt.pointerId); } catch (e) { /* noop */ }
      highlightZone(null);

      if (ball.status !== 'alive') return;

      var centerX = ball.x + BALL_SIZE / 2;
      var zone = zoneForCenterX(centerX);

      if (zone === 'left') {
        if (ball.color === 'blue') resolveBallSuccess(ball);
        else explodeBall(ball);
      } else if (zone === 'right') {
        if (ball.color === 'red') resolveBallSuccess(ball);
        else explodeBall(ball);
      }
      // zone === 'middle': ball stays alive and keeps bouncing
    }

    el.addEventListener('pointerdown', onPointerDown);
  }

  function moveBall(ball, dt) {
    var minX = LEFT_ZONE_END;
    var maxX = RIGHT_ZONE_START - BALL_SIZE;
    var minY = 0;
    var maxY = GAME_HEIGHT - BALL_SIZE;

    var newX = ball.x + ball.vx * dt;
    var newY = ball.y + ball.vy * dt;

    if (newX < minX) {
      newX = minX;
      ball.vx = Math.abs(ball.vx);
    } else if (newX > maxX) {
      newX = maxX;
      ball.vx = -Math.abs(ball.vx);
    }

    if (newY < minY) {
      newY = minY;
      ball.vy = Math.abs(ball.vy);
    } else if (newY > maxY) {
      newY = maxY;
      ball.vy = -Math.abs(ball.vy);
    }

    ball.x = newX;
    ball.y = newY;
    ball.el.style.left = newX + 'px';
    ball.el.style.top = newY + 'px';
  }

  function animate(ts) {
    if (!state || !state.running || state.gameOver) {
      animationFrameId = null;
      return;
    }
    if (lastFrameTs === null) lastFrameTs = ts;
    var dt = (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;

    Object.keys(state.balls).forEach(function (id) {
      var ball = state.balls[id];
      if (ball.status !== 'alive' || ball.dragging) return;
      moveBall(ball, dt);
    });

    animationFrameId = requestAnimationFrame(animate);
  }

  function scheduleNextSpawn() {
    if (state.gameOver) return;
    var elapsed = performance.now() - state.startTime;
    var interval = computeSpawnInterval(elapsed);
    state.spawnTimeoutId = setTimeout(function () {
      spawnBall();
      scheduleNextSpawn();
    }, interval);
  }

  function endGame() {
    if (state.gameOver) return;
    state.gameOver = true;
    state.running = false;
    if (state.spawnTimeoutId) clearTimeout(state.spawnTimeoutId);

    Object.keys(state.balls).forEach(function (id) {
      var ball = state.balls[id];
      clearBallTimeouts(ball);
      if (ball.el.parentNode) ball.el.parentNode.removeChild(ball.el);
    });
    state.balls = {};

    finalScoreEl.textContent = String(state.score);
    gameOverOverlayEl.classList.remove('hidden');
  }

  function resetBoard() {
    var stray = gameEl.querySelectorAll('.ball, .explosion-fx, .score-popup');
    Array.prototype.forEach.call(stray, function (n) { n.remove(); });
  }

  function startGame() {
    state = createState();
    state.startTime = performance.now();
    state.running = true;
    updateHud();
    startOverlayEl.classList.add('hidden');
    gameOverOverlayEl.classList.add('hidden');
    resetBoard();

    lastFrameTs = null;
    if (animationFrameId === null) {
      animationFrameId = requestAnimationFrame(animate);
    }

    scheduleNextSpawn();
  }

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  state = createState();
  updateHud();
})();
