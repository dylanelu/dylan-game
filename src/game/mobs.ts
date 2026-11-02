import type { Anim } from './assets';
import { Enemy, type EnemyKind } from './enemies';
import type { Game } from './game';
import { MOBS, type MobDef, type MobKind } from './roster';

// The roster's base enemies: one class, twelve archetypes. Each archetype is a small state machine with a
// readable tell (white glint = parry it, red glint = heavy: parry perfectly or roll) and one idea:
//   swarm     fly heads: erratic, weak, many; nip on contact
//   splitter  slimes hop and split in two when they die
//   exploder  burning skulls rush you, swell, and blow up
//   trapper   web spinners keep away and spit fans of web
//   burrower  larvae dive under the ground and burst up under you
//   lunger    vipers coil, then strike in a straight line
//   turret    sporemaws plant and puff rings of spores
//   healer    lanterns hang back and mend the wounded
//   sniper    cyclopes sight a line, then fire one fast bolt
//   charger   frost bears wind up and charge; a wall stuns them
//   shielded  kappa shells block shots from the front: flank, parry or break posture
//   phaser    phantoms fade out, reappear behind you and cut

const WHITE = '#ffffff', RED = '#ff3355';

export class Mob extends Enemy {
  kind: EnemyKind;
  anim: Anim;
  def: MobDef;
  cd = 0.6 + Math.random() * 0.8;
  ax = 0; ay = 0;            // locked attack direction / target point
  alpha = 1;
  /** splitter children: half size, don't split again */
  small = false;

  constructor(g: Game, x: number, y: number, kind: MobKind) {
    super(x, y);
    this.kind = kind;
    this.def = MOBS[kind];
    this.anim = g.A.spec(this.def.sprite);
    this.hp = this.maxHp = this.def.hp;
    this.r = this.def.r; this.heavy = this.def.heavy; this.baseSpeed = this.def.speed;
    this.animFps = 6;
    if (this.def.arch === 'phaser' || this.def.arch === 'burrower') this.spawnTime = 0.5;
  }

  height() { return this.small ? this.anim.h * 0.6 : this.anim.h; }

  private hit(g: Game, dmg: number, heavy = false, kind: 'melee' | 'aoe' = 'melee') {
    g.attack(g.targetFor(this), this, dmg, { kind, heavy }, () => { if (heavy) g.deflect(this, true); else this.parried(g); });
  }
  private shoot(g: Game, a: number, speed: number, o: { r?: number; dmg?: number; heavy?: boolean; kind?: 'orb' | 'dagger' | 'big' } = {}) {
    g.enemyBullet(this.x + Math.cos(a) * 8, this.y - this.height() * 0.5, a, speed, { r: o.r ?? 4, dmg: o.dmg ?? this.def.dmg, heavy: !!o.heavy, color: this.def.color, kind: o.kind ?? 'orb', source: this });
  }

