import type { Anim } from './assets';
import type { Game } from './game';

export const PARRY_PERFECT = 0.15;   // seconds after the press that count as a perfect parry
export const PARRY_TOTAL = 0.3;      // after that it's a guard (chip damage, no reward)
const WHIFF_RECOVER = 0.22;          // punished window when a parry catches nothing
const ROLL_TIME = 0.27;
const ROLL_IFRAMES = 0.24;
const ROLL_SPEED = 330;
const ROLL_COOLDOWN = 0.18;
const SPEED = 128;
const FIRE_INTERVAL = 0.13;
const SHOT_COST = 7;
const AIM_HOLD = 0.45;               // keep the blade aimed this long after the last shot
const RIPOSTE_TIME = 0.32;
const HIT_TIME = 0.28;

export type PlayerState = 'normal' | 'roll' | 'parry' | 'recover' | 'dead';

export class Player {
  /** body landmarks above the feet, in native px (sprite is 0x72's 16×28 elf at 2x) */
  static readonly CHEST = 18;
  static readonly HEAD = 44;

  vx = 0; vy = 0;
  readonly r = 7;
  hp = 100; maxHp = 100;
  mana = 100; maxMana = 100; manaDelay = 0;
  face = 1;
  aimX = 0; aimY = 0;
  state: PlayerState = 'normal';
  t = 0;                 // time in current state
  rollCd = 0; rollDx = 1; rollDy = 0;
  iframes = 0; invuln = 0; flash = 0;
  fireCd = 0; empowered = 0;
  afterT = 0;
  parryFlash = 0;        // brief bright arc after a successful parry
  parryAngle = 0;        // where that arc points: toward whatever we deflected

  // animation
  action: { name: 'riposte' | 'hit'; t: number } | null = null;
  aimHold = 0; recoil = 0; muzzle = 0;
  runT = 0; idleT = 0; private lastStep = -1;
  sq = 0; sqV = 0; lean = 0;           // spring squash/stretch and movement lean
  bladeA = Math.PI / 3;                 // dagger angle, eased toward its target each frame
  dissolved = false;
  /** current sprite + its feet anchor, for afterimages and the death dissolve */
  sprite: { img: HTMLCanvasElement; ax: number; ay: number } | null = null;
  /** player color / look index (0 = Dylan) */
  slot = 0;
  /** co-op: set on other players' characters (null for the local player) */
  peerId: string | null = null;
  netX = 0; netY = 0;

  constructor(public x: number, public y: number) {}

  setState(s: PlayerState) { this.state = s; this.t = 0; }
  play(name: 'riposte' | 'hit') {
    this.action = { name, t: 0 };
    if (name === 'riposte') this.punch(-3);
    else this.punch(3.5);
  }
  punch(v: number) { this.sqV += v; }

  get parryPhase(): 'perfect' | 'guard' | null {
    if (this.state !== 'parry') return null;
    return this.t < PARRY_PERFECT ? 'perfect' : 'guard';
  }

  tryParry(g: Game) {
    if (this.state === 'dead' || this.state === 'roll' || this.state === 'recover' || this.state === 'parry') return;
    this.setState('parry');
    this.action = null;
    this.punch(1.8);
    g.sfx('whiff', this.x);
  }

  tryRoll(g: Game, dx: number, dy: number) {
    if (this.state === 'dead' || this.state === 'roll' || this.rollCd > 0) return;
    let l = Math.hypot(dx, dy);
    if (l < 0.01) { dx = g.input.move.x; dy = g.input.move.y; l = Math.hypot(dx, dy); }
    if (l < 0.01) { dx = this.aimX - this.x; dy = this.aimY - this.y; l = Math.hypot(dx, dy); }
    if (l < 0.01) { dx = this.face; dy = 0; l = 1; }
    this.rollDx = dx / l; this.rollDy = dy / l;
    this.setState('roll');
    this.action = null;
    this.iframes = ROLL_IFRAMES;
    this.vx = this.rollDx * ROLL_SPEED; this.vy = this.rollDy * ROLL_SPEED;
    if (Math.abs(this.rollDx) > 0.2) this.face = Math.sign(this.rollDx);
    this.punch(4);
    g.sfx('roll', this.x);
    g.fx.burst(this.x, this.y, 10, { speed: 70, colors: ['#3a3155', '#2a2340', '#4a4066'], size: 2, life: 0.45, z: 1, vz: 14, grav: 40, angle: Math.atan2(-this.rollDy, -this.rollDx), spread: 1.8 });
  }

