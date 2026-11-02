import type { Game } from './game';
import { AX, AY, ARM_LEN, type Frame } from './hero';

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
const AIM_HOLD = 0.45;               // keep the arm raised this long after the last shot

export type PlayerState = 'normal' | 'roll' | 'parry' | 'recover' | 'dead';

export class Player {
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
  squash = 0; afterT = 0;
  parryFlash = 0;        // brief bright arc after a successful parry
  parryAngle = 0;        // where that arc points: toward whatever we deflected

  // animation
  anim = 'idle'; animT = 0;
  action: { name: string; t: number } | null = null;   // one-shot overlays: riposte, hit
  aimHold = 0; recoil = 0;
  private lastStepFrame = -1;
  private wasRunning = 0;
  dissolved = false;
  frame!: Frame;

  constructor(public x: number, public y: number) {}

  setState(s: PlayerState) { this.state = s; this.t = 0; }
  play(name: string) { this.action = { name, t: 0 }; }

  get parryPhase(): 'perfect' | 'guard' | null {
    if (this.state !== 'parry') return null;
    return this.t < PARRY_PERFECT ? 'perfect' : 'guard';
  }

  tryParry(g: Game) {
    if (this.state === 'dead' || this.state === 'roll' || this.state === 'recover' || this.state === 'parry') return;
    this.setState('parry');
    this.action = null;
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
    g.sfx('roll', this.x);
    g.fx.burst(this.x, this.y, 10, { speed: 70, colors: ['#3a3155', '#2a2340', '#4a4066'], size: 2, life: 0.45, z: 1, vz: 14, grav: 40, angle: Math.atan2(-this.rollDy, -this.rollDx), spread: 1.8 });
  }

