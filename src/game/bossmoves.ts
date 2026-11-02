import type { Anim, Sprite } from './assets';
import { AreaBoss } from './bosses';
import type { EnemyKind } from './enemies';
import type { Game } from './game';
import { BOSSES, type BossDef, type BossKind, type Move } from './roster';

// Roster bosses: a def (roster.ts) picks moves from this shared library and themes them with its color.
// Same rules as the hand-written ones: white glint = parryable, red glint = heavy (perfect parry or roll),
// telegraphs on the ground for anything that lands where you stand. Final bosses get a second phase at half
// health: faster, and every move comes twice as often.

const WHITE = '#ffffff', RED = '#ff3355';
const ATTACKS = new Set<string>(['combo', 'cleave', 'lunge', 'slam', 'ring', 'spiral', 'fan', 'spray', 'summon', 'rain', 'beam', 'blink', 'charge', 'nova', 'mines', 'harden']);

export class ScriptedBoss extends AreaBoss {
  kind: EnemyKind;
  anim: Anim; idleAnim: Anim; attackAnim: Anim | null;
  def: BossDef;
  combo = 0; waves = 0; emitT = 0; alpha = 1; hardT = 0;
  aimA = 0; tx = 0; ty = 0;
  /** Antares: where the head has been, for the body to follow */
  trail: { x: number; y: number }[] = [];
  private segs: Sprite[] = [];

  constructor(g: Game, x: number, y: number, kind: BossKind) {
    super(g, x, y);
    this.kind = kind;
    const d = this.def = BOSSES[kind];
    this.idleAnim = g.A.spec(d.idle);
    this.anim = d.walk ? g.A.spec(d.walk) : this.idleAnim;
    this.attackAnim = d.attack ? g.A.spec(d.attack) : null;
    this.name = d.name;
    this.hp = this.maxHp = d.hp; this.r = d.r; this.chaseSpeed = d.speed; this.maxPosture = d.posture;
    this.baseSpeed = d.speed; this.animFps = d.fps ?? 7; this.leanScale = 0.3;
    this.final = !!d.final;
    // a lair's boss guards ordinary loot, and now and then a rare ability (rolled per hunter)
    this.reward = d.reward === 'lair' ? (Math.random() < 0.3 ? { kind: 'active', key: Math.random() < 0.5 ? 'ruler' : 'exchange', rarity: 3 } : null) : d.reward;
    if (d.serpent) {
      this.segs = ['Body1', 'Body2', 'Body1', 'Body2', 'Body1', 'BodyEnd'].map((n) => g.A.sheet(`boss/DragonBlue/${n}.png`));
      this.z = 40;
    }
  }

  height() { return this.def.serpent ? 60 : this.idleAnim.h; }
  get sm() { return this.phase === 2 ? 1.3 : 1; }

  protected pickAttack(_g: Game, dist: number) {
    const pool = this.def.moves.filter(([, , mn, mx]) => dist >= (mn ?? 0) && dist <= (mx ?? 9999));
    const total = pool.reduce((a, m) => a + m[1], 0);
    let r = Math.random() * total;
    for (const [m, w] of pool) { r -= w; if (r <= 0) return this.startMove(m); }
    return 'chase';
  }
  private startMove(m: Move) {
    this.combo = 0; this.waves = 0; this.emitT = 0;
    return m;
  }

  onHurt(g: Game, amount: number) {
    super.onHurt(g, amount);
    if (this.final && this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      g.banner(`${this.name} AWAKENS`, '#ff3355', 2.2); g.sfx('roar', this.x); g.shake(0.8); g.flash('#ff3355', 0.3);
      g.fx.ring(this.x, this.y - 30, 140, this.def.color, 0.6, 4);
    }
  }

