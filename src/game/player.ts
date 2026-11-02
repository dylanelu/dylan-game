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
  walk = 0; squash = 0; afterT = 0;
  parryFlash = 0;        // brief bright arc after a successful parry
  parryAngle = 0;        // where that arc points: toward whatever we deflected

  constructor(public x: number, public y: number) {}

  setState(s: PlayerState) { this.state = s; this.t = 0; }

  get parryPhase(): 'perfect' | 'guard' | null {
    if (this.state !== 'parry') return null;
    return this.t < PARRY_PERFECT ? 'perfect' : 'guard';
  }

  tryParry(g: Game) {
    if (this.state === 'dead' || this.state === 'roll' || this.state === 'recover' || this.state === 'parry') return;
    this.setState('parry');
    this.squash = -0.12;
    g.audio.play('whiff');
  }

  tryRoll(g: Game, dx: number, dy: number) {
    if (this.state === 'dead' || this.state === 'roll' || this.rollCd > 0) return;
    let l = Math.hypot(dx, dy);
    if (l < 0.01) { dx = g.input.move.x; dy = g.input.move.y; l = Math.hypot(dx, dy); }
    if (l < 0.01) { dx = this.aimX - this.x; dy = this.aimY - this.y; l = Math.hypot(dx, dy); }
    if (l < 0.01) { dx = this.face; dy = 0; l = 1; }
    this.rollDx = dx / l; this.rollDy = dy / l;
    this.setState('roll');
    this.iframes = ROLL_IFRAMES;
    this.vx = this.rollDx * ROLL_SPEED; this.vy = this.rollDy * ROLL_SPEED;
    this.squash = 0.25;
    if (Math.abs(this.rollDx) > 0.2) this.face = Math.sign(this.rollDx);
    g.audio.play('roll');
    g.fx.burst(this.x, this.y, 8, { speed: 60, colors: ['#3a3155', '#2a2340'], size: 2, life: 0.4, z: 1, vz: 10, grav: 40, angle: Math.atan2(-this.rollDy, -this.rollDx), spread: 1.6 });
  }

  update(g: Game, dt: number) {
    this.t += dt;
    this.rollCd -= dt; this.fireCd -= dt; this.iframes -= dt; this.invuln -= dt;
    this.flash -= dt; this.parryFlash -= dt;
    this.squash *= Math.exp(-dt * 14);
    if (this.state === 'dead') { this.vx *= 0.9; this.vy *= 0.9; return; }

    const mv = g.input.move;
    if (this.state === 'roll') {
      // fast start, eased stop: reads as a committed dive
      const k = Math.max(0, 1 - this.t / ROLL_TIME);
      const sp = ROLL_SPEED * (0.35 + 0.65 * k * k);
      this.vx = this.rollDx * sp; this.vy = this.rollDy * sp;
      this.afterT -= dt;
      if (this.afterT <= 0) {
        this.afterT = 0.028;
        g.fx.after(g.A.heroShadow, this.x, this.y, this.face < 0, g.A.hero.width, g.A.hero.height, 0.22);
      }
      if (this.t >= ROLL_TIME) { this.setState('normal'); this.rollCd = ROLL_COOLDOWN; this.squash = -0.1; }
    } else {
      let speed = SPEED;
      if (this.state === 'parry') speed *= 0.35;
      if (this.state === 'recover') speed *= 0.45;
      const tx = mv.x * speed, ty = mv.y * speed;
      const accel = Math.hypot(mv.x, mv.y) > 0.1 ? 22 : 16;  // snappy start, slightly softer stop
      this.vx += (tx - this.vx) * Math.min(1, accel * dt);
      this.vy += (ty - this.vy) * Math.min(1, accel * dt);
      if (this.state === 'parry' && this.t >= PARRY_TOTAL) this.setState('recover');
      if (this.state === 'recover' && this.t >= WHIFF_RECOVER) this.setState('normal');
    }

    this.x += this.vx * dt; this.y += this.vy * dt;
    g.level.collide(this, this.r);

    const moving = Math.hypot(this.vx, this.vy) > 20;
    this.walk = moving ? this.walk + dt * Math.hypot(this.vx, this.vy) / 14 : 0;

    // facing: aim when shooting / on mouse, else movement
    const ax = this.aimX - this.x;
    if (g.input.device === 'mouse' || g.input.firing) { if (Math.abs(ax) > 2) this.face = Math.sign(ax); }
    else if (Math.abs(this.vx) > 10) this.face = Math.sign(this.vx);

    // mana regenerates after a short pause
    this.manaDelay -= dt;
    if (this.manaDelay <= 0) this.mana = Math.min(this.maxMana, this.mana + 30 * dt);

    if (g.input.firing && this.state !== 'roll' && this.fireCd <= 0) this.fire(g);
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
    const sx = this.x + this.face * 6, sy = this.y - 32;
    let dx = this.aimX - sx, dy = this.aimY - sy;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    // tiny spread keeps streams lively without hurting aim
    const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.05;
    const speed = emp ? 520 : 440;
    g.bullets.push({
      x: sx + Math.cos(a) * 8, y: sy + Math.sin(a) * 8, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: emp ? 5 : 3, dmg: emp ? 22 : 9, team: 'player', parryable: false, life: 0.85, age: 0,
      color: emp ? '#d8a8ff' : '#a45cff', kind: emp ? 'big' : 'dagger', pierce: emp ? 3 : 0, hits: new Set(), source: null,
    });
    if (emp) { this.empowered--; g.audio.play('shootBig'); g.shake(0.12); } else g.audio.play('shoot');
    this.vx -= dx * 18; this.vy -= dy * 18;           // recoil
    g.kick(-dx * (emp ? 3 : 1.5), -dy * (emp ? 3 : 1.5));
    g.fx.light(sx + dx * 10, sy + dy * 10, emp ? 70 : 46, '#b06bff', 1);
    g.fx.burst(sx + dx * 10, sy + dy * 10, 3, { speed: 90, angle: a, spread: 0.8, color: '#e2c8ff', glow: true, life: 0.12, z: 0, vz: 0, grav: 0, size: 1 });
    this.muzzle = 0.05;
  }
  muzzle = 0;

  draw(g: Game, ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, cx: number, cy: number) {
    const A = g.A, img = this.flash > 0 ? A.heroFlash : A.hero;
    const w = A.hero.width, h = A.hero.height;
    const bob = this.state === 'normal' && this.walk > 0 ? Math.round(Math.abs(Math.sin(this.walk)) * 2) : 0;
    const sq = this.squash;
    const sw = Math.round(w * (1 + sq * 0.6)), sh = Math.round(h * (1 - sq));
    const x = Math.round(this.x - cx), y = Math.round(this.y - cy);
    // contact shadow
    ctx.fillStyle = 'rgba(4,2,10,0.55)';
    ctx.fillRect(x - 9, y - 1, 18, 3); ctx.fillRect(x - 6, y - 2, 12, 5);
    const blink = this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = this.state === 'roll' ? 0.75 : blink ? 0.5 : 1;
    ctx.translate(x, y - bob);
    if (this.face < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, -Math.floor(sw / 2), -sh, sw, sh);
    ctx.restore();

    // parry arc toward the aim: bright during the perfect window, dim while guarding
    const ph = this.parryPhase;
    if (ph || this.parryFlash > 0) {
      const a = this.parryFlash > 0 ? this.parryAngle : Math.atan2(this.aimY - (this.y - 30), this.aimX - this.x);
      glow.strokeStyle = this.parryFlash > 0 ? '#ffffff' : ph === 'perfect' ? '#e8dcff' : '#6d5c99';
      glow.lineWidth = this.parryFlash > 0 ? 3 : 2;
      glow.globalAlpha = this.parryFlash > 0 ? 1 : ph === 'perfect' ? 0.9 : 0.5;
      glow.beginPath(); glow.arc(x, y - 30, 22, a - 1.1, a + 1.1); glow.stroke();
      glow.globalAlpha = 1;
    }
    if (this.muzzle > 0) {
      this.muzzle -= 1 / 60;
      const a = Math.atan2(this.aimY - (this.y - 32), this.aimX - this.x);
      glow.fillStyle = '#f0e0ff';
      const mx = Math.round(x + this.face * 6 + Math.cos(a) * 10), my = Math.round(y - 32 + Math.sin(a) * 10);
      glow.fillRect(mx - 2, my - 1, 5, 3); glow.fillRect(mx - 1, my - 2, 3, 5);
    }
  }
}
