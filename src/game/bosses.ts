import type { Anim } from './assets';
import { Boss } from './boss';
import { Enemy, type EnemyKind } from './enemies';
import type { Game } from './game';

// The named places' bosses and the titans. Area bosses reuse the final boss's posture / deflect / boss-bar
// machinery but have their own movesets, and each guards a unique reward. Every attack can be parried:
// white glint = normal, red glint = heavy (perfect parry for a big payoff, or roll).

const WHITE = '#ffffff', RED = '#ff3355';

/** Shared base: posture, boss bar, reward; a simple attack scheduler; no phase-2 enrage. */
export abstract class AreaBoss extends Boss {
  final = false;
  idleFor = 1;
  attackT = 0;
  protected abstract pickAttack(g: Game, dist: number): string;
  protected abstract act(g: Game, dt: number, p: { x: number; y: number; vx: number; vy: number; r: number }): void;
  protected chaseSpeed = 50;
  /** where it guards; it won't chase you across the map */
  homeX: number; homeY: number;
  /** a boss only gives up after you've been well clear of its ground for a while */
  static readonly LEASH = 760;
  static readonly GIVE_UP = 4;
  leashT = 0; returning = false; returnT = 0;

  constructor(g: Game, x: number, y: number) { super(g, x, y); this.homeX = x; this.homeY = y; }

  onHurt(g: Game, amount: number) { if (this.state !== 'stunned') this.addPosture(g, amount * 0.12); }

  think(g: Game, dt: number) {
    const p = g.targetFor(this), d = this.dirTo(p.x, p.y);
    this.postureIdle += dt;
    if (this.postureIdle > 2.5) this.posture = Math.max(0, this.posture - 7 * dt);
    const away = Math.hypot(p.x - this.homeX, p.y - this.homeY) > AreaBoss.LEASH;
    this.leashT = away ? this.leashT + dt : 0;
    if (!away) this.returning = false;
    else if (this.leashT > AreaBoss.GIVE_UP && !this.returning && (this.state === 'chase' || this.state === 'recover' || this.state === 'idle')) {
      this.returning = true; this.returnT = 0; this.setState('chase');
      g.fx.text(this.x, this.y - this.height() - 8, 'RETREATS', '#8a7ab8', 1.5, 1);
    }
    if (this.state === 'idle' || this.state === 'chase') {
      if (!this.introDone) { this.introDone = true; g.banner(this.name, '#ff6680', 2.2); g.sfx('roar', this.x); g.shake(0.5); }
      if (this.posture >= this.maxPosture) this.posture = 0;
      if (this.returning) {
        // you left its ground: it walks home, and only once there does it recover
        const h = this.dirTo(this.homeX, this.homeY);
        this.returnT += dt;
        if (h.d > 30 && this.returnT > 3) {
          // walls in the way: slip back home in a puff of smoke rather than path around them
          const poof = (x: number, y: number) => g.fx.burst(x, y - 20, 18, { speed: 70, colors: ['#1a1424', '#3a2a4a', '#5a4a6a'], life: 0.5, grav: -20 });
          poof(this.x, this.y); this.x = this.homeX; this.y = this.homeY; this.vx = this.vy = 0; poof(this.x, this.y);
        } else if (h.d > 30) { this.steer(h.dx * this.chaseSpeed * 1.4, h.dy * this.chaseSpeed * 1.4, dt, 4); if (Math.abs(h.dx) > 0.15) this.face = Math.sign(h.dx); }
        else { this.steer(0, 0, dt); this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.05 * dt); this.posture = 0; }
        this.stateT = 0;
        return;
      }
      if (Math.abs(d.dx) > 0.15) this.face = Math.sign(d.dx);
      this.steer(d.dx * this.chaseSpeed, d.dy * this.chaseSpeed, dt, 4);
      if (this.stateT > this.idleFor && p.state !== 'dead') this.setState(this.pickAttack(g, d.d));
      return;
    }
    if (this.state === 'recover') { this.steer(0, 0, dt); if (this.stateT > this.idleFor) this.setState('chase'); return; }
    this.act(g, dt, p);
  }

  /** Finish an attack: rest a moment, then chase again. */
  protected done(rest: number) { this.idleFor = rest; this.setState('recover'); }

  drawGlow(g: Game, glow: CanvasRenderingContext2D, cx: number, cy: number) {
    // just the stagger stars; area bosses don't have the Warden's burning eyes
    Enemy.prototype.drawGlow.call(this, g, glow, cx, cy);
  }
}