  hurt(g: Game, dmg: number, dx: number, dy: number, opts: { crit?: boolean; knock?: number; how?: string } = {}) {
    if (this.alpha < 0.3) return;
    let mul = 1;
    if (this.hardT > 0 && opts.how !== 'nape') { mul = 0.1; g.fx.burst(this.x, this.y - 40, 4, { speed: 120, color: '#c8f0ff', glow: true, life: 0.2, grav: 0 }); }
    else if (this.def.armor && this.state !== 'stunned' && opts.how !== 'nape') mul = this.def.armor;
    if (this.def.nape && opts.how === 'nape') mul = 3;
    // Antares is always aloft; Boss.hurt ignores anything in the air, so take hits at its ground point
    const z = this.z; if (this.def.serpent) this.z = 0;
    super.hurt(g, dmg * mul, dx, dy, opts);
    this.z = z;
  }

  think(g: Game, dt: number) {
    this.hardT -= dt;
    if (this.def.serpent) {
      // always aloft, bobbing; the body trails the head
      this.z = 46 + Math.sin(this.t * 2) * 8;
      const last = this.trail[0];
      if (!last || Math.hypot(last.x - this.x, last.y - this.y) > 6) { this.trail.unshift({ x: this.x, y: this.y }); if (this.trail.length > 60) this.trail.pop(); }
    }
    super.think(g, dt);
  }

  private players(g: Game) { return g.allPlayers(); }
  /** everyone inside an ellipse on the ground takes it (each on their own machine) */
  private blast(g: Game, x: number, y: number, r: number, dmg: number, heavy = false) {
    for (const pl of this.players(g)) if (Math.hypot(pl.x - x, (pl.y - y) / 0.62) < r + pl.r) g.attack(pl, this, dmg, { kind: 'aoe', heavy }, () => g.deflect(this, heavy));
  }
  private bullet(g: Game, a: number, speed: number, o: { r?: number; dmg?: number; heavy?: boolean; kind?: 'orb' | 'dagger' | 'big'; color?: string } = {}) {
    g.enemyBullet(this.x + Math.cos(a) * 14, this.y - this.z - Math.min(60, this.height() * 0.5), a, speed * this.sm, { r: o.r ?? 5, dmg: o.dmg ?? 12, heavy: !!o.heavy, color: o.color ?? this.def.color, kind: o.kind ?? 'orb', source: this });
  }
  private glint(g: Game, heavy: boolean) {
    g.fx.glint(this.x + this.face * 10, this.y - this.z - this.height() * 0.85, heavy ? RED : WHITE, heavy ? 13 : 10);
    g.sfx(heavy ? 'danger' : 'glint', this.x);
  }

