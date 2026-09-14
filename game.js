/* =============================================================================
   GHOST ESCAPE — Level 1 prototype
   Vanilla HTML5 / Canvas. No dependencies.

   Systems in this file, in order:
     0. Constants + math helpers
     1. SFX          — tiny Web Audio blip synth (lazy, user-gesture safe)
     2. Particles    — one flat particle pool
     3. Input        — keyboard + invisible drag-to-move + action buttons
     4. Collision    — circle vs AABB / circle, swept-ish resolve
     5. Entities     — Ghost, Possessable(Lamp/ToyCar/Fan), PressurePlate,
                       ExitDoor, LightHazard
     6. Level        — the single room for level 1
     7. Render       — procedural cozy room drawing
     8. Game         — state machine, loop, UI glue
   ============================================================================= */
(() => {
'use strict';

/* =============================================================================
   0. CONSTANTS + HELPERS
   ============================================================================= */

const W = 540, H = 960;                               // logical design size (9:16)
const ROOM = { x0: 24, y0: 24, x1: 516, y1: 936 };    // playable interior
const DIV  = { y0: 520, y1: 548, gx0: 228, gx1: 330 };// divider wall + doorway gap
const DOOR = { x0: 202, x1: 286 };                    // exit opening in the top wall

const DANGER_TIME  = 1.5;   // seconds in light before the level restarts
const POSSESS_DIST = 82;    // how close the ghost must be to possess

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const dist  = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const rand  = (a, b) => a + Math.random() * (b - a);
const pick  = arr => arr[(Math.random() * arr.length) | 0];

// frame-rate independent smoothing: how much of the way to `to` we travel in dt
const smooth = (dt, per) => 1 - Math.pow(per, dt);

function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d >  Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rounded-rect path (hand rolled: Safari support for ctx.roundRect is recent). */
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Soft elliptical drop shadow used under every prop. */
function softShadow(ctx, x, y, rx, ry, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, 'rgba(0,0,0,' + (a === undefined ? 0.38 : a) + ')');
  g.addColorStop(0.6, 'rgba(0,0,0,' + (a === undefined ? 0.18 : a * 0.45) + ')');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/* =============================================================================
   1. SFX — placeholder Web Audio blips. Never blocks the game if unavailable.
   ============================================================================= */

const SFX = {
  ctx: null, master: null, ok: false, muted: false,

  init() {                                  // called from the first user gesture
    if (this.ok) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      this.ok = true;
    } catch (e) { this.ok = false; }
  },
  resume() {
    if (this.ok && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  tone(freq, dur, type, vol, slideTo, delay) {
    if (!this.ok || this.muted) return;
    try {
      const t = this.ctx.currentTime + (delay || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.02, vol === undefined ? 0.4 : vol), t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.03);
    } catch (e) { /* audio must never break the game */ }
  },
  noise(dur, vol) {
    if (!this.ok || this.muted) return;
    try {
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = this.ctx.createBufferSource(); s.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = this.ctx.createGain(); g.gain.value = vol || 0.25;
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start();
    } catch (e) {}
  },

  possess()  { this.tone(300, 0.28, 'sine', 0.35, 760); this.tone(600, 0.22, 'triangle', 0.12, 1200, 0.03); },
  release()  { this.tone(720, 0.22, 'sine', 0.3, 320); },
  toggleOn() { this.tone(420, 0.12, 'square', 0.12); this.tone(640, 0.14, 'sine', 0.18, 0, 0.05); },
  toggleOff(){ this.tone(320, 0.16, 'square', 0.12, 160); },
  plate()    { this.tone(392, 0.14, 'triangle', 0.3); this.tone(587, 0.22, 'triangle', 0.26, 0, 0.09); },
  unlock()   { [523, 659, 784].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.3, 0, i * 0.09)); this.noise(0.25, 0.12); },
  hurt()     { this.tone(180, 0.3, 'sawtooth', 0.16, 90); },
  key()      { [784, 1046, 1318].forEach((f, i) => this.tone(f, 0.26, 'triangle', 0.26, 0, i * 0.06)); },
  locked()   { this.tone(150, 0.11, 'square', 0.13); this.tone(115, 0.15, 'square', 0.11, 0, 0.09); },
  fail()     { this.tone(330, 0.5, 'sine', 0.3, 110); this.noise(0.4, 0.18); },
  win()      { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.45, 'sine', 0.32, 0, i * 0.11)); },
  step()     { this.tone(rand(600, 900), 0.05, 'sine', 0.05); }
};

/* =============================================================================
   2. PARTICLES — single pool, drawn additively for the glowy ones
   ============================================================================= */

const Particles = {
  list: [],
  MAX: 420,

  spawn(o) {
    if (this.list.length >= this.MAX) this.list.shift();
    this.list.push({
      x: 0, y: 0, vx: 0, vy: 0, life: 0.6, max: 0.6,
      size: 4, color: '#a9e2ff', glow: true, drag: 0.9,
      grav: 0, rot: 0, spin: 0, shape: 'dot', ...o
    });
    const p = this.list[this.list.length - 1];
    p.max = p.life;
  },

  burst(x, y, n, o) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand((o && o.spdMin) || 40, (o && o.spdMax) || 170);
      this.spawn({
        x: x + rand(-4, 4), y: y + rand(-4, 4),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.35, 0.9),
        size: rand(2.5, 6),
        color: o && o.colors ? pick(o.colors) : '#a9e2ff',
        glow: !o || o.glow !== false,
        grav: (o && o.grav) || 0,
        shape: (o && o.shape) || 'dot'
      });
    }
  },

  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) { l.splice(i, 1); continue; }
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  },

  draw(ctx) {
    for (const p of this.list) {
      const t = clamp(p.life / p.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = t;
      if (p.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      if (p.shape === 'star') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        const s = p.size * (0.6 + t * 0.8);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU, r = i % 2 ? s * 0.4 : s;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill();
      } else if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + (1 - t) * 3), 0, TAU);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.35 + t * 0.8), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  clear() { this.list.length = 0; }
};

/* =============================================================================
   3. INPUT — keyboard + invisible drag-to-move (pointer events)

   Touch anywhere in the play area and drag: the vector from the touch origin
   to the finger is the movement vector. No on-screen stick, no teleporting —
   it just feeds the same normalised vector the keyboard produces.
   ============================================================================= */

const Input = {
  keys: Object.create(null),
  drag: { active: false, id: null, dx: 0, dy: 0 },
  actionEdge: false,     // consumed once per press
  releaseEdge: false,

  frame: null,
  deadZone: 9,           // px of slop before anything moves
  fullDrag: 62,          // px of drag that means "full speed"

  init(frame) {
    this.frame = frame;
    this.measure();

    addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (!this.keys[k]) {
        if (k === 'e' || k === ' ' || k === 'enter') this.actionEdge = true;
        if (k === 'q' || k === 'escape') this.releaseEdge = true;
        if (k >= '1' && k <= '9') this.levelKey = +k;      // quick level jump
      }
      this.keys[k] = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      SFX.init();
    }, { passive: false });

    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { this.keys = Object.create(null); this.endDrag(); });

    // ---- invisible drag pad: the whole play area, minus the UI ----
    frame.addEventListener('pointerdown', e => {
      SFX.init();
      if (this.drag.active) return;            // a second finger is free for buttons
      if (this.isUI(e.target)) return;         // buttons and overlays keep their taps
      this.drag.active = true;
      this.drag.id = e.pointerId;
      this.drag.dx = this.drag.dy = 0;
      this.origin = { x: e.clientX, y: e.clientY };
      this.downAt = performance.now();
      this.moved = false;
      if (frame.setPointerCapture) { try { frame.setPointerCapture(e.pointerId); } catch (err) {} }
      this.ripple(e.clientX, e.clientY);
      e.preventDefault();
    }, { passive: false });

    frame.addEventListener('pointermove', e => {
      if (!this.drag.active || e.pointerId !== this.drag.id) return;
      this.move(e);
      e.preventDefault();
    }, { passive: false });

    // a touch that never really moved is a tap: used to possess/leave objects
    const up = e => {
      if (!this.drag.active || e.pointerId !== this.drag.id) return;
      if (!this.moved && performance.now() - this.downAt < 380) {
        this.tapPoint = this.toLogical(e.clientX, e.clientY);
      }
      this.endDrag();
    };
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);

    // block browser gestures (zoom, pull-to-refresh, long-press menu)
    ['gesturestart', 'gesturechange', 'contextmenu'].forEach(ev =>
      document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
    document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', e => {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    addEventListener('resize', () => this.measure());
  },

  /** Scale the dead zone / full-speed distance to the screen. */
  measure() {
    if (!this.frame) return;
    const r = this.frame.getBoundingClientRect();
    const base = Math.min(r.width, r.height * 0.5625) || 375;
    this.deadZone = Math.max(6, base * 0.024);
    this.fullDrag = Math.max(38, base * 0.17);
  },

  /** Taps that belong to the UI must never start a drag. */
  isUI(el) {
    return !!(el && el.closest && el.closest('button, #overlay, #intro'));
  },

  /** Screen pixels → the canvas' logical 540x960 space. */
  toLogical(clientX, clientY) {
    const r = this.frame.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  },

  move(e) {
    let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > this.deadZone) this.moved = true;
    if (d <= this.deadZone) { this.drag.dx = this.drag.dy = 0; return; }
    // 0 at the dead zone edge, 1 once the drag passes fullDrag, clamped there
    const mag = clamp((d - this.deadZone) / (this.fullDrag - this.deadZone), 0, 1);
    this.drag.dx = (dx / d) * mag;
    this.drag.dy = (dy / d) * mag;
  },

  endDrag() {
    this.drag.active = false; this.drag.id = null;
    this.drag.dx = this.drag.dy = 0;
  },

  /** A single soft ripple so the player knows the touch registered. */
  ripple(clientX, clientY) {
    const p = this.toLogical(clientX, clientY);
    if (!p) return;
    const x = p.x, y = p.y;
    Particles.spawn({ x, y, vx: 0, vy: 0, life: 0.36, size: 9, color: 'rgba(150,215,255,0.85)', shape: 'ring' });
    Particles.spawn({ x, y, vx: 0, vy: 0, life: 0.22, size: 4, color: 'rgba(200,240,255,0.8)', shape: 'ring' });
  },

  /** Combined movement vector, magnitude clamped to 1. */
  vector() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k['a'] || k['arrowleft'])  x -= 1;
    if (k['d'] || k['arrowright']) x += 1;
    if (k['w'] || k['arrowup'])    y -= 1;
    if (k['s'] || k['arrowdown'])  y += 1;
    if (x || y) { const m = Math.hypot(x, y); x /= m; y /= m; }
    if (this.drag.active) {
      x += this.drag.dx; y += this.drag.dy;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
    }
    return { x, y, mag: Math.hypot(x, y) };
  },

  takeAction()  { const v = this.actionEdge;  this.actionEdge = false;  return v; },
  takeRelease() { const v = this.releaseEdge; this.releaseEdge = false; return v; },
  takeTap()     { const v = this.tapPoint;    this.tapPoint = null;     return v; },
  takeLevelKey(){ const v = this.levelKey;    this.levelKey = 0;        return v; }
};

/* =============================================================================
   4. COLLISION — circles against static AABBs and static circles
   ============================================================================= */

const Collide = {
  /** Push a circle out of an axis-aligned box along the shallowest axis. */
  circleRect(c, r) {
    const nx = clamp(c.x, r.x, r.x + r.w);
    const ny = clamp(c.y, r.y, r.y + r.h);
    const dx = c.x - nx, dy = c.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 > c.r * c.r) return false;

    if (d2 > 0.0001) {                       // outside the box: push along normal
      const d = Math.sqrt(d2);
      const push = c.r - d;
      c.x += (dx / d) * push;
      c.y += (dy / d) * push;
    } else {                                 // center inside: escape the nearest face
      const left = c.x - r.x, right = r.x + r.w - c.x;
      const top = c.y - r.y, bottom = r.y + r.h - c.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left)       c.x = r.x - c.r;
      else if (m === right) c.x = r.x + r.w + c.r;
      else if (m === top)   c.y = r.y - c.r;
      else                  c.y = r.y + r.h + c.r;
    }
    return true;
  },

  circleCircle(c, o) {
    const dx = c.x - o.x, dy = c.y - o.y;
    const rad = c.r + o.r;
    const d = Math.hypot(dx, dy);
    if (d >= rad) return false;
    if (d < 0.0001) { c.y -= rad; return true; }
    const push = rad - d;
    c.x += (dx / d) * push;
    c.y += (dy / d) * push;
    return true;
  },

  /** Resolve a moving circle against the whole level. Returns true if it hit. */
  resolve(body, level) {
    let hit = false;
    const movers = level.movables;
    for (let pass = 0; pass < 2; pass++) {
      for (const r of level.rects) {
        if (r.disabled) continue;                       // an opened gate stops colliding
        if (this.circleRect(body, r)) hit = true;
      }
      for (const o of level.circles) if (this.circleCircle(body, o)) hit = true;
      if (movers) {                                     // push-able props are solid too
        for (const m of movers) if (m !== body && this.circleCircle(body, m)) hit = true;
      }
    }
    return hit;
  }
};