  think(g: Game, dt: number) {
    const p = g.targetFor(this), d = this.dirTo(p.x, p.y), sp = this.def.speed;
    if (Math.abs(d.dx) > 0.2 && this.state !== 'lunge' && this.state !== 'charge') this.face = Math.sign(d.dx);
    this.cd -= dt;
    const near = d.d < this.r + p.r + 6;
    switch (this.def.arch) {
      case 'swarm': {
        // a jittery orbit that tightens; bites on contact
        const wob = Math.sin(this.t * 7 + this.id) * 0.9;
        this.steer((d.dx * Math.cos(wob) - d.dy * Math.sin(wob)) * sp, (d.dy * Math.cos(wob) + d.dx * Math.sin(wob)) * sp, dt, 5);
        if (near && this.cd <= 0) { this.cd = 0.9; this.punch(2); this.hit(g, this.def.dmg); }
        break;
      }
      case 'splitter': {
        // hop, hop: moves only in bursts
        if (this.state === 'idle' || this.state === 'chase') {
          this.steer(0, 0, dt, 6);
          if (this.cd <= 0) { this.cd = 0.75 + Math.random() * 0.3; this.vx = d.dx * sp * 2.6; this.vy = d.dy * sp * 2.6; this.punch(-3); g.sfx('step', this.x, 0.4); }
          if (near && !this.hitThisAttack) { this.hitThisAttack = true; this.hit(g, this.def.dmg); g.later(0.6, () => { this.hitThisAttack = false; }); }
        }
        break;
      }
      case 'exploder': {
        if (this.state === 'windup') {
          this.steer(0, 0, dt, 10);
          if (this.stateT > 0.65) {
            this.dead = true;
            g.fx.ring(this.x, this.y - 6, 54, '#ff6a2a', 0.35, 4);
            g.fx.burst(this.x, this.y - 10, 30, { speed: 200, colors: ['#ff6a2a', '#ffd84a', '#5a1a0a'], glow: true, life: 0.5, grav: 60 });
            g.fx.light(this.x, this.y, 120, '#ff6a2a', 1);
            g.sfx('slam', this.x); g.shake(0.25);
            for (const pl of g.allPlayers()) if (Math.hypot(pl.x - this.x, (pl.y - this.y) / 0.62) < 54 + pl.r) g.attack(pl, this, this.def.dmg, { kind: 'aoe', heavy: true });
            g.onEnemyKilled(this, 'self');
          }
          break;
        }
        this.steer(d.dx * sp, d.dy * sp, dt, 3);
        if (d.d < 46) {
          this.setState('windup'); g.fx.glint(this.x, this.y - this.height(), RED, 9); g.sfx('danger', this.x, 0.6);
          g.fx.telegraph({ x: this.x, y: this.y, r: 54, t: 0, dur: 0.65, color: '#ff6a2a' });
        }
        break;
      }
      case 'trapper': {
        const want = 150;
        this.steer(d.dx * sp * (d.d > want + 30 ? 1 : d.d < want - 30 ? -1 : 0) + -d.dy * sp * 0.5 * Math.sin(this.t), d.dy * sp * (d.d > want + 30 ? 1 : d.d < want - 30 ? -1 : 0) + d.dx * sp * 0.5 * Math.sin(this.t), dt, 4);
        if (this.cd <= 0 && d.d < 300) {
          this.cd = 2.2; g.fx.glint(this.x, this.y - this.height(), WHITE, 7); g.sfx('cast', this.x, 0.5);
          g.later(0.35, () => { if (this.dead) return; const a = Math.atan2(p.y - this.y, p.x - this.x); for (let i = -1; i <= 1; i++) this.shoot(g, a + i * 0.22, 150, { r: 5 }); });
        }
        break;
      }
      case 'burrower': {
        if (this.state === 'under') {
          // a dust trail creeps toward you; then it surfaces where you were
          this.alpha = 0;
          this.steer(d.dx * sp * 1.3, d.dy * sp * 1.3, dt, 6);
          if (Math.random() < 0.5) g.fx.burst(this.x, this.y, 1, { speed: 20, colors: ['#5a4030', '#3a2a20'], size: 2, life: 0.5, grav: 40, vz: 20 });
          if (this.stateT > 1.4 || d.d < 30) {
            this.setState('emerge'); this.ax = p.x; this.ay = p.y;
            g.fx.telegraph({ x: p.x, y: p.y, r: 30, t: 0, dur: 0.55, color: '#c8a050' });
            g.fx.glint(p.x, p.y - 20, WHITE, 8);
          }
        } else if (this.state === 'emerge') {
          this.steer(0, 0, dt, 10);
          if (this.stateT > 0.55 && !this.hitThisAttack) {
            this.hitThisAttack = true; this.x = this.ax; this.y = this.ay; this.alpha = 1; this.punch(-5);
            g.fx.burst(this.x, this.y, 16, { speed: 120, colors: ['#5a4030', '#8a6a40'], size: 2, life: 0.5, grav: 200, vz: 120 });
            g.sfx('slam', this.x, 0.6);
            for (const pl of g.allPlayers()) if (Math.hypot(pl.x - this.x, (pl.y - this.y) / 0.62) < 30 + pl.r) g.attack(pl, this, this.def.dmg, { kind: 'aoe' }, () => this.parried(g));
          }
          if (this.stateT > 2.2) { this.setState('idle'); this.cd = 0.8; }
        } else {
          this.alpha = 1;
          this.steer(d.dx * sp * 0.5, d.dy * sp * 0.5, dt, 4);
          if (this.cd <= 0) { this.setState('under'); this.cd = 3; g.fx.burst(this.x, this.y, 10, { speed: 60, colors: ['#5a4030', '#3a2a20'], size: 2, life: 0.5, grav: 120, vz: 60 }); }
        }
        break;
      }
      case 'lunger': {
        if (this.state === 'windup') {
          this.steer(-this.ax * 20, -this.ay * 20, dt, 8);
          if (this.stateT > 0.45) { this.setState('lunge'); this.vx = this.ax * 420; this.vy = this.ay * 420; this.punch(3); g.sfx('swing', this.x); }
        } else if (this.state === 'lunge') {
          if (Math.random() < 0.6) g.fx.after(this.anim.normal[0], this.x, this.y, this.face < 0, this.anim.w >> 1, this.anim.h, 0.15);
          if (!this.hitThisAttack && near) { this.hitThisAttack = true; this.hit(g, this.def.dmg); }
          if (this.stateT > 0.35) { this.setState('recover'); }
        } else if (this.state === 'recover') {
          if (this.stateT > 0.7) this.setState('idle');
        } else {
          this.steer(d.dx * sp, d.dy * sp, dt, 5);
          if (d.d < 120 && this.cd <= 0) {
            this.cd = 1.6; this.ax = d.dx; this.ay = d.dy; this.setState('windup');
            g.fx.glint(this.x, this.y - this.height(), WHITE, 8); g.sfx('glint', this.x, 0.6);
          }
        }
        break;
      }
      case 'turret': {
        if (this.state === 'cast') {
          this.steer(0, 0, dt, 10);
          if (this.stateT > 0.6 && !this.hitThisAttack) {
            this.hitThisAttack = true; this.punch(-4); g.sfx('cast', this.x, 0.7);
            const off = Math.random() * Math.PI;
            for (let i = 0; i < 10; i++) this.shoot(g, off + (i / 10) * Math.PI * 2, 95, { r: 5 });
          }
          if (this.stateT > 1) { this.setState('idle'); this.cd = 2.6; }
        } else {
          this.steer(d.dx * sp, d.dy * sp, dt, 2);
          if (this.cd <= 0 && d.d < 320) { this.setState('cast'); g.fx.glint(this.x, this.y - this.height(), WHITE, 7); }
        }
        break;
      }
      case 'healer': {
        // hang back from the hunters, float to whoever is hurt
        const hurt = g.enemies.find((e) => e !== this && !e.ally && !e.dead && !e.boss && e.hp < e.maxHp * 0.85 && Math.hypot(e.x - this.x, e.y - this.y) < 220);
        const away = d.d < 160 ? -1 : 0;
        if (hurt) { const h = this.dirTo(hurt.x, hurt.y); this.steer(h.dx * sp * (h.d > 70 ? 1 : 0) + d.dx * sp * away, h.dy * sp * (h.d > 70 ? 1 : 0) + d.dy * sp * away, dt, 3); }
        else this.steer(d.dx * sp * away + Math.cos(this.t) * 20, d.dy * sp * away + Math.sin(this.t) * 20, dt, 3);
        if (this.cd <= 0) {
          this.cd = 2.8;
          if (hurt) {
            const amt = Math.round(hurt.maxHp * 0.2);
            hurt.hp = Math.min(hurt.maxHp, hurt.hp + amt);
            g.fx.text(hurt.x, hurt.y - hurt.height() - 6, `+${amt}`, '#6aff9a', 1, 0.6);
            g.fx.ring(hurt.x, hurt.y - 10, 24, '#6aff9a', 0.4, 2);
            g.fx.burst(hurt.x, hurt.y - 10, 10, { speed: 40, color: '#6aff9a', glow: true, life: 0.6, grav: -80 });
            g.sfx('select', hurt.x, 0.4);
          } else if (d.d < 260) this.shoot(g, Math.atan2(p.y - this.y, p.x - this.x), 130);
        }
        break;
      }
      case 'sniper': {
        if (this.state === 'aim') {
          this.steer(0, 0, dt, 10);
          // track for most of the windup, lock for the last beat so a sidestep works
          if (this.stateT < 0.8) { this.ax = Math.atan2(p.y - this.y, p.x - this.x); }
          if (this.stateT > 0.8 && !this.hitThisAttack) { this.hitThisAttack = true; g.fx.telegraph({ x: this.x, y: this.y - this.height() * 0.5, r: 0, t: 0, dur: 0.3, color: RED, angle: this.ax, len: 380, width: 6 }); g.fx.glint(this.x, this.y - this.height(), RED, 10); }
          if (this.stateT > 1.1) { this.shoot(g, this.ax, 620, { r: 6, heavy: true, kind: 'big' }); g.sfx('cast', this.x); this.punch(4); this.setState('idle'); this.cd = 2.4; }
        } else {
          const want = 230, k = d.d > want + 40 ? 1 : d.d < want - 40 ? -1 : 0;
          this.steer(d.dx * sp * k, d.dy * sp * k, dt, 3);
          if (this.cd <= 0 && d.d < 420) this.setState('aim');
        }
        break;
      }
      case 'charger': {
        if (this.state === 'windup') {
          this.steer(0, 0, dt, 10);
          if (this.stateT > 0.75) { this.setState('charge'); this.vx = this.ax * 360; this.vy = this.ay * 360; g.sfx('roar', this.x, 0.5); }
        } else if (this.state === 'charge') {
          this.vx = this.ax * 360; this.vy = this.ay * 360;
          if (Math.random() < 0.5) g.fx.burst(this.x, this.y, 1, { speed: 30, colors: ['#c8d8ff'], size: 2, life: 0.4 });
          if (!this.hitThisAttack && near) { this.hitThisAttack = true; this.hit(g, this.def.dmg, true); }
          // hitting a wall or rock knocks it silly
          if (g.level.solidAt(this.x + this.ax * (this.r + 6), this.y + this.ay * 6) || g.level.blocks(this.x + this.ax * (this.r + 6), this.y)) {
            this.setState('stunned'); this.stunTime = 1.6; g.shake(0.25); g.sfx('slam', this.x); this.vx = -this.ax * 80; this.vy = -this.ay * 80;
          } else if (this.stateT > 0.9) { this.setState('recover'); }
        } else if (this.state === 'recover') {
          this.steer(0, 0, dt, 6); if (this.stateT > 0.8) this.setState('idle');
        } else {
          this.stunTime = 0.9;
          this.steer(d.dx * sp, d.dy * sp, dt, 4);
          if (this.cd <= 0 && d.d < 240 && d.d > 60) {
            this.cd = 3; this.ax = d.dx; this.ay = d.dy; this.setState('windup');
            g.fx.glint(this.x, this.y - this.height(), RED, 11); g.sfx('danger', this.x, 0.6);
            g.fx.telegraph({ x: this.x, y: this.y, r: 0, t: 0, dur: 0.75, color: RED, angle: Math.atan2(d.dy, d.dx), len: 320, width: this.r * 2 });
          }
        }
        break;
      }
      case 'shielded': {
        if (this.state === 'windup') {
          this.steer(0, 0, dt, 10);
          if (this.stateT > 0.4) { this.vx = d.dx * 200; this.vy = d.dy * 200; if (near || d.d < this.r + p.r + 20) this.hit(g, this.def.dmg); this.setState('recover'); }
        } else if (this.state === 'recover') { if (this.stateT > 0.6) this.setState('idle'); }
        else {
          this.steer(d.dx * sp, d.dy * sp, dt, 4);
          if (this.cd <= 0 && d.d < 50) { this.cd = 1.4; this.setState('windup'); g.fx.glint(this.x, this.y - this.height(), WHITE, 8); }
        }
        break;
      }
      case 'phaser': {
        if (this.state === 'fade') {
          this.alpha = Math.max(0.08, 1 - this.stateT * 2);
          this.steer(0, 0, dt, 10);
          if (this.stateT > 0.9) {
            // reappear just behind the target
            const bx = p.x - (p.vx || p.face * 30) * 0.02 - Math.sign(p.vx || p.face) * 34, by = p.y + 4;
            if (!g.level.solidAt(bx, by)) { this.x = bx; this.y = by; }
            this.alpha = 1; this.setState('windup');
            g.fx.burst(this.x, this.y - 14, 12, { speed: 50, color: '#b8a8ff', glow: true, life: 0.4 });
            g.fx.glint(this.x, this.y - this.height(), WHITE, 9); g.sfx('glint', this.x);
          }
        } else if (this.state === 'windup') {
          this.steer(0, 0, dt, 10);
          if (this.stateT > 0.4 && !this.hitThisAttack) { this.hitThisAttack = true; this.vx = d.dx * 220; this.vy = d.dy * 220; if (d.d < this.r + p.r + 26) this.hit(g, this.def.dmg); g.sfx('swing', this.x); }
          if (this.stateT > 0.8) { this.setState('idle'); this.cd = 2.5; }
        } else {
          this.alpha = 0.75 + Math.sin(this.t * 3) * 0.2;
          this.steer(d.dx * sp, d.dy * sp, dt, 3);
          if (this.cd <= 0 && d.d < 260) this.setState('fade');
        }
        break;
      }
    }
  }