// ---------------------------------------------------------------- SHADOW KNIGHT (Arise Arena)

export class ShadowKnight extends AreaBoss {
  kind: EnemyKind = 'knight';
  anim: Anim; idleAnim: Anim;
  combo = 0; summons = 0;
  constructor(g: Game, x: number, y: number) {
    super(g, x, y);
    this.anim = g.A.nAnim('RedSamuraiWalk', 0, 0, 96, 48, 6, 96, 0, 2);
    this.idleAnim = g.A.nAnim('RedSamuraiIdle', 0, 0, 96, 48, 6, 96, 0, 2);
    this.name = 'THE SHADOW KNIGHT';
    this.hp = this.maxHp = 650; this.r = 18; this.chaseSpeed = 56;
    this.reward = { kind: 'active', key: 'summon', rarity: 3 };
  }
  height() { return 80; }
  protected pickAttack(_g: Game, dist: number) {
    if (this.summons < 2 && this.hp < this.maxHp * (0.8 - this.summons * 0.3)) return 'summon';
    return dist < 110 ? (Math.random() < 0.7 ? 'combo' : 'cleave') : Math.random() < 0.5 ? 'lunge' : 'combo';
  }
  protected act(g: Game, dt: number, p: { x: number; y: number; vx: number; vy: number; r: number }) {
    const d = this.dirTo(p.x, p.y);
    switch (this.state) {
      case 'combo': {
        const wind = this.combo === 0 ? 0.55 : 0.32;
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x + this.face * 16, this.y - 70, WHITE, 10); g.sfx('glint', this.x); }
        if (this.stateT < wind) { this.steer(d.dx * 20, d.dy * 20, dt); if (Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx); }
        else if (!this.hitThisAttack) {
          this.hitThisAttack = true;
          this.vx = d.dx * 260; this.vy = d.dy * 260; this.punch(2.4);
          g.sfx('swing', this.x);
          g.fx.ring(this.x + d.dx * 30, this.y - 30, 40, '#ffb0c0', 0.18, 2);
          if (d.d < this.r + p.r + 44) g.attack(g.targetFor(this), this, 18, { kind: 'melee' }, () => g.deflect(this));
        } else if (this.stateT > wind + 0.25) {
          if (++this.combo < 3) { this.stateT = 0; this.hitThisAttack = false; }
          else { this.combo = 0; this.done(0.9); }
        }
        break;
      }
      case 'cleave': {
        if (this.stateT < dt * 1.5) {
          g.fx.glint(this.x, this.y - 74, RED, 12); g.sfx('danger', this.x);
          g.fx.telegraph({ x: this.x, y: this.y, r: 84, t: 0, dur: 0.8, color: '#ff2244' });
        }
        this.steer(0, 0, dt);
        if (this.stateT > 0.8 && !this.hitThisAttack) {
          this.hitThisAttack = true; this.punch(5);
          g.sfx('slam', this.x); g.shake(0.4);
          g.fx.ring(this.x, this.y - 10, 90, '#ff3355', 0.3, 4);
          if (Math.hypot(p.x - this.x, (p.y - this.y) / 0.62) < 84 + p.r) g.attack(g.targetFor(this), this, 26, { heavy: true, kind: 'aoe' }, () => g.deflect(this, true));
        }
        if (this.stateT > 1.2) this.done(0.9);
        break;
      }
      case 'lunge': {
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x, this.y - 74, RED, 12); g.sfx('danger', this.x); }
        if (this.stateT < 0.6) { this.steer(-d.dx * 30, -d.dy * 30, dt); this.fromX = d.dx; this.fromY = d.dy; }
        else if (this.stateT < 0.95) {
          this.vx = this.fromX * 460; this.vy = this.fromY * 460;
          g.fx.after(this.anim.shadow[0], this.x, this.y, this.face < 0, this.anim.w >> 1, this.anim.h, 0.2);
          if (!this.hitThisAttack && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 10) {
            this.hitThisAttack = true;
            g.attack(g.targetFor(this), this, 24, { heavy: true, kind: 'melee' }, () => { g.deflect(this, true); this.vx = this.vy = 0; this.done(1.1); });
          }
        } else this.done(0.8);
        break;
      }
      case 'summon': {
        this.steer(0, 0, dt);
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x, this.y - 74, WHITE, 12); g.sfx('arise', this.x); g.banner('RISE, MY SOLDIERS', '#b26bff', 1.4); }
        if (this.stateT > 0.7 && !this.hitThisAttack) {
          this.hitThisAttack = true; this.summons++;
          for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; g.spawn('ghoul', this.x + Math.cos(a) * 60, this.y + Math.sin(a) * 30, this.level - 2); }
        }
        if (this.stateT > 1.1) this.done(0.6);
        break;
      }
      default: this.done(0.5);
    }
  }
}