/** Ray vs AABB (slab test). Returns the distance along the ray, or Infinity. */
function rayRectT(ox, oy, dx, dy, r, maxT) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-6) {
    if (ox < r.x || ox > r.x + r.w) return Infinity;
  } else {
    let t1 = (r.x - ox) / dx, t2 = (r.x + r.w - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-6) {
    if (oy < r.y || oy > r.y + r.h) return Infinity;
  } else {
    let t1 = (r.y - oy) / dy, t2 = (r.y + r.h - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/**
 * How far a sight line travels before a wall stops it. Only real walls block
 * sight (level.sight), so vision cones stay clean and readable.
 */
function sightLimit(level, ox, oy, ang, maxLen) {
  const blockers = level.sight;
  if (!blockers || !blockers.length) return maxLen;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let best = maxLen;
  for (const r of blockers) {
    if (r.disabled) continue;                           // an opened gate no longer blocks
    const t = rayRectT(ox, oy, dx, dy, r, maxLen);
    if (t < best) best = t;
  }
  return best;
}

/* =============================================================================
   5. ENTITIES
   ============================================================================= */

/** A cone of warm light. Dangerous ones burn the ghost. */
class LightHazard {
  constructor(o) {
    Object.assign(this, {
      x: 0, y: 0, dir: -Math.PI / 2, half: 0.85, len: 300,
      on: true, dangerous: true,
      bright: false,      // does this light make the ghost easy to spot?
      occluded: false,    // should walls cast shadows out of it?
      nearSafe: 26,       // the bulb itself is not a kill zone
      shaft: null,        // optional occluder: light only escapes through a gap
      fade: 1, flicker: 0
    }, o);
    this.fade = this.on ? 1 : 0;
  }

  update(dt, time) {
    this.fade = lerp(this.fade, this.on ? 1 : 0, smooth(dt, 0.0005));
    this.flicker = 0.94 + Math.sin(time * 2.7) * 0.03 + Math.sin(time * 11.3) * 0.015;
  }

  get reach() { return this.len * this.fade; }

  /** Is this point lit? `lethalOnly` keeps the old "does it burn" meaning. */
  contains(x, y, level, lethalOnly) {
    if (lethalOnly !== false && !this.dangerous) return false;
    if (this.fade < 0.4) return false;
    const dx = x - this.x, dy = y - this.y;
    const d = Math.hypot(dx, dy);
    if (d > this.reach || d < this.nearSafe) return false;
    const a = Math.atan2(dy, dx);
    if (Math.abs(angDiff(a, this.dir)) > this.half) return false;
    // beyond a wall the light only survives inside the doorway shaft
    if (this.shaft && y < this.shaft.wallY0 && (x < this.shaft.gx0 || x > this.shaft.gx1)) return false;
    // walls cast real shadows for lights that ask for it
    if (this.occluded && level && sightLimit(level, this.x, this.y, a, this.reach) < d - 1) return false;
    return true;
  }
}

/** The wall-aware outline of a light cone, shared by the drawing and the clip. */
function conePoints(level, z, n) {
  const pts = [];
  const R = z.reach;
  const a0 = z.dir - z.half, span = z.half * 2;
  for (let i = 0; i <= n; i++) {
    const a = a0 + span * (i / n);
    const t = (z.occluded && level) ? Math.min(R, sightLimit(level, z.x, z.y, a, R)) : R;
    pts.push([z.x + Math.cos(a) * t, z.y + Math.sin(a) * t]);
  }
  return pts;
}

/** Shared behaviour for everything the ghost can slip inside. */
class Possessable {
  constructor(o) {
    Object.assign(this, {
      x: 0, y: 0, r: 26, name: 'object',
      possessed: false, highlight: 0, pop: 0, glow: 0
    }, o);
  }
  /** Secondary label for the big button while possessed (null = plain RELEASE). */
  actionLabel() { return null; }
  activate() {}                       // pressing the big button while possessed
  update(dt, input, level) {}
  onPossess() { this.pop = 1; }
  onRelease() { this.pop = 1; }
  tickCommon(dt, nearGhost) {
    this.highlight = lerp(this.highlight, nearGhost ? 1 : 0, smooth(dt, 0.002));
    this.glow = lerp(this.glow, this.possessed ? 1 : 0, smooth(dt, 0.002));
    this.pop = Math.max(0, this.pop - dt * 2.6);
  }
}

/** Floor lamp: its cone is the wall of light blocking the doorway. */
class FloorLamp extends Possessable {
  constructor(x, y, light) {
    super({ x, y, r: 30, name: 'lamp' });
    this.light = light;
    this.sway = 0;
  }
  get on() { return this.light.on; }
  actionLabel() { return this.light.on ? 'TURN OFF' : 'TURN ON'; }
  activate() {
    this.light.on = !this.light.on;
    this.pop = 1;
    this.sway = 1;
    if (this.light.on) {
      SFX.toggleOn();
      Particles.burst(this.x, this.y - 74, 14, { colors: ['#ffd88a', '#fff0c4'], spdMax: 120 });
    } else {
      SFX.toggleOff();
      Particles.burst(this.x, this.y - 74, 18, { colors: ['#ffd88a', '#9fd8ff'], spdMax: 140, grav: 130 });
    }
    return true;
  }
  update(dt) { this.sway = Math.max(0, this.sway - dt * 1.8); }
}

/**
 * A lamp whose beam the player aims. Possess it, then drag (or press A/D) to
 * sweep the light between two clamped angles — no spinning, no extra buttons.
 */
class RotatingLamp extends Possessable {
  constructor(x, y, light, minDir, maxDir) {
    super({ x, y, r: 28, name: 'aimlamp' });
    this.light = light;
    this.min = Math.min(minDir, maxDir);
    this.max = Math.max(minDir, maxDir);
    this.dir = clamp(light.dir, this.min, this.max);
    this.light.dir = this.dir;
    this.rotatable = true;
    this.spin = 0;
  }
  actionLabel() { return null; }              // the big button stays RELEASE
  update(dt, input) {
    const want = (this.possessed && input) ? clamp(input.x, -1, 1) * 1.6 : 0;
    this.spin = lerp(this.spin, want, smooth(dt, this.possessed ? 0.02 : 0.0005));
    if (Math.abs(this.spin) > 0.002) {
      const before = this.dir;
      this.dir = clamp(this.dir + this.spin * dt, this.min, this.max);
      if (this.dir === before) this.spin *= 0.4;   // soft stop at the limits
      this.light.dir = this.dir;
    }
  }
  /** 0..1 across the allowed sweep — used by the little dial indicator. */
  get t() { return (this.dir - this.min) / Math.max(0.001, this.max - this.min); }
}

/** Fan: flavour object, shows that possessables can behave differently. */
class Fan extends Possessable {
  constructor(x, y) {
    super({ x, y, r: 28, name: 'fan' });
    this.on = false;
    this.spin = 0;
    this.speed = 0;
    this.windT = 0;
  }
  actionLabel() { return this.on ? 'TURN OFF' : 'TURN ON'; }
  activate() {
    this.on = !this.on;
    this.pop = 1;
    if (this.on) SFX.toggleOn(); else SFX.toggleOff();
    return true;
  }
  update(dt) {
    this.speed = lerp(this.speed, this.on ? 15 : 0, smooth(dt, 0.06));
    this.spin += this.speed * dt;
    if (this.on) {
      this.windT += dt;
      if (this.windT > 0.09) {
        this.windT = 0;
        Particles.spawn({
          x: this.x + rand(-16, 16), y: this.y - 30,
          vx: rand(-26, 26), vy: rand(-150, -95),
          life: rand(0.5, 0.95), size: rand(1.5, 3),
          color: 'rgba(190,225,255,0.85)', glow: true, drag: 0.985
        });
      }
    }
  }
}

/** Toy car: drives like a little wheeled thing and is heavy enough for plates. */
class ToyCar extends Possessable {
  constructor(x, y) {
    super({ x, y, r: 17, name: 'car' });
    this.angle = -Math.PI / 2;
    this.speed = 0;
    this.wheel = 0;
    this.bump = 0;
    this.engineT = 0;
  }
  update(dt, input, level) {
    if (this.possessed) {
      const mag = input.mag;
      if (mag > 0.15) {
        const target = Math.atan2(input.y, input.x);
        const d = angDiff(target, this.angle);
        // sharper turning while slow, like a toy on carpet
        const turnRate = 4.6 + (1 - clamp(Math.abs(this.speed) / 150, 0, 1)) * 4.0;
        const step = turnRate * dt;
        this.angle += clamp(d, -step, step);
        // don't accelerate straight into a wall-facing turn
        const align = clamp(1 - Math.abs(d) / Math.PI, 0.25, 1);
        this.speed = lerp(this.speed, 152 * mag * align, smooth(dt, 0.02));
        this.engineT += dt;
        if (this.engineT > 0.14) { this.engineT = 0; SFX.tone(rand(90, 130), 0.07, 'sawtooth', 0.05); }
      } else {
        this.speed = lerp(this.speed, 0, smooth(dt, 0.0004));
      }
    } else {
      this.speed = lerp(this.speed, 0, smooth(dt, 0.00001));
    }

    if (Math.abs(this.speed) > 1) {
      const px = this.x, py = this.y;
      this.x += Math.cos(this.angle) * this.speed * dt;
      this.y += Math.sin(this.angle) * this.speed * dt;
      if (Collide.resolve(this, level)) {
        this.speed *= 0.35;
        this.bump = 1;
      }
      this.wheel += dist(px, py, this.x, this.y) * 0.16;
    }
    this.bump = Math.max(0, this.bump - dt * 3);
  }
}

/** Weight-activated floor plate. A ghost is far too light for it. */
class PressurePlate {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 38;
    this.pressed = false;
    this.press = 0;
    this.pulse = 0;
    this.ring = 0;
  }
  update(dt, level) {
    // anything heavy enough counts: the toy car, a pushed box, ... never the ghost
    const heavies = level.heavy || (level.car ? [level.car] : []);
    let on = false;
    for (const o of heavies) {
      if (dist(o.x, o.y, this.x, this.y) < this.r - 6) { on = true; break; }
    }
    if (on !== this.pressed) {
      this.pressed = on;
      this.pulse = 1;
      if (on) {
        SFX.plate();
        Particles.burst(this.x, this.y, 22, { colors: ['#9dffc8', '#d9ffe9', '#7fd4ff'], spdMax: 150 });
        Particles.spawn({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.6, size: 18, color: '#9dffc8', shape: 'ring' });
      }
    }
    this.press = lerp(this.press, on ? 1 : 0, smooth(dt, 0.0006));
    this.pulse = Math.max(0, this.pulse - dt * 1.6);
    this.ring += dt * (on ? 1.6 : 0.4);
  }
}

/** The way out. Locked until the plate stays pressed. */
class ExitDoor {
  constructor() {
    this.x0 = DOOR.x0; this.x1 = DOOR.x1;
    this.locked = true;
    this.open = 0;
    this.shake = 0;
    this.glow = 0;
  }
  setLocked(v) {
    if (this.locked === v) return;
    this.locked = v;
    this.shake = 1;
    const cx = (this.x0 + this.x1) / 2;
    if (!v) {
      SFX.unlock();
      Particles.burst(cx, 58, 30, { colors: ['#fff2c8', '#9dffc8', '#ffd88a'], spdMax: 190, grav: 120 });
      Particles.spawn({ x: cx, y: 58, vx: 0, vy: 0, life: 0.8, size: 22, color: '#ffe6a8', shape: 'ring' });
    } else {
      SFX.toggleOff();
    }
  }
  update(dt) {
    this.open = lerp(this.open, this.locked ? 0 : 1, smooth(dt, 0.004));
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.glow = this.open;
  }
  reached(g) {
    return !this.locked && g.y < 104 && g.x > this.x0 - 10 && g.x < this.x1 + 10;
  }
}

/** The star of the show. */
class Ghost {
  constructor(x, y) {
    this.spawnX = x; this.spawnY = y;
    this.reset();
  }
  reset() {
    this.x = this.spawnX; this.y = this.spawnY;
    this.r = 15;
    this.vx = 0; this.vy = 0;
    this.t = rand(0, 10);
    this.danger = 0;
    this.hidden = false;
    this.face = 0;         // eye look direction (-1..1)
    this.squash = 0;
    this.trailT = 0;
    this.blink = rand(1.5, 4);
    this.blinkT = 0;
  }

  update(dt, input, level) {
    this.t += dt;

    // --- blinking keeps it alive while idle ---
    this.blink -= dt;
    if (this.blink <= 0) { this.blinkT = 0.14; this.blink = rand(2.2, 5.5); }
    this.blinkT = Math.max(0, this.blinkT - dt);

    if (this.hidden) { this.danger = Math.max(0, this.danger - dt * 2); return; }

    const inLight = level.lightAt(this.x, this.y);
    const maxSpd = inLight ? 112 : 176;      // the light saps a little ghost
    const tx = input.x * maxSpd, ty = input.y * maxSpd;
    const k = smooth(dt, input.mag > 0.05 ? 0.0006 : 0.00004);
    this.vx = lerp(this.vx, tx, k);
    this.vy = lerp(this.vy, ty, k);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    Collide.resolve(this, level);
    this.x = clamp(this.x, ROOM.x0 - 4, ROOM.x1 + 4);
    this.y = clamp(this.y, -30, ROOM.y1 + 4);

    const sp = Math.hypot(this.vx, this.vy);
    this.squash = lerp(this.squash, clamp(sp / 240, 0, 0.5), smooth(dt, 0.002));
    if (Math.abs(this.vx) > 12) this.face = lerp(this.face, clamp(this.vx / 150, -1, 1), smooth(dt, 0.01));

    // wispy trail
    if (sp > 45) {
      this.trailT += dt;
      if (this.trailT > 0.045) {
        this.trailT = 0;
        Particles.spawn({
          x: this.x + rand(-5, 5), y: this.y + rand(0, 9),
          vx: -this.vx * 0.12 + rand(-12, 12), vy: -this.vy * 0.12 + rand(-8, 14),
          life: rand(0.3, 0.62), size: rand(2.5, 5.5),
          color: inLight ? 'rgba(255,190,150,0.9)' : 'rgba(150,215,255,0.9)', drag: 0.93
        });
      }
    }

    // --- light danger timer ---
    if (inLight) {
      if (this.danger === 0) SFX.hurt();
      this.danger = Math.min(DANGER_TIME, this.danger + dt);
      if (Math.random() < dt * 22) {
        Particles.spawn({
          x: this.x + rand(-12, 12), y: this.y + rand(-14, 8),
          vx: rand(-20, 20), vy: rand(-70, -30),
          life: rand(0.3, 0.6), size: rand(2, 4.5), color: '#ffcf9a'
        });
      }
    } else {
      this.danger = Math.max(0, this.danger - dt * 1.35);
    }
  }
}

/**
 * A hiding place: the ghost slips inside and the house cannot see it.
 * `kind` picks the drawing ('pot' | 'box' | 'teddy'); everything else is shared.
 */
class HideSpot extends Possessable {
  constructor(x, y, kind, label) {
    super({ x, y, r: 26, name: kind, kind, label: label || kind });
    this.spot = true;
    this.wobble = 0;
    this.peek = 0;          // the little ghost face that fades in after hiding
    this.seed = rand(0, 10);
  }
  actionLabel() { return null; }          // the big button just says RELEASE
  onPossess() { this.pop = 1; this.wobble = 1; this.peek = 1.4; }
  onRelease() { this.pop = 1; this.wobble = 1; }
  update(dt) {
    this.wobble = Math.max(0, this.wobble - dt * 1.5);
    if (this.possessed) this.peek = Math.min(1.4, this.peek + dt * 0.6);
    else this.peek = Math.max(0, this.peek - dt * 3);
  }
}

/**
 * A hiding place the ghost can also steer. Heavier and slower than the ghost,
 * collides with everything, and counts as weight on a pressure plate.
 */
class PushBox extends HideSpot {
  constructor(x, y, kind) {
    super(x, y, kind || 'box', 'cardboard box');
    this.r = 20;
    this.movable = true;
    this.vx = 0; this.vy = 0;
    this.scuff = 0;
  }
  update(dt, input, level) {
    super.update(dt);                                   // wobble + peeking face
    const speed = 96;                                   // clearly slower than the ghost
    if (this.possessed && input && level) {
      const k = smooth(dt, input.mag > 0.05 ? 0.03 : 0.002);
      this.vx = lerp(this.vx, input.x * speed, k);
      this.vy = lerp(this.vy, input.y * speed, k);
    } else {
      this.vx = lerp(this.vx, 0, smooth(dt, 0.0004));   // no sliding once released
      this.vy = lerp(this.vy, 0, smooth(dt, 0.0004));
    }
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 1 && level) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (Collide.resolve(this, level)) { this.vx *= 0.3; this.vy *= 0.3; }
      this.scuff += sp * dt;
      if (this.scuff > 26) {                            // little dust puffs while sliding
        this.scuff = 0;
        Particles.spawn({
          x: this.x + rand(-14, 14), y: this.y + 16,
          vx: rand(-14, 14), vy: rand(-14, 4),
          life: rand(0.3, 0.6), size: rand(2, 4.5),
          color: 'rgba(190,170,150,0.5)', glow: false, drag: 0.9
        });
      }
    }
  }
}

/** A little barrier that a pressure plate opens, once and for good. */
class Gate {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.isOpen = false;
    this.disabled = false;      // read by Collide.resolve and sightLimit
    this.open = 0;              // animation 0..1
  }
  setOpen() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.disabled = true;
    SFX.unlock();
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    Particles.burst(cx, cy, 26, { colors: ['#9dffc8', '#d9ffe9', '#fff2c8'], spdMax: 170 });
    Particles.spawn({ x: cx, y: cy, vx: 0, vy: 0, life: 0.7, size: 20, color: '#9dffc8', shape: 'ring' });
  }
  update(dt) { this.open = lerp(this.open, this.isOpen ? 1 : 0, smooth(dt, 0.004)); }
}

/** A key lying on the floor. Walk into it to pick it up. */
class KeyPickup {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 16;
    this.taken = false;
    this.pop = 0;
  }
  tryTake(g) {
    if (this.taken) return false;
    if (dist(g.x, g.y, this.x, this.y) > this.r + g.r + 6) return false;
    this.taken = true;
    this.pop = 1;
    SFX.key();
    Particles.burst(this.x, this.y, 26, { colors: ['#ffe6a0', '#fff6d8', '#ffd166'], spdMax: 180 });
    Particles.spawn({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.7, size: 16, color: '#ffe6a0', shape: 'ring' });
    for (let i = 0; i < 8; i++) {
      Particles.spawn({
        x: this.x + rand(-14, 14), y: this.y + rand(-14, 6),
        vx: rand(-20, 20), vy: rand(-90, -40),
        life: rand(0.5, 1), size: rand(2.5, 5), color: '#ffeebb', shape: 'star', spin: rand(-6, 6)
      });
    }
    return true;
  }
  update(dt) { this.pop = Math.max(0, this.pop - dt * 2); }
}

/**
 * A housemate. Walks a fixed polyline back and forth, pausing (and turning
 * around) at each end, and sees in a cone that real walls cut off.
 * Patrol + vision + detection only — nothing else, by design.
 */
class Human {
  constructor(o) {
    Object.assign(this, {
      path: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      speed: 78,            // px per second — strollingly slow
      pause: 1.2,           // seconds spent at each end of the route
      range: 190,           // how far they can see into a lit area
      darkRange: 0,         // ...and into darkness (0 = same as range)
      half: 0.46,           // half the cone angle, radians
      name: 'human'
    }, o);
    if (!this.darkRange) this.darkRange = this.range;
    this.x = this.path[0].x;
    this.y = this.path[0].y;
    this.target = 1;
    this.step = 1;          // +1 walking forward along the path, -1 coming back
    this.paused = 0;
    this.angle = Math.atan2(this.path[1].y - this.y, this.path[1].x - this.x);
    this.bob = 0;
    this.alert = 0;
    this.curious = 0;       // "huh, that lamp just went out"
    this.lookX = 0; this.lookY = 0;
    this.t = rand(0, 10);
  }

  /** Glance at something for a moment, then carry on. Not an investigation. */
  startle(x, y) {
    this.curious = 1.1;
    this.lookX = x; this.lookY = y;
  }

  faceTowards(ax, ay, dt, rate) {
    const want = Math.atan2(ay - this.y, ax - this.x);
    this.angle += clamp(angDiff(want, this.angle), -rate * dt, rate * dt);
  }

  update(dt) {
    this.t += dt;
    const n = this.path[this.target];

    if (this.curious > 0) {                      // stop and look at whatever changed
      this.curious -= dt;
      this.faceTowards(this.lookX, this.lookY, dt, 3.4);
      return;
    }
    if (this.paused > 0) {                       // pause, then turn around
      this.paused -= dt;
      // a waypoint may name a spot to stare at while standing there
      const node = this.path[this.pauseNode];
      const f = node && node.face;
      if (f) this.faceTowards(f[0], f[1], dt, 3.0);
      else this.faceTowards(n.x, n.y, dt, 3.0);
      return;
    }

    const dx = n.x - this.x, dy = n.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 2.5) {
      let next = this.target + this.step;
      if (next >= this.path.length || next < 0) {  // an end of the route
        this.step *= -1;
        next = this.target + this.step;
        this.pauseNode = this.target;
        this.paused = this.pause;
      } else if (n.pause) {                        // a waypoint that asks for a stop
        this.pauseNode = this.target;
        this.paused = n.pause;
      }
      this.target = next;
      return;
    }
    const move = Math.min(this.speed * dt, d);
    this.x += (dx / d) * move;
    this.y += (dy / d) * move;
    this.bob += move * 0.09;
    this.faceTowards(n.x, n.y, dt, 4.5);
  }

  /** Can this human see the point? Cone + range + walls. */
  sees(x, y, level) {
    const dx = x - this.x, dy = y - this.y;
    const d = Math.hypot(dx, dy);
    // in the dark they have to be much closer before they notice anything
    const range = (this.darkRange < this.range && level.brightAt && !level.brightAt(x, y))
      ? this.darkRange : this.range;
    if (d > range) return false;
    if (d < 14) return true;
    const a = Math.atan2(dy, dx);
    if (Math.abs(angDiff(a, this.angle)) > this.half) return false;
    return sightLimit(level, this.x, this.y, a, range) >= d - 1;
  }
}