  hurt(g: Game, dmg: number, dx: number, dy: number, opts: { crit?: boolean; knock?: number; how?: string; pierce?: boolean } = {}) {
    if (this.state === 'under' || (this.state === 'fade' && this.stateT > 0.3)) return;   // underground / out of phase
    // a kappa's shell turns aside anything coming at its face, unless it's reeling (or the blade ignores shields)
    if (this.def.arch === 'shielded' && this.state !== 'stunned' && dx * this.face < -0.3 && opts.how !== 'nape' && opts.how !== 'riposte' && !opts.pierce) {
      g.fx.burst(this.x + this.face * 10, this.y - 14, 5, { speed: 120, color: '#d8ffe8', glow: true, life: 0.2, grav: 0 });
      g.sfx('guard', this.x, 0.5);
      this.vx += dx * 20;
      return;
    }
    super.hurt(g, dmg, dx, dy, opts);
  }

  die(g: Game, how: string) {
    super.die(g, how);
    if (this.def.arch === 'splitter' && !this.small && !this.remote && g.authority) {
      for (const s of [-1, 1]) {
        const c = g.spawn(this.kind, this.x + s * 12, this.y, Math.max(1, this.level - 1)) as Mob;
        c.small = true; c.hp = c.maxHp = Math.round(c.maxHp * 0.4); c.state = 'idle'; c.vx = s * 120;
      }
    }
  }

  draw(g: Game, ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    if (this.alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    if (this.small) {
      // children of a split: drawn at 60% around their feet
      ctx.translate(Math.round(this.x - cx), Math.round(this.y - cy)); ctx.scale(0.6, 0.6); ctx.translate(-Math.round(this.x - cx), -Math.round(this.y - cy));
    }
    if (this.def.flying) ctx.translate(0, -6 + Math.sin(this.t * 4 + this.id) * 2);
    super.draw(g, ctx, cx, cy);
    ctx.restore();
  }
}

export const isMob = (k: string): k is MobKind => k in MOBS;