// ---------------------------------------------------------------- TOJI (Toji Towers)

export class Toji extends AreaBoss {
  kind: EnemyKind = 'toji';
  anim: Anim; idleAnim: Anim;
  dashes = 0; alpha = 1;
  constructor(g: Game, x: number, y: number) {
    super(g, x, y);
    this.anim = g.A.nAnim('NinjaDark', 48, 0, 16, 16, 4, 0, 16, 3);
    this.idleAnim = g.A.nAnim('NinjaDark', 0, 0, 16, 16, 1, 0, 0, 3);
    this.name = 'TOJI';
    this.hp = this.maxHp = 520; this.r = 12; this.chaseSpeed = 118; this.heavy = 10;
    this.maxPosture = 80;
    this.reward = { kind: 'relic', key: 'boundless', rarity: 3 };
    this.animFps = 10;
  }
  height() { return 46; }
  protected pickAttack(_g: Game, dist: number) {
    const r = Math.random();
    return dist > 160 ? (r < 0.5 ? 'kunai' : 'dash') : r < 0.45 ? 'dash' : r < 0.8 ? 'vanish' : 'kunai';
  }
  protected act(g: Game, dt: number, p: { x: number; y: number; vx: number; vy: number; r: number }) {
    const d = this.dirTo(p.x, p.y);
    switch (this.state) {
      case 'dash': {
        const wind = this.dashes === 0 ? 0.42 : 0.24;
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x, this.y - 50, WHITE, 8); g.sfx('glint', this.x); this.fromX = d.dx; this.fromY = d.dy; }
        if (this.stateT < wind) { this.steer(0, 0, dt); this.fromX = d.dx; this.fromY = d.dy; if (Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx); }
        else if (this.stateT < wind + 0.2) {
          this.vx = this.fromX * 560; this.vy = this.fromY * 560;
          g.fx.after(this.anim.shadow[0], this.x, this.y, this.face < 0, this.anim.w >> 1, this.anim.h, 0.18);
          if (!this.hitThisAttack && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 12) {
            this.hitThisAttack = true; g.sfx('swing', this.x);
            g.attack(g.targetFor(this), this, 16, { kind: 'melee' }, () => g.deflect(this));
          }
        } else if (++this.dashes < 3) { this.stateT = 0; this.hitThisAttack = false; }
        else { this.dashes = 0; this.done(0.7); }
        break;
      }
      case 'vanish': {
        // fade out, reappear behind the target, heavy cut
        if (this.stateT < 0.35) { this.alpha = 1 - this.stateT / 0.35; this.steer(0, 0, dt); }
        else if (this.alpha <= 0.01 || this.stateT < 0.36) {
          const behind = -(Math.sign(p.vx) || this.face);
          this.x = p.x + behind * 46; this.y = p.y + 4; g.level.collide(this, this.r);
          this.face = Math.sign(p.x - this.x) || 1;
          this.alpha = 1; g.fx.burst(this.x, this.y - 20, 14, { speed: 60, colors: ['#1a1424', '#3a2a4a'], life: 0.4, grav: 0 });
          g.fx.glint(this.x, this.y - 50, RED, 10); g.sfx('danger', this.x);
        }
        if (this.stateT > 0.68 && !this.hitThisAttack) {
          this.hitThisAttack = true; this.vx = this.face * 300; this.punch(2.5);
          g.sfx('swing', this.x); g.fx.ring(this.x + this.face * 20, this.y - 24, 40, '#ff6680', 0.2, 3);
          if (Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 40) g.attack(g.targetFor(this), this, 28, { heavy: true, kind: 'melee' }, () => g.deflect(this, true));
        }
        if (this.stateT > 1.0) { this.alpha = 1; this.done(0.6); }
        break;
      }
      case 'kunai': {
        this.steer(-d.dx * 40, -d.dy * 40, dt);
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x, this.y - 50, WHITE, 8); g.sfx('glint', this.x); }
        if (this.stateT > 0.45 && !this.hitThisAttack) {
          this.hitThisAttack = true;
          const a = Math.atan2(p.y - 18 - (this.y - 20), p.x - this.x);
          for (let i = -2; i <= 2; i++) g.enemyBullet(this.x, this.y - 20, a + i * 0.16, 230, { color: '#d8d8ff', r: 3, dmg: 9, source: this });
          g.sfx('shoot', this.x);
        }
        if (this.stateT > 0.75) this.done(0.4);
        break;
      }
      default: this.done(0.4);
    }
  }
  draw(g: Game, ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    ctx.save(); ctx.globalAlpha = Math.max(0.05, this.alpha); super.draw(g, ctx, cx, cy); ctx.restore();
  }
}