/* =============================================================================
   6. LEVELS — each build function returns one self-contained room
   ============================================================================= */

function buildLevel1() {
  const L = {};

  // ---- static colliders (walls are thick and reach outside the frame) ----
  L.rects = [
    { x: -60, y: 0, w: 84, h: H },                                  // left wall
    { x: ROOM.x1, y: 0, w: 84, h: H },                              // right wall
    { x: 0, y: ROOM.y1, w: W, h: 84 },                              // bottom wall
    { x: -60, y: -60, w: 60 + DOOR.x0, h: 84 },                     // top wall, left of door
    { x: DOOR.x1, y: -60, w: W - DOOR.x1 + 60, h: 84 },             // top wall, right of door
    { x: DOOR.x0, y: -90, w: DOOR.x1 - DOOR.x0, h: 96 },            // the door itself
    { x: -60, y: DIV.y0, w: 60 + DIV.gx0, h: DIV.y1 - DIV.y0 },     // divider, left half
    { x: DIV.gx1, y: DIV.y0, w: W - DIV.gx1 + 60, h: DIV.y1 - DIV.y0 }, // divider, right half

    // ---- furniture (these double as the drawing list) ----
    { x: 50,  y: 612, w: 150, h: 92,  kind: 'sofa' },
    { x: 330, y: 676, w: 112, h: 74,  kind: 'table' },
    { x: 206, y: 884, w: 130, h: 44,  kind: 'tv' },
    { x: 44,  y: 330, w: 156, h: 180, kind: 'bed' },
    { x: 420, y: 400, w: 92,  h: 100, kind: 'dresser' },
    { x: 210, y: 330, w: 56,  h: 56,  kind: 'nightstand' }
  ];

  L.circles = [
    { x: 492, y: 880, r: 24, kind: 'plant', seed: 1 },
    { x: 62,  y: 566, r: 20, kind: 'plant', seed: 2 },
    { x: 148, y: 182, r: 20, kind: 'plant', seed: 3 },
    { x: 470, y: 620, r: 24, kind: 'fanbase' },
    { x: 222, y: 700, r: 16, kind: 'lampbase' },
    { x: 470, y: 300, r: 15, kind: 'nightlamp' }
  ];

  // ---- lights ----
  // 1) the floor lamp: a wall of light across the only doorway
  L.lampLight = new LightHazard({
    x: 222, y: 700, dir: -Math.PI / 2, half: 0.95, len: 400,
    on: true, dangerous: true, nearSafe: 30,
    shaft: { wallY0: DIV.y0, wallY1: DIV.y1, gx0: DIV.gx0 - 6, gx1: DIV.gx1 + 6 }
  });
  // 2) a small night lamp upstairs — atmosphere plus a hazard beside the plate
  L.nightLight = new LightHazard({
    x: 470, y: 300, dir: -Math.PI / 2, half: 0.70, len: 210,
    on: true, dangerous: true, nearSafe: 22
  });
  // 3) warm glow spilling under the exit door (harmless, it is the goal)
  L.doorLight = new LightHazard({
    x: (DOOR.x0 + DOOR.x1) / 2, y: 44, dir: Math.PI / 2, half: 0.62, len: 150,
    on: false, dangerous: false, nearSafe: 0
  });

  L.lights = [L.lampLight, L.nightLight, L.doorLight];

  // ---- interactive props ----
  L.lamp = new FloorLamp(222, 700, L.lampLight);
  L.car  = new ToyCar(370, 452);
  L.fan  = new Fan(470, 620);
  L.possessables = [L.lamp, L.car, L.fan];

  L.plate = new PressurePlate(330, 170);
  L.door  = new ExitDoor();

  // ---- decor (no collision) ----
  L.rug = { x: 262, y: 790, rx: 142, ry: 92 };
  // little cushions / books scattered around, purely decorative
  L.decor = [
    { x: 226, y: 742, r: 15, kind: 'cushion', hue: '#5b6bb8' },
    { x: 196, y: 812, r: 13, kind: 'cushion', hue: '#7a5b9e' },
    { x: 364, y: 700, r: 11, kind: 'books' },
    { x: 238, y: 348, r: 10, kind: 'mug' }
  ];

  L.dividers = [{
    y0: DIV.y0, y1: DIV.y1,
    segs: [[ROOM.x0, DIV.gx0], [DIV.gx1, ROOM.x1]],
    jambs: [{ x: DIV.gx0, side: -1 }, { x: DIV.gx1, side: 1 }]
  }];

  finishLevel(L);
  return L;
}

/* -----------------------------------------------------------------------------
   LEVEL 2 — "First Human": patrol, vision cone, and three places to hide.
   Three rooms stacked bottom → middle → top, linked by two offset doorways.
   The housemate paces the middle room, sweeping both doorways in turn.
   ----------------------------------------------------------------------------- */

const L2 = {
  wallA: { y0: 600, y1: 628, endX: 360 },   // lower wall, gap on the right
  wallB: { y0: 300, y1: 328, startX: 200 }  // upper wall, gap on the left
};

function buildLevel2() {
  const L = {};
  const A = L2.wallA, B = L2.wallB;

  L.rects = [
    { x: -60, y: 0, w: 84, h: H },                                  // left wall
    { x: ROOM.x1, y: 0, w: 84, h: H },                              // right wall
    { x: 0, y: ROOM.y1, w: W, h: 84 },                              // bottom wall
    { x: -60, y: -60, w: 60 + DOOR.x0, h: 84 },                     // top wall, left of door
    { x: DOOR.x1, y: -60, w: W - DOOR.x1 + 60, h: 84 },             // top wall, right of door
    { x: DOOR.x0, y: -90, w: DOOR.x1 - DOOR.x0, h: 96 },            // the door itself
    { x: -60, y: A.y0, w: 60 + A.endX, h: A.y1 - A.y0 },            // lower divider
    { x: B.startX, y: B.y0, w: W - B.startX + 60, h: B.y1 - B.y0 }, // upper divider

    // ---- furniture ----
    { x: 56,  y: 790, w: 150, h: 90,  kind: 'sofa' },       // bottom room
    { x: 62,  y: 662, w: 104, h: 70,  kind: 'table' },
    { x: 336, y: 878, w: 134, h: 44,  kind: 'tv' },
    { x: 40,  y: 452, w: 84,  h: 96,  kind: 'dresser' },    // middle room
    { x: 40,  y: 350, w: 56,  h: 56,  kind: 'nightstand' },
    { x: 336, y: 60,  w: 152, h: 172, kind: 'bed' },        // top room
    { x: 44,  y: 120, w: 100, h: 66,  kind: 'table' }
  ];

  L.circles = [
    { x: 486, y: 872, r: 22, kind: 'plant', seed: 4 },
    { x: 170, y: 560, r: 20, kind: 'plant', seed: 5 },
    { x: 486, y: 252, r: 22, kind: 'plant', seed: 6 },
    { x: 486, y: 786, r: 15, kind: 'nightlamp' },
    // the hiding places are solid little props too
    { x: 400, y: 686, r: 17, kind: 'hidebase' },
    { x: 250, y: 430, r: 17, kind: 'hidebase' },
    { x: 130, y: 242, r: 17, kind: 'hidebase' }
  ];

  // ---- lights: level 2 has no burning light at all, only cozy glow ----
  L.nightLight = new LightHazard({
    x: 486, y: 786, dir: -Math.PI / 2, half: 0.62, len: 150,
    on: true, dangerous: false, nearSafe: 0
  });
  L.doorLight = new LightHazard({
    x: (DOOR.x0 + DOOR.x1) / 2, y: 44, dir: Math.PI / 2, half: 0.62, len: 150,
    on: true, dangerous: false, nearSafe: 0
  });
  L.lights = [L.nightLight, L.doorLight];

  // ---- hiding places, in the order the player meets them ----
  L.possessables = [
    new HideSpot(400, 686, 'pot',   'flower pot'),
    new HideSpot(250, 430, 'box',   'cardboard box'),
    new HideSpot(130, 242, 'teddy', 'teddy bear')
  ];

  // ---- the housemate: up the right side, across the middle, peek through the door ----
  L.humans = [new Human({
    path: [{ x: 440, y: 500 }, { x: 440, y: 384 }, { x: 150, y: 384 }, { x: 150, y: 344 }],
    speed: 78, pause: 1.2, range: 190, half: 0.46
  })];

  // ---- the way out is already open here; the human is the only obstacle ----
  L.door = new ExitDoor();
  L.door.locked = false;
  L.door.open = 1;

  L.rug = { x: 250, y: 800, rx: 140, ry: 88 };
  L.decor = [
    { x: 206, y: 758, r: 15, kind: 'cushion', hue: '#5b6bb8' },
    { x: 168, y: 826, r: 13, kind: 'cushion', hue: '#7a5b9e' },
    { x: 110, y: 686, r: 11, kind: 'books' },
    { x: 94,  y: 140, r: 10, kind: 'mug' }
  ];

  L.dividers = [
    { y0: A.y0, y1: A.y1, segs: [[ROOM.x0, A.endX]], jambs: [{ x: A.endX, side: -1 }] },
    { y0: B.y0, y1: B.y1, segs: [[B.startX, ROOM.x1]], jambs: [{ x: B.startX, side: 1 }] }
  ];

  finishLevel(L);
  return L;
}

/* -----------------------------------------------------------------------------
   LEVEL 3 — "Hide and Seek": timing puzzle, same rules as level 2.
   Four zones separated by three walls whose doorways alternate left/right, so
   the route zig-zags. One housemate walks that same zig-zag the other way,
   crossing the player's path at every doorway. Four hiding places, one per
   exposed stretch; the start (zone A) and the exit room are never patrolled.
   ----------------------------------------------------------------------------- */

const L3 = {
  wallA: { y0: 700, y1: 728, endX: 340 },    // gap on the right  (340..516)
  wallB: { y0: 470, y1: 498, startX: 190 },  // gap on the left   (24..190)
  wallC: { y0: 250, y1: 278, endX: 380 }     // gap on the right  (380..516)
};

function buildLevel3() {
  const L = {};
  const A = L3.wallA, B = L3.wallB, C = L3.wallC;

  L.rects = [
    { x: -60, y: 0, w: 84, h: H },                                  // left wall
    { x: ROOM.x1, y: 0, w: 84, h: H },                              // right wall
    { x: 0, y: ROOM.y1, w: W, h: 84 },                              // bottom wall
    { x: -60, y: -60, w: 60 + DOOR.x0, h: 84 },                     // top wall, left of door
    { x: DOOR.x1, y: -60, w: W - DOOR.x1 + 60, h: 84 },             // top wall, right of door
    { x: DOOR.x0, y: -90, w: DOOR.x1 - DOOR.x0, h: 96 },            // the door itself
    { x: -60, y: A.y0, w: 60 + A.endX, h: A.y1 - A.y0 },
    { x: B.startX, y: B.y0, w: W - B.startX + 60, h: B.y1 - B.y0 },
    { x: -60, y: C.y0, w: 60 + C.endX, h: C.y1 - C.y0 },

    // ---- furniture ----
    { x: 50,  y: 762, w: 140, h: 84,  kind: 'sofa' },       // zone A — the safe start
    { x: 230, y: 790, w: 96,  h: 56,  kind: 'table' },
    { x: 360, y: 886, w: 120, h: 40,  kind: 'tv' },
    { x: 430, y: 500, w: 84,  h: 90,  kind: 'dresser' },    // zone B
    { x: 40,  y: 520, w: 52,  h: 52,  kind: 'nightstand' },
    { x: 40,  y: 300, w: 52,  h: 52,  kind: 'nightstand' }, // zone C stays open to cross
    { x: 40,  y: 60,  w: 150, h: 170, kind: 'bed' },        // zone D — the exit room
    { x: 330, y: 100, w: 100, h: 64,  kind: 'table' }
  ];

  L.circles = [
    { x: 60,  y: 745, r: 20, kind: 'plant', seed: 7 },
    { x: 486, y: 120, r: 22, kind: 'plant', seed: 8 },
    { x: 60,  y: 380, r: 20, kind: 'plant', seed: 9 },
    { x: 486, y: 210, r: 15, kind: 'nightlamp' },
    // the four hiding places are solid props too
    { x: 400, y: 760, r: 17, kind: 'hidebase' },
    { x: 250, y: 650, r: 17, kind: 'hidebase' },
    { x: 162, y: 420, r: 17, kind: 'hidebase' },
    { x: 430, y: 420, r: 17, kind: 'hidebase' }
  ];

  // ---- cozy light only, exactly like level 2: nothing here burns ----
  L.nightLight = new LightHazard({
    x: 486, y: 210, dir: -Math.PI / 2, half: 0.62, len: 140,
    on: true, dangerous: false, nearSafe: 0
  });
  L.doorLight = new LightHazard({
    x: (DOOR.x0 + DOOR.x1) / 2, y: 44, dir: Math.PI / 2, half: 0.62, len: 150,
    on: true, dangerous: false, nearSafe: 0
  });
  L.lights = [L.nightLight, L.doorLight];

  // ---- one hiding place per exposed stretch, in route order ----
  L.possessables = [
    new HideSpot(400, 760, 'pot',    'flower pot'),      // before the first doorway
    new HideSpot(250, 650, 'box',    'cardboard box'),   // on the patrol corridor
    new HideSpot(162, 420, 'teddy',  'teddy bear'),      // just past the left doorway
    new HideSpot(430, 420, 'basket', 'laundry basket')   // below the last doorway
  ];

  // ---- the long patrol: down-right → left → up → right → into the exit room ----
  L.humans = [new Human({
    path: [
      { x: 430, y: 640 },   // A — beside the first doorway
      { x: 120, y: 600 },   // B — across the lower room
      { x: 120, y: 380 },   // C — up through the left doorway
      { x: 430, y: 340 },   // D — back across the upper room
      { x: 450, y: 180 }    // E — a look around the exit room, then turn back
    ],
    speed: 100, pause: 1.15, range: 190, half: 0.46
  })];

  L.door = new ExitDoor();
  L.door.locked = false;
  L.door.open = 1;

  L.rug = { x: 240, y: 872, rx: 130, ry: 56 };
  L.decor = [
    { x: 160, y: 876, r: 15, kind: 'cushion', hue: '#5b6bb8' },
    { x: 322, y: 858, r: 13, kind: 'cushion', hue: '#7a5b9e' },
    { x: 262, y: 800, r: 11, kind: 'books' },
    { x: 66,  y: 530, r: 10, kind: 'mug' }
  ];

  L.dividers = [
    { y0: A.y0, y1: A.y1, segs: [[ROOM.x0, A.endX]], jambs: [{ x: A.endX, side: -1 }] },
    { y0: B.y0, y1: B.y1, segs: [[B.startX, ROOM.x1]], jambs: [{ x: B.startX, side: 1 }] },
    { y0: C.y0, y1: C.y1, segs: [[ROOM.x0, C.endX]], jambs: [{ x: C.endX, side: -1 }] }
  ];

  finishLevel(L);
  return L;
}

/* -----------------------------------------------------------------------------
   LEVEL 4 — "The Locked Door": stealth plus a multi-step puzzle.
   Three rooms. The exit is visible from the start but locked; the key sits in a
   walled alcove whose gate only opens while something heavy holds the floor
   button down. The only heavy thing is a cardboard box the ghost can possess
   and push. A wire on the floor spells out button → gate.
   ----------------------------------------------------------------------------- */

const L4 = {
  wallA:  { y0: 230, y1: 258, gx0: 300, gx1: 430 },  // exit room, doorway centre-right
  wallB:  { y0: 640, y1: 668, endX: 360 },           // start room, doorway on the right
  alcove: { x: 150, y: 258, w: 28, h: 142 },         // post that walls the key in
  gate:   { x: 24,  y: 400, w: 126, h: 28 }          // ...and the gate underneath it
};