  protected act(g: Game, dt: number, p: { x: number; y: number; vx: number; vy: number; r: number }) {
    const d = this.dirTo(p.x, p.y), first = this.stateT < dt * 1.5, c = this.def.color, sm = this.sm;
    const T = (s: number) => s / sm;   // phase 2 runs every timing a little faster
    switch (this.state as Move) {
      case 'combo': {
        const wind = T(this.combo === 0 ? 0.55 : 0.32);
        if (this.stateT < dt * 1.5) this.glint(g, false);
        if (this.stateT < wind) { this.steer(d.dx * 30, d.dy * 30, dt); if (Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx); }
        else if (!this.hitThisAttack) {
          this.hitThisAttack = true;
          this.vx = d.dx * 260; this.vy = d.dy * 260; this.punch(2.4); g.sfx('swing', this.x);
          g.fx.ring(this.x + d.dx * 30, this.y - 30, 40, c, 0.18, 2);
          if (d.d < this.r + p.r + 46) g.attack(g.targetFor(this), this, 16, { kind: 'melee' }, () => g.deflect(this));
        } else if (this.stateT > wind + T(0.25)) {
          if (++this.combo < 3) { this.stateT = 0; this.hitThisAttack = false; } else this.done(0.8);
        }
        break;
      }
      case 'cleave': {
        const R = this.r + 72;
        if (first) { this.glint(g, true); g.fx.telegraph({ x: this.x, y: this.y, r: R, t: 0, dur: T(0.8), color: RED }); }
        this.steer(0, 0, dt);
        if (this.stateT > T(0.8) && !this.hitThisAttack) {
          this.hitThisAttack = true; this.punch(5); g.sfx('slam', this.x); g.shake(0.4);
          g.fx.ring(this.x, this.y - 10, R, c, 0.3, 4);
          this.blast(g, this.x, this.y, R, 24, true);
        }
        if (this.stateT > T(1.2)) this.done(0.9);
        break;
      }
      case 'lunge': {
        if (first) this.glint(g, true);
        if (this.stateT < T(0.6)) { this.steer(-d.dx * 30, -d.dy * 30, dt); this.fromX = d.dx; this.fromY = d.dy; }
        else if (this.stateT < T(0.6) + 0.35) {
          this.vx = this.fromX * 480; this.vy = this.fromY * 480;
          g.fx.after(this.idleAnim.shadow[0], this.x, this.y, this.face < 0, this.idleAnim.w >> 1, this.idleAnim.h, 0.2);
          if (!this.hitThisAttack && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 12) {
            this.hitThisAttack = true;
            g.attack(g.targetFor(this), this, 22, { heavy: true, kind: 'melee', counter: true }, () => { g.deflect(this, true); this.vx = this.vy = 0; this.done(1.1); });
          }
        } else this.done(0.8);
        break;
      }
      case 'slam': {
        // crouch, leap at where you are, land with a shockwave
        if (first) { this.tx = p.x; this.ty = p.y; this.fromX = this.x; this.fromY = this.y; this.glint(g, true); }
        const up = T(0.35), air = T(0.6);
        if (this.stateT < up) this.steer(0, 0, dt);
        else if (this.stateT < up + air) {
          if (!this.hitThisAttack) { this.hitThisAttack = true; g.fx.telegraph({ x: this.tx, y: this.ty, r: 70, t: 0, dur: air, color: RED }); g.sfx('lunge', this.x); }
          const k = (this.stateT - up) / air;
          this.x = this.fromX + (this.tx - this.fromX) * k; this.y = this.fromY + (this.ty - this.fromY) * k; this.vx = this.vy = 0;
          if (!this.def.serpent) this.z = Math.sin(k * Math.PI) * 120;
        } else if (this.waves === 0) {
          this.waves = 1; if (!this.def.serpent) this.z = 0; this.punch(6);
          g.sfx('slam', this.x); g.shake(0.5);
          g.fx.ring(this.x, this.y, 80, c, 0.35, 4);
          g.fx.burst(this.x, this.y, 24, { speed: 160, colors: ['#3a3352', '#5a4a6a'], size: 2, life: 0.6, grav: 200, vz: 80 });
          this.blast(g, this.x, this.y, 70, 26, true);
          g.hazard(this.x, this.y, 220, 170, 14);
        } else if (this.stateT > up + air + T(0.7)) this.done(0.7);
        break;
      }
      case 'ring': {
        this.steer(0, 0, dt);
        if (first) this.glint(g, false);
        this.emitT -= dt;
        if (this.stateT > T(0.4) && this.emitT <= 0 && this.waves < 3) {
          this.emitT = T(0.4); const n = 16, off = this.waves * (Math.PI / n);
          for (let i = 0; i < n; i++) this.bullet(g, off + (i / n) * Math.PI * 2, 120);
          g.sfx('cast', this.x); this.punch(-2); this.waves++;
        }
        if (this.waves >= 3 && this.emitT <= -0.4) this.done(0.8);
        break;
      }
      case 'spiral': {
        this.steer(0, 0, dt);
        if (first) { this.glint(g, false); this.aimA = Math.random() * Math.PI * 2; }
        this.emitT -= dt;
        if (this.stateT > T(0.4) && this.stateT < T(0.4) + 2.2 && this.emitT <= 0) {
          this.emitT = 0.09; this.aimA += 0.27;
          const arms = this.phase === 2 ? 4 : 3;
          for (let i = 0; i < arms; i++) this.bullet(g, this.aimA + (i / arms) * Math.PI * 2, 110, { r: 4 });
          if (Math.random() < 0.3) g.sfx('enemyShoot', this.x, 0.4);
        }
        if (this.stateT > T(0.4) + 2.6) this.done(0.8);
        break;
      }
      case 'fan': {
        if (first) this.glint(g, false);
        this.steer(-d.dx * 20, -d.dy * 20, dt);
        this.emitT -= dt;
        if (this.stateT > T(0.35) && this.emitT <= 0 && this.waves < 3) {
          this.emitT = T(0.3); this.waves++;
          const a = Math.atan2(p.y - this.y, p.x - this.x);
          for (let i = -2; i <= 2; i++) this.bullet(g, a + i * 0.17, 210, { kind: 'dagger', r: 4 });
          g.sfx('enemyShoot', this.x); this.punch(-1.5);
        }
        if (this.waves >= 3 && this.emitT <= -0.3) this.done(0.7);
        break;
      }
      case 'spray': {
        // a breath or ink stream that sweeps after you
        if (first) { this.glint(g, true); this.aimA = Math.atan2(p.y - this.y, p.x - this.x); }
        this.steer(0, 0, dt);
        const want = Math.atan2(p.y - this.y, p.x - this.x);
        let da = want - this.aimA; da = Math.atan2(Math.sin(da), Math.cos(da));
        this.aimA += Math.max(-1.2 * dt, Math.min(1.2 * dt, da));
        this.emitT -= dt;
        if (this.stateT > T(0.5) && this.stateT < T(0.5) + 1.6 && this.emitT <= 0) {
          this.emitT = 0.05;
          this.bullet(g, this.aimA + (Math.random() - 0.5) * 0.5, 200 + Math.random() * 70, { r: 5, dmg: 9 });
          g.fx.light(this.x, this.y - 40, 80, c, 0.5);
        }
        if (this.stateT > T(0.5) + 2) this.done(0.8);
        break;
      }
      case 'summon': {
        this.steer(0, 0, dt);
        if (first) { this.glint(g, false); g.sfx('arise', this.x); }
        if (this.stateT > 0.7 && !this.hitThisAttack) {
          this.hitThisAttack = true;
          const adds = this.def.adds ?? ['ghoul'], alive = g.enemies.filter((e) => !e.ally && !e.dead && !e.boss && Math.hypot(e.x - this.x, e.y - this.y) < 400).length;
          if (alive < 6) adds.forEach((k, i) => { const a = (i / adds.length) * Math.PI * 2; g.spawn(k as EnemyKind, this.x + Math.cos(a) * 70, this.y + Math.sin(a) * 40, Math.max(1, this.level - 2)); });
        }
        if (this.stateT > 1.1) this.done(0.6);
        break;
      }
      case 'rain': {
        // circles bloom around the hunters, then burst
        this.steer(0, 0, dt);
        if (first) { this.glint(g, false); g.sfx('cast', this.x); }
        this.emitT -= dt;
        if (this.emitT <= 0 && this.waves < 7) {
          this.emitT = T(0.16); this.waves++;
          const pls = this.players(g).filter((pl) => Math.hypot(pl.x - this.x, pl.y - this.y) < 500);
          const t = pls[this.waves % Math.max(1, pls.length)] ?? p;
          const x = t.x + (this.waves === 1 ? 0 : (Math.random() - 0.5) * 220), y = t.y + (this.waves === 1 ? 0 : (Math.random() - 0.5) * 140), dur = T(0.9);
          g.fx.telegraph({ x, y, r: 38, t: 0, dur, color: c });
          g.later(dur, () => {
            if (this.dead) return;
            g.fx.ring(x, y, 40, c, 0.25, 3);
            g.fx.burst(x, y - 6, 12, { speed: 120, colors: [c, '#ffffff'], glow: true, life: 0.35, grav: 120, vz: 80 });
            g.fx.light(x, y, 70, c, 0.8);
            g.sfx('slam', x, 0.35);
            this.blast(g, x, y, 38, 20);
          });
        }
        if (this.waves >= 7 && this.stateT > T(1.8)) this.done(0.6);
        break;
      }
      case 'beam': {
        // sight a line (tracks, then locks), then a rapid string of bolts down it
        this.steer(0, 0, dt);
        if (first) this.glint(g, true);
        if (this.stateT < T(0.7)) this.aimA = Math.atan2(p.y - (this.y - 30), p.x - this.x);
        else if (!this.hitThisAttack) { this.hitThisAttack = true; g.fx.telegraph({ x: this.x, y: this.y - this.z - 30, r: 0, t: 0, dur: T(0.35), color: RED, angle: this.aimA, len: 420, width: 10 }); }
        this.emitT -= dt;
        if (this.stateT > T(1.05) && this.waves < 6 && this.emitT <= 0) { this.emitT = 0.045; this.waves++; this.bullet(g, this.aimA, 640, { r: 6, heavy: true, kind: 'big', dmg: 14 }); g.sfx('enemyShoot', this.x, 0.5); }
        if (this.waves >= 6 && this.stateT > T(1.5)) this.done(0.8);
        break;
      }
      case 'blink': {
        // fade, reappear behind the target, cut
        this.steer(0, 0, dt);
        if (this.stateT < T(0.35)) this.alpha = 1 - this.stateT / T(0.35);
        else if (this.waves === 0) {
          this.waves = 1;
          const side = Math.random() < 0.5 ? -1 : 1, bx = p.x + side * 42, by = p.y + 6;
          g.fx.burst(this.x, this.y - 30, 14, { speed: 60, colors: ['#1a1424', c], life: 0.4, grav: -20 });
          if (!g.level.solidAt(bx, by)) { this.x = bx; this.y = by; }
          this.face = -side; this.alpha = 1;
          g.fx.burst(this.x, this.y - 30, 14, { speed: 60, colors: ['#1a1424', c], life: 0.4, grav: -20 });
          this.glint(g, false);
        } else if (this.stateT > T(0.35) + T(0.35) && !this.hitThisAttack) {
          this.hitThisAttack = true; this.punch(3); g.sfx('swing', this.x);
          this.vx = d.dx * 240; this.vy = d.dy * 240;
          g.fx.ring(this.x + d.dx * 24, this.y - 30, 36, c, 0.18, 2);
          if (d.d < this.r + p.r + 40) g.attack(g.targetFor(this), this, 18, { kind: 'melee' }, () => g.deflect(this));
        } else if (this.stateT > T(1.2)) this.done(0.6);
        break;
      }
      case 'charge': {
        const wind = T(0.7);
        if (this.stateT < dt * 1.5) {
          this.chargeDx = d.dx; this.chargeDy = d.dy; this.glint(g, true);
          g.fx.telegraph({ x: this.x, y: this.y, r: 0, t: 0, dur: wind, color: RED, angle: Math.atan2(d.dy, d.dx), len: 380, width: this.r * 2 });
        }
        if (this.stateT < wind) this.steer(0, 0, dt);
        else if (this.stateT < wind + 0.8) {
          this.vx = this.chargeDx * 380 * sm; this.vy = this.chargeDy * 380 * sm;
          if (Math.random() < 0.5) g.fx.after(this.idleAnim.shadow[0], this.x, this.y - this.z, this.face < 0, this.idleAnim.w >> 1, this.idleAnim.h, 0.18);
          if (!this.hitThisAttack && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 10) {
            this.hitThisAttack = true;
            g.attack(g.targetFor(this), this, 24, { heavy: true, kind: 'melee' }, () => { g.deflect(this, true); this.vx = this.vy = 0; this.done(1.2); });
          }
        } else {
          if (++this.charges < 2) { this.stateT = 0; this.hitThisAttack = false; } else this.done(0.9);
        }
        break;
      }
      case 'nova': {
        this.steer(0, 0, dt);
        if (first) this.glint(g, true);
        if (this.stateT > T(0.6) && this.waves < 2 && this.stateT > T(0.6) + this.waves * 0.45) {
          this.waves++; this.punch(-4);
          g.hazard(this.x, this.y, 240, 150, 16);
          g.fx.ring(this.x, this.y, 50, c, 0.3, 3); g.sfx('slam', this.x, 0.6); g.shake(0.25);
        }
        if (this.stateT > T(1.8)) this.done(0.8);
        break;
      }
      case 'mines': {
        // walk at you leaving burning ground behind
        this.steer(d.dx * this.chaseSpeed * 1.2, d.dy * this.chaseSpeed * 1.2, dt, 4);
        if (first) this.glint(g, false);
        this.emitT -= dt;
        if (this.emitT <= 0 && this.stateT < 2.6) {
          this.emitT = 0.22;
          const x = this.x, y = this.y;
          for (let k = 0; k < 4; k++) g.later(0.3 + k * 0.5, () => {
            g.fx.telegraph({ x, y, r: 26, t: 0, dur: 0.5, color: c });
            g.fx.burst(x, y - 4, 3, { speed: 30, colors: [c, '#ffd84a'], glow: true, life: 0.4, grav: -80 });
            if (k > 0) for (const pl of this.players(g)) if (Math.hypot(pl.x - x, (pl.y - y) / 0.62) < 26 + pl.r && pl.state !== 'roll') g.attack(pl, this, 6, { kind: 'aoe' });
          });
        }
        if (this.stateT > 3) this.done(0.6);
        break;
      }
      case 'harden': {
        // crystal skin: nearly immune for a few seconds, except at the nape
        this.steer(0, 0, dt);
        if (first) { this.hardT = 3.5; g.fx.ring(this.x, this.y - 40, 70, '#c8f0ff', 0.5, 3); g.sfx('guard', this.x); g.banner('HARDENING', '#c8f0ff', 1.2); }
        if (this.stateT > 1) this.done(0.4);
        break;
      }
      default: this.done(0.5);
    }
  }