// ---------------------------------------------------------------- ARMORED TITAN (Titan Walls)

export class ArmoredTitan extends AreaBoss {
  kind: EnemyKind = 'atitan';
  anim: Anim; idleAnim: Anim;
  constructor(g: Game, x: number, y: number) {
    super(g, x, y);
    this.anim = g.A.nAnim('BlueSamuraiWalk', 0, 0, 96, 48, 6, 96, 0, 3);
    this.idleAnim = g.A.nAnim('BlueSamuraiIdle', 0, 0, 96, 48, 6, 96, 0, 3);
    this.name = 'THE ARMORED TITAN';
    this.hp = this.maxHp = 900; this.r = 30; this.heavy = 60; this.chaseSpeed = 30;
    this.maxPosture = 130;
    this.reward = { kind: 'active', key: 'grapple', rarity: 3 };
    this.animFps = 5; this.baseSpeed = 30; this.leanScale = 0.3;
  }
  height() { return 120; }
  /** armor: most damage glances off until its posture breaks */
  hurt(g: Game, dmg: number, dx: number, dy: number, opts: { crit?: boolean; knock?: number; how?: string } = {}) {
    // a hook to the nape finds the gap in the plates
    const armored = this.state !== 'stunned' && opts.how !== 'nape';
    if (armored && Math.random() < 0.3) g.fx.burst(this.x + dx * -10, this.y - 60, 4, { speed: 120, color: '#9ad0ff', glow: true, life: 0.2, grav: 0 });
    super.hurt(g, armored ? dmg * 0.4 : dmg, dx, dy, opts);
  }
  onStep(g: Game) { this.punch(2); g.sfx('bossStep', this.x); g.shake(0.1); }
  protected pickAttack(_g: Game, dist: number) { return dist < 120 ? (Math.random() < 0.55 ? 'sweep' : 'stomp') : Math.random() < 0.6 ? 'charge' : 'stomp'; }
  protected act(g: Game, dt: number, p: { x: number; y: number; vx: number; vy: number; r: number }) {
    const d = this.dirTo(p.x, p.y);
    switch (this.state) {
      case 'sweep': {
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x + this.face * 30, this.y - 110, WHITE, 12); g.sfx('glint', this.x); }
        this.steer(0, 0, dt);
        if (this.stateT > 0.75 && !this.hitThisAttack) {
          this.hitThisAttack = true; this.punch(3); g.sfx('swing', this.x); g.shake(0.3);
          g.fx.ring(this.x + this.face * 40, this.y - 40, 80, '#cfe8ff', 0.25, 3);
          if (d.d < this.r + p.r + 80) g.attack(g.targetFor(this), this, 24, { kind: 'melee' }, () => g.deflect(this));
        }
        if (this.stateT > 1.1) this.done(1.0);
        break;
      }
      case 'stomp': {
        if (this.stateT < dt * 1.5) {
          g.fx.glint(this.x, this.y - 120, RED, 14); g.sfx('danger', this.x);
          g.fx.telegraph({ x: this.x, y: this.y, r: 100, t: 0, dur: 0.9, color: '#ff2244' });
        }
        this.steer(0, 0, dt);
        if (this.stateT > 0.9 && !this.hitThisAttack) {
          this.hitThisAttack = true; this.punch(7);
          g.sfx('slam', this.x); g.shake(0.7); g.chroma(0.8);
          g.fx.burst(this.x, this.y, 30, { speed: 200, colors: ['#5a4a3a', '#7a6a50'], size: 2, life: 0.8 });
          if (Math.hypot(p.x - this.x, (p.y - this.y) / 0.62) < 100 + p.r) g.attack(g.targetFor(this), this, 30, { heavy: true, kind: 'aoe' }, () => g.deflect(this, true));
          g.hazard(this.x, this.y, 260, 170, 18);
        }
        if (this.stateT > 1.4) this.done(1.0);
        break;
      }
      case 'charge': {
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x, this.y - 120, RED, 14); g.sfx('danger', this.x); this.fromX = d.dx; this.fromY = d.dy; }
        if (this.stateT < 0.8) {
          this.steer(0, 0, dt); this.fromX = d.dx; this.fromY = d.dy;
          if (Math.abs(this.stateT - 0.45) < dt) g.fx.telegraph({ x: this.x, y: this.y, r: 0, t: 0, dur: 0.4, color: '#ff2244', angle: Math.atan2(this.fromY, this.fromX), len: 320, width: 60 });
        } else if (this.stateT < 1.5) {
          this.vx = this.fromX * 340; this.vy = this.fromY * 340;
          if (!this.hitThisAttack && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 14) {
            this.hitThisAttack = true;
            g.attack(g.targetFor(this), this, 30, { heavy: true, kind: 'melee' }, () => { g.deflect(this, true); this.vx = this.vy = 0; this.done(1.4); });
          }
        } else this.done(1.0);
        break;
      }
      default: this.done(0.6);
    }
  }
}