  update(g: Game, dt: number) {
    this.t += dt;
    this.rollCd -= dt; this.fireCd -= dt; this.iframes -= dt; this.invuln -= dt;
    this.flash -= dt; this.parryFlash -= dt; this.aimHold -= dt;
    this.recoil *= Math.exp(-dt * 30);
    this.squash *= Math.exp(-dt * 14);
    if (this.action) { this.action.t += dt; if (this.action.t > g.A.rig.anims[this.action.name].total) this.action = null; }
    if (this.state === 'dead') {
      this.vx *= Math.exp(-dt * 6); this.vy *= Math.exp(-dt * 6);
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.animate(g, dt);
      return;
    }

    const mv = g.input.move;
    if (this.state === 'roll') {
      // fast start, eased stop: reads as a committed dive
      const k = Math.max(0, 1 - this.t / ROLL_TIME);
      const sp = ROLL_SPEED * (0.35 + 0.65 * k * k);
      this.vx = this.rollDx * sp; this.vy = this.rollDy * sp;
      this.afterT -= dt;
      if (this.afterT <= 0 && this.frame) {
        this.afterT = 0.026;
        g.fx.after(this.frame.shadow, this.x, this.y, this.face < 0, AX, AY, 0.24);
      }
      if (this.t >= ROLL_TIME) {
        this.setState('normal'); this.rollCd = ROLL_COOLDOWN; this.squash = 0.12;
        g.fx.burst(this.x, this.y, 5, { speed: 40, colors: ['#3a3155', '#2a2340'], size: 2, life: 0.35, z: 1, vz: 8, grav: 40 });
      }
    } else {
      let speed = SPEED;
      if (this.state === 'parry') speed *= 0.35;
      if (this.state === 'recover') speed *= 0.45;
      if (this.action?.name === 'riposte') speed *= 0.3;
      const tx = mv.x * speed, ty = mv.y * speed;
      const accel = Math.hypot(mv.x, mv.y) > 0.1 ? 22 : 16;  // snappy start, slightly softer stop
      this.vx += (tx - this.vx) * Math.min(1, accel * dt);
      this.vy += (ty - this.vy) * Math.min(1, accel * dt);
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

    // mana regenerates after a short pause
    this.manaDelay -= dt;
    if (this.manaDelay <= 0) this.mana = Math.min(this.maxMana, this.mana + 30 * dt);

    if (g.input.firing && this.state !== 'roll' && this.action?.name !== 'riposte' && this.fireCd <= 0) this.fire(g);
    this.animate(g, dt);
  }

  /** Pick the animation for the current state and advance it. Run speed follows ground speed so feet don't slide. */
  private animate(g: Game, dt: number) {
    const rig = g.A.rig;
    const speed = Math.hypot(this.vx, this.vy);
    let name: string, t: number;
    if (this.state === 'dead') { name = 'death'; t = this.t; }
    else if (this.state === 'roll') { name = 'roll'; t = this.t; }
    else if (this.state === 'parry') { name = 'parry'; t = this.t; }
    else if (this.state === 'recover') { name = 'parryRecover'; t = this.t; }
    else if (this.action) { name = this.action.name; t = this.action.t; }
    else if (speed > 26) {
      name = Math.abs(this.vx) > Math.abs(this.vy) * 0.6 ? 'run' : 'runFront';
      if (this.anim !== 'run' && this.anim !== 'runFront') { this.animT = 0.07; this.squash = -0.06; }   // start on a push-off
      this.animT += dt * (speed / SPEED);
      t = this.animT;
      this.wasRunning = 0.12;
      const fi = rig.indexAt(name, t);
      if ((fi === 0 || fi === 4) && fi !== this.lastStepFrame) {
        g.sfx('step', this.x);
        g.fx.burst(this.x + (fi === 0 ? 3 : -3) * this.face, this.y, 2, { speed: 25, color: '#3a3352', size: 1, life: 0.3, z: 0, vz: 12, grav: 60 });
      }
      this.lastStepFrame = fi;
    } else if (this.wasRunning > 0) {
      // skid into idle instead of snapping
      if (this.anim !== 'skid') { this.animT = 0; g.sfx('step', this.x, 0.7); }
      this.wasRunning -= dt;
      name = 'skid'; this.animT += dt; t = this.animT;
    } else {
      name = 'idle';
      if (this.anim !== 'idle') this.animT = 0;
      this.animT += dt; t = this.animT;
    }
    if (name === 'run' || name === 'runFront' || name === 'idle' || name === 'skid') this.anim = name;
    else { this.anim = name; this.animT = t; }
    this.frame = rig.frameAt(name, t);
  }

  /** True when the gun arm is live-aimed instead of using the baked pose. */
  get aiming() {
    return this.aimHold > 0 && (this.state === 'normal') && !this.action;
  }

  /** World-space position of the front hand (muzzle), accounting for facing and the live arm. */
  handPos(g: Game) {
    const f = this.frame;
    if (!f) return { x: this.x + this.face * 8, y: this.y - 32 };
    const lx = f.shoulder.x - AX, ly = f.shoulder.y - AY;
    const a = this.aimAngleLocal();
    return { x: this.x + (lx + Math.cos(a) * (ARM_LEN + 2)) * this.face, y: this.y + ly + Math.sin(a) * (ARM_LEN + 2) };
    void g;
  }

  /** Aim angle in the sprite's own (right-facing) space. */
  private aimAngleLocal() {
    const f = this.frame;
    const sx = this.x + (f.shoulder.x - AX) * this.face, sy = this.y + f.shoulder.y - AY;
    let a = Math.atan2(this.aimY - sy, this.aimX - sx);
    if (this.face < 0) a = Math.PI - a;
    return a;
  }

  fire(g: Game) {
    const emp = this.empowered > 0;
    const cost = emp ? 0 : SHOT_COST;
    if (this.mana < cost) {
      if (this.fireCd <= 0) { this.fireCd = 0.25; g.fx.text(this.x, this.y - 66, 'NO MANA', '#8a7ab8', 1, 0.5); }
      return;
    }
    this.mana -= cost; this.manaDelay = 0.45;
    this.fireCd = FIRE_INTERVAL;
    if (Math.abs(this.aimX - this.x) > 2) this.face = Math.sign(this.aimX - this.x);
    this.aimHold = AIM_HOLD;
    const h = this.handPos(g);
    let dx = this.aimX - h.x, dy = this.aimY - h.y;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    // tiny spread keeps streams lively without hurting aim
    const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.05;
    const speed = emp ? 520 : 440;
    g.bullets.push({
      x: h.x, y: h.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: emp ? 5 : 3, dmg: emp ? 22 : 9, team: 'player', parryable: false, life: 0.85, age: 0,
      color: emp ? '#d8a8ff' : '#a45cff', kind: emp ? 'big' : 'dagger', pierce: emp ? 3 : 0, hits: new Set(), source: null,
    });
    if (emp) { this.empowered--; g.sfx('shootBig', this.x); g.shake(0.12); } else g.sfx('shoot', this.x);
    this.vx -= dx * 18; this.vy -= dy * 18;           // body recoil
    this.recoil = emp ? 4 : 2.5;                        // arm snaps back
    g.kick(-dx * (emp ? 3 : 1.5), -dy * (emp ? 3 : 1.5));
    g.fx.light(h.x, h.y, emp ? 70 : 46, '#b06bff', 1);
    g.fx.burst(h.x, h.y, 3, { speed: 90, angle: a, spread: 0.8, color: '#e2c8ff', glow: true, life: 0.12, z: 0, vz: 0, grav: 0, size: 1 });
    this.muzzle = 0.06;
  }
  muzzle = 0;

  draw(g: Game, ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, cx: number, cy: number, dt: number) {
    if (this.dissolved || !this.frame) return;
    const rig = g.A.rig, f = this.frame;
    const x = Math.round(this.x - cx), y = Math.round(this.y - cy);
    // contact shadow, squashed while airborne in a roll
    const air = this.state === 'roll' ? 0.7 : 1;
    ctx.fillStyle = 'rgba(4,2,10,0.55)';
    ctx.fillRect(x - Math.round(9 * air), y - 1, Math.round(18 * air), 3); ctx.fillRect(x - Math.round(6 * air), y - 2, Math.round(12 * air), 5);

    const blink = this.invuln > 0 && this.state !== 'dead' && Math.floor(this.invuln * 20) % 2 === 0;
    const aiming = this.aiming;
    const body = this.flash > 0 ? f.flash : aiming ? f.noArm : f.img;
    const sq = this.squash;
    ctx.save();
    ctx.globalAlpha = blink ? 0.45 : 1;
    ctx.translate(x, y);
    if (this.face < 0) ctx.scale(-1, 1);
    if (Math.abs(sq) > 0.01) ctx.scale(1 + sq * 0.5, 1 - sq);
    ctx.drawImage(body, -AX, -AY);

    // live gun arm: rotates about the posed shoulder toward the aim, kicks back on each shot
    let hand: { x: number; y: number; a: number } | null = f.hand ? { x: f.hand.x - AX, y: f.hand.y - AY, a: f.hand.a } : null;
    if (aiming) {
      const a = this.aimAngleLocal();
      const sx = f.shoulder.x - AX - Math.cos(a) * this.recoil, sy = f.shoulder.y - AY - Math.sin(a) * this.recoil;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a - Math.PI / 2);
      ctx.drawImage(this.flash > 0 ? rig.gunArmFlash : rig.gunArm, -rig.gunPivot[0], -rig.gunPivot[1]);
      ctx.restore();
      hand = { x: sx + Math.cos(a) * ARM_LEN, y: sy + Math.sin(a) * ARM_LEN, a };
    }
    ctx.restore();

    // shadow dagger in the front hand (glow layer, so it blooms)
    if (hand && this.state !== 'dead') {
      const hx = x + hand.x * this.face, hy = y + hand.y;
      const ha = this.face < 0 ? Math.PI - hand.a : hand.a;
      const bright = this.parryPhase === 'perfect' || this.parryFlash > 0 || this.action?.name === 'riposte';
      glow.fillStyle = bright ? '#f0e4ff' : '#9a5cff';
      for (let i = 1; i <= 6; i++) glow.fillRect(Math.round(hx + Math.cos(ha) * i), Math.round(hy + Math.sin(ha) * i), 1, 1);
      glow.fillStyle = '#ffffff';
      glow.fillRect(Math.round(hx + Math.cos(ha) * 6), Math.round(hy + Math.sin(ha) * 6), 1, 1);
      if (bright) g.fx.light(this.x + hand.x * this.face, this.y + hand.y, 30, '#d8c0ff', 0.6);
    }

    // parry arc: bright during the perfect window, dim while guarding
    const ph = this.parryPhase;
    if (ph || this.parryFlash > 0) {
      const a = this.parryFlash > 0 ? this.parryAngle : Math.atan2(this.aimY - (this.y - 30), this.aimX - this.x);
      glow.strokeStyle = this.parryFlash > 0 ? '#ffffff' : ph === 'perfect' ? '#e8dcff' : '#6d5c99';
      glow.lineWidth = this.parryFlash > 0 ? 3 : 2;
      glow.globalAlpha = this.parryFlash > 0 ? 1 : ph === 'perfect' ? 0.9 : 0.5;
      glow.beginPath(); glow.arc(x, y - 30, 22, a - 1.1, a + 1.1); glow.stroke();
      glow.globalAlpha = 1;
    }
    // riposte smear: a crescent swept through the strike frames
    if (this.action?.name === 'riposte' && this.action.t > 0.04 && this.action.t < 0.22) {
      const k = (this.action.t - 0.04) / 0.18;
      glow.globalAlpha = 1 - k;
      glow.strokeStyle = '#e8dcff'; glow.lineWidth = 3 - k * 2;
      const base = this.face > 0 ? 0 : Math.PI;
      glow.beginPath(); glow.arc(x + this.face * 6, y - 32, 20 + k * 6, base - 1.2 + k * 0.4, base + 0.9 * (1 - k * 0.3)); glow.stroke();
      glow.globalAlpha = 1;
    }
    if (this.muzzle > 0) {
      this.muzzle -= dt;
      const h = this.handPos(g);
      const mx = Math.round(h.x - cx), my = Math.round(h.y - cy);
      glow.fillStyle = '#f0e0ff';
      glow.fillRect(mx - 2, my - 1, 5, 3); glow.fillRect(mx - 1, my - 2, 3, 5);
    }
  }
}
