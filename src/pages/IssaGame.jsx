/**
 * IssaGame — goaloracle.io/issa-game
 *
 * "Bread to Toaster" — a simple, kid-friendly side-scrolling platformer.
 * You're a slice of bread hopping across the kitchen counter, dodging
 * knives and spills, climbing shelves, and racing to the toaster at the
 * end of each level. Level 4 is a rolling-pin boss.
 *
 * Self-contained HTML5 canvas game — no game-engine dependency, so it
 * can't destabilise the app. Physics constants + level data + the
 * "is this level beatable" validator live in src/games/breadToaster/*
 * and are covered by Vitest.
 *
 * Controls: web — arrow keys / A,D + Space (or W / Up) to jump.
 *           touch — on-screen left / right / jump buttons.
 *
 * Currently noindex (see VIEW_META in goaloracle.jsx) — flip to indexed
 * once we want it surfaced in search.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { LEVELS } from '../games/breadToaster/levels';
import {
  WORLD_HEIGHT, GROUND_Y, PLAYER_W, PLAYER_H,
  RUN_SPEED, GRAVITY, JUMP_SPEED, TERMINAL_VY, COYOTE_TIME,
} from '../games/breadToaster/constants';
import { sfx, resumeAudio, setMuted, startMusic, stopMusic } from '../games/breadToaster/sound';
import {
  TOAST_SKINS, KITCHEN_THEMES, DEFAULT_SKIN, DEFAULT_THEME, skinById, themeById,
} from '../games/breadToaster/cosmetics';

function useNoIndexMeta() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => { meta.parentNode?.removeChild(meta); };
  }, []);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function hazardRect(h) {
  // Hazards sit on the floor; data gives top-of-floor y + a height.
  return { x: h.x, y: h.y - h.h, w: h.w, h: h.h };
}

function bossPinRects(boss, t) {
  // Each rolling pin sweeps smoothly between x0 and x1.
  if (!boss?.pins) return [];
  return boss.pins.map((pin) => {
    const phase = 0.5 - 0.5 * Math.cos(t * pin.speed + (pin.phase || 0));
    const x = pin.x0 + (pin.x1 - pin.x0) * phase;
    return { x, y: GROUND_Y - pin.h, w: pin.w, h: pin.h };
  });
}

function toasterRect(goal) {
  // Toaster body sits on the goal surface.
  return { x: goal.x, y: goal.y - 64, w: 58, h: 64 };
}

function makeState(level) {
  return {
    level,
    player: {
      x: level.start.x,
      y: level.start.y - PLAYER_H,
      vy: 0,
      grounded: true,
      coyote: 0,
      facing: 1,
      jumpPrev: false,
      moving: false,
      runPhase: 0,
      blinkTimer: 2.5,
      blinkDur: 0,
    },
    cameraX: 0,
    t: 0,
    deadFlash: 0,
    finished: false,
  };
}

// ---------------------------------------------------------------------------
// Drawing (cartoon shapes, world space unless noted)
// ---------------------------------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBackground(ctx, w, h, cameraX, theme) {
  // Kitchen wall (screen space), tinted by the chosen theme.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, theme.wallTop);
  g.addColorStop(1, theme.wallBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // A cheerful window with sky, gently parallaxed.
  const px = -((cameraX * 0.25) % 520);
  for (let wx = px; wx < w; wx += 520) {
    ctx.fillStyle = theme.sky;
    roundRect(ctx, wx + 60, 40, 150, 110, 10);
    ctx.fill();
    ctx.fillStyle = theme.cloud;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(wx + 175, 70, 16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(wx + 155, 78, 12, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.frame;
    ctx.lineWidth = 6;
    ctx.strokeRect(wx + 60, 40, 150, 110);
    ctx.beginPath();
    ctx.moveTo(wx + 135, 40); ctx.lineTo(wx + 135, 150);
    ctx.moveTo(wx + 60, 95); ctx.lineTo(wx + 210, 95);
    ctx.stroke();
  }
}

function drawFloor(ctx, s) {
  const bottom = WORLD_HEIGHT;
  // Counter top
  ctx.fillStyle = '#e9c79b';
  ctx.fillRect(s.x, s.y, s.w, bottom - s.y);
  ctx.fillStyle = '#d8ad79';
  ctx.fillRect(s.x, s.y, s.w, 10);
  // Cabinet doors below
  ctx.strokeStyle = '#c79a64';
  ctx.lineWidth = 3;
  for (let dx = s.x + 20; dx < s.x + s.w - 20; dx += 120) {
    roundRect(ctx, dx, s.y + 26, 90, bottom - s.y - 50, 8);
    ctx.stroke();
  }
}

function drawPlatform(ctx, s) {
  // Wooden cutting-board shelf.
  ctx.fillStyle = '#caa472';
  roundRect(ctx, s.x, s.y, s.w, 24, 8);
  ctx.fill();
  ctx.fillStyle = '#b88f59';
  ctx.fillRect(s.x + 6, s.y + 6, s.w - 12, 4);
}

function drawKnife(ctx, r) {
  // Handle
  ctx.fillStyle = '#5b3b1a';
  roundRect(ctx, r.x + r.w / 2 - 5, r.y + r.h - 16, 10, 16, 3);
  ctx.fill();
  // Blade
  ctx.fillStyle = '#cdd6df';
  ctx.beginPath();
  ctx.moveTo(r.x + r.w / 2 - 6, r.y + r.h - 14);
  ctx.lineTo(r.x + r.w / 2 + 6, r.y + r.h - 14);
  ctx.lineTo(r.x + r.w / 2 + 4, r.y);
  ctx.lineTo(r.x + r.w / 2 - 6, r.y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#9aa6b1';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawPuddle(ctx, r) {
  ctx.fillStyle = '#7fc8ff';
  ctx.beginPath();
  ctx.ellipse(r.x + r.w / 2, r.y + r.h - 4, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#aee0ff';
  ctx.beginPath();
  ctx.ellipse(r.x + r.w / 2 - 6, r.y + r.h - 7, r.w / 6, r.h / 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawToaster(ctx, r, t) {
  // Bobbing slice of toast popping out.
  const pop = Math.sin(t * 3) * 3;
  ctx.fillStyle = '#caa15a';
  roundRect(ctx, r.x + 12, r.y - 16 + pop, 34, 22, 5);
  ctx.fill();
  // Body
  const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  g.addColorStop(0, '#e7edf3');
  g.addColorStop(1, '#b9c4d0');
  ctx.fillStyle = g;
  roundRect(ctx, r.x, r.y, r.w, r.h, 12);
  ctx.fill();
  // Slots
  ctx.fillStyle = '#3a4654';
  roundRect(ctx, r.x + 10, r.y + 8, 38, 8, 4);
  ctx.fill();
  // Lever + dial
  ctx.fillStyle = '#8b97a4';
  roundRect(ctx, r.x + r.w - 6, r.y + 18, 8, 16, 3);
  ctx.fill();
  ctx.fillStyle = '#5a6675';
  ctx.beginPath(); ctx.arc(r.x + 14, r.y + 44, 6, 0, Math.PI * 2); ctx.fill();
  // Feet
  ctx.fillStyle = '#8b97a4';
  ctx.fillRect(r.x + 6, r.y + r.h, 8, 5);
  ctx.fillRect(r.x + r.w - 14, r.y + r.h, 8, 5);
}

function drawRollingPin(ctx, r, t) {
  // Handles
  ctx.fillStyle = '#a9794a';
  roundRect(ctx, r.x - 14, r.y + r.h / 2 - 6, 16, 12, 4);
  ctx.fill();
  roundRect(ctx, r.x + r.w - 2, r.y + r.h / 2 - 6, 16, 12, 4);
  ctx.fill();
  // Barrel
  const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  g.addColorStop(0, '#e8c596');
  g.addColorStop(1, '#c79a64');
  ctx.fillStyle = g;
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  // Rolling grain lines
  ctx.strokeStyle = 'rgba(120,80,40,0.4)';
  ctx.lineWidth = 2;
  const off = (t * 120) % 24;
  for (let lx = r.x - 24 + off; lx < r.x + r.w; lx += 24) {
    if (lx < r.x + 4 || lx > r.x + r.w - 4) continue;
    ctx.beginPath(); ctx.moveTo(lx, r.y + 5); ctx.lineTo(lx, r.y + r.h - 5); ctx.stroke();
  }
  // Angry boss eyebrows
  ctx.strokeStyle = '#5b3b1a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(r.x + 18, r.y + 8); ctx.lineTo(r.x + 30, r.y + 14);
  ctx.moveTo(r.x + r.w - 18, r.y + 8); ctx.lineTo(r.x + r.w - 30, r.y + 14);
  ctx.stroke();
}

function drawBread(ctx, p, t, skin) {
  const airborne = !p.grounded;
  const running = p.grounded && p.moving;
  const swing = running ? Math.sin(p.runPhase) : 0;

  // Squash & stretch from vertical speed + a little run bob.
  const stretch = Math.max(-0.18, Math.min(0.18, -p.vy / 4000));
  const bob = running ? Math.abs(Math.cos(p.runPhase)) * 2 : 0;
  const w = PLAYER_W * (1 - stretch);
  const h = PLAYER_H * (1 + stretch);
  const ox = p.x + (PLAYER_W - w) / 2;
  const oy = p.y + (PLAYER_H - h) - bob;
  const dir = p.facing >= 0 ? 1 : -1;

  ctx.save();

  // --- Arms (behind body) — raise up when jumping, swing when running.
  ctx.strokeStyle = '#caa05a';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  const armY = oy + h * 0.55;
  if (airborne) {
    ctx.beginPath(); ctx.moveTo(ox + 4, armY); ctx.lineTo(ox - 4, oy + h * 0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox + w - 4, armY); ctx.lineTo(ox + w + 4, oy + h * 0.3); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(ox + 4, armY); ctx.lineTo(ox - 3, armY + 6 + swing * 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox + w - 4, armY); ctx.lineTo(ox + w + 3, armY + 6 - swing * 3); ctx.stroke();
  }

  // --- Feet — alternate while running, tuck together in the air.
  ctx.fillStyle = skin.foot;
  const footW = 9, footH = 6;
  const footBase = oy + h;
  if (airborne) {
    ctx.beginPath(); ctx.ellipse(ox + w * 0.34, footBase - 3, footW / 2, footH / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ox + w * 0.66, footBase - 3, footW / 2, footH / 2, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    const lLift = Math.max(0, swing) * 6;
    const rLift = Math.max(0, -swing) * 6;
    ctx.beginPath(); ctx.ellipse(ox + w * 0.34, footBase - lLift, footW / 2, footH / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ox + w * 0.66, footBase - rLift, footW / 2, footH / 2, 0, 0, Math.PI * 2); ctx.fill();
  }

  // --- Body: crust on top, soft bread inside.
  ctx.fillStyle = skin.crust;
  ctx.beginPath();
  ctx.moveTo(ox, oy + h * 0.45);
  ctx.arc(ox + w * 0.3, oy + h * 0.42, w * 0.3, Math.PI, 0);
  ctx.arc(ox + w * 0.7, oy + h * 0.42, w * 0.3, Math.PI, 0);
  ctx.lineTo(ox + w, oy + h);
  ctx.lineTo(ox, oy + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = skin.inside;
  roundRect(ctx, ox + 3, oy + h * 0.42, w - 6, h * 0.58 - 3, 6);
  ctx.fill();
  // Optional grainy seeds (e.g. wheat).
  if (skin.seeds) {
    ctx.fillStyle = 'rgba(90,60,30,0.5)';
    const seedY = oy + h * 0.5;
    for (const sx of [0.3, 0.5, 0.7, 0.42, 0.6]) {
      ctx.beginPath();
      ctx.ellipse(ox + w * sx, seedY + (sx * 11 % 5), 1.6, 1, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Face (looks toward travel direction).
  const cx = ox + w / 2 + dir * 4;
  const ey = oy + h * 0.62;
  const blinking = p.blinkDur > 0;
  ctx.strokeStyle = '#3a2a18';
  ctx.fillStyle = '#3a2a18';
  if (blinking) {
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 10, ey); ctx.lineTo(cx - 4, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 4, ey); ctx.lineTo(cx + 10, ey); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(cx - 7, ey, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 7, ey, 3.2, 0, Math.PI * 2); ctx.fill();
  }
  // Mouth: open "o" of excitement mid-jump, smile on the ground.
  ctx.lineWidth = 2;
  if (airborne) {
    ctx.beginPath(); ctx.arc(cx, ey + 7, 3.2, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(cx, ey + 4, 6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  // Cheeks
  ctx.fillStyle = 'rgba(255,150,120,0.5)';
  ctx.beginPath(); ctx.arc(cx - 13, ey + 4, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 13, ey + 4, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function IssaGame() {
  useNoIndexMeta();
  const [screen, setScreen] = useState('title'); // title | playing | levelclear | won
  const [levelIndex, setLevelIndex] = useState(0);
  const [deaths, setDeaths] = useState(0);
  const [muted, setMutedState] = useState(false);

  const readStored = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const [skinId, setSkinId] = useState(() => readStored('issa_toast', DEFAULT_SKIN.id));
  const [themeId, setThemeId] = useState(() => readStored('issa_kitchen', DEFAULT_THEME.id));
  const skinRef = useRef(skinById(skinId));
  const themeRef = useRef(themeById(themeId));
  useEffect(() => { skinRef.current = skinById(skinId); try { localStorage.setItem('issa_toast', skinId); } catch { /* ignore */ } }, [skinId]);
  useEffect(() => { themeRef.current = themeById(themeId); try { localStorage.setItem('issa_kitchen', themeId); } catch { /* ignore */ } }, [themeId]);

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const gameRef = useRef(null);
  const rafRef = useRef(0);
  const inputRef = useRef({ left: false, right: false, jumpHeld: false });
  const deathsRef = useRef(0);

  const finishLevel = useCallback((isBoss) => {
    setScreen(isBoss ? 'won' : 'levelclear');
  }, []);

  // Keyboard input
  useEffect(() => {
    const down = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') { inputRef.current.left = true; e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { inputRef.current.right = true; e.preventDefault(); }
      else if (k === ' ' || k === 'arrowup' || k === 'w' || k === 'spacebar') { inputRef.current.jumpHeld = true; e.preventDefault(); }
    };
    const up = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') inputRef.current.left = false;
      else if (k === 'arrowright' || k === 'd') inputRef.current.right = false;
      else if (k === ' ' || k === 'arrowup' || k === 'w' || k === 'spacebar') inputRef.current.jumpHeld = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Background music: plays while actively in a level (incl. the brief
  // level-clear screen), pauses on title/win so the fanfare stands out.
  useEffect(() => {
    if (screen === 'playing' || screen === 'levelclear') startMusic();
    else stopMusic();
  }, [screen]);

  // Stop music if the page unmounts (navigating away).
  useEffect(() => () => stopMusic(), []);

  // Main game loop — runs only while playing the current level.
  useEffect(() => {
    if (screen !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const level = LEVELS[levelIndex];
    gameRef.current = makeState(level);

    // Keep the canvas backing store matched to its displayed size + DPR.
    const resize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);

    let last = performance.now();

    const loop = (now) => {
      const g = gameRef.current;
      if (!g) return;
      // Clamp dt so a backgrounded tab can't fling the player through walls.
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;

      const scale = canvas.height / WORLD_HEIGHT;
      const visibleW = canvas.width / scale;

      if (!g.finished) update(g, dt, visibleW);

      // ---- render ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawBackground(ctx, canvas.width, canvas.height, g.cameraX * scale, themeRef.current || DEFAULT_THEME);

      ctx.setTransform(scale, 0, 0, scale, -g.cameraX * scale, 0);

      for (const s of level.surfaces) {
        if (s.y >= GROUND_Y) drawFloor(ctx, s); else drawPlatform(ctx, s);
      }
      for (const h of level.hazards || []) {
        const r = hazardRect(h);
        if (h.type === 'puddle') drawPuddle(ctx, r); else drawKnife(ctx, r);
      }
      drawToaster(ctx, toasterRect(level.goal), g.t);
      if (level.boss) for (const r of bossPinRects(level.boss, g.t)) drawRollingPin(ctx, r, g.t);
      drawBread(ctx, g.player, g.t, skinRef.current || DEFAULT_SKIN);

      // Red flash on death.
      if (g.deadFlash > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(255,70,70,${Math.min(0.5, g.deadFlash)})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    function update(g, dt, visibleW) {
      g.t += dt;
      const p = g.player;
      const inp = inputRef.current;

      // Horizontal
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (dir !== 0) p.facing = dir;
      p.x += dir * RUN_SPEED * dt;
      p.x = Math.max(0, Math.min(level.width - PLAYER_W, p.x));

      // Animation state: run cycle + occasional blink.
      p.moving = dir !== 0;
      if (p.moving && p.grounded) p.runPhase += dt * 11;
      p.blinkTimer -= dt;
      if (p.blinkTimer <= 0 && p.blinkDur <= 0) { p.blinkDur = 0.12; p.blinkTimer = 2.2 + Math.random() * 2.5; }
      if (p.blinkDur > 0) p.blinkDur = Math.max(0, p.blinkDur - dt);

      // Jump (edge-triggered, with coyote time)
      const jumpPressed = inp.jumpHeld && !p.jumpPrev;
      if (jumpPressed && (p.grounded || p.coyote > 0)) {
        p.vy = -JUMP_SPEED;
        p.grounded = false;
        p.coyote = 0;
        sfx.jump();
      }
      p.jumpPrev = inp.jumpHeld;

      // Gravity + swept vertical move
      p.vy = Math.min(p.vy + GRAVITY * dt, TERMINAL_VY);
      const prevBottom = p.y + PLAYER_H;
      p.y += p.vy * dt;
      const newBottom = p.y + PLAYER_H;

      const wasGrounded = p.grounded;
      p.grounded = false;
      if (p.vy >= 0) {
        // Land on the highest surface our feet swept through this frame.
        let landTop = null;
        for (const s of level.surfaces) {
          const horiz = p.x + PLAYER_W > s.x && p.x < s.x + s.w;
          if (!horiz) continue;
          if (prevBottom <= s.y + 1 && newBottom >= s.y) {
            if (landTop === null || s.y < landTop) landTop = s.y;
          }
        }
        if (landTop !== null) {
          p.y = landTop - PLAYER_H;
          p.vy = 0;
          p.grounded = true;
        }
      }
      // Coyote countdown
      if (p.grounded) p.coyote = COYOTE_TIME;
      else if (wasGrounded) p.coyote = COYOTE_TIME;
      else p.coyote = Math.max(0, p.coyote - dt);

      if (g.deadFlash > 0) g.deadFlash = Math.max(0, g.deadFlash - dt * 2);

      // Hazards
      let dead = false;
      for (const h of level.hazards || []) {
        const r = hazardRect(h);
        if (overlap(p.x + 4, p.y + 4, PLAYER_W - 8, PLAYER_H - 6, r.x, r.y, r.w, r.h)) dead = true;
      }
      if (level.boss) {
        for (const r of bossPinRects(level.boss, g.t)) {
          if (overlap(p.x + 4, p.y + 4, PLAYER_W - 8, PLAYER_H - 6, r.x, r.y, r.w, r.h)) dead = true;
        }
      }
      // Fell into a pit
      if (p.y > WORLD_HEIGHT + 80) dead = true;

      if (dead) {
        sfx.die();
        deathsRef.current += 1;
        setDeaths(deathsRef.current);
        // Respawn at the level start.
        p.x = level.start.x;
        p.y = level.start.y - PLAYER_H;
        p.vy = 0;
        p.grounded = true;
        g.deadFlash = 0.5;
        return;
      }

      // Reached the toaster?
      const tr = toasterRect(level.goal);
      if (overlap(p.x, p.y, PLAYER_W, PLAYER_H, tr.x, tr.y, tr.w, tr.h)) {
        g.finished = true;
        if (level.isBoss) sfx.win(); else sfx.levelClear();
        finishLevel(!!level.isBoss);
        return;
      }

      // Camera follows, clamped to the level.
      const target = p.x + PLAYER_W / 2 - visibleW / 2;
      const maxCam = Math.max(0, level.width - visibleW);
      const clamped = Math.max(0, Math.min(maxCam, target));
      g.cameraX += (clamped - g.cameraX) * Math.min(1, dt * 8);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [screen, levelIndex, finishLevel]);

  // Touch / pointer button helpers
  const press = (key, val) => (e) => {
    e.preventDefault();
    if (key === 'jump') inputRef.current.jumpHeld = val;
    else inputRef.current[key] = val;
  };

  const toggleMute = () => {
    setMutedState((m) => { const next = !m; setMuted(next); return next; });
  };

  const startGame = () => {
    resumeAudio();
    sfx.start();
    deathsRef.current = 0;
    setDeaths(0);
    setLevelIndex(0);
    setScreen('playing');
  };
  const nextLevel = () => { setLevelIndex((i) => i + 1); setScreen('playing'); };
  const restartLevel = () => { setScreen('title'); setTimeout(() => setScreen('playing'), 0); };

  const level = LEVELS[levelIndex];

  return (
    <div className="ig-page">
      <style>{IG_CSS}</style>

      <div className="ig-shell">
        <div className="ig-topbar">
          <span className="ig-brand">🍞 Bread to Toaster</span>
          <div className="ig-topright">
            {screen === 'playing' && (
              <span className="ig-status">Level {levelIndex + 1}/{LEVELS.length} · Tries: {deaths}</span>
            )}
            <button className="ig-mute" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </div>

        <div className="ig-stage" ref={wrapRef}>
          <canvas ref={canvasRef} className="ig-canvas" />

          {/* On-screen touch controls (also clickable on desktop) */}
          {screen === 'playing' && (
            <div className="ig-controls">
              <div className="ig-dpad">
                <button
                  className="ig-btn" aria-label="Move left"
                  onPointerDown={press('left', true)} onPointerUp={press('left', false)}
                  onPointerLeave={press('left', false)} onPointerCancel={press('left', false)}
                >◀</button>
                <button
                  className="ig-btn" aria-label="Move right"
                  onPointerDown={press('right', true)} onPointerUp={press('right', false)}
                  onPointerLeave={press('right', false)} onPointerCancel={press('right', false)}
                >▶</button>
              </div>
              <button
                className="ig-btn ig-jump" aria-label="Jump"
                onPointerDown={press('jump', true)} onPointerUp={press('jump', false)}
                onPointerLeave={press('jump', false)} onPointerCancel={press('jump', false)}
              >JUMP</button>
            </div>
          )}

          {/* Title screen */}
          {screen === 'title' && (
            <div className="ig-overlay">
              <div className="ig-card">
                <div className="ig-bigbread">🍞</div>
                <h1>Bread to Toaster</h1>
                <p>Hop across the kitchen, dodge the knives and spills, and reach the toaster. Beat all the levels to take on the rolling-pin boss!</p>

                <div className="ig-picker">
                  <div className="ig-picker-label">Your toast</div>
                  <div className="ig-swatches">
                    {TOAST_SKINS.map((s) => (
                      <button
                        key={s.id}
                        className={`ig-swatch${skinId === s.id ? ' sel' : ''}`}
                        onClick={() => setSkinId(s.id)}
                        type="button"
                      >
                        <span className="ig-dot" style={{ background: s.crust, borderColor: s.inside }} />
                        {s.name}
                      </button>
                    ))}
                  </div>
                  <div className="ig-picker-label">Your kitchen</div>
                  <div className="ig-swatches">
                    {KITCHEN_THEMES.map((th) => (
                      <button
                        key={th.id}
                        className={`ig-swatch${themeId === th.id ? ' sel' : ''}`}
                        onClick={() => setThemeId(th.id)}
                        type="button"
                      >
                        <span className="ig-dot" style={{ background: `linear-gradient(${th.wallBottom}, ${th.sky})`, borderColor: th.frame }} />
                        {th.name}
                      </button>
                    ))}
                  </div>
                </div>

                <button className="ig-cta" onClick={startGame}>Start</button>
                <p className="ig-hint">Move: ◀ ▶ or arrow keys · Jump: JUMP or Space</p>
              </div>
            </div>
          )}

          {/* Level clear */}
          {screen === 'levelclear' && (
            <div className="ig-overlay">
              <div className="ig-card">
                <div className="ig-bigbread">🎉</div>
                <h1>Level {levelIndex + 1} clear!</h1>
                <p>Next up: {LEVELS[levelIndex + 1]?.name}</p>
                <button className="ig-cta" onClick={nextLevel}>Next level</button>
              </div>
            </div>
          )}

          {/* Win */}
          {screen === 'won' && (
            <div className="ig-overlay">
              <div className="ig-card">
                <div className="ig-bigbread">🏆🍞</div>
                <h1>Toasty victory!</h1>
                <p>You beat the rolling-pin boss in {deaths} tr{deaths === 1 ? 'y' : 'ies'}. You&rsquo;re officially golden brown.</p>
                <button className="ig-cta" onClick={startGame}>Play again</button>
              </div>
            </div>
          )}
        </div>

        {screen === 'playing' && (
          <div className="ig-footer">
            <button className="ig-link" onClick={restartLevel}>Restart level</button>
            <span className="ig-level-name">{level?.name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const IG_CSS = `
.ig-page {
  min-height: 100vh;
  background: #0b0f1a;
  color: #f5f7fb;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
.ig-shell {
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ig-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ig-brand { font-weight: 800; font-size: 1.05rem; }
.ig-topright { display: flex; align-items: center; gap: 12px; }
.ig-status { font-size: 0.9rem; color: #aab3c5; }
.ig-mute {
  background: rgba(255,255,255,0.08);
  border: none; cursor: pointer;
  width: 34px; height: 34px; border-radius: 8px;
  font-size: 1rem; line-height: 1;
}
.ig-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  background: #f6e2c4;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
  touch-action: none;
  user-select: none;
}
.ig-canvas { display: block; width: 100%; height: 100%; }

.ig-controls {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 14px 16px;
  pointer-events: none;
}
.ig-dpad { display: flex; gap: 10px; pointer-events: auto; }
.ig-btn {
  pointer-events: auto;
  width: 64px; height: 64px;
  border-radius: 50%;
  border: none;
  background: rgba(20,24,38,0.55);
  color: #fff;
  font-size: 1.4rem;
  font-weight: 800;
  cursor: pointer;
  backdrop-filter: blur(4px);
  touch-action: none;
}
.ig-btn:active { background: rgba(20,24,38,0.8); transform: scale(0.95); }
.ig-jump {
  width: 84px; height: 84px;
  font-size: 1rem;
  background: rgba(227,168,87,0.9);
  color: #2a1c08;
}

.ig-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8,11,20,0.55);
  backdrop-filter: blur(3px);
  padding: 20px;
}
.ig-card {
  background: #11162a;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 18px;
  padding: 26px 24px;
  max-width: 420px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.ig-bigbread { font-size: 3rem; line-height: 1; margin-bottom: 6px; }
.ig-card h1 { margin: 4px 0 8px; font-size: 1.6rem; }
.ig-card p { margin: 0 0 14px; color: #c3ccdc; font-size: 0.98rem; line-height: 1.45; }
.ig-cta {
  appearance: none; border: none; cursor: pointer;
  background: #e3a857; color: #2a1c08;
  font-weight: 800; font-size: 1.1rem;
  padding: 12px 30px; border-radius: 999px;
}
.ig-cta:active { transform: translateY(1px); }
.ig-hint { margin-top: 14px !important; font-size: 0.82rem !important; color: #8893a8 !important; }

.ig-picker { margin: 6px 0 16px; text-align: left; }
.ig-picker-label {
  font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em;
  color: #8893a8; margin: 10px 0 6px;
}
.ig-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.ig-swatch {
  display: inline-flex; align-items: center; gap: 7px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: #e7ecf5; cursor: pointer;
  font-size: 0.85rem; font-weight: 600;
  padding: 6px 11px 6px 7px; border-radius: 999px;
}
.ig-swatch.sel { border-color: #e3a857; background: rgba(227,168,87,0.18); }
.ig-dot {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid; display: inline-block; flex: none;
}

.ig-footer {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 0.85rem; color: #aab3c5;
}
.ig-link {
  background: none; border: none; color: #e3a857; cursor: pointer;
  font-size: 0.85rem; padding: 0; font-weight: 700;
}
.ig-level-name { color: #8893a8; }

@media (max-width: 600px) {
  .ig-stage { aspect-ratio: 4 / 3; }
  .ig-btn { width: 58px; height: 58px; }
  .ig-jump { width: 76px; height: 76px; }
}
`;