function buildLevel4() {
  const L = {};
  const A = L4.wallA, B = L4.wallB;

  L.gate = new Gate(L4.gate.x, L4.gate.y, L4.gate.w, L4.gate.h);
  const post = { x: L4.alcove.x, y: L4.alcove.y, w: L4.alcove.w, h: L4.alcove.h };
  L.walls = [post];                                   // drawn as an upright wall block

  L.rects = [
    { x: -60, y: 0, w: 84, h: H },                                  // left wall
    { x: ROOM.x1, y: 0, w: 84, h: H },                              // right wall
    { x: 0, y: ROOM.y1, w: W, h: 84 },                              // bottom wall
    { x: -60, y: -60, w: 60 + DOOR.x0, h: 84 },                     // top wall, left of door
    { x: DOOR.x1, y: -60, w: W - DOOR.x1 + 60, h: 84 },             // top wall, right of door
    { x: DOOR.x0, y: -90, w: DOOR.x1 - DOOR.x0, h: 96 },            // the door itself
    { x: -60, y: A.y0, w: 60 + A.gx0, h: A.y1 - A.y0 },             // wall A, left of the doorway
    { x: A.gx1, y: A.y0, w: W - A.gx1 + 60, h: A.y1 - A.y0 },       // wall A, right of it
    post,                                                            // alcove post
    L.gate,                                                          // the gate (stops colliding when open)
    { x: -60, y: B.y0, w: 60 + B.endX, h: B.y1 - B.y0 },            // wall B

    // ---- furniture ----
    { x: 330, y: 60,  w: 152, h: 160, kind: 'bed' },        // exit room
    { x: 60,  y: 120, w: 96,  h: 60,  kind: 'table' },
    { x: 430, y: 260, w: 84,  h: 96,  kind: 'dresser' },    // middle room
    { x: 60,  y: 560, w: 52,  h: 52,  kind: 'nightstand' },
    { x: 60,  y: 780, w: 150, h: 88,  kind: 'sofa' },       // start room
    { x: 250, y: 740, w: 96,  h: 58,  kind: 'table' },
    { x: 200, y: 888, w: 130, h: 40,  kind: 'tv' }
  ];

  L.circles = [
    { x: 486, y: 880, r: 22, kind: 'plant', seed: 10 },
    { x: 60,  y: 700, r: 20, kind: 'plant', seed: 11 },
    { x: 250, y: 290, r: 20, kind: 'plant', seed: 12 },
    { x: 486, y: 150, r: 15, kind: 'nightlamp' },
    // static hiding places are solid props
    { x: 420, y: 730, r: 17, kind: 'hidebase' },
    { x: 330, y: 560, r: 17, kind: 'hidebase' },
    { x: 353, y: 363, r: 17, kind: 'hidebase' }
  ];

  L.nightLight = new LightHazard({
    x: 486, y: 150, dir: -Math.PI / 2, half: 0.62, len: 130,
    on: true, dangerous: false, nearSafe: 0
  });
  L.doorLight = new LightHazard({
    x: (DOOR.x0 + DOOR.x1) / 2, y: 44, dir: Math.PI / 2, half: 0.62, len: 150,
    on: false, dangerous: false, nearSafe: 0                       // lights up once unlocked
  });
  L.lights = [L.nightLight, L.doorLight];

  // ---- three places to hide, plus the box that also moves ----
  L.box = new PushBox(472, 566);
  L.possessables = [
    new HideSpot(420, 730, 'pot',   'flower pot'),      // start room, by the doorway
    new HideSpot(330, 560, 'teddy', 'teddy bear'),      // middle room, by the box
    new HideSpot(353, 363, 'basket', 'laundry basket'), // middle room, near the exit doorway
    L.box
  ];
  L.movables = [L.box];       // dynamic colliders
  L.heavy    = [L.box];       // what the floor button accepts

  // ---- the puzzle chain: button → gate → key → door ----
  L.plate = new PressurePlate(430, 414);
  L.key   = new KeyPickup(86, 330);
  L.wire  = [[430, 414], [430, 462], [87, 462], [87, 414]];   // drawn on the floor

  L.door = new ExitDoor();    // starts locked; only the key opens it
  L.needsKey = true;

  L.humans = [new Human({
    path: [
      { x: 120, y: 590 },   // A — bottom-left, pause
      { x: 440, y: 600 },   // B — across to the box corner
      { x: 440, y: 470 },   // C — up the right side, past the button
      { x: 200, y: 470 },   // D — back across the middle, past the gate
      { x: 360, y: 300 }    // E — up to the exit doorway, pause, turn back
    ],
    speed: 96, pause: 1.2, range: 190, half: 0.46
  })];

  L.rug = { x: 250, y: 840, rx: 130, ry: 60 };
  L.decor = [
    { x: 192, y: 846, r: 14, kind: 'cushion', hue: '#5b6bb8' },
    { x: 300, y: 862, r: 12, kind: 'cushion', hue: '#7a5b9e' },
    { x: 288, y: 754, r: 11, kind: 'books' },
    { x: 86,  y: 148, r: 10, kind: 'mug' }
  ];

  L.dividers = [
    { y0: A.y0, y1: A.y1, segs: [[ROOM.x0, A.gx0], [A.gx1, ROOM.x1]],
      jambs: [{ x: A.gx0, side: -1 }, { x: A.gx1, side: 1 }] },
    { y0: B.y0, y1: B.y1, segs: [[ROOM.x0, B.endX]], jambs: [{ x: B.endX, side: -1 }] }
  ];

  finishLevel(L);
  return L;
}

/* -----------------------------------------------------------------------------
   LEVEL 5 — "Light & Shadow": the player rearranges the lighting itself.
   Lit floor is dangerous at a distance (the housemate sees 200px into it) while
   darkness hides you until they are almost on top of you (72px). Two lamps are
   controllable: a standing lamp that switches off, and a table lamp whose beam
   you aim between the two routes past the final wall.
   ----------------------------------------------------------------------------- */

const L5 = {
  wallA: { y0: 560, y1: 588, endX: 300 },                 // doorway on the right
  wallB: { y0: 300, y1: 328, gx0: 200, gx1: 330 }         // doorway in the middle
};

function buildLevel5() {
  const L = {};
  const A = L5.wallA, B = L5.wallB;

  L.rects = [
    { x: -60, y: 0, w: 84, h: H },                                  // left wall
    { x: ROOM.x1, y: 0, w: 84, h: H },                              // right wall
    { x: 0, y: ROOM.y1, w: W, h: 84 },                              // bottom wall
    { x: -60, y: -60, w: 60 + DOOR.x0, h: 84 },                     // top wall, left of door
    { x: DOOR.x1, y: -60, w: W - DOOR.x1 + 60, h: 84 },             // top wall, right of door
    { x: DOOR.x0, y: -90, w: DOOR.x1 - DOOR.x0, h: 96 },            // the door itself
    { x: -60, y: A.y0, w: 60 + A.endX, h: A.y1 - A.y0 },            // wall A
    { x: -60, y: B.y0, w: 60 + B.gx0, h: B.y1 - B.y0 },             // wall B, left part
    { x: B.gx1, y: B.y0, w: W - B.gx1 + 60, h: B.y1 - B.y0 },       // wall B, right part

    // ---- furniture ----
    { x: 50,  y: 672, w: 140, h: 80,  kind: 'sofa' },       // start room
    { x: 200, y: 800, w: 96,  h: 56,  kind: 'table' },
    { x: 330, y: 880, w: 130, h: 40,  kind: 'tv' },
    { x: 40,  y: 440, w: 84,  h: 96,  kind: 'dresser' },    // middle corridor
    // the bed splits the last room into a left and a right way round; light
    // still sweeps over it, so the lamp decides which way is safe
    { x: 190, y: 92,  w: 160, h: 148, kind: 'bed' },
    { x: 60,  y: 44,  w: 56,  h: 56,  kind: 'nightstand' }  // exit strip
  ];

  L.circles = [
    { x: 486, y: 852, r: 22, kind: 'plant', seed: 13 },
    { x: 60,  y: 380, r: 20, kind: 'plant', seed: 14 },
    { x: 486, y: 58,  r: 20, kind: 'plant', seed: 15 },
    { x: 410, y: 648, r: 16, kind: 'lampbase' },            // the standing lamp
    { x: 265, y: 262, r: 15, kind: 'aimlampbase' },         // the table lamp
    { x: 140, y: 820, r: 17, kind: 'hidebase' },
    { x: 330, y: 690, r: 17, kind: 'hidebase' },
    { x: 360, y: 510, r: 17, kind: 'hidebase' },
    { x: 150, y: 360, r: 17, kind: 'hidebase' }
  ];

  // ---- lamp 1: lights the only doorway out of the start room ----
  L.lamp1Light = new LightHazard({
    x: 410, y: 648, dir: -Math.PI / 2, half: 1.0, len: 280,
    on: true, dangerous: false, bright: true, occluded: true, nearSafe: 24
  });
  // ---- lamp 2: aimable, covers both ways past the island wall ----
  L.lamp2Light = new LightHazard({
    x: 265, y: 262, dir: -0.75, half: 0.55, len: 320,
    on: true, dangerous: false, bright: true, occluded: true, nearSafe: 22
  });
  L.doorLight = new LightHazard({
    x: (DOOR.x0 + DOOR.x1) / 2, y: 44, dir: Math.PI / 2, half: 0.62, len: 120,
    on: true, dangerous: false, nearSafe: 0
  });
  L.lights = [L.lamp1Light, L.lamp2Light, L.doorLight];

  L.lamp = new FloorLamp(410, 648, L.lamp1Light);                       // on/off
  L.aimLamp = new RotatingLamp(265, 262, L.lamp2Light, -2.50, -0.64);   // aimable

  L.possessables = [
    new HideSpot(140, 820, 'teddy',  'teddy bear'),     // dark start corner
    new HideSpot(330, 690, 'pot',    'flower pot'),     // beside lamp 1
    new HideSpot(360, 510, 'basket', 'laundry basket'), // just past the doorway
    new HideSpot(150, 360, 'box',    'cardboard box'),  // before the middle doorway
    L.lamp,
    L.aimLamp
  ];

  L.door = new ExitDoor();
  L.door.locked = false;
  L.door.open = 1;

  L.humans = [new Human({
    path: [
      // A — stands at the top of the doorway staring down it into the start room
      { x: 455, y: 505, face: [430, 700] },
      { x: 250, y: 420 },                              // B — across the corridor
      // C — stops below the bed and looks up the left-hand way
      { x: 230, y: 286, pause: 1.8, face: [100, 90] },
      // D — and at the far end, up the right-hand way
      { x: 430, y: 286, face: [470, 90] }
    ],
    speed: 100, pause: 2.2, range: 260, darkRange: 60, half: 0.46
  })];

  L.rug = { x: 240, y: 850, rx: 130, ry: 58 };
  L.decor = [
    { x: 186, y: 866, r: 14, kind: 'cushion', hue: '#5b6bb8' },
    { x: 296, y: 852, r: 12, kind: 'cushion', hue: '#7a5b9e' },
    { x: 236, y: 802, r: 11, kind: 'books' },
    { x: 86,  y: 72,  r: 10, kind: 'mug' }
  ];

  L.dividers = [
    { y0: A.y0, y1: A.y1, segs: [[ROOM.x0, A.endX]], jambs: [{ x: A.endX, side: -1 }] },
    { y0: B.y0, y1: B.y1, segs: [[ROOM.x0, B.gx0], [B.gx1, ROOM.x1]],
      jambs: [{ x: B.gx0, side: -1 }, { x: B.gx1, side: 1 }] }
  ];

  finishLevel(L);
  return L;
}

/** Shared tail end of every build: defaults, sight blockers, helpers. */
function finishLevel(L) {
  L.lights = L.lights || [];
  L.possessables = L.possessables || [];
  L.humans = L.humans || [];
  L.decor = L.decor || [];
  L.circles = L.circles || [];
  L.dividers = L.dividers || [];

  // only real walls stop a look — furniture would just make the cone noisy
  L.sight = L.rects.filter(r => !r.kind);

  L.lightAt = function (x, y) {                 // light that burns the ghost
    for (const l of this.lights) if (l.contains(x, y, this)) return true;
    return false;
  };
  L.brightAt = function (x, y) {                // light that makes the ghost easy to see
    for (const l of this.lights) if (l.bright && l.contains(x, y, this, false)) return true;
    return false;
  };
  /** A lamp was switched: nearby housemates glance over at it. */
  L.lampChanged = function (x, y) {
    for (const h of this.humans) if (dist(h.x, h.y, x, y) < 250) h.startle(x, y);
  };
  /** Is the ghost in somebody's view right now? */
  L.seenBy = function (x, y) {
    for (const h of this.humans) if (h.sees(x, y, this)) return h;
    return null;
  };
  return L;
}

/* ---- the level list; add future levels here ---- */
const LEVELS = [
  {
    name: 'Level 1', objective: 'Reach the exit',
    spawn: { x: 262, y: 826 }, build: buildLevel1,
    winTitle: 'LEVEL COMPLETE!',
    winText: 'The little ghost slipped away into the night.'
  },
  {
    name: 'Level 2', subtitle: 'First Human', objective: 'Do not be seen',
    spawn: { x: 270, y: 872 }, build: buildLevel2,
    winTitle: 'LEVEL 2 COMPLETE!',
    winText: 'Not a single floorboard creaked.',
    startHint: 'Someone is awake! Hide inside things to stay unseen.'
  },
  {
    name: 'Level 3', subtitle: 'Hide and Seek', objective: 'Time your moves',
    spawn: { x: 110, y: 900 }, build: buildLevel3,
    winTitle: 'LEVEL 3 COMPLETE!',
    winText: 'Four hiding places, one perfectly timed escape.',
    startHint: 'Watch their route first, then hop from one hiding place to the next.'
  },
  {
    name: 'Level 4', subtitle: 'The Locked Door', objective: 'Find the key',
    spawn: { x: 250, y: 855 }, build: buildLevel4,
    winTitle: 'LEVEL 4 COMPLETE!',
    winText: 'Box pushed, gate opened, key stolen, door unlocked.',
    startHint: 'The exit is locked. Something heavy could hold that floor button down...'
  },
  {
    name: 'Level 5', subtitle: 'Light & Shadow', objective: 'Make your own darkness',
    spawn: { x: 110, y: 870 }, build: buildLevel5,
    winTitle: 'LEVEL 5 COMPLETE!',
    winText: 'Lights out, shadows arranged, ghost gone.',
    startHint: 'They see far in the light — but barely at all in the dark.'
  }
];

/* =============================================================================
   7. RENDER — everything is drawn procedurally onto the canvas
   ============================================================================= */