// ---------------------------------------------------------------- TITAN (roams Titan Walls)

export class Titan extends Enemy {
  kind: EnemyKind = 'titan';
  anim: Anim; idleAnim: Anim;
  cd = 1.5;
  attack: 'grab' | 'stomp' = 'grab';
  constructor(g: Game, x: number, y: number) {
    super(x, y);
    this.anim = g.A.anim('ogre_run_anim', 4); this.idleAnim = g.A.anim('ogre_idle_anim', 4);
    this.hp = this.maxHp = 230; this.r = 22; this.heavy = 12; this.stunTime = 1.6; this.spawnTime = 1.2;
    this.baseSpeed = 28; this.leanScale = 0.3; this.animFps = 4; this.shadowAnim = 'ogre_idle_anim';
  }
  onStep(g: Game) { this.punch(1.4); g.sfx('bossStep', this.x, 0.6); }
  think(g: Game, dt: number) {
    const p = g.targetFor(this), d = this.dirTo(p.x, p.y);
    this.cd -= dt;
    if (this.state !== 'windup' && Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx);
    switch (this.state) {
      case 'idle': case 'chase':
        this.steer(d.dx * 32, d.dy * 32, dt, 2);
        if (d.d < 90 && this.cd <= 0 && p.state !== 'dead') {
          this.attack = Math.random() < 0.6 ? 'grab' : 'stomp';
          this.setState('windup');
          if (this.attack === 'grab') { g.fx.glint(this.x + this.face * 20, this.y - 110, WHITE, 11); g.sfx('glint', this.x); }
          else { g.fx.glint(this.x, this.y - 110, RED, 12); g.sfx('danger', this.x); g.fx.telegraph({ x: this.x, y: this.y, r: 70, t: 0, dur: 1, color: '#ff2244' }); }
        }
        break;
      case 'windup': {
        this.steer(0, 0, dt);
        const wind = this.attack === 'grab' ? 0.85 : 1.0;
        if (this.stateT >= wind) {
          this.punch(4); g.shake(0.3);
          if (this.attack === 'grab') {
            g.sfx('swing', this.x);
            if (d.d < this.r + p.r + 50) g.attack(p, this, 22, { kind: 'melee', counter: true }, () => g.riposte(this, 40));
          } else {
            g.sfx('slam', this.x);
            g.fx.ring(this.x, this.y, 74, '#ff3355', 0.3, 3);
            if (Math.hypot(p.x - this.x, (p.y - this.y) / 0.62) < 70 + p.r) g.attack(p, this, 26, { heavy: true, kind: 'aoe' }, () => g.riposte(this, 40));
          }
          this.setState('recover');
        }
        break;
      }
      case 'recover':
        if (this.stateT >= 1.1) { this.setState('chase'); this.cd = 1.2 + Math.random(); }
        break;
    }
  }
}