  update(g: Game, dt: number) {
    this.t += dt;
    this.rollCd -= dt; this.fireCd -= dt; this.iframes -= dt; this.invuln -= dt;
    this.flash -= dt; this.parryFlash -= dt; this.aimHold -= dt; this.muzzle -= dt;
    this.recoil *= Math.exp(-dt * 26);
    if (this.action) {
      this.action.t += dt;
      if (this.action.t > (this.action.name === 'riposte' ? RIPOSTE_TIME : HIT_TIME)) this.action = null;
    }
    // squash spring: snappy with a single overshoot
    this.sqV += (-190 * this.sq - 15 * this.sqV) * dt;
    this.sq += this.sqV * dt;

    if (this.state === 'dead') {
      this.vx *= Math.exp(-dt * 6); this.vy *= Math.exp(-dt * 6);
      this.x += this.vx * dt; this.y += this.vy * dt;
      return;
    }

    const mv = g.input.move;
    if (this.state === 'roll') {
      // fast start, eased stop: reads as a committed dive
      const k = Math.max(0, 1 - this.t / ROLL_TIME);
      const sp = ROLL_SPEED * (0.35 + 0.65 * k * k);
      this.vx = this.rollDx * sp; this.vy = this.rollDy * sp;
      this.afterT -= dt;
      if (this.afterT <= 0 && this.sprite) {
        this.afterT = 0.026;
        const roll = g.A.heroes[this.slot].roll, fi = this.rollFrame();
        g.fx.after(roll.shadow[fi], this.x, this.y, this.face < 0, 32, 64, 0.24);
      }
      if (this.t >= ROLL_TIME) {
        this.setState('normal'); this.rollCd = ROLL_COOLDOWN; this.punch(3);
        g.fx.burst(this.x, this.y, 5, { speed: 40, colors: ['#3a3155', '#2a2340'], size: 2, life: 0.35, z: 1, vz: 8, grav: 40 });
      }
    } else {
      let speed = SPEED;
      if (this.state === 'parry') speed *= 0.35;
      if (this.state === 'recover') speed *= 0.45;
      if (this.action?.name === 'riposte') speed *= 0.3;
      const tx = mv.x * speed, ty = mv.y * speed;
      const accel = Math.hypot(mv.x, mv.y) > 0.1 ? 22 : 16;  // snappy start, slightly softer stop
      const wasStill = Math.hypot(this.vx, this.vy) < 20;
      this.vx += (tx - this.vx) * Math.min(1, accel * dt);
      this.vy += (ty - this.vy) * Math.min(1, accel * dt);
      if (wasStill && Math.hypot(tx, ty) > 60) this.punch(-1.6);          // push-off stretch
      if (!wasStill && Math.hypot(tx, ty) < 1 && Math.hypot(this.vx, this.vy) < 40) this.punch(1.2);  // plant
      if (this.state === 'parry' && this.t >= PARRY_TOTAL) this.setState('recover');
      if (this.state === 'recover' && this.t >= WHIFF_RECOVER) this.setState('normal');
    }

    this.x += this.vx * dt; this.y += this.vy * dt;
    g.level.collide(this, this.r);

    // facing: aim when shooting / on mouse, else movement
    const ax = this.aimX - this.x;
    if (this.state !== 'roll') {
      if (g.input.device === 'mouse' || g.input.firing || this.aimHold > 0) { if (Math.abs(ax) > 2) this.face = Math.sign(ax); }
      else if (Math.abs(this.vx) > 10) this.face = Math.sign(this.vx);
    }

    // run cycle paced by distance so feet never skate; idle breathes on its own clock
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 24 && this.state !== 'roll') {
      this.runT += dt * (speed / SPEED);
      const fi = Math.floor(this.runT * 11) % 4;
      if (fi !== this.lastStep && (fi === 1 || fi === 3)) {
        g.sfx('step', this.x);
        g.fx.burst(this.x - this.face * 3, this.y, 2, { speed: 25, color: '#3a3352', size: 1, life: 0.3, z: 0, vz: 12, grav: 60 });
        this.punch(0.5);
      }
      this.lastStep = fi;
    } else { this.idleT += dt; this.lastStep = -1; }
    const targetLean = this.state === 'roll' ? 0 : Math.max(-0.22, Math.min(0.22, this.vx / 600));
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 12);

    // mana regenerates after a short pause
    this.manaDelay -= dt;
    if (this.manaDelay <= 0) this.mana = Math.min(this.maxMana, this.mana + 30 * dt);

    if (g.input.firing && this.state !== 'roll' && this.action?.name !== 'riposte' && this.fireCd <= 0) this.fire(g);
    this.updateBlade(dt);
  }

  private rollFrame() { return Math.min(3, Math.floor((this.t / ROLL_TIME) * 4)); }

  /** Body-relative pivot the dagger orbits: a little in front of the chest. */
  private pivot() { return { x: this.x + this.face * 3, y: this.y - Player.CHEST + 2 }; }
  private aimAngle() { const p = this.pivot(); return Math.atan2(this.aimY - p.y, this.aimX - p.x); }

  /** Another player's character: no input or physics, just timers, springs and smoothing toward the network position. */
  simRemote(g: Game, dt: number) {
    this.t += dt; this.flash -= dt; this.parryFlash -= dt; this.aimHold -= dt; this.muzzle -= dt;
    this.iframes -= dt; this.invuln -= dt;
    this.recoil *= Math.exp(-dt * 26);
    if (this.action) this.action.t += dt;
    this.sqV += (-190 * this.sq - 15 * this.sqV) * dt;
    this.sq += this.sqV * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const k = Math.min(1, dt * 14);
    this.x += (this.netX - this.x) * k; this.y += (this.netY - this.y) * k;
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 24 && this.state !== 'roll') this.runT += dt * (speed / SPEED); else this.idleT += dt;
    this.lean += ((this.state === 'roll' ? 0 : Math.max(-0.22, Math.min(0.22, this.vx / 600))) - this.lean) * Math.min(1, dt * 12);
    this.updateBlade(dt);
    if (this.state === 'roll') {
      this.afterT -= dt;
      if (this.afterT <= 0) { this.afterT = 0.026; g.fx.after(g.A.heroes[this.slot].roll.shadow[this.rollFrame()], this.x, this.y, this.face < 0, 32, 64, 0.24); }
    }
  }

  /** Where the dagger wants to point this frame; eased so it swings instead of teleporting. */
  updateBlade(dt: number) {
    let target: number, rate = 22;
    const fwd = this.face > 0 ? 0 : Math.PI;
    if (this.state === 'parry' || this.parryFlash > 0) {
      // guard: blade raised across the front, angled toward the threat
      const toward = this.parryFlash > 0 ? this.parryAngle : this.aimAngle();
      target = toward - this.face * 1.25; rate = 60;
    } else if (this.state === 'recover') {
      target = fwd + this.face * 0.9; rate = 14;
    } else if (this.action?.name === 'riposte') {
      // one fast sweep through the target
      const k = Math.min(1, this.action.t / 0.12);
      const base = this.parryAngle;
      this.bladeA = base - this.face * 1.6 + this.face * 3.0 * (1 - Math.pow(1 - k, 3));
      return;
    } else if (this.state === 'roll' || this.state === 'dead') {
      target = fwd + this.face * 1.4; rate = 30;
    } else if (this.aimHold > 0 || this.muzzle > 0) {
      target = this.aimAngle(); rate = 40;
    } else {
      // at rest: held low and forward, rocking slightly with the breath / stride
      target = fwd + this.face * (1.05 + Math.sin(this.idleT * 2.2) * 0.06 + Math.sin(this.runT * 11 * Math.PI / 2) * 0.12);
      rate = 12;
    }
    let d = target - this.bladeA;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.bladeA += d * Math.min(1, dt * rate);
  }

  /** Dagger grip and tip in world space. */
  blade() {
    const p = this.pivot(), a = this.bladeA, back = this.recoil;
    const gx = p.x + Math.cos(a) * (8 - back), gy = p.y + Math.sin(a) * (8 - back);
    return { gx, gy, tx: gx + Math.cos(a) * 18, ty: gy + Math.sin(a) * 18, a };
  }

  fire(g: Game) {
    const emp = this.empowered > 0;
    const cost = emp ? 0 : SHOT_COST;
    if (this.mana < cost) {
      if (this.fireCd <= 0) { this.fireCd = 0.25; g.fx.text(this.x, this.y - Player.HEAD - 10, 'NO MANA', '#8a7ab8', 1, 0.5); }
      return;
    }
    this.mana -= cost; this.manaDelay = 0.45;
    this.fireCd = FIRE_INTERVAL;
    if (Math.abs(this.aimX - this.x) > 2) this.face = Math.sign(this.aimX - this.x);
    this.aimHold = AIM_HOLD;
    this.bladeA = this.aimAngle();
    const b = this.blade();
    let dx = this.aimX - b.tx, dy = this.aimY - b.ty;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    // tiny spread keeps streams lively without hurting aim
    const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.05;
    const speed = emp ? 520 : 440;
    g.bullets.push({
      x: b.tx, y: b.ty, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: emp ? 5 : 3, dmg: emp ? 22 : 9, team: 'player', heavy: false, life: 0.85, age: 0,
      color: emp ? '#d8a8ff' : '#a45cff', kind: emp ? 'big' : 'dagger', pierce: emp ? 3 : 0, hits: new Set(), source: null,
    });
    g.onShot(g.bullets[g.bullets.length - 1]);
    if (emp) { this.empowered--; g.sfx('shootBig', this.x); g.shake(0.12); } else g.sfx('shoot', this.x);
    this.vx -= dx * 18; this.vy -= dy * 18;           // body recoil
    this.recoil = emp ? 6 : 4;                          // blade snaps back
    this.punch(emp ? 1.8 : 0.8);
    g.kick(-dx * (emp ? 3 : 1.5), -dy * (emp ? 3 : 1.5));
    g.fx.light(b.tx, b.ty, emp ? 70 : 46, '#b06bff', 1);
    g.fx.burst(b.tx, b.ty, 3, { speed: 90, angle: a, spread: 0.8, color: '#e2c8ff', glow: true, life: 0.12, z: 0, vz: 0, grav: 0, size: 1 });
    this.muzzle = 0.06;
  }

  /** Pick the frame for this moment. */
  private pickSprite(g: Game): { anim: Anim; i: number; ax: number; ay: number } {
    const H = g.A.heroes[this.slot];
    if (this.state === 'dead') {
      if (this.t < 0.12) return { anim: H.hit, i: 0, ax: 16, ay: 56 };
      return { anim: H.fall, i: Math.min(2, Math.floor((this.t - 0.12) / 0.07)), ax: 32, ay: 64 };
    }
    if (this.state === 'roll') return { anim: H.roll, i: this.rollFrame(), ax: 32, ay: 64 };
    if (this.action?.name === 'hit') return { anim: H.hit, i: 0, ax: 16, ay: 56 };
    if (this.action?.name === 'riposte') return { anim: H.run, i: 2, ax: 16, ay: 56 };
    if (Math.hypot(this.vx, this.vy) > 24) return { anim: H.run, i: Math.floor(this.runT * 11) % 4, ax: 16, ay: 56 };
    return { anim: H.idle, i: Math.floor(this.idleT * 7) % 4, ax: 16, ay: 56 };
  }

  draw(g: Game, ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, cx: number, cy: number, _dt: number) {
    if (this.dissolved) return;
    const pick = this.pickSprite(g);
    const frames = this.flash > 0 ? pick.anim.flash : pick.anim.normal;
    const img = frames[pick.i];
    this.sprite = { img: pick.anim.normal[pick.i], ax: pick.ax, ay: pick.ay };
    const x = Math.round(this.x - cx), y = Math.round(this.y - cy);

    // contact shadow, shrinks while airborne in a roll
    const air = this.state === 'roll' ? 0.7 : 1;
    ctx.fillStyle = 'rgba(4,2,10,0.55)';
    ctx.fillRect(x - Math.round(8 * air), y - 1, Math.round(16 * air), 3); ctx.fillRect(x - Math.round(5 * air), y - 2, Math.round(10 * air), 5);

    // pose layered on the frame: brace while guarding, lunge on riposte, recoil when hit
    let sq = this.sq, lean = this.lean;
    if (this.state === 'parry') { sq += 0.1; lean -= this.face * 0.08; }
    if (this.action?.name === 'riposte') lean += this.face * 0.3 * Math.max(0, 1 - this.action.t / RIPOSTE_TIME);
    if (this.action?.name === 'hit') lean -= this.face * 0.25 * Math.max(0, 1 - this.action.t / HIT_TIME);
    sq = Math.max(-0.3, Math.min(0.35, sq));

    const b = this.blade();
    const bladeBehind = Math.sin(b.a) < -0.45 && this.state !== 'parry';   // raised blades tuck behind the head
    if (bladeBehind) this.drawBlade(g, ctx, glow, cx, cy);

    const blink = this.invuln > 0 && this.state !== 'dead' && Math.floor(this.invuln * 20) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.45 : 1;
    ctx.translate(x, y);
    if (Math.abs(lean) > 0.01) ctx.transform(1, 0, -lean, 1, 0, 0);      // shear about the feet
    if (this.face < 0) ctx.scale(-1, 1);
    const w = Math.round(img.width * (1 + sq * 0.55)), h = Math.round(img.height * (1 - sq));
    ctx.drawImage(img, -Math.round(pick.ax * w / img.width), -Math.round(pick.ay * h / img.height), w, h);
    ctx.restore();

    if (!bladeBehind) this.drawBlade(g, ctx, glow, cx, cy);

    // parry arc: bright during the perfect window, dim while guarding
    const ph = this.parryPhase;
    const cyc = y - Player.CHEST;
    if (ph || this.parryFlash > 0) {
      const a = this.parryFlash > 0 ? this.parryAngle : Math.atan2(this.aimY - (this.y - Player.CHEST), this.aimX - this.x);
      glow.strokeStyle = this.parryFlash > 0 ? '#ffffff' : ph === 'perfect' ? '#e8dcff' : '#6d5c99';
      glow.lineWidth = this.parryFlash > 0 ? 3 : 2;
      glow.globalAlpha = this.parryFlash > 0 ? 1 : ph === 'perfect' ? 0.9 : 0.5;
      glow.beginPath(); glow.arc(x, cyc, 20, a - 1.1, a + 1.1); glow.stroke();
      glow.globalAlpha = 1;
    }
    // riposte smear: the arc the blade just swept
    if (this.action?.name === 'riposte' && this.action.t < 0.2) {
      const k = this.action.t / 0.2, base = this.parryAngle;
      glow.globalAlpha = 1 - k;
      glow.strokeStyle = '#e8dcff'; glow.lineWidth = Math.max(1, 4 - k * 3);
      const a0 = base - this.face * 1.6, a1 = base + this.face * 1.4;
      glow.beginPath(); glow.arc(x + this.face * 3, cyc + 2, 24, Math.min(a0, a1), Math.max(a0, a1)); glow.stroke();
      glow.globalAlpha = 1;
    }
  }

  private drawBlade(g: Game, ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, cx: number, cy: number) {
    if (this.state === 'dead') return;
    const D = g.A.dagger, b = this.blade();
    const gx = Math.round(b.gx - cx), gy = Math.round(b.gy - cy);
    const bright = this.parryPhase === 'perfect' || this.parryFlash > 0 || this.action?.name === 'riposte';
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(b.a + Math.PI / 2);                     // sprite blade points up
    ctx.drawImage(bright ? D.flash : D.img, -Math.floor(D.w / 2), -D.h + 4);
    ctx.restore();
    // edge glow so the blade blooms
    glow.globalAlpha = bright ? 1 : 0.55;
    glow.fillStyle = bright ? '#f4ecff' : '#9a5cff';
    for (let i = 6; i <= 20; i += 2) glow.fillRect(Math.round(gx + Math.cos(b.a) * i), Math.round(gy + Math.sin(b.a) * i), 1, 1);
    glow.globalAlpha = 1;
    if (bright) g.fx.light(b.tx, b.ty, 34, '#d8c0ff', 0.6);
    if (this.muzzle > 0) {
      const mx = Math.round(b.tx - cx), my = Math.round(b.ty - cy);
      glow.fillStyle = '#f0e0ff';
      glow.fillRect(mx - 2, my - 1, 5, 3); glow.fillRect(mx - 1, my - 2, 3, 5);
    }
  }
}
