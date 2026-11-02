import type { Anim } from './assets';
import type { Game, HitResult } from './game';

export type EnemyKind = 'ghoul' | 'caster' | 'brute' | 'boss' | 'shadow';

const WHITE = '#ffffff', RED = '#ff3355';

export abstract class Enemy {
  vx = 0; vy = 0;
  r = 9;
  hp = 30; maxHp = 30;
  flash = 0; dead = false; face = 1;
  state = 'spawn'; stateT = 0; t = 0;
  spawnTime = 0.7;
  heavy = 1;               // knockback divisor
  ally = false;
  boss = false;
  hitThisAttack = false;
  abstract kind: EnemyKind;
  abstract anim: Anim;
  idleAnim?: Anim;
  animFps = 7;
  jitter = 0;

  constructor(public x: number, public y: number) {}

  setState(s: string) { this.state = s; this.stateT = 0; this.hitThisAttack = false; }

  dirTo(x: number, y: number) {
    const dx = x - this.x, dy = y - this.y, d = Math.hypot(dx, dy) || 1;
    return { dx: dx / d, dy: dy / d, d };
  }

  update(g: Game, dt: number) {
    this.t += dt; this.stateT += dt; this.flash -= dt;
    if (this.state === 'spawn') {
      if (this.stateT >= this.spawnTime) this.setState('idle');
      return;
    }
    if (this.state === 'stunned') {
      if (this.stateT > this.stunTime) this.setState('idle');
    } else this.think(g, dt);
    const fr = this.state === 'lunge' || this.state === 'charge' ? 1.2 : 9;
    this.vx *= Math.exp(-fr * dt); this.vy *= Math.exp(-fr * dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
    g.level.collide(this, this.r);
  }
  stunTime = 0.9;

  abstract think(g: Game, dt: number): void;

  /** steer toward a velocity, not instant, so enemies feel weighty */
  steer(tx: number, ty: number, dt: number, k = 8) {
    this.vx += (tx - this.vx) * Math.min(1, k * dt);
    this.vy += (ty - this.vy) * Math.min(1, k * dt);
  }

  hurt(g: Game, dmg: number, dx: number, dy: number, opts: { crit?: boolean; knock?: number; how?: string } = {}) {
    if (this.dead || this.state === 'spawn' || this.ally) return;
    const crit = opts.crit || this.state === 'stunned';
    const amount = Math.round(dmg * (crit ? 2 : 1));
    this.hp -= amount;
    this.flash = 0.07;
    const kb = (opts.knock ?? 60) / this.heavy;
    this.vx += dx * kb; this.vy += dy * kb;
    g.fx.text(this.x + (Math.random() - 0.5) * 10, this.y - this.height() - 4, `${amount}`, crit ? '#ffd84a' : '#ffffff', crit ? 2 : 1, 0.6);
    g.fx.burst(this.x, this.y - this.height() * 0.5, crit ? 10 : 5, {
      speed: 140, angle: Math.atan2(dy, dx), spread: 1.4, colors: ['#5a0f1e', '#8e1b2e', '#3a0a14'], size: 2, life: 0.6, decal: '#2a0610',
    });
    g.fx.burst(this.x, this.y - this.height() * 0.5, 4, { speed: 160, angle: Math.atan2(dy, dx), spread: 1, color: '#d8b8ff', glow: true, life: 0.15, grav: 0, size: 1 });
    g.audio.play(crit ? 'crit' : 'hit');
    if (this.hp <= 0) this.die(g, opts.how ?? 'shot');
    else this.onHurt(g, amount);
  }
  onHurt(_g: Game, _amount: number) {}

  /** Player perfect-parried one of our attacks. */
  parried(g: Game) {
    this.setState('stunned');
    const d = this.dirTo(g.player.x, g.player.y);
    this.vx = -d.dx * 140 / this.heavy; this.vy = -d.dy * 140 / this.heavy;
  }

  die(g: Game, how: string) {
    this.dead = true;
    const h = this.height();
    g.fx.burst(this.x, this.y - h * 0.4, 18, { speed: 160, colors: ['#5a0f1e', '#8e1b2e', '#24061a'], size: 2, life: 0.8, decal: '#2a0610' });
    g.fx.burst(this.x, this.y - h * 0.5, 14, { speed: 50, colors: ['#7a3cff', '#b26bff', '#3a1a80'], glow: true, life: 1.1, grav: -60, vz: 30, size: 2, drag: 1.5 });
    g.fx.splat(this.x, this.y, '#1e0410', 14, 9);
    g.fx.ring(this.x, this.y - 2, 26, '#7a3cff', 0.35, 2);
    g.audio.play('death');
    g.shake(0.18);
    g.onEnemyKilled(this, how);
  }

  height() { return this.anim.h; }

  draw(g: Game, ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const a = this.state === 'idle' || this.state === 'windup' || this.state === 'cast' || this.state === 'stunned' ? (this.idleAnim ?? this.anim) : this.anim;
    const frames = this.ally ? a.shadow : this.flash > 0 ? a.flash : a.normal;
    const f = frames[Math.floor(this.t * this.animFps) % frames.length];
    let x = Math.round(this.x - cx), y = Math.round(this.y - cy);
    if (this.state === 'windup' || this.state === 'cast') x += Math.round(Math.sin(this.stateT * 70) * this.jitter);
    ctx.fillStyle = 'rgba(4,2,10,0.5)';
    const sw = Math.round(a.w * 0.55);
    ctx.fillRect(x - (sw >> 1), y - 1, sw, 3);
    ctx.save();
    ctx.translate(x, y);
    if (this.face < 0) ctx.scale(-1, 1);
    if (this.state === 'spawn') {
      // rise out of the floor
      const k = Math.min(1, this.stateT / this.spawnTime), vis = Math.round(a.h * k);
      ctx.drawImage(f, 0, 0, f.width, vis, -(a.w >> 1), -vis, a.w, vis);
    } else {
      const sq = this.state === 'stunned' ? 0.12 : this.state === 'windup' ? -0.06 : 0;
      const w = Math.round(a.w * (1 + sq)), h = Math.round(a.h * (1 - sq));
      ctx.drawImage(f, -(w >> 1), -h, w, h);
    }
    ctx.restore();
  }

  drawGlow(_g: Game, glow: CanvasRenderingContext2D, cx: number, cy: number) {
    if (this.state === 'stunned' && Math.floor(this.stateT * 10) % 2 === 0) {
      glow.fillStyle = '#ffd84a';
      const x = Math.round(this.x - cx), y = Math.round(this.y - cy - this.height() - 6);
      for (let i = 0; i < 3; i++) {
        const a = this.stateT * 6 + i * 2.1;
        glow.fillRect(x + Math.round(Math.cos(a) * 7), y + Math.round(Math.sin(a) * 2), 2, 2);
      }
    }
  }
}

// ---------------------------------------------------------------- ghoul: melee lunger

export class Ghoul extends Enemy {
  kind: EnemyKind = 'ghoul';
  anim: Anim; idleAnim: Anim;
  cd = 0.5 + Math.random();
  lungeDx = 0; lungeDy = 0;
  speed = 50 + Math.random() * 14;
  constructor(g: Game, x: number, y: number) {
    super(x, y);
    this.anim = g.A.anim('masked_orc_run_anim'); this.idleAnim = g.A.anim('masked_orc_idle_anim');
    this.hp = this.maxHp = 30; this.r = 8; this.jitter = 1;
  }
  think(g: Game, dt: number) {
    const p = g.player, d = this.dirTo(p.x, p.y);
    this.cd -= dt;
    if (Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx);
    switch (this.state) {
      case 'idle': case 'chase':
        this.steer(d.dx * this.speed, d.dy * this.speed, dt);
        if (d.d < 52 && this.cd <= 0 && p.state !== 'dead') {
          this.setState('windup');
          g.fx.glint(this.x, this.y - 30, WHITE, 7);
          g.audio.play('glint');
        }
        break;
      case 'windup':
        this.steer(-d.dx * 20, -d.dy * 20, dt);   // lean back before lunging
        if (this.stateT < 0.36) { this.lungeDx = d.dx; this.lungeDy = d.dy; }
        if (this.stateT >= 0.46) {
          this.setState('lunge');
          this.vx = this.lungeDx * 280; this.vy = this.lungeDy * 280;
        }
        break;
      case 'lunge':
        if (!this.hitThisAttack && Math.hypot(p.x - this.x, p.y - this.y) < this.r + p.r + 7) {
          this.hitThisAttack = true;
          const res: HitResult = g.hitPlayer(this, 12, { parryable: true, kind: 'melee' });
          if (res === 'parried') { g.riposte(this, 60); return; }
        }
        if (this.stateT >= 0.2) { this.setState('recover'); this.cd = 0.9 + Math.random() * 0.6; }
        break;
      case 'recover':
        if (this.stateT >= 0.5) this.setState('chase');
        break;
    }
  }
}

// ---------------------------------------------------------------- caster: ranged

export class Caster extends Enemy {
  kind: EnemyKind = 'caster';
  anim: Anim;
  cd = 1 + Math.random() * 1.5;
  strafe = Math.random() < 0.5 ? 1 : -1;
  heavyShot = false;
  constructor(g: Game, x: number, y: number) {
    super(x, y);
    this.anim = g.A.anim('necromancer_idle_anim');
    this.hp = this.maxHp = 26; this.r = 8; this.jitter = 0;
  }
  think(g: Game, dt: number) {
    const p = g.player, d = this.dirTo(p.x, p.y);
    if (Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx);
    this.cd -= dt;
    switch (this.state) {
      case 'idle': case 'chase': {
        let tx = -d.dy * this.strafe * 34, ty = d.dx * this.strafe * 34;
        if (d.d < 120) { tx -= d.dx * 50; ty -= d.dy * 50; }
        else if (d.d > 190) { tx += d.dx * 46; ty += d.dy * 46; }
        this.steer(tx, ty, dt, 4);
        if (Math.random() < dt * 0.3) this.strafe *= -1;
        if (this.cd <= 0 && d.d < 300 && p.state !== 'dead') {
          this.heavyShot = Math.random() < 0.3;
          this.setState('cast');
          g.fx.glint(this.x, this.y - 44, this.heavyShot ? RED : WHITE, 6);
          g.audio.play(this.heavyShot ? 'danger' : 'glint');
        }
        break;
      }
      case 'cast':
        this.steer(0, 0, dt);
        g.fx.light(this.x, this.y - 22, 40 + this.stateT * 60, this.heavyShot ? '#ff2244' : '#ff5a8a', 0.8);
        if (this.stateT >= 0.6) {
          const a = Math.atan2(p.y - 30 - (this.y - 22), p.x - this.x);
          if (this.heavyShot) {
            g.enemyBullet(this.x, this.y - 22, a, 85, { r: 7, dmg: 18, parryable: false, kind: 'big', color: '#ff2244', source: this });
          } else {
            for (const off of [-0.24, 0, 0.24]) g.enemyBullet(this.x, this.y - 22, a + off, 128, { source: this });
          }
          this.setState('chase');
          this.cd = 1.9 + Math.random() * 1.2;
        }
        break;
    }
  }
}

// ---------------------------------------------------------------- brute: heavy melee

export class Brute extends Enemy {
  kind: EnemyKind = 'brute';
  anim: Anim; idleAnim: Anim;
  cd = 1;
  attack: 'swing' | 'slam' = 'swing';
  ax = 0; ay = 0;
  constructor(g: Game, x: number, y: number) {
    super(x, y);
    this.anim = g.A.anim('ogre_run_anim'); this.idleAnim = g.A.anim('ogre_idle_anim');
    this.hp = this.maxHp = 170; this.r = 15; this.heavy = 3.5; this.jitter = 1; this.stunTime = 1.3; this.spawnTime = 1;
  }
  think(g: Game, dt: number) {
    const p = g.player, d = this.dirTo(p.x, p.y);
    this.cd -= dt;
    if (this.state !== 'windup' && Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx);
    switch (this.state) {
      case 'idle': case 'chase':
        this.steer(d.dx * 40, d.dy * 40, dt, 3);
        if (d.d < 70 && this.cd <= 0 && p.state !== 'dead') {
          this.attack = Math.random() < 0.55 ? 'swing' : 'slam';
          this.setState('windup');
          if (this.attack === 'swing') { g.fx.glint(this.x, this.y - 58, WHITE, 9); g.audio.play('glint'); }
          else {
            g.fx.glint(this.x, this.y - 58, RED, 10); g.audio.play('danger');
            this.ax = this.x + d.dx * 18; this.ay = this.y + d.dy * 10;
            g.fx.telegraphs.push({ x: this.ax, y: this.ay, r: 58, t: 0, dur: 0.85, color: '#ff2244' });
          }
        }
        break;
      case 'windup': {
        this.steer(0, 0, dt);
        const wind = this.attack === 'swing' ? 0.55 : 0.85;
        if (this.stateT >= wind) {
          if (this.attack === 'swing') {
            this.vx = d.dx * 160; this.vy = d.dy * 160;
            if (d.d < 66 && p.state !== 'dead') {
              const res = g.hitPlayer(this, 22, { parryable: true, kind: 'melee' });
              if (res === 'parried') { g.riposte(this, 45); return; }
            }
            g.fx.ring(this.x + d.dx * 20, this.y - 20 + d.dy * 10, 34, '#d8c8ff', 0.18, 2);
            g.shake(0.15);
          } else {
            g.audio.play('slam'); g.shake(0.45);
            g.fx.ring(this.ax, this.ay, 62, '#ff3355', 0.35, 3);
            g.fx.burst(this.ax, this.ay, 22, { speed: 150, colors: ['#3a3155', '#5a4a7a'], size: 2, life: 0.6 });
            g.fx.light(this.ax, this.ay, 120, '#ff4422', 1);
            if (Math.hypot((p.x - this.ax), (p.y - this.ay) / 0.62) < 58 + p.r) g.hitPlayer({ x: this.ax, y: this.ay }, 26, { parryable: false, kind: 'aoe' });
          }
          this.setState('recover');
        }
        break;
      }
      case 'recover':
        if (this.stateT >= 0.85) { this.setState('chase'); this.cd = 0.7 + Math.random() * 0.8; }
        break;
    }
  }
}

// ---------------------------------------------------------------- shadow soldier: risen ally

export class Shadow extends Enemy {
  kind: EnemyKind = 'shadow';
  anim: Anim;
  life = 12;
  cd = 0;
  target: Enemy | null = null;
  constructor(anim: Anim, x: number, y: number) {
    super(x, y);
    this.anim = anim; this.ally = true; this.r = 8; this.spawnTime = 0.6;
  }
  think(g: Game, dt: number) {
    this.life -= dt; this.cd -= dt;
    if (this.life <= 0) {
      this.dead = true;
      g.fx.burst(this.x, this.y - 16, 16, { speed: 40, colors: ['#5a2ccf', '#2a1060'], glow: true, grav: -80, vz: 40, life: 0.9, size: 2 });
      return;
    }
    if (!this.target || this.target.dead) {
      let best = 1e9;
      this.target = null;
      for (const e of g.enemies) if (!e.ally && !e.dead && e.state !== 'spawn') {
        const d = Math.hypot(e.x - this.x, e.y - this.y);
        if (d < best) { best = d; this.target = e; }
      }
    }
    const tx = this.target ? this.target.x : g.player.x - g.player.face * 26;
    const ty = this.target ? this.target.y : g.player.y + 6;
    const d = this.dirTo(tx, ty);
    if (Math.abs(d.dx) > 0.1) this.face = Math.sign(d.dx);
    if (this.target && d.d < this.r + this.target.r + 6 && this.cd <= 0) {
      this.cd = 0.55;
      this.vx = d.dx * 160; this.vy = d.dy * 160;
      this.target.hurt(g, 9, d.dx, d.dy, { knock: 40, how: 'shadow' });
      g.fx.burst(this.target.x, this.target.y - 14, 5, { speed: 90, color: '#9a5cff', glow: true, grav: 0, life: 0.2 });
    } else if (d.d > 8) this.steer(d.dx * 95, d.dy * 95, dt, 6);
  }
  drawGlow(_g: Game, glow: CanvasRenderingContext2D, cx: number, cy: number) {
    // glowing eyes sell the "shadow soldier" read
    glow.fillStyle = '#b26bff';
    const x = Math.round(this.x - cx), y = Math.round(this.y - cy - this.anim.h * 0.62);
    glow.fillRect(x - 3, y, 2, 1); glow.fillRect(x + 2, y, 2, 1);
  }
}
