import type { Anim } from './assets';
import { Enemy, type EnemyKind } from './enemies';
import type { Game } from './game';

// Elden Ring cadence (readable windups, delayed swings, punish windows) mixed with
// bullet-hell patterns. Parries build posture; a full posture bar breaks the boss open.

type Attack = 'combo' | 'burst' | 'spiral' | 'leap' | 'charge';
const WHITE = '#ffffff', RED = '#ff3355';

export class Boss extends Enemy {
  kind: EnemyKind = 'boss';
  anim: Anim; idleAnim: Anim;
  name = 'THE CRIMSON WARDEN';
  posture = 0; maxPosture = 100; postureIdle = 0;
  phase = 1;
  attack: Attack = 'combo';
  step = 0; steps = 3;
  lastAttacks: Attack[] = [];
  spiralA = 0; emitT = 0;
  z = 0; fromX = 0; fromY = 0; toX = 0; toY = 0;
  chargeDx = 0; chargeDy = 0; charges = 0;
  redStep = -1;
  idleFor = 1;

  constructor(g: Game, x: number, y: number) {
    super(x, y);
    this.anim = g.A.anim('big_demon_run_anim', 3);
    this.idleAnim = g.A.anim('big_demon_idle_anim', 3);
    this.boss = true;
    this.hp = this.maxHp = 1500;
    this.r = 20; this.heavy = 40; this.spawnTime = 1.2; this.stunTime = 3.2; this.jitter = 1.5;
    this.animFps = 6;
  }

  get speedMul() { return this.phase === 2 ? 1.3 : 1; }

  addPosture(g: Game, amt: number) {
    if (this.state === 'stunned' || this.state === 'enrage') return;
    this.posture = Math.min(this.maxPosture, this.posture + amt);
    this.postureIdle = 0;
    if (this.posture >= this.maxPosture) this.breakPosture(g);
  }

  breakPosture(g: Game) {
    this.setState('stunned');
    this.z = 0;
    this.vx = 0; this.vy = 0;
    g.audio.play('break');
    g.hitstop(0.18); g.slowmo(0.6, 0.3); g.shake(0.6); g.flash('#ffd84a', 0.3); g.chroma(1.5);
    g.fx.ring(this.x, this.y - 30, 90, '#ffd84a', 0.5, 4);
    g.fx.burst(this.x, this.y - 40, 30, { speed: 220, colors: ['#ffd84a', '#fff2b0'], glow: true, life: 0.6, grav: 100 });
    g.banner('POSTURE BROKEN', '#ffd84a');
  }