const Draw = {

  /* ---------- floor ---------- */
  floor(ctx) {
    const g = ctx.createRadialGradient(270, 540, 40, 270, 540, 640);
    g.addColorStop(0, '#1b2252');
    g.addColorStop(0.55, '#131a42');
    g.addColorStop(1, '#0a0e26');
    ctx.fillStyle = g;
    ctx.fillRect(ROOM.x0, ROOM.y0, ROOM.x1 - ROOM.x0, ROOM.y1 - ROOM.y0);

    // floorboards
    ctx.save();
    ctx.beginPath();
    ctx.rect(ROOM.x0, ROOM.y0, ROOM.x1 - ROOM.x0, ROOM.y1 - ROOM.y0);
    ctx.clip();
    ctx.lineWidth = 1;
    for (let y = ROOM.y0 + 46; y < ROOM.y1; y += 46) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.moveTo(ROOM.x0, y); ctx.lineTo(ROOM.x1, y); ctx.stroke();
      ctx.strokeStyle = 'rgba(190,215,255,0.045)';
      ctx.beginPath(); ctx.moveTo(ROOM.x0, y + 1); ctx.lineTo(ROOM.x1, y + 1); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    for (let row = 0, y = ROOM.y0; y < ROOM.y1; y += 46, row++) {
      const off = (row % 2) * 82;
      for (let x = ROOM.x0 + off; x < ROOM.x1; x += 164) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 46); ctx.stroke();
      }
    }
    ctx.restore();
  },

  rug(ctx, r) {
    ctx.save();
    ctx.globalAlpha = 0.92;
    const g = ctx.createRadialGradient(r.x, r.y, 6, r.x, r.y, r.rx);
    g.addColorStop(0, '#3b3470');
    g.addColorStop(0.55, '#332e63');
    g.addColorStop(1, '#282450');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(180,170,255,0.10)';
    ctx.beginPath(); ctx.ellipse(r.x, r.y, r.rx * 0.72, r.ry * 0.72, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,210,160,0.08)';
    ctx.beginPath(); ctx.ellipse(r.x, r.y, r.rx * 0.45, r.ry * 0.45, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  },

  /* ---------- lights ---------- */
  cone(ctx, z, time, level) {
    const R = z.reach;
    if (R < 10) return;
    const warm = z.dangerous ? '255,206,120' : (z.bright ? '255,224,160' : '255,236,190');
    const pulse = z.flicker * (z.dangerous ? 1 + 0.05 * Math.sin(time * 2.3) : 1);
    const g = ctx.createRadialGradient(z.x, z.y, 6, z.x, z.y, R);
    g.addColorStop(0,    'rgba(' + warm + ',' + (0.62 * z.fade * pulse) + ')');
    g.addColorStop(0.45, 'rgba(' + warm + ',' + (0.34 * z.fade * pulse) + ')');
    g.addColorStop(0.82, 'rgba(' + warm + ',' + (0.17 * z.fade * pulse) + ')');
    g.addColorStop(0.97, 'rgba(' + warm + ',' + (0.10 * z.fade * pulse) + ')');
    g.addColorStop(1,    'rgba(' + warm + ',0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    if (z.occluded && level) {                   // walls carve real shadows out of it
      const pts = conePoints(level, z, 26);
      ctx.moveTo(z.x, z.y);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
    } else {
      ctx.moveTo(z.x, z.y);
      ctx.arc(z.x, z.y, R, z.dir - z.half, z.dir + z.half);
      ctx.closePath();
    }
    ctx.fill();

    // A readable danger boundary: the player must know exactly where it burns.
    if (z.dangerous) {
      ctx.strokeStyle = 'rgba(255,180,110,' + (0.34 * z.fade) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -Game.time * 14;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  },

  /** Light that squeezes through a doorway keeps going as a narrow beam. */
  shaftBeam(ctx, z, time) {
    const s = z.shaft;
    const tip = z.y - z.reach;
    if (tip > s.wallY0 - 4) return;
    const y0 = s.wallY0, y1 = Math.max(ROOM.y0, tip);
    const spread = 16;
    const a = 0.46 * z.fade * z.flicker;
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(255,206,120,' + a + ')');
    g.addColorStop(0.7, 'rgba(255,206,120,' + (a * 0.5) + ')');
    g.addColorStop(1, 'rgba(255,206,120,0)');

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(s.gx0, y0); ctx.lineTo(s.gx1, y0);
    ctx.lineTo(s.gx1 + spread, y1); ctx.lineTo(s.gx0 - spread, y1);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = 'rgba(255,180,110,' + (0.32 * z.fade) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -time * 14;
    ctx.beginPath();
    ctx.moveTo(s.gx0, y0); ctx.lineTo(s.gx0 - spread, y1);
    ctx.moveTo(s.gx1, y0); ctx.lineTo(s.gx1 + spread, y1);
    ctx.moveTo(s.gx0 - spread, y1); ctx.lineTo(s.gx1 + spread, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },

  lights(ctx, level, time) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ROOM.x0, ROOM.y0, ROOM.x1 - ROOM.x0, ROOM.y1 - ROOM.y0);
    ctx.clip();
    for (const z of level.lights) {
      if (z.fade < 0.02) continue;
      if (z.shaft) {
        // light below the divider wall...
        ctx.save();
        ctx.beginPath();
        ctx.rect(ROOM.x0, z.shaft.wallY1, ROOM.x1 - ROOM.x0, ROOM.y1 - z.shaft.wallY1);
        ctx.clip();
        this.cone(ctx, z, time, level);
        ctx.restore();
        // ...and the shaft that escapes through the doorway
        this.shaftBeam(ctx, z, time);
      } else {
        this.cone(ctx, z, time, level);
      }
    }
    ctx.restore();
  },

  /** Clip whatever comes next to the lit floor — used to split the vision cone. */
  clipToBright(ctx, level) {
    ctx.beginPath();
    let any = false;
    for (const z of level.lights) {
      if (!z.bright || z.fade < 0.4 || z.reach < 10) continue;
      const pts = conePoints(level, z, 20);
      ctx.moveTo(z.x, z.y);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      any = true;
    }
    if (!any) ctx.rect(0, 0, 0, 0);             // nothing lit: clip everything away
    ctx.clip();
  },

  /* ---------- walls ---------- */
  walls(ctx) {
    const t = ROOM.y0;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a3168');
    g.addColorStop(1, '#191e46');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, t);
    ctx.fillRect(0, ROOM.y1, W, H - ROOM.y1);
    ctx.fillRect(0, 0, t, H);
    ctx.fillRect(ROOM.x1, 0, W - ROOM.x1, H);

    // inner rim highlight + soft baseboard shadow inside the room
    ctx.strokeStyle = 'rgba(160,195,255,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ROOM.x0 + 1, ROOM.y0 + 1, ROOM.x1 - ROOM.x0 - 2, ROOM.y1 - ROOM.y0 - 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(ROOM.x0, ROOM.y0, ROOM.x1 - ROOM.x0, ROOM.y1 - ROOM.y0);
    ctx.clip();
    const sh = 18;
    const mk = (x0, y0, x1, y1) => {
      const lg = ctx.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, 'rgba(0,0,0,0.38)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg;
    };
    mk(0, ROOM.y0, 0, ROOM.y0 + sh); ctx.fillRect(ROOM.x0, ROOM.y0, ROOM.x1 - ROOM.x0, sh);
    mk(ROOM.x0, 0, ROOM.x0 + sh, 0); ctx.fillRect(ROOM.x0, ROOM.y0, sh, ROOM.y1 - ROOM.y0);
    mk(ROOM.x1, 0, ROOM.x1 - sh, 0); ctx.fillRect(ROOM.x1 - sh, ROOM.y0, sh, ROOM.y1 - ROOM.y0);
    mk(0, ROOM.y1, 0, ROOM.y1 - sh); ctx.fillRect(ROOM.x0, ROOM.y1 - sh, ROOM.x1 - ROOM.x0, sh);
    ctx.restore();

    // star garland along the top wall
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 58, y = 12 + Math.sin(i * 1.1) * 3;
      const a = 0.35 + 0.3 * Math.sin(Game.time * 2 + i);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,226,160,' + a + ')';
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.fill();
      ctx.restore();
    }
  },

  divider(ctx, d) {
    const h = d.y1 - d.y0;
    for (const [a, b] of d.segs) {
      softShadow(ctx, (a + b) / 2, d.y1 + 8, (b - a) / 2, 14, 0.45);
      const g = ctx.createLinearGradient(0, d.y0 - 10, 0, d.y1);
      g.addColorStop(0, '#39417e');
      g.addColorStop(1, '#1e2453');
      ctx.fillStyle = g;
      rr(ctx, a, d.y0 - 10, b - a, h + 10, 5); ctx.fill();
      ctx.fillStyle = 'rgba(170,200,255,0.14)';
      rr(ctx, a, d.y0 - 10, b - a, 4, 2); ctx.fill();
    }
    // doorway jambs
    ctx.fillStyle = 'rgba(255,225,180,0.10)';
    for (const j of d.jambs) {
      ctx.fillRect(j.side < 0 ? j.x - 3 : j.x, d.y0 - 10, 3, h + 10);
    }
  },

  /* ---------- generic 2.5D block ---------- */
  block(ctx, r, lift, top, side, radius) {
    softShadow(ctx, r.x + r.w / 2, r.y + r.h + 2, r.w * 0.60, 13, 0.42);
    ctx.fillStyle = side;
    rr(ctx, r.x, r.y + r.h - lift - radius, r.w, lift + radius, radius); ctx.fill();
    ctx.fillStyle = top;
    rr(ctx, r.x, r.y - lift, r.w, r.h, radius); ctx.fill();
    return { x: r.x, y: r.y - lift, w: r.w, h: r.h };
  },

  /* ---------- furniture ---------- */
  furniture(ctx, r) {
    switch (r.kind) {
      case 'sofa': {
        const t = this.block(ctx, r, 14, '#44508f', '#2c3465', 16);
        ctx.fillStyle = '#36407a';                       // backrest (top edge)
        rr(ctx, t.x + 4, t.y + 3, t.w - 8, 24, 11); ctx.fill();
        ctx.fillStyle = '#5766ad';                       // cushions
        rr(ctx, t.x + 8, t.y + 30, t.w / 2 - 12, t.h - 40, 10); ctx.fill();
        rr(ctx, t.x + t.w / 2 + 4, t.y + 30, t.w / 2 - 12, t.h - 40, 10); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        rr(ctx, t.x + 8, t.y + 30, t.w / 2 - 12, 8, 6); ctx.fill();
        ctx.fillStyle = '#3a4584';                       // arms
        rr(ctx, t.x, t.y + 20, 12, t.h - 24, 6); ctx.fill();
        rr(ctx, t.x + t.w - 12, t.y + 20, 12, t.h - 24, 6); ctx.fill();
        break;
      }
      case 'table': {
        const t = this.block(ctx, r, 18, '#6b4f57', '#3f2f38', 12);
        ctx.fillStyle = 'rgba(255,220,180,0.10)';
        rr(ctx, t.x + 7, t.y + 7, t.w - 14, t.h - 14, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
        rr(ctx, t.x + 7, t.y + 7, t.w - 14, t.h - 14, 8); ctx.stroke();
        break;
      }
      case 'tv': {
        const t = this.block(ctx, r, 28, '#2b3162', '#1a1f44', 8);
        // screen
        ctx.fillStyle = '#0e1330';
        rr(ctx, t.x + 10, t.y + 6, t.w - 20, t.h - 14, 6); ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const sg = ctx.createLinearGradient(0, t.y, 0, t.y + t.h);
        sg.addColorStop(0, 'rgba(120,170,255,0.20)');
        sg.addColorStop(1, 'rgba(90,150,255,0.05)');
        ctx.fillStyle = sg;
        rr(ctx, t.x + 10, t.y + 6, t.w - 20, t.h - 14, 6); ctx.fill();
        const bloom = ctx.createRadialGradient(t.x + t.w / 2, t.y + t.h / 2, 4, t.x + t.w / 2, t.y + t.h / 2, t.w * 0.6);
        bloom.addColorStop(0, 'rgba(110,170,255,0.16)');
        bloom.addColorStop(1, 'rgba(110,170,255,0)');
        ctx.fillStyle = bloom;
        ctx.fillRect(t.x - 30, t.y - 20, t.w + 60, t.h + 40);
        ctx.restore();
        ctx.strokeStyle = 'rgba(170,200,255,0.18)'; ctx.lineWidth = 2;
        rr(ctx, t.x + 10, t.y + 6, t.w - 20, t.h - 14, 6); ctx.stroke();
        break;
      }
      case 'bed': {
        const t = this.block(ctx, r, 16, '#4a3f78', '#2b2450', 14);
        ctx.fillStyle = '#8e93cf';                                   // mattress
        rr(ctx, t.x + 7, t.y + 34, t.w - 14, t.h - 44, 12); ctx.fill();
        ctx.fillStyle = '#6f6bb8';                                   // blanket
        rr(ctx, t.x + 7, t.y + t.h * 0.46, t.w - 14, t.h * 0.46, 12); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        rr(ctx, t.x + 7, t.y + t.h * 0.46, t.w - 14, 7, 4); ctx.fill();
        ctx.fillStyle = '#dfe4ff';                                   // pillow
        rr(ctx, t.x + 22, t.y + 10, t.w - 44, 30, 12); ctx.fill();
        ctx.fillStyle = 'rgba(120,120,190,0.35)';
        rr(ctx, t.x + 22, t.y + 30, t.w - 44, 8, 6); ctx.fill();
        break;
      }
      case 'dresser': {
        const t = this.block(ctx, r, 24, '#4d3f5c', '#2c2439', 10);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        for (let i = 0; i < 3; i++) { rr(ctx, t.x + 9, t.y + 10 + i * 28, t.w - 18, 20, 6); ctx.fill(); }
        ctx.fillStyle = 'rgba(255,214,150,0.5)';
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(t.x + t.w / 2, t.y + 20 + i * 28, 3, 0, TAU); ctx.fill(); }
        break;
      }
      case 'nightstand': {
        const t = this.block(ctx, r, 18, '#4d3f5c', '#2c2439', 9);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        rr(ctx, t.x + 8, t.y + 12, t.w - 16, 16, 5); ctx.fill();
        ctx.fillStyle = 'rgba(255,214,150,0.5)';
        ctx.beginPath(); ctx.arc(t.x + t.w / 2, t.y + 20, 3, 0, TAU); ctx.fill();
        break;
      }
    }
  },

  plant(ctx, c, time) {
    softShadow(ctx, c.x, c.y + c.r * 0.7, c.r * 1.1, c.r * 0.5, 0.42);
    ctx.fillStyle = '#7a4a44';                                      // pot
    rr(ctx, c.x - c.r * 0.7, c.y - 2, c.r * 1.4, c.r * 0.95, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    rr(ctx, c.x - c.r * 0.7, c.y - 2, c.r * 1.4, 5, 3); ctx.fill();
    const sway = Math.sin(time * 1.3 + c.seed) * 0.09;              // leaves
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.52 + sway;
      const len = c.r * (1.25 + (i % 2) * 0.35);
      ctx.save();
      ctx.translate(c.x, c.y - 2);
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, 0, -len);
      g.addColorStop(0, '#2f6b52'); g.addColorStop(1, '#49a179');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, -len * 0.55, c.r * 0.26, len * 0.55, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  },

  decor(ctx, d) {
    switch (d.kind) {
      case 'cushion':
        softShadow(ctx, d.x, d.y + 6, d.r * 1.2, d.r * 0.5, 0.35);
        ctx.fillStyle = d.hue;
        rr(ctx, d.x - d.r, d.y - d.r * 0.75, d.r * 2, d.r * 1.5, d.r * 0.6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        rr(ctx, d.x - d.r + 3, d.y - d.r * 0.75 + 3, d.r * 2 - 6, 5, 3); ctx.fill();
        break;
      case 'books':
        softShadow(ctx, d.x, d.y + 6, 16, 7, 0.3);
        ['#c4585e', '#5b86c9', '#d8a24a'].forEach((c, i) => {
          ctx.fillStyle = c;
          rr(ctx, d.x - 15, d.y - i * 6, 30, 5, 2); ctx.fill();
        });
        break;
      case 'mug':
        softShadow(ctx, d.x, d.y + 4, 9, 4, 0.3);
        ctx.fillStyle = '#e7eefc';
        rr(ctx, d.x - 6, d.y - 8, 12, 12, 4); ctx.fill();
        ctx.strokeStyle = '#e7eefc'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(d.x + 8, d.y - 2, 4, -1, 1.4); ctx.stroke();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(200,225,255,0.25)';
        ctx.beginPath(); ctx.ellipse(d.x, d.y - 14 - Math.sin(Game.time * 2) * 2, 5, 8, 0, 0, TAU); ctx.fill();
        ctx.restore();
        break;
    }
  },

  /* ---------- possessables ---------- */
  highlightRing(ctx, o, time) {
    const a = Math.max(o.highlight * 0.9, o.glow);
    if (a < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pr = o.r + 12 + Math.sin(time * 3.4) * 3;
    ctx.strokeStyle = 'rgba(140,215,255,' + (0.55 * a) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(o.x, o.y, pr, pr * 0.62, 0, 0, TAU); ctx.stroke();
    const g = ctx.createRadialGradient(o.x, o.y, 2, o.x, o.y, pr * 1.8);
    g.addColorStop(0, 'rgba(120,200,255,' + (0.30 * a) + ')');
    g.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(o.x, o.y, pr * 1.8, pr * 1.2, 0, 0, TAU); ctx.fill();
    ctx.restore();
  },

  lamp(ctx, lamp, time) {
    const bob = lamp.sway * Math.sin(time * 22) * 3;
    const pop = 1 + lamp.pop * 0.12;
    this.highlightRing(ctx, lamp, time);
    softShadow(ctx, lamp.x, lamp.y + 6, 26, 11, 0.5);

    ctx.save();
    ctx.translate(lamp.x + bob, lamp.y);
    ctx.scale(pop, pop);

    ctx.fillStyle = '#3b4380';                                   // base
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(190,215,255,0.16)';
    ctx.beginPath(); ctx.ellipse(0, -2, 22, 8, 0, 0, TAU); ctx.fill();

    ctx.strokeStyle = '#5a639f'; ctx.lineWidth = 6;              // pole
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -66); ctx.stroke();

    const on = lamp.light.fade;
    ctx.beginPath();                                             // shade
    ctx.moveTo(-16, -66); ctx.lineTo(16, -66);
    ctx.lineTo(27, -100); ctx.lineTo(-27, -100); ctx.closePath();
    const sg = ctx.createLinearGradient(0, -100, 0, -66);
    sg.addColorStop(0, on > 0.5 ? '#ffe4a8' : '#5b6098');
    sg.addColorStop(1, on > 0.5 ? '#ffb95e' : '#454a80');
    ctx.fillStyle = sg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();

    if (on > 0.05) {                                             // bulb bloom
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -68, 2, 0, -68, 56);
      g.addColorStop(0, 'rgba(255,231,170,' + (0.75 * on) + ')');
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -68, 56, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    if (lamp.glow > 0.02) this.possessAura(ctx, lamp.x, lamp.y - 50, 46, lamp.glow, time);
  },

  /** The aimable table lamp: a head that swings, plus a dial while you hold it. */
  aimLamp(ctx, lamp, time) {
    this.highlightRing(ctx, lamp, time);
    softShadow(ctx, lamp.x, lamp.y + 6, 20, 9, 0.45);
    const pop = 1 + lamp.pop * 0.12;
    const on = lamp.light.fade;

    // the sweep dial, only while the player is holding it
    if (lamp.glow > 0.02) {
      ctx.save();
      ctx.globalAlpha = lamp.glow;
      ctx.translate(lamp.x, lamp.y);
      ctx.strokeStyle = 'rgba(150,215,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 40, lamp.min, lamp.max); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,226,160,0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 40, lamp.dir - 0.06, lamp.dir + 0.06); ctx.stroke();
      for (const a of [lamp.min, lamp.max]) {     // end stops
        ctx.fillStyle = 'rgba(150,215,255,0.5)';
        ctx.beginPath(); ctx.arc(Math.cos(a) * 40, Math.sin(a) * 40, 3.2, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(lamp.x, lamp.y);
    ctx.scale(pop, pop);
    ctx.fillStyle = '#3b4380';                                  // base
    ctx.beginPath(); ctx.ellipse(0, 0, 17, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(190,215,255,0.16)';
    ctx.beginPath(); ctx.ellipse(0, -2, 17, 7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5a639f'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -24); ctx.stroke();

    ctx.save();                                                 // the swinging head
    ctx.translate(0, -26);
    ctx.rotate(lamp.dir + Math.PI / 2);
    const sg = ctx.createLinearGradient(0, -16, 0, 6);
    sg.addColorStop(0, on > 0.5 ? '#ffe4a8' : '#5b6098');
    sg.addColorStop(1, on > 0.5 ? '#ffb95e' : '#454a80');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(-11, 4); ctx.lineTo(11, 4); ctx.lineTo(17, -18); ctx.lineTo(-17, -18);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
    if (on > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -20, 2, 0, -20, 40);
      g.addColorStop(0, 'rgba(255,231,170,' + (0.7 * on) + ')');
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -20, 40, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();

    if (lamp.glow > 0.02) this.possessAura(ctx, lamp.x, lamp.y - 20, 38, lamp.glow, time);
  },

  nightLamp(ctx, c, light, time) {
    softShadow(ctx, c.x, c.y + 4, 18, 8, 0.45);
    ctx.fillStyle = '#3b4380';
    ctx.beginPath(); ctx.ellipse(c.x, c.y, 15, 7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5a639f'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(c.x, c.y - 2); ctx.lineTo(c.x, c.y - 40); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x - 12, c.y - 40); ctx.lineTo(c.x + 12, c.y - 40);
    ctx.lineTo(c.x + 19, c.y - 66); ctx.lineTo(c.x - 19, c.y - 66); ctx.closePath();
    const sg = ctx.createLinearGradient(0, c.y - 66, 0, c.y - 40);
    sg.addColorStop(0, '#ffe0a0'); sg.addColorStop(1, '#ffb95e');
    ctx.fillStyle = sg; ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(c.x, c.y - 44, 2, c.x, c.y - 44, 44);
    g.addColorStop(0, 'rgba(255,231,170,' + (0.6 * light.fade) + ')');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c.x, c.y - 44, 44, 0, TAU); ctx.fill();
    ctx.restore();
  },

  fan(ctx, fan, time) {
    this.highlightRing(ctx, fan, time);
    softShadow(ctx, fan.x, fan.y + 6, 24, 10, 0.45);
    const pop = 1 + fan.pop * 0.12;
    ctx.save();
    ctx.translate(fan.x, fan.y);
    ctx.scale(pop, pop);

    ctx.fillStyle = '#3b4380';
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 8, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5a639f'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -26); ctx.stroke();

    ctx.save();                                   // cage + blades
    ctx.translate(0, -44);
    ctx.fillStyle = 'rgba(20,26,60,0.75)';
    ctx.beginPath(); ctx.arc(0, 0, 25, 0, TAU); ctx.fill();
    ctx.save();
    ctx.rotate(fan.spin);
    for (let i = 0; i < 3; i++) {
      ctx.rotate(TAU / 3);
      const g = ctx.createLinearGradient(0, 0, 20, 0);
      g.addColorStop(0, '#9fb4ee'); g.addColorStop(1, '#6a7fc4');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(11, 0, 12, 6, 0.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#cfe0ff';
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(190,215,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 25, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(190,215,255,0.18)'; ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) { ctx.beginPath(); ctx.arc(0, 0, 25 * i / 3, 0, TAU); ctx.stroke(); }
    ctx.restore();
    ctx.restore();

    if (fan.glow > 0.02) this.possessAura(ctx, fan.x, fan.y - 30, 40, fan.glow, time);
  },

  car(ctx, car, time) {
    this.highlightRing(ctx, car, time);
    softShadow(ctx, car.x, car.y + 8, 20, 9, 0.45);
    const pop = 1 + car.pop * 0.15 + car.bump * 0.06;
    ctx.save();
    ctx.translate(car.x, car.y - 3);
    ctx.rotate(car.angle + Math.PI / 2);
    ctx.scale(pop, pop);

    ctx.fillStyle = '#1a1f40';                                  // wheels
    for (const [wx, wy] of [[-13, -8], [13, -8], [-13, 9], [13, 9]]) {
      ctx.save(); ctx.translate(wx, wy);
      rr(ctx, -4, -7, 8, 14, 3); ctx.fill();
      ctx.fillStyle = 'rgba(200,220,255,0.35)';
      ctx.beginPath(); ctx.arc(0, Math.sin(car.wheel + wx) * 3, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a1f40';
      ctx.restore();
    }
    const bg = ctx.createLinearGradient(0, -22, 0, 22);          // body
    bg.addColorStop(0, '#ff9a7a'); bg.addColorStop(1, '#e4564f');
    ctx.fillStyle = bg;
    rr(ctx, -15, -22, 30, 44, 9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rr(ctx, -12, -19, 9, 34, 5); ctx.fill();
    ctx.fillStyle = '#bfe6ff';                                   // windshield
    rr(ctx, -11, -15, 22, 13, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    rr(ctx, -11, -15, 22, 5, 3); ctx.fill();
    ctx.fillStyle = '#ffe9b0';                                   // headlights
    ctx.beginPath(); ctx.arc(-9, -21, 3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(9, -21, 3, 0, TAU); ctx.fill();
    if (car.possessed) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, -24, 0, -80);
      g.addColorStop(0, 'rgba(255,235,170,0.35)');
      g.addColorStop(1, 'rgba(255,235,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-11, -22); ctx.lineTo(11, -22);
      ctx.lineTo(30, -78); ctx.lineTo(-30, -78); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    if (car.glow > 0.02) this.possessAura(ctx, car.x, car.y, 34, car.glow, time);
  },

  possessAura(ctx, x, y, r, a, time) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pr = r * (1 + 0.06 * Math.sin(time * 5));
    const g = ctx.createRadialGradient(x, y, 2, x, y, pr);
    g.addColorStop(0, 'rgba(150,225,255,' + (0.42 * a) + ')');
    g.addColorStop(0.55, 'rgba(90,170,255,' + (0.2 * a) + ')');
    g.addColorStop(1, 'rgba(90,170,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(190,240,255,' + (0.35 * a) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, pr * 0.62, time * 2, time * 2 + 2.2); ctx.stroke();
    ctx.restore();
  },

  /* ---------- puzzle props ---------- */
  plate(ctx, p, time) {
    const press = p.press;
    softShadow(ctx, p.x, p.y + 4, p.r * 1.1, p.r * 0.5, 0.4);
    ctx.fillStyle = '#232a58';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 0.52, 0, 0, TAU); ctx.fill();

    const lift = 6 * (1 - press);
    const col = p.pressed ? '#5ee6a4' : '#8ea0e8';
    ctx.fillStyle = p.pressed ? '#2e6d55' : '#39427e';
    ctx.beginPath(); ctx.ellipse(p.x, p.y - lift, p.r * 0.82, p.r * 0.43, 0, 0, TAU); ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(time * 3 + (p.pressed ? 0 : 1));
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(p.x, p.y - lift, p.r * 0.6, p.r * 0.31, 0, 0, TAU); ctx.stroke();
    // ripple while idle so the player notices it
    const rp = (p.ring % 1);
    ctx.globalAlpha = (1 - rp) * (p.pressed ? 0.25 : 0.4);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - lift, p.r * (0.5 + rp * 0.75), p.r * (0.26 + rp * 0.39), 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // little arrows pointing in
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = col;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const d = p.r * 0.95 + (p.pressed ? 0 : Math.sin(time * 3) * 2);
      ctx.save();
      ctx.translate(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.52);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(4, 3); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  door(ctx, d, time) {
    const cx = (d.x0 + d.x1) / 2;
    const w = d.x1 - d.x0;
    const shk = d.shake ? Math.sin(time * 55) * d.shake * 3 : 0;
    const open = d.open;

    ctx.save();
    ctx.translate(shk, 0);

    // recessed frame
    ctx.fillStyle = '#10142f';
    rr(ctx, d.x0 - 9, -14, w + 18, 76, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(170,200,255,0.22)'; ctx.lineWidth = 3;
    rr(ctx, d.x0 - 9, -14, w + 18, 76, 12); ctx.stroke();

    // the corridor beyond, warm when unlocked
    const back = ctx.createLinearGradient(0, -10, 0, 58);
    back.addColorStop(0, open > 0.05 ? 'rgba(255,232,176,' + (0.85 * open) + ')' : 'rgba(22,28,64,1)');
    back.addColorStop(1, open > 0.05 ? 'rgba(255,196,110,' + (0.45 * open) + ')' : 'rgba(16,20,48,1)');
    ctx.fillStyle = '#161c40';
    rr(ctx, d.x0, -10, w, 66, 8); ctx.fill();
    ctx.fillStyle = back;
    rr(ctx, d.x0, -10, w, 66, 8); ctx.fill();

    // door slab: swings to the left as it opens
    ctx.save();
    ctx.translate(d.x0 + 3, 54);
    ctx.rotate(-open * 1.15);
    const slab = ctx.createLinearGradient(0, -66, w, 0);
    slab.addColorStop(0, '#4b3f6e');
    slab.addColorStop(1, '#392f57');
    ctx.fillStyle = slab;
    rr(ctx, 0, -64, w - 6, 64, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(200,215,255,0.20)'; ctx.lineWidth = 2;
    rr(ctx, 6, -56, w - 18, 46, 5); ctx.stroke();
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath(); ctx.arc(w - 16, -30, 3.4, 0, TAU); ctx.fill();   // knob
    ctx.restore();

    // light spilling into the room
    if (open > 0.03) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ROOM.x0, ROOM.y0, ROOM.x1 - ROOM.x0, ROOM.y1 - ROOM.y0);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const g2 = ctx.createLinearGradient(0, 24, 0, 24 + 150 * open);
      g2.addColorStop(0, 'rgba(255,226,160,' + (0.34 * open) + ')');
      g2.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(d.x0, 24); ctx.lineTo(d.x1, 24);
      ctx.lineTo(d.x1 + 52 * open, 24 + 150 * open);
      ctx.lineTo(d.x0 - 52 * open, 24 + 150 * open);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // lock indicator
    const lockA = 1 - open;
    if (lockA > 0.02) {
      ctx.save();
      ctx.globalAlpha = lockA;
      ctx.translate(cx, 76);
      ctx.fillStyle = 'rgba(10,14,36,0.8)';
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#9fb2f0'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, -3, 5, Math.PI, 0); ctx.stroke();   // shackle
      ctx.fillStyle = '#c6d6ff';
      rr(ctx, -6.5, -3, 13, 11, 2.5); ctx.fill();
      ctx.fillStyle = '#2b3160';
      ctx.beginPath(); ctx.arc(0, 2.5, 1.8, 0, TAU); ctx.fill();
      ctx.restore();
    } else {
      // exit arrow once it is open
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(time * 4);
      ctx.fillStyle = '#c8ffd9';
      ctx.translate(cx, 84 + Math.sin(time * 3) * 4);
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(9, 4); ctx.lineTo(-9, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  /* ---------- hiding places ---------- */
  hideSpot(ctx, o, time) {
    this.highlightRing(ctx, o, time);
    const tilt = Math.sin(time * 9 + o.seed) * 0.10 * o.wobble
               + (o.possessed ? Math.sin(time * 2.4 + o.seed) * 0.03 : 0);
    const pop = 1 + o.pop * 0.14;
    softShadow(ctx, o.x, o.y + 10, 24, 10, 0.45);

    ctx.save();
    ctx.translate(o.x, o.y + 8);
    ctx.rotate(tilt);
    ctx.scale(pop, pop);
    ctx.translate(0, -8);

    if (o.kind === 'pot') {
      const sway = Math.sin(time * 1.4 + o.seed) * 0.10;
      for (let i = 0; i < 5; i++) {                       // leaves
        const a = -Math.PI / 2 + (i - 2) * 0.5 + sway;
        const len = 30 + (i % 2) * 10;
        ctx.save(); ctx.rotate(a);
        const lg = ctx.createLinearGradient(0, 0, 0, -len);
        lg.addColorStop(0, '#2f6b52'); lg.addColorStop(1, '#4fb489');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.ellipse(0, -len * 0.55, 6, len * 0.55, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      const pg = ctx.createLinearGradient(0, -4, 0, 20);   // terracotta pot
      pg.addColorStop(0, '#d98a63'); pg.addColorStop(1, '#a85f45');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(-17, -4); ctx.lineTo(17, -4); ctx.lineTo(12, 20); ctx.lineTo(-12, 20);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e39a72';
      rr(ctx, -19, -9, 38, 8, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      rr(ctx, -14, -2, 5, 18, 2.5); ctx.fill();

    } else if (o.kind === 'box') {
      ctx.fillStyle = '#8a6242';                          // open flaps
      ctx.beginPath(); ctx.moveTo(-20, -8); ctx.lineTo(-4, -4); ctx.lineTo(-9, -17); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(20, -8); ctx.lineTo(4, -4); ctx.lineTo(9, -17); ctx.closePath(); ctx.fill();
      const bg = ctx.createLinearGradient(0, -8, 0, 22);   // cardboard body
      bg.addColorStop(0, '#c99562'); bg.addColorStop(1, '#9a6b44');
      ctx.fillStyle = bg;
      rr(ctx, -21, -8, 42, 30, 4); ctx.fill();
      ctx.fillStyle = 'rgba(60,36,20,0.35)';              // dark opening
      rr(ctx, -15, -8, 30, 7, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,210,0.35)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0, 22); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      rr(ctx, -18, -5, 6, 24, 3); ctx.fill();

    } else if (o.kind === 'basket') {                     // laundry basket
      const kg = ctx.createLinearGradient(0, -10, 0, 22);
      kg.addColorStop(0, '#e0c08a'); kg.addColorStop(1, '#ab8552');
      ctx.fillStyle = kg;
      ctx.beginPath();
      ctx.moveTo(-19, -8); ctx.lineTo(19, -8); ctx.lineTo(15, 22); ctx.lineTo(-15, 22);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(110,78,40,0.35)'; ctx.lineWidth = 1.6;   // weave
      for (let i = 0; i < 3; i++) {
        const y = -1 + i * 8, w = 18 - i * 1.3;
        ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
      }
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(i * 8, -7); ctx.lineTo(i * 6.4, 21); ctx.stroke();
      }
      ctx.fillStyle = '#dfe7ff';                                       // a sock peeking out
      rr(ctx, 3, -17, 13, 9, 4); ctx.fill();
      ctx.fillStyle = '#efd3a2';                                       // rim
      rr(ctx, -21, -13, 42, 9, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      rr(ctx, -16, -4, 5, 22, 2.5); ctx.fill();

    } else {                                              // teddy bear
      ctx.fillStyle = '#b07a52';
      ctx.beginPath(); ctx.ellipse(-14, 6, 6, 6, 0, 0, TAU); ctx.fill();   // arms
      ctx.beginPath(); ctx.ellipse(14, 6, 6, 6, 0, 0, TAU); ctx.fill();
      const tg = ctx.createLinearGradient(0, -6, 0, 22);
      tg.addColorStop(0, '#d0996b'); tg.addColorStop(1, '#a9754c');
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.ellipse(0, 8, 14, 13, 0, 0, TAU); ctx.fill();   // body
      ctx.fillStyle = '#b07a52';
      ctx.beginPath(); ctx.arc(-9, -16, 5.5, 0, TAU); ctx.fill();          // ears
      ctx.beginPath(); ctx.arc(9, -16, 5.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d0996b';
      ctx.beginPath(); ctx.arc(0, -10, 12, 0, TAU); ctx.fill();            // head
      ctx.fillStyle = '#efc79c';
      ctx.beginPath(); ctx.ellipse(0, -6, 6.5, 5, 0, 0, TAU); ctx.fill();  // muzzle
      if (!o.possessed) {
        ctx.fillStyle = '#3a2a22';
        ctx.beginPath(); ctx.arc(-4.5, -13, 1.8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(4.5, -13, 1.8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -8, 2, 0, TAU); ctx.fill();
      }
    }

    // the ghost peeking out of whatever it is wearing
    if (o.peek > 0.02) {
      const a = clamp(o.peek, 0, 1) * (0.55 + 0.25 * Math.sin(time * 2.6));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#22285a';
      const ey = o.kind === 'teddy' ? -13 : 4;
      ctx.beginPath(); ctx.ellipse(-4.5, ey, 2.1, 2.9, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4.5, ey, 2.1, 2.9, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#22285a'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, ey + 4, 2.4, 0.2, Math.PI - 0.2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,150,170,0.4)';
      ctx.beginPath(); ctx.ellipse(-9, ey + 3, 2.6, 1.8, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(9, ey + 3, 2.6, 1.8, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    if (o.glow > 0.02) this.possessAura(ctx, o.x, o.y, 36, o.glow, time);
  },

  /* ---------- walls, gates, wiring, keys ---------- */

  /** An upright wall block, drawn in the same language as the divider bands. */
  wallPost(ctx, r) {
    softShadow(ctx, r.x + r.w / 2, r.y + r.h + 6, r.w / 2 + 8, 12, 0.45);
    const g = ctx.createLinearGradient(0, r.y - 10, 0, r.y + r.h);
    g.addColorStop(0, '#39417e');
    g.addColorStop(1, '#1e2453');
    ctx.fillStyle = g;
    rr(ctx, r.x, r.y - 10, r.w, r.h + 10, 5); ctx.fill();
    ctx.fillStyle = 'rgba(170,200,255,0.14)';
    rr(ctx, r.x, r.y - 10, r.w, 4, 2); ctx.fill();
  },

  /** The floor wire that visibly links a button to whatever it opens. */
  wire(ctx, pts, live, time) {
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(120,150,220,0.22)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    if (live > 0.02) {                                  // energised: a travelling glow
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(157,255,200,' + (0.55 * live) + ')';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 12]);
      ctx.lineDashOffset = -time * 60;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  },

  gate(ctx, gt, time) {
    const open = gt.open;
    const cx = gt.x + gt.w / 2;
    ctx.save();
    ctx.globalAlpha = 1 - open * 0.85;
    ctx.translate(0, open * (gt.h + 12));               // sinks into the floor
    softShadow(ctx, cx, gt.y + gt.h + 4, gt.w / 2, 10, 0.4 * (1 - open));
    const g = ctx.createLinearGradient(0, gt.y - 8, 0, gt.y + gt.h);
    g.addColorStop(0, '#5b6bb0');
    g.addColorStop(1, '#2c3468');
    ctx.fillStyle = g;
    rr(ctx, gt.x, gt.y - 8, gt.w, gt.h + 8, 5); ctx.fill();
    ctx.fillStyle = 'rgba(20,26,60,0.55)';              // bars
    const bars = 5;
    for (let i = 0; i < bars; i++) {
      const bx = gt.x + 8 + i * ((gt.w - 16) / (bars - 1)) - 2.5;
      rr(ctx, bx, gt.y - 6, 5, gt.h + 4, 2.5); ctx.fill();
    }
    ctx.fillStyle = 'rgba(180,210,255,0.18)';
    rr(ctx, gt.x, gt.y - 8, gt.w, 4, 2); ctx.fill();
    ctx.restore();

    if (open > 0.05 && open < 0.999) {                  // dust as it drops away
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - open) * 0.5;
      ctx.fillStyle = '#9dffc8';
      ctx.beginPath(); ctx.ellipse(cx, gt.y + gt.h / 2, gt.w / 2, 8, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  },

  /** The little golden key: on the floor, or tucked behind the ghost. */
  keyShape(ctx, x, y, s, glow, time) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    if (glow) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
      g.addColorStop(0, 'rgba(255,224,150,' + (0.5 + 0.12 * Math.sin(time * 3)) + ')');
      g.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.rotate(-0.5);
    const kg = ctx.createLinearGradient(-10, -10, 10, 10);
    kg.addColorStop(0, '#ffe9a8'); kg.addColorStop(1, '#e0a93c');
    ctx.strokeStyle = kg; ctx.fillStyle = kg;
    ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-5, -5, 5.5, 0, TAU); ctx.stroke();       // bow
    ctx.beginPath(); ctx.moveTo(-1.5, -1.5); ctx.lineTo(9, 9); ctx.stroke();  // shaft
    ctx.beginPath(); ctx.moveTo(9, 9); ctx.lineTo(5.5, 12.5); ctx.stroke();   // teeth
    ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(3, 9); ctx.stroke();
    ctx.restore();
  },

  keyPickup(ctx, k, time) {
    if (k.taken) return;
    const bob = Math.sin(time * 2.2) * 4;
    softShadow(ctx, k.x, k.y + 14, 14, 6, 0.4);
    this.keyShape(ctx, k.x, k.y + bob, 1.25, true, time);
    if (Math.random() < 0.04) {                         // occasional sparkle
      Particles.spawn({
        x: k.x + rand(-14, 14), y: k.y + rand(-12, 12),
        vx: rand(-8, 8), vy: rand(-26, -8),
        life: rand(0.4, 0.8), size: rand(1.6, 3), color: '#ffeebb', shape: 'star', spin: rand(-5, 5)
      });
    }
  },

  /** Key in hand: a small one drifting along behind the ghost. */
  carriedKey(ctx, g, time) {
    if (g.hidden) return;
    const x = g.x - 22 + Math.sin(time * 2) * 3;
    const y = g.y + 4 + Math.cos(time * 2.6) * 3;
    this.keyShape(ctx, x, y, 0.7, true, time);
  },

  /** "It needs a key" — shown over the door when the ghost bumps into it. */
  lockedHint(ctx, d, a, time) {
    if (a <= 0.02) return;
    const cx = (d.x0 + d.x1) / 2;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(cx, 108 - a * 6);
    ctx.fillStyle = 'rgba(10,14,36,0.82)';
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 18, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,150,0.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 18, 0, 0, TAU); ctx.stroke();
    this.keyShape(ctx, 0, -1, 0.95, false, time);
    ctx.restore();
  },

  /* ---------- the housemate ---------- */
  visionCone(ctx, h, level, time) {
    const N = 28, R = h.range;
    const a0 = h.angle - h.half, span = h.half * 2;
    const reach = [];
    for (let i = 0; i <= N; i++) {
      const a = a0 + span * (i / N);
      reach.push([a, Math.min(R, sightLimit(level, h.x, h.y, a, R))]);
    }
    const poly = (cap) => {
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      for (const [a, t] of reach) {
        const tt = cap ? Math.min(t, cap) : t;
        ctx.lineTo(h.x + Math.cos(a) * tt, h.y + Math.sin(a) * tt);
      }
      ctx.closePath();
    };

    const hot = h.alert;
    const col = hot > 0.05 ? '255,120,120' : '255,182,168';
    const pulse = 0.94 + 0.06 * Math.sin(time * 2.2);
    const grad = rad => {
      const g = ctx.createRadialGradient(h.x, h.y, 6, h.x, h.y, rad);
      g.addColorStop(0,    'rgba(' + col + ',' + (0.42 + hot * 0.25) * pulse + ')');
      g.addColorStop(0.5,  'rgba(' + col + ',' + (0.22 + hot * 0.2) * pulse + ')');
      g.addColorStop(0.92, 'rgba(' + col + ',' + (0.10 + hot * 0.12) * pulse + ')');
      g.addColorStop(1,    'rgba(' + col + ',0)');
      return g;
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(ROOM.x0, ROOM.y0, ROOM.x1 - ROOM.x0, ROOM.y1 - ROOM.y0);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';

    const split = h.darkRange < h.range;
    if (split) {
      // the long reach only exists over lit floor...
      ctx.save();
      this.clipToBright(ctx, level);
      ctx.fillStyle = grad(R);
      poly(0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.26 + hot * 0.4) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -time * 12;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // ...while this short core catches the ghost even in the dark
      ctx.fillStyle = grad(h.darkRange);
      poly(h.darkRange);
      ctx.fill();
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.34 + hot * 0.4) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -time * 12;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = grad(R);
      poly(0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.3 + hot * 0.4) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -time * 12;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  },

  human(ctx, h, time) {
    const walk = Math.sin(h.bob) * 2.2;
    const hot = h.alert;
    softShadow(ctx, h.x, h.y + 12, 20, 9, 0.45);

    ctx.save();
    ctx.translate(h.x, h.y + (hot > 0.05 ? -Math.abs(Math.sin(time * 14)) * 3 * hot : 0));

    // slippers
    ctx.fillStyle = '#3f4780';
    ctx.beginPath(); ctx.ellipse(-6, 12 + walk * 0.6, 5, 3.4, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6, 12 - walk * 0.6, 5, 3.4, 0, 0, TAU); ctx.fill();

    // body: a cosy jumper
    const bg = ctx.createLinearGradient(0, -12, 0, 14);
    bg.addColorStop(0, '#7fd0c2'); bg.addColorStop(1, '#4f9f95');
    ctx.fillStyle = bg;
    rr(ctx, -13, -10, 26, 24, 11); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    rr(ctx, -10, -8, 7, 18, 3.5); ctx.fill();
    ctx.fillStyle = '#6bc0b3';                                  // arms
    ctx.beginPath(); ctx.arc(-13, 1 + walk, 5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(13, 1 - walk, 5, 0, TAU); ctx.fill();

    // head, turned the way they are looking
    ctx.save();
    ctx.translate(0, -16);
    ctx.rotate(h.angle + Math.PI / 2);
    ctx.fillStyle = '#f6d7c0';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5a44';                                  // hair covers the back
    ctx.beginPath(); ctx.arc(0, 0, 12.4, 0.18, Math.PI - 0.18); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 1.5, 12.4, Math.PI - 0.5, TAU + 0.5); ctx.fill();
    ctx.fillStyle = '#2c2440';                                  // eyes look forward
    if (hot > 0.05) {
      ctx.beginPath(); ctx.arc(-4.4, -5, 2.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(4.4, -5, 2.6, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(-4.4, -5, 1.7, 2.2, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4.4, -5, 1.7, 2.2, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,150,170,0.35)';
    ctx.beginPath(); ctx.ellipse(-8, -2, 2.6, 1.8, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, -2, 2.6, 1.8, 0, 0, TAU); ctx.fill();
    ctx.restore();

    // surprise bubble — "!" when spotted, "?" when a lamp clicks off nearby
    const curious = clamp(h.curious, 0, 1);
    if (hot > 0.03 || curious > 0.03) {
      const q = hot <= 0.03;
      ctx.save();
      ctx.globalAlpha = q ? curious : clamp(hot, 0, 1);
      ctx.translate(0, -54 - (q ? 2 : hot * 5));
      ctx.fillStyle = '#fff4f0';
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 12, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(4, 9); ctx.lineTo(0, 15); ctx.closePath(); ctx.fill();
      if (q) {
        ctx.strokeStyle = '#5b86c9'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, -3.5, 3.4, Math.PI * 0.95, Math.PI * 0.25); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(1.6, 0.4); ctx.lineTo(0, 2.6); ctx.stroke();
        ctx.fillStyle = '#5b86c9';
        ctx.beginPath(); ctx.arc(0, 6, 1.9, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = '#e8576b';
        rr(ctx, -2, -7, 4, 9, 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 5, 2.2, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  },

  ghost(ctx, g, time) {
    if (g.hidden) return;
    const dangerT = g.danger / DANGER_TIME;
    const bob = Math.sin(time * 2.4) * 4;
    const sq = g.squash;
    const shake = dangerT > 0 ? Math.sin(time * 42) * dangerT * 2.4 : 0;
    const x = g.x + shake, y = g.y + bob;
    const r = g.r * 1.6;

    // glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(x, y, 3, x, y, 70);
    const c = dangerT > 0.05
      ? 'rgba(255,' + Math.floor(200 - 90 * dangerT) + ',150,'
      : 'rgba(150,215,255,';
    gl.addColorStop(0, c + (0.34 + 0.06 * Math.sin(time * 3)) + ')');
    gl.addColorStop(1, c + '0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(x, y, 70, 0, TAU); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + sq * 0.18, 1 - sq * 0.18);

    // body
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    const bottom = r * 1.05;
    ctx.lineTo(r, bottom - 4);
    const humps = 4;
    for (let i = 0; i < humps; i++) {
      const x0 = r - (2 * r) * (i / humps);
      const x1 = r - (2 * r) * ((i + 1) / humps);
      const mid = (x0 + x1) / 2;
      const dip = (i % 2 === 0 ? 1 : -1) * 7 + Math.sin(time * 4 + i * 1.7) * 3;
      ctx.quadraticCurveTo(mid, bottom + dip, x1, bottom - 4);
    }
    ctx.closePath();

    const bg = ctx.createLinearGradient(0, -r, 0, bottom);
    if (dangerT > 0.05) {
      bg.addColorStop(0, '#fff2e4');
      bg.addColorStop(1, 'rgb(' + Math.floor(255) + ',' + Math.floor(210 - 70 * dangerT) + ',' + Math.floor(190 - 110 * dangerT) + ')');
    } else {
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(1, '#cfe8ff');
    }
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,220,255,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // face (authored for a 20px body, scaled to whatever the ghost size is)
    ctx.save();
    ctx.scale(r / 20, r / 20);
    const look = g.face * 3;
    const eyeY = -2;
    ctx.fillStyle = '#22285a';
    if (g.blinkT > 0) {
      ctx.lineWidth = 2.4; ctx.strokeStyle = '#22285a';
      ctx.beginPath(); ctx.moveTo(-8 + look, eyeY); ctx.lineTo(-3 + look, eyeY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3 + look, eyeY); ctx.lineTo(8 + look, eyeY); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(-5.5 + look, eyeY, 2.6, 3.6, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5.5 + look, eyeY, 2.6, 3.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(-6.4 + look, eyeY - 1.4, 1, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(4.6 + look, eyeY - 1.4, 1, 0, TAU); ctx.fill();
    }
    // blush
    ctx.fillStyle = 'rgba(255,150,170,0.38)';
    ctx.beginPath(); ctx.ellipse(-11 + look * 0.6, eyeY + 5, 3.6, 2.4, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(11 + look * 0.6, eyeY + 5, 3.6, 2.4, 0, 0, TAU); ctx.fill();
    // mouth
    ctx.strokeStyle = '#22285a'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath();
    if (dangerT > 0.25) ctx.arc(look * 0.5, eyeY + 11, 3, Math.PI, 0);        // worried
    else ctx.arc(look * 0.5, eyeY + 7, 3, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  },

  /* ---------- screen effects ---------- */
  vignette(ctx, dangerT) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(2,4,14,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (dangerT > 0.01) {
      const dg = ctx.createRadialGradient(W / 2, H / 2, H * 0.18, W / 2, H / 2, H * 0.62);
      dg.addColorStop(0, 'rgba(255,90,70,0)');
      dg.addColorStop(1, 'rgba(255,90,70,' + (0.46 * dangerT) + ')');
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, W, H);
    }
  },

  dangerMeter(ctx, g) {
    const t = g.danger / DANGER_TIME;
    if (t <= 0.01 || g.hidden) return;
    const x = g.x, y = g.y - 42, w = 44;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(ctx, x - w / 2, y, w, 6, 3); ctx.fill();
    const col = t > 0.66 ? '#ff6b5c' : t > 0.33 ? '#ffb45c' : '#ffe08a';
    ctx.fillStyle = col;
    rr(ctx, x - w / 2, y, w * t, 6, 3); ctx.fill();
    ctx.restore();
  }
};

/* =============================================================================
   8. GAME — state machine, main loop and UI glue
   ============================================================================= */

const UI = {
  frame:    document.getElementById('frame'),
  canvas:   document.getElementById('game'),
  toast:    document.getElementById('toast'),
  objective:document.getElementById('objective'),
  btnAction:document.getElementById('btn-action'),
  btnRelease:document.getElementById('btn-release'),
  btnRestart:document.getElementById('btn-restart'),
  overlay:  document.getElementById('overlay'),
  ovTitle:  document.getElementById('ov-title'),
  ovText:   document.getElementById('ov-text'),
  btnNext:  document.getElementById('btn-next'),
  btnAgain: document.getElementById('btn-again'),
  intro:    document.getElementById('intro'),
  btnStart: document.getElementById('btn-start'),
  flash:    document.getElementById('flash'),
  levelTitle: document.querySelector('.level-title'),
  levels:   document.getElementById('levels'),
  levelGrid:document.getElementById('level-grid'),
  btnLevels:document.getElementById('btn-levels'),
  btnIntroLevels: document.getElementById('btn-intro-levels'),
  btnOvLevels:    document.getElementById('btn-ov-levels'),
  btnLevelsClose: document.getElementById('btn-levels-close'),
  banner:   document.getElementById('banner'),
  bannerTitle: document.getElementById('banner-title'),
  bannerSub:document.getElementById('banner-sub')
};

const Game = {
  state: 'intro',            // intro | play | dying | win
  levelIndex: 0,
  bannerT: 0,
  failReason: 'light',
  actionLock: 0,             // stops one tap from toggling twice
  time: 0,
  level: null,
  ghost: null,
  possessed: null,
  target: null,
  shake: 0,
  timer: 0,
  hints: {},
  toastT: 0,
  winT: 0,
  lastLabel: '', lastWarm: false, lastShowAction: false, lastShowRelease: false,

  /* ---------------- setup ---------------- */
  init() {
    this.ctx = UI.canvas.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));

    Input.init(UI.frame);
    this.bindUI();
    this.reset();

    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  resize() {
    const r = UI.frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    UI.canvas.width  = Math.max(1, Math.round(r.width * dpr));
    UI.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.sx = (r.width * dpr) / W;
    this.sy = (r.height * dpr) / H;
    Input.measure();
  },

  bindUI() {
    const tap = (el, fn) => {
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        SFX.init();
        fn();
      }, { passive: false });
    };
    tap(UI.btnAction,  () => this.doAction());
    tap(UI.btnRelease, () => this.doRelease());
    tap(UI.btnRestart, () => { this.hideOverlay(); this.reset(); this.toast('Level restarted'); });
    tap(UI.btnAgain,   () => { this.hideOverlay(); this.reset(); });
    tap(UI.btnNext,    () => {
      if (this.levelIndex < LEVELS.length - 1) {
        this.goToLevel(this.levelIndex + 1);
      } else {
        this.hideOverlay(); this.reset();
        this.toast('More levels coming soon! Here is this one again.', 3.2);
      }
    });
    // ---- level picker ----
    LEVELS.forEach((def, i) => {
      const card = document.createElement('button');
      card.className = 'level-card';
      card.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="sub"></span>';
      card.querySelector('.sub').textContent = def.subtitle || def.objective || '';
      tap(card, () => this.pickLevel(i));
      UI.levelGrid.appendChild(card);
    });
    tap(UI.btnLevels,      () => this.openLevels());
    tap(UI.btnIntroLevels, () => this.openLevels());
    tap(UI.btnOvLevels,    () => this.openLevels());
    tap(UI.btnLevelsClose, () => this.closeLevels());

    tap(UI.btnStart,   () => {
      UI.intro.classList.add('hidden');
      this.state = 'play';
      const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
      this.toast(touch ? 'Drag anywhere to move · stay in the dark!'
                       : 'Stay in the dark. Warm light burns!', 3.2);
    });
  },

  /* ---------------- level lifecycle ---------------- */
  get def() { return LEVELS[this.levelIndex] || LEVELS[0]; },

  reset() {
    const def = this.def;
    this.level = def.build();
    this.ghost = new Ghost(def.spawn.x, def.spawn.y);
    this.possessed = null;
    this.target = null;
    this.hints = {};
    this.shake = 0;
    this.winT = 0;
    this.actionLock = 0;
    this.lockedHintT = 0;
    this.lockedNagT = 0;
    Particles.clear();
    UI.levelTitle.textContent = def.name;
    UI.objective.textContent = def.objective;
    UI.objective.classList.remove('done');
    if (this.state !== 'intro') this.state = 'play';
  },

  /* ---------------- level picker ---------------- */
  openLevels() {
    const cards = UI.levelGrid.children;
    for (let i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('current', i === this.levelIndex);
    }
    // remember what to put back if they just browse and hit BACK
    this.levelsFrom = this.state === 'intro' ? 'intro'
      : (!UI.overlay.classList.contains('hidden') ? 'overlay' : 'play');
    UI.intro.classList.add('hidden');
    UI.overlay.classList.add('hidden');
    UI.levels.classList.remove('hidden');
  },
  closeLevels() {
    UI.levels.classList.add('hidden');
    if (this.levelsFrom === 'intro') UI.intro.classList.remove('hidden');
    else if (this.levelsFrom === 'overlay') UI.overlay.classList.remove('hidden');
  },
  /** Jump straight to a level from the picker (or a number key). */
  pickLevel(i) {
    if (i < 0 || i >= LEVELS.length) return;
    UI.levels.classList.add('hidden');
    UI.intro.classList.add('hidden');
    this.hideOverlay();
    UI.flash.classList.remove('on');
    this.state = 'play';
    this.goToLevel(i);
  },

  /** Load another level with a short title card. */
  goToLevel(i) {
    this.levelIndex = clamp(i, 0, LEVELS.length - 1);
    this.hideOverlay();
    this.reset();
    const def = this.def;
    UI.bannerTitle.textContent = def.name;
    UI.bannerSub.textContent = def.subtitle || '';
    UI.banner.classList.add('show');
    this.bannerT = 1.6;
    if (def.startHint) this.hint('start', def.startHint, 3.4);
  },

  toast(msg, dur) {
    UI.toast.textContent = msg;
    UI.toast.classList.add('show');
    this.toastT = dur || 2.4;
  },
  hint(id, msg, dur) {
    if (this.hints[id]) return;
    this.hints[id] = true;
    this.toast(msg, dur);
  },
  hideOverlay() { UI.overlay.classList.add('hidden'); },

  /* ---------------- possession ---------------- */
  findTarget() {
    if (this.possessed || this.ghost.hidden) return null;
    let best = null, bd = POSSESS_DIST;
    for (const p of this.level.possessables) {
      const d = dist(this.ghost.x, this.ghost.y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  },

  possess(p) {
    this.possessed = p;
    p.possessed = true;
    p.onPossess();
    this.ghost.hidden = true;
    this.ghost.danger = 0;
    this.ghost.vx = this.ghost.vy = 0;
    SFX.possess();
    Particles.burst(this.ghost.x, this.ghost.y, 24, {
      colors: ['#bff0ff', '#7fd4ff', '#ffffff'], spdMax: 190
    });
    Particles.spawn({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.55, size: 14, color: '#9fe4ff', shape: 'ring' });
    for (let i = 0; i < 10; i++) {
      Particles.spawn({
        x: p.x + rand(-28, 28), y: p.y + rand(-30, 10),
        vx: rand(-25, 25), vy: rand(-90, -30),
        life: rand(0.4, 0.9), size: rand(2, 5), color: '#cdefff', shape: 'star', spin: rand(-6, 6)
      });
    }
    this.shake = 0.25;
    this.actionLock = 0.3;
    if (p.name === 'lamp')      this.hint('h-lamp-in', 'Now press TURN OFF to kill the light');
    else if (p.name === 'car')  this.hint('h-car-in', 'Drive onto the glowing plate');
    else if (p.name === 'fan')  this.hint('h-fan-in', 'Spin it up! (not needed to escape)');
    else if (p.rotatable)       this.hint('h-rotate', 'Drag left / right to aim the light', 3.2);
    else if (p.spot)            this.hint('h-hide-in', 'Nobody can see you in there. Wait, then RELEASE.', 3.2);
  },

  doRelease() {
    const p = this.possessed;
    if (!p) return;
    p.possessed = false;
    p.onRelease();
    this.possessed = null;

    const g = this.ghost;
    g.x = p.x + (p.name === 'car' ? -Math.cos(p.angle) * 26 : 0);
    g.y = p.y + (p.name === 'car' ? 30 : 46);
    g.x = clamp(g.x, ROOM.x0 + g.r, ROOM.x1 - g.r);
    g.y = clamp(g.y, ROOM.y0 + g.r, ROOM.y1 - g.r);
    g.vx = g.vy = 0;
    g.hidden = false;
    Collide.resolve(g, this.level);
    SFX.release();
    Particles.burst(g.x, g.y, 20, { colors: ['#dff4ff', '#8fd8ff'], spdMax: 170 });
    Particles.spawn({ x: g.x, y: g.y, vx: 0, vy: 0, life: 0.5, size: 12, color: '#bfe9ff', shape: 'ring' });
    this.shake = 0.18;
    this.actionLock = 0.3;
  },

  /** The big contextual button. */
  doAction() {
    if (this.state !== 'play') return;
    const p = this.possessed;
    if (p) {
      if (p.actionLabel()) {
        p.activate();                        // lamp / fan toggle
        // a lamp clicking off is the kind of thing a housemate notices
        if (p.light && this.level.lampChanged) this.level.lampChanged(p.x, p.y);
      } else {
        this.doRelease();                    // car / hiding spot / aimed lamp
      }
      return;
    }
    const t = this.findTarget();
    if (t) this.possess(t);
  },

  /** Tapping (or clicking) an object enters it — the same rules as the button. */
  tapAt(pt) {
    if (this.state !== 'play' || this.actionLock > 0) return;
    const reach = 56;
    if (this.possessed) {                         // tap what you are wearing to leave it
      const p = this.possessed;
      if (dist(pt.x, pt.y, p.x, p.y) < reach + p.r) this.doRelease();
      return;
    }
    let best = null, bd = reach;
    for (const o of this.level.possessables) {
      const d = dist(pt.x, pt.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    // only objects the ghost could reach anyway, so tapping stays honest
    if (best && dist(this.ghost.x, this.ghost.y, best.x, best.y) < POSSESS_DIST) this.possess(best);
  },

  /* ---------------- failure / victory ---------------- */
  fail(reason) {
    if (this.state !== 'play') return;
    this.state = 'dying';
    this.failReason = reason || 'light';
    // being spotted gets a longer beat so the "!" reads before the fade
    this.timer = this.failReason === 'seen' ? 1.2 : 0.75;
    this.shake = 0.5;
    SFX.fail();
    const g = this.ghost;
    const cols = this.failReason === 'seen'
      ? ['#ffd6dd', '#ffffff', '#ff9fb0']
      : ['#ffd2a8', '#ffffff', '#ffb38a'];
    Particles.burst(g.x, g.y, 32, { colors: cols, spdMax: 220, grav: -40 });
    UI.flash.classList.add('on');
  },

  /** Caught in somebody's line of sight. */
  spotted(h) {
    if (this.state !== 'play') return;
    h.alert = 1;
    SFX.tone(880, 0.12, 'square', 0.2);
    SFX.tone(660, 0.2, 'square', 0.16, 0, 0.1);
    Particles.spawn({ x: h.x, y: h.y - 40, vx: 0, vy: -20, life: 0.7, size: 16, color: '#ffd0d8', shape: 'ring' });
    this.fail('seen');
  },

  win() {
    if (this.state !== 'play') return;
    this.state = 'win';
    this.winT = 0;
    this.ghost.hidden = true;
    SFX.win();
    const cx = (DOOR.x0 + DOOR.x1) / 2;
    for (let i = 0; i < 60; i++) {
      Particles.spawn({
        x: cx + rand(-30, 30), y: 70 + rand(-20, 20),
        vx: rand(-170, 170), vy: rand(-40, 210),
        life: rand(0.7, 1.6), size: rand(2.5, 6),
        color: pick(['#fff2c8', '#9dffc8', '#a9e2ff', '#ffb8d8', '#ffd88a']),
        shape: Math.random() < 0.4 ? 'star' : 'dot',
        spin: rand(-8, 8), grav: 120, drag: 0.96
      });
    }
    UI.objective.textContent = 'Escaped!';
    UI.objective.classList.add('done');
    if (this.levelIndex < LEVELS.length - 1) UI.btnNext.textContent = 'NEXT LEVEL';
  },

  /* ---------------- per-frame update ---------------- */
  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 1.6);

    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) UI.toast.classList.remove('show');
    }

    const L = this.level;
    if (!L) return;

    if (this.actionLock > 0) this.actionLock -= dt;
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) UI.banner.classList.remove('show');
    }

    // keyboard edges + tap-to-possess
    if (Input.takeAction()) this.doAction();
    if (Input.takeRelease()) this.doRelease();
    const tapped = Input.takeTap();
    if (tapped) this.tapAt(tapped);
    const lk = Input.takeLevelKey();               // 1..9 jumps straight to a level
    if (lk) this.pickLevel(lk - 1);

    const input = (this.state === 'play') ? Input.vector() : { x: 0, y: 0, mag: 0 };

    if (this.state === 'play') {
      // the drag/keys steer whatever the ghost is currently wearing
      if (L.car && this.possessed === L.car) {
        L.car.update(dt, input, L);
      } else if (this.possessed && this.possessed.movable) {
        this.possessed.update(dt, input, L);            // a pushed box, etc.
      } else {
        this.ghost.update(dt, input, L);
      }
      if (L.car && this.possessed !== L.car) L.car.update(dt, { x: 0, y: 0, mag: 0 }, L);
      if (this.possessed) {
        this.ghost.x = this.possessed.x; this.ghost.y = this.possessed.y;
      }
    }

    if (L.lamp) L.lamp.update(dt);
    if (L.fan) L.fan.update(dt);
    // aimable lamps: the drag steers the beam while the ghost is inside one
    for (const p of L.possessables) {
      if (p.rotatable) p.update(dt, p === this.possessed ? input : null);
    }
    for (const l of L.lights) l.update(dt, this.time);

    this.target = this.findTarget();
    for (const p of L.possessables) p.tickCommon(dt, this.target === p);
    // hiding places tick themselves; the one being steered was updated above
    for (const p of L.possessables) if (p.spot && p !== this.possessed) p.update(dt, null, L);

    // ---- housemates: patrol, then look ----
    for (const h of L.humans) {
      if (this.state === 'play') h.update(dt);
      const canBeSeen = !this.possessed && !this.ghost.hidden;
      if (this.state === 'play' && canBeSeen && h.sees(this.ghost.x, this.ghost.y, L)) {
        this.spotted(h);
      } else if (this.state === 'play') {
        h.alert = Math.max(0, h.alert - dt * 1.4);
      }
    }

    // ---- pressure plate: opens a gate here, or unlocks the door in level 1 ----
    if (L.plate && L.gate) {
      L.plate.update(dt, L);
      if (L.plate.pressed && !L.gate.isOpen) {
        L.gate.setOpen();
        this.shake = 0.35;
        this.hint('h-gate', 'Something opened over there!', 2.6);
      }
    } else if (L.plate && L.door) {
      L.plate.update(dt, L);
      if (L.plate.pressed === L.door.locked) {
        L.door.setLocked(!L.plate.pressed);
        L.doorLight.on = !L.door.locked;          // warm glow spilling in from the hall
        if (!L.door.locked) {
          this.shake = 0.35;
          UI.objective.textContent = 'Door open — escape!';
          UI.objective.classList.add('done');
          this.hint('h-unlock', 'The exit door is unlocked!');
        } else {
          UI.objective.textContent = 'Keep the car on the plate';
          UI.objective.classList.remove('done');
          this.toast('The car rolled off — the door locked again!', 2.6);
        }
      }
    }
    if (L.gate) L.gate.update(dt);

    // ---- key and locked door ----
    if (L.key) {
      L.key.update(dt);
      if (this.state === 'play' && !this.possessed && !this.ghost.hidden && L.key.tryTake(this.ghost)) {
        UI.objective.textContent = 'Unlock the exit';
        this.toast('You found the key!', 2.4);
        this.shake = 0.25;
      }
    }
    if (L.needsKey && L.door) {
      const g = this.ghost;
      const atDoor = !this.possessed && g.y < 150 && g.x > L.door.x0 - 24 && g.x < L.door.x1 + 24;
      if (atDoor && L.door.locked) {
        if (L.key && L.key.taken) {                       // the key turns it on approach
          L.door.setLocked(false);
          L.doorLight.on = true;
          UI.objective.textContent = 'Escape!';
          UI.objective.classList.add('done');
        } else {                                          // locked: shake, click, key icon
          this.lockedHintT = Math.min(1, (this.lockedHintT || 0) + dt * 3);
          this.lockedNagT = (this.lockedNagT || 0) - dt;
          if (this.lockedNagT <= 0) {
            this.lockedNagT = 1.3;
            L.door.shake = 0.55;
            SFX.locked();
            this.hint('h-locked', 'Locked! A key must be somewhere in the house.', 3);
          }
        }
      } else {
        this.lockedHintT = Math.max(0, (this.lockedHintT || 0) - dt * 2.2);
      }
    }
    if (L.door) L.door.update(dt);

    Particles.update(dt);

    // contextual hints
    if (this.state === 'play' && !this.possessed && !this.ghost.hidden) {
      const g = this.ghost;
      if (L.lamp && this.target === L.lamp) this.hint('h-lamp', 'Press POSSESS to slip inside the lamp');
      if (L.car && this.target === L.car)   this.hint('h-car', 'Possess the toy car');
      if (L.lampLight && !L.lampLight.on)   this.hint('h-dark', 'The doorway is safe now', 2.2);
      if (L.plate && dist(g.x, g.y, L.plate.x, L.plate.y) < L.plate.r)
        this.hint('h-plate', 'Too light! The plate needs something heavy');
      if (g.danger > 0.25) this.hint('h-burn', 'Get back in the shadows!', 2);
      if (this.target && this.target.spot && !this.target.movable)
        this.hint('h-hide', 'Tap it (or press POSSESS) to hide inside', 3);
      if (this.target && this.target.movable)
        this.hint('h-push', 'Possess this one and you can push it around', 3.2);
    }

    // state transitions
    if (this.state === 'play') {
      if (this.ghost.danger >= DANGER_TIME) this.fail('light');
      else if (L.door && L.door.reached(this.ghost) && !this.possessed) this.win();
    } else if (this.state === 'dying') {
      this.timer -= dt;
      if (this.timer <= 0.45 && UI.flash.classList.contains('on')) {
        this.reset();
        this.state = 'play';
        UI.flash.classList.remove('on');
        this.toast(this.failReason === 'seen'
          ? 'They spotted you! Hide next time.'
          : 'The light got you! Try again.', 2.2);
      }
    } else if (this.state === 'win') {
      this.winT += dt;
      if (this.winT > 0.9 && UI.overlay.classList.contains('hidden')) {
        UI.ovTitle.textContent = this.def.winTitle || 'LEVEL COMPLETE!';
        UI.ovText.textContent = this.def.winText || '';
        UI.overlay.classList.remove('hidden');
      }
      if (Math.random() < dt * 6) {
        Particles.spawn({
          x: rand(60, 480), y: rand(120, 700),
          vx: rand(-30, 30), vy: rand(-60, -10),
          life: rand(0.8, 1.6), size: rand(2, 5),
          color: pick(['#fff2c8', '#9dffc8', '#a9e2ff']), shape: 'star', spin: rand(-5, 5)
        });
      }
    }

    this.syncUI();
  },

  /** Keep the contextual buttons in sync without thrashing the DOM. */
  syncUI() {
    const p = this.possessed;
    let label = 'POSSESS', warm = false, showAction = false, showRelease = false;

    if (this.state !== 'play') {
      showAction = false;
    } else if (p) {
      const sub = p.actionLabel();
      showAction = true;
      showRelease = !!sub;
      label = sub || 'RELEASE';
      warm = !!sub;
    } else if (this.target) {
      showAction = true;
    }

    if (label !== this.lastLabel) { UI.btnAction.textContent = label; this.lastLabel = label; }
    if (warm !== this.lastWarm) { UI.btnAction.classList.toggle('warm', warm); this.lastWarm = warm; }
    if (showAction !== this.lastShowAction) {
      UI.btnAction.classList.toggle('hidden', !showAction);
      this.lastShowAction = showAction;
    }
    if (showRelease !== this.lastShowRelease) {
      UI.btnRelease.classList.toggle('hidden', !showRelease);
      this.lastShowRelease = showRelease;
    }
  },

  /* ---------------- render ---------------- */
  draw() {
    const ctx = this.ctx, L = this.level;
    ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!L) return;

    if (this.shake > 0) {
      const s = this.shake * 6;
      ctx.translate(rand(-s, s), rand(-s, s));
    }

    Draw.floor(ctx);
    if (L.rug) Draw.rug(ctx, L.rug);
    if (L.wire) Draw.wire(ctx, L.wire, L.plate ? L.plate.press : 0, this.time);
    if (L.plate) Draw.plate(ctx, L.plate, this.time);
    Draw.lights(ctx, L, this.time);
    for (const h of L.humans) Draw.visionCone(ctx, h, L, this.time);
    Draw.walls(ctx);
    for (const d of L.dividers) Draw.divider(ctx, d);
    if (L.gate) Draw.gate(ctx, L.gate, this.time);
    for (const w of (L.walls || [])) Draw.wallPost(ctx, w);

    // furniture, back to front
    const furn = L.rects.filter(r => r.kind).sort((a, b) => (a.y + a.h) - (b.y + b.h));
    for (const r of furn) Draw.furniture(ctx, r);
    for (const d of L.decor) Draw.decor(ctx, d);
    for (const c of L.circles) {
      if (c.kind === 'plant') Draw.plant(ctx, c, this.time);
      if (c.kind === 'nightlamp' && L.nightLight) Draw.nightLamp(ctx, c, L.nightLight, this.time);
    }

    if (L.lamp) Draw.lamp(ctx, L.lamp, this.time);
    if (L.fan) Draw.fan(ctx, L.fan, this.time);
    for (const p of L.possessables) if (p.rotatable) Draw.aimLamp(ctx, p, this.time);
    if (L.car) Draw.car(ctx, L.car, this.time);
    if (L.key) Draw.keyPickup(ctx, L.key, this.time);
    for (const o of L.possessables) if (o.spot) Draw.hideSpot(ctx, o, this.time);
    for (const h of L.humans) Draw.human(ctx, h, this.time);
    if (L.door) Draw.door(ctx, L.door, this.time);
    if (L.needsKey && L.door) Draw.lockedHint(ctx, L.door, this.lockedHintT || 0, this.time);

    Draw.ghost(ctx, this.ghost, this.time);
    if (L.key && L.key.taken) Draw.carriedKey(ctx, this.ghost, this.time);
    Particles.draw(ctx);
    Draw.dangerMeter(ctx, this.ghost);

    ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    Draw.vignette(ctx, this.ghost.hidden ? 0 : this.ghost.danger / DANGER_TIME);
  }
};

// handy for tinkering from the console: GhostEscape.Game.level.lamp, etc.
window.GhostEscape = { Game, Draw, SFX, Input, Particles };

/* ---- boot ---- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Game.init());
} else {
  Game.init();
}

// first gesture anywhere unlocks audio on mobile
['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
  document.addEventListener(ev, () => { SFX.init(); SFX.resume(); }, { once: false, passive: true }));

})();