  currentFrame(variants = true): HTMLCanvasElement {
    if (this.attackAnim && ATTACKS.has(this.state)) {
      const a = this.attackAnim, frames = !variants ? a.normal : this.flash > 0 ? a.flash : a.normal;
      return frames[Math.floor(this.stateT * 10) % frames.length];
    }
    return super.currentFrame(variants);
  }

  draw(g: Game, ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    if (this.alpha < 0.03) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    if (this.hardT > 0) ctx.filter = 'brightness(1.4) saturate(0.4)';
    if (this.def.serpent && this.state !== 'spawn') this.drawSerpent(g, ctx, cx, cy);
    else super.draw(g, ctx, cx, cy);
    ctx.restore();
  }

  /** Antares: wings and a trailing body under the head, all floating on its ground shadow. */
  private drawSerpent(g: Game, ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const z = this.z, s = 2;
    ctx.fillStyle = 'rgba(4,2,10,0.5)';
    ctx.beginPath(); ctx.ellipse(Math.round(this.x - cx), Math.round(this.y - cy), 34, 11, 0, 0, Math.PI * 2); ctx.fill();
    const at = (i: number) => this.trail[Math.min(this.trail.length - 1, i * 3)] ?? { x: this.x, y: this.y };
    const wing = g.A.sheet('boss/DragonBlue/Wing.png'), flap = 1 + Math.sin(this.t * 6) * 0.2;
    const w0 = at(2);
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(Math.round(w0.x - cx), Math.round(w0.y - z - 40 - cy)); ctx.scale(side * s, s * flap);
      ctx.drawImage(wing, 0, -wing.height / 2); ctx.restore();
    }
    for (let i = this.segs.length - 1; i >= 0; i--) {
      const q = at(i + 1), img = this.segs[i];
      ctx.drawImage(img, Math.round(q.x - cx - img.width), Math.round(q.y - z - cy - img.height * s + 10 + i * 2), img.width * s, img.height * s);
    }
    const y0 = this.y; this.y -= z; this.z = 0;
    super.draw(g, ctx, cx, cy);
    this.y = y0; this.z = z;
  }

  drawGlow(g: Game, glow: CanvasRenderingContext2D, cx: number, cy: number) {
    super.drawGlow(g, glow, cx, cy);
    if (this.state !== 'spawn' && this.alpha > 0.5) g.fx.light(this.x, this.y - this.z - this.height() * 0.6, 70, this.def.color, 0.35);
  }
}

export const isRosterBoss = (k: string): k is BossKind => k in BOSSES;