  onHurt(g: Game, amount: number) {
    if (this.state !== 'stunned') this.addPosture(g, amount * 0.12);
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2;
      this.setState('enrage');
      this.posture = 0;
    }
  }

  parried(g: Game) {
    // deflecting a boss swing doesn't stagger it, it fills posture (Sekiro rules)
    this.addPosture(g, 19);
    const d = this.dirTo(g.player.x, g.player.y);
    this.vx = -d.dx * 90; this.vy = -d.dy * 90;
  }

  hurt(g: Game, dmg: number, dx: number, dy: number, opts: { crit?: boolean; knock?: number; how?: string } = {}) {
    if (this.state === 'enrage' || this.state === 'spawn' || this.z > 10) return;
    super.hurt(g, dmg, dx, dy, opts);
  }

  pick(d: number): Attack {
    const pool: Attack[] = d < 95 ? ['combo', 'combo', 'leap', 'burst'] : ['spiral', 'burst', 'leap', 'combo', 'spiral'];
    if (this.phase === 2) pool.push('charge', d < 95 ? 'combo' : 'charge');
    // avoid repeating the same attack three times
    let a: Attack;
    do { a = pool[Math.floor(Math.random() * pool.length)]; }
    while (this.lastAttacks.length >= 2 && this.lastAttacks.every((x) => x === a));
    this.lastAttacks = [...this.lastAttacks.slice(-1), a];
    return a;
  }

  think(g: Game, dt: number) {
    const p = g.player, d = this.dirTo(p.x, p.y);
    const S = this.speedMul;
    this.postureIdle += dt;
    if (this.postureIdle > 2.5) this.posture = Math.max(0, this.posture - 7 * dt);
    if (this.state !== 'combo' && this.state !== 'charge' && Math.abs(d.dx) > 0.15) this.face = Math.sign(d.dx);

    switch (this.state) {
      case 'idle':
        if (!this.introDone) { this.introDone = true; this.setState('intro'); return; }
        if (this.posture >= this.maxPosture) this.posture = 0;   // just recovered from a break
        this.steer(d.dx * 46 * S, d.dy * 46 * S, dt, 3);
        if (this.stateT > this.idleFor / S && p.state !== 'dead') this.begin(g, this.pick(d.d));
        break;

      case 'intro':
        this.steer(0, 0, dt);
        if (this.stateT > 0.3 && !this.roared) {
          this.roared = true;
          g.audio.play('roar'); g.shake(0.7); g.flash('#ff2244', 0.18); g.chroma(1);
          g.fx.ring(this.x, this.y - 20, 140, '#ff3355', 0.6, 3);
          g.banner(this.name, '#ff6680', 2.4);
        }
        if (this.stateT > 1.8) { this.setState('idle'); this.idleFor = 0.5; }
        break;

      case 'enrage':
        this.steer(0, 0, dt);
        if (this.stateT < dt * 1.5) {
          g.audio.play('roar'); g.shake(0.9); g.flash('#ff1133', 0.35); g.chroma(2); g.slowmo(0.5, 0.4);
          g.banner('THE WARDEN AWAKENS', '#ff3355', 2);
          g.hazard(this.x, this.y, 210, 26, 14);
        }
        g.fx.light(this.x, this.y - 40, 160 + Math.sin(this.stateT * 30) * 20, '#ff1133', 1);
        if (this.stateT > 1.6) { this.setState('idle'); this.idleFor = 0.3; }
        break;

      case 'combo': {
        const wind = (this.step === 0 ? 0.6 : 0.38) / S;
        const isRed = this.step === this.redStep;
        if (this.stateT < dt * 1.5) {
          g.fx.glint(this.x + this.face * 18, this.y - 86, isRed ? RED : WHITE, 11);
          g.audio.play(isRed ? 'danger' : 'glint');
          if (isRed) g.fx.telegraphs.push({ x: this.x, y: this.y, r: 74, t: 0, dur: wind, color: '#ff2244' });
        }
        if (this.stateT < wind * 0.8) { this.steer(d.dx * 30, d.dy * 30, dt); if (Math.abs(d.dx) > 0.15) this.face = Math.sign(d.dx); this.fromX = d.dx; this.fromY = d.dy; }
        else if (this.stateT < wind) this.steer(0, 0, dt);
        else if (this.stateT < wind + 0.16) {
          if (!this.hitThisAttack) {
            this.hitThisAttack = true;
            if (isRed) {
              // wide sweep: roll through it
              g.audio.play('slam'); g.shake(0.4);
              g.fx.ring(this.x, this.y - 10, 80, '#ff3355', 0.3, 4);
              if (Math.hypot(p.x - this.x, (p.y - this.y) / 0.62) < 76 + p.r) g.hitPlayer(this, 26, { parryable: false, kind: 'aoe' });
            } else {
              this.vx = this.fromX * 300 * S; this.vy = this.fromY * 300 * S;
            }
          }
          if (!isRed && !this.swingResolved && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 30) {
            this.swingResolved = true;
            g.fx.ring(this.x + this.fromX * 26, this.y - 30, 30, '#e8dcff', 0.15, 2);
            const res = g.hitPlayer(this, 20, { parryable: true, kind: 'melee' });
            if (res === 'parried') g.deflect(this);
          }
        } else if (this.stateT > wind + 0.28 / S) {
          this.step++;
          this.swingResolved = false;
          if (this.step >= this.steps) { this.setState('recover'); this.idleFor = 0.95; }
          else { this.stateT = 0; this.hitThisAttack = false; }
        }
        break;
      }

      case 'burst': {
        this.steer(0, 0, dt);
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x, this.y - 90, WHITE, 10); g.audio.play('glint'); }
        g.fx.light(this.x, this.y - 40, 60 + Math.min(1, this.stateT / 0.65) * 80, '#ff3355', 0.9);
        const waves = this.phase === 2 ? 4 : 3;
        for (let w = 0; w < waves; w++) {
          const at = 0.65 + w * 0.32;
          if (this.stateT >= at && this.stateT - dt < at) {
            const n = this.phase === 2 ? 22 : 18;
            for (let i = 0; i < n; i++) g.enemyBullet(this.x, this.y - 36, (i / n) * Math.PI * 2 + w * 0.17, 100 + w * 6, { source: this });
            g.shake(0.2); g.audio.play('enemyShoot', 1.5);
            g.fx.ring(this.x, this.y - 36, 30, '#ff5577', 0.2, 2);
          }
        }
        if (this.stateT > 0.65 + waves * 0.32 + 0.3) { this.setState('recover'); this.idleFor = 0.6; }
        break;
      }

      case 'spiral': {
        this.steer(d.dx * 22, d.dy * 22, dt, 2);
        if (this.stateT < dt * 1.5) { g.fx.glint(this.x, this.y - 90, WHITE, 10); g.audio.play('glint'); }
        const dur = 2.6;
        if (this.stateT > 0.4 && this.stateT < dur) {
          this.emitT -= dt;
          if (this.emitT <= 0) {
            this.emitT = 0.075;
            const arms = this.phase === 2 ? 4 : 3;
            for (let k = 0; k < arms; k++) g.enemyBullet(this.x, this.y - 36, this.spiralA + (k * Math.PI * 2) / arms, 112, { source: this });
            this.spiralA += this.phase === 2 ? -0.21 : 0.24;
            g.audio.play('enemyShoot', 0.6);
          }
          g.fx.light(this.x, this.y - 36, 70, '#ff3355', 0.8);
        }
        if (this.stateT > dur + 0.2) { this.setState('recover'); this.idleFor = 0.7; }
        break;
      }

      case 'leap': {
        const crouch = 0.55 / S, air = 0.62;
        if (this.stateT < dt * 1.5) {
          g.fx.glint(this.x, this.y - 90, RED, 12); g.audio.play('danger');
        }
        if (this.stateT < crouch) {
          this.steer(0, 0, dt);
          this.toX = p.x + p.vx * 0.25; this.toY = p.y + p.vy * 0.25;
          this.fromX = this.x; this.fromY = this.y;
          if (this.stateT + dt >= crouch) g.fx.telegraphs.push({ x: this.toX, y: this.toY, r: 60, t: 0, dur: air, color: '#ff2244' });
        } else if (this.stateT < crouch + air) {
          const k = (this.stateT - crouch) / air, e = k * k * (3 - 2 * k);
          this.x = this.fromX + (this.toX - this.fromX) * e;
          this.y = this.fromY + (this.toY - this.fromY) * e;
          this.vx = 0; this.vy = 0;
          this.z = Math.sin(k * Math.PI) * 120;
        } else if (this.z > 0 || !this.hitThisAttack) {
          this.z = 0; this.hitThisAttack = true;
          g.audio.play('slam'); g.shake(0.85); g.chroma(0.8); g.hitstop(0.05);
          g.fx.burst(this.x, this.y, 30, { speed: 200, colors: ['#3a3155', '#5a4a7a', '#241c38'], size: 2, life: 0.8 });
          g.fx.light(this.x, this.y, 160, '#ff4422', 1);
          g.fx.splat(this.x, this.y, '#0c0818', 30, 30);
          if (Math.hypot(p.x - this.x, (p.y - this.y) / 0.62) < 58 + p.r) g.hitPlayer(this, 28, { parryable: false, kind: 'aoe' });
          g.hazard(this.x, this.y, 240, 150, 20);
          const n = this.phase === 2 ? 16 : 12;
          for (let i = 0; i < n; i++) g.enemyBullet(this.x, this.y - 10, (i / n) * Math.PI * 2, 90, { source: this });
          this.setState('recover'); this.idleFor = 1.0;
        }
        break;
      }

      case 'charge': {
        const wind = 0.6;
        if (this.stateT < dt * 1.5) {
          g.fx.glint(this.x, this.y - 90, RED, 12); g.audio.play('danger');
          this.chargeDx = d.dx; this.chargeDy = d.dy;
        }
        if (this.stateT < wind) {
          this.steer(-d.dx * 30, -d.dy * 30, dt);
          if (this.stateT < wind * 0.6) { this.chargeDx = d.dx; this.chargeDy = d.dy; if (Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx); }
          if (Math.abs(this.stateT - wind * 0.6) < dt) g.fx.telegraphs.push({ x: this.x, y: this.y, r: 0, t: 0, dur: wind * 0.4 + 0.1, color: '#ff2244', angle: Math.atan2(this.chargeDy, this.chargeDx), len: 300, width: 34 });
        } else if (this.stateT < wind + 0.55) {
          this.vx = this.chargeDx * 430; this.vy = this.chargeDy * 430;
          this.emitT -= dt;
          if (this.emitT <= 0) {
            this.emitT = 0.06;
            const a = Math.atan2(this.chargeDy, this.chargeDx);
            g.enemyBullet(this.x, this.y - 30, a + Math.PI / 2, 60, { source: this });
            g.enemyBullet(this.x, this.y - 30, a - Math.PI / 2, 60, { source: this });
          }
          g.fx.after(this.anim.normal[0], this.x, this.y, this.face < 0, this.anim.w, this.anim.h, 0.2);
          if (!this.hitThisAttack && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 10) {
            this.hitThisAttack = true;
            g.hitPlayer(this, 24, { parryable: false, kind: 'melee' });
          }
        } else if (this.stateT > wind + 0.85) {
          this.charges++;
          if (this.charges < 2) { this.stateT = 0; this.hitThisAttack = false; }
          else { this.setState('recover'); this.idleFor = 0.9; }
        }
        break;
      }

      case 'recover':
        this.steer(0, 0, dt);
        if (this.stateT > 0.5) { this.setState('idle'); }
        break;
    }
  }
  introDone = false; roared = false; swingResolved = false;

  begin(g: Game, a: Attack) {
    this.attack = a;
    this.setState(a);
    this.step = 0; this.charges = 0; this.swingResolved = false;
    this.steps = this.phase === 2 ? 4 : 3;
    // phase 2 sometimes ends a combo with an unparryable sweep, so you can't just mash parry
    this.redStep = this.phase === 2 && Math.random() < 0.6 ? this.steps - 1 : -1;
    this.emitT = 0;
  }

  draw(g: Game, ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    if (this.z > 0) {
      // ground shadow while airborne
      const s = Math.max(0.3, 1 - this.z / 160);
      ctx.fillStyle = 'rgba(4,2,10,0.55)';
      ctx.beginPath(); ctx.ellipse(Math.round(this.x - cx), Math.round(this.y - cy), 30 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
      const y0 = this.y; this.y -= this.z; super.draw(g, ctx, cx, cy); this.y = y0;
      return;
    }
    super.draw(g, ctx, cx, cy);
  }

  drawGlow(g: Game, glow: CanvasRenderingContext2D, cx: number, cy: number) {
    super.drawGlow(g, glow, cx, cy);
    if (this.state === 'spawn') return;
    // burning eyes
    const x = Math.round(this.x - cx), y = Math.round(this.y - this.z - cy - this.anim.h * 0.72);
    glow.fillStyle = this.phase === 2 ? '#ff2244' : '#ff7a3a';
    glow.fillRect(x - 7 * this.face - 2, y, 3, 2); glow.fillRect(x + 3 * this.face - 1, y, 3, 2);
    g.fx.light(this.x, this.y - this.z - 50, 70, this.phase === 2 ? '#ff2244' : '#ff6a3a', 0.6);
  }
}
