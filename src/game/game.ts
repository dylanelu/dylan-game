import type { Audio } from '../engine/audio';
import type { Input } from '../engine/input';
import type { PostParams, Renderer } from '../engine/renderer';
import type { Assets } from './assets';
import { Boss } from './boss';
import { Brute, Caster, Enemy, Ghoul, Shadow, type EnemyKind } from './enemies';
import { Fx } from './fx';
import { drawHud } from './hud';
import { Level } from './level';
import { PARRY_PERFECT, Player } from './player';

export type HitResult = 'hit' | 'parried' | 'guarded' | 'dodged' | 'ignored';

export interface Bullet {
  x: number; y: number; vx: number; vy: number; r: number; dmg: number;
  team: 'enemy' | 'player'; parryable: boolean; life: number; age: number;
  color: string; kind: 'orb' | 'dagger' | 'big'; pierce: number;
  hits: Set<Enemy> | null; source: Enemy | null;
}

interface Hazard { x: number; y: number; r: number; maxR: number; speed: number; dmg: number; hit: boolean }

const lightCache = new Map<string, HTMLCanvasElement>();
function lightSprite(color: string) {
  let c = lightCache.get(color);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!, grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, color); grd.addColorStop(0.35, color + 'aa'); grd.addColorStop(1, color + '00');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    lightCache.set(color, c);
  }
  return c;
}

export class Game {
  level: Level;
  player: Player;
  fx: Fx;
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  hazards: Hazard[] = [];
  cam = { x: 0, y: 0 };
  time = 0;
  trauma = 0;
  kickX = 0; kickY = 0;
  private stop = 0;
  private slowT = 0; private slowScale = 1; timeScale = 1;
  post: PostParams = { chroma: 0, flash: 0, flashColor: [1, 1, 1], zoom: 1, lowHp: 0, vignette: 0.7, grain: 0.035, desat: 0 };
  god = false;
  showHitbox = false;
  combo = 0; comboT = 0;
  bannerText = ''; bannerColor = '#fff'; bannerT = 0; bannerDur = 0;
  hintT = 14;
  deadT = 0;
  kills = 0;
  private timers: { t: number; fn: () => void }[] = [];

  /** Schedule on game time, so hitstop and slow-mo stretch it like everything else. */
  later(sec: number, fn: () => void) { this.timers.push({ t: sec, fn }); }

  /** Play a sound panned by where it happens on screen. */
  sfx(name: string, x?: number, vol = 1) {
    const pan = x === undefined ? 0 : ((x - this.cam.x) / this.r.w - 0.5) * 2;
    this.audio.play(name, { pan, vol });
  }
  private musicCalm = 0;

  constructor(public r: Renderer, public input: Input, public audio: Audio, public A: Assets) {
    this.level = new Level(A);
    this.fx = new Fx(this.level.decalCtx);
    this.player = new Player(this.level.width / 2, this.level.height / 2 + 40);
    this.cam.x = this.player.x - r.w / 2; this.cam.y = this.player.y - r.h / 2;
    this.later(0.4, () => { this.banner('E-RANK GATE', '#b26bff', 2.2); this.spawnWave(['ghoul', 'ghoul', 'ghoul', 'caster']); });
  }

  // ------------------------------------------------------------------ juice API

  shake(t: number) { this.trauma = Math.min(1, this.trauma + t); }
  kick(x: number, y: number) { this.kickX += x; this.kickY += y; }
  hitstop(t: number) { this.stop = Math.max(this.stop, t); }
  slowmo(t: number, scale: number) { this.slowT = Math.max(this.slowT, t); this.slowScale = Math.min(this.slowScale, scale); }
  flash(color: string, a: number) {
    const c = parseInt(color.slice(1), 16);
    this.post.flashColor = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    this.post.flash = Math.max(this.post.flash, a);
  }
  chroma(a: number) { this.post.chroma = Math.max(this.post.chroma, a); }
  zoomPunch(a: number) { this.post.zoom = Math.max(this.post.zoom, 1 + a); }
  banner(text: string, color: string, dur = 1.6) { this.bannerText = text; this.bannerColor = color; this.bannerT = 0; this.bannerDur = dur; }
  hazard(x: number, y: number, maxR: number, speed: number, dmg: number) { this.hazards.push({ x, y, r: 10, maxR, speed, dmg, hit: false }); }

  // ------------------------------------------------------------------ spawning

  spawn(kind: EnemyKind, x?: number, y?: number) {
    const b = this.level.bounds, p = this.player;
    if (x === undefined || y === undefined) {
      for (let i = 0; i < 30; i++) {
        x = b.x0 + 30 + Math.random() * (b.x1 - b.x0 - 60);
        y = b.y0 + 30 + Math.random() * (b.y1 - b.y0 - 60);
        if (Math.hypot(x - p.x, y - p.y) > 150) break;
      }
    }
    const e = kind === 'ghoul' ? new Ghoul(this, x!, y!) : kind === 'caster' ? new Caster(this, x!, y!)
      : kind === 'brute' ? new Brute(this, x!, y!) : new Boss(this, x!, y!);
    this.level.collide(e, e.r);
    this.enemies.push(e);
    // gate portal
    this.fx.ring(e.x, e.y, e.boss ? 70 : 26, '#7a3cff', 0.7, 2);
    this.fx.burst(e.x, e.y, e.boss ? 40 : 12, { speed: 40, colors: ['#7a3cff', '#3a1a80', '#b26bff'], glow: true, grav: -90, vz: 50, life: 0.9, size: 2, drag: 2 });
    this.fx.splat(e.x, e.y, '#120a24', 10, e.boss ? 26 : 10);
    this.sfx('spawn', e.x);
    return e;
  }

  spawnWave(kinds: EnemyKind[]) { kinds.forEach((k, i) => this.later(i * 0.14, () => this.spawn(k))); }

  sandbox(act: string) {
    switch (act) {
      case 'ghoul': this.spawnWave(['ghoul', 'ghoul', 'ghoul']); break;
      case 'caster': this.spawnWave(['caster', 'caster']); break;
      case 'brute': this.spawn('brute'); break;
      case 'boss': {
        this.enemies = this.enemies.filter((e) => e.ally);
        this.bullets = [];
        const b = this.level.bounds;
        this.spawn('boss', (b.x0 + b.x1) / 2, b.y0 + 120);
        break;
      }
      case 'wave': this.spawnWave(['ghoul', 'ghoul', 'ghoul', 'ghoul', 'caster', 'caster', 'brute']); break;
      case 'clear': this.enemies = []; this.bullets = []; this.hazards = []; break;
      case 'god': this.god = !this.god; break;
      case 'hitbox': this.showHitbox = !this.showHitbox; break;
    }
  }

  enemyBullet(x: number, y: number, a: number, speed: number, o: Partial<Bullet> = {}) {
    this.bullets.push({
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 4, dmg: 10, team: 'enemy', parryable: true,
      life: 6, age: 0, color: '#ff4a6a', kind: 'orb', pierce: 0, hits: null, source: null, ...o,
    });
  }

  // ------------------------------------------------------------------ combat resolution

  /** Every attack on the player funnels through here so dodge/parry/guard rules live in one place. */
  hitPlayer(src: { x: number; y: number }, dmg: number, o: { parryable: boolean; kind: 'melee' | 'bullet' | 'aoe' }): HitResult {
    const p = this.player;
    if (p.state === 'dead') return 'ignored';
    if (p.iframes > 0) {
      if (o.kind !== 'bullet') this.fx.text(p.x, p.y - 70, 'DODGE', '#9ad0ff', 1, 0.5);
      return 'dodged';
    }
    if (p.invuln > 0) return 'ignored';
    const phase = p.parryPhase;
    if (o.parryable && phase) {
      const fx = (src.x + p.x) / 2, fy = (src.y + p.y) / 2 - 28;
      if (phase === 'perfect') { this.perfectParry(fx, fy, o.kind); return 'parried'; }
      // guard: late parry still blocks most of it
      this.damagePlayer(Math.round(dmg * 0.25), src, true);
      this.sfx('guard', p.x); this.shake(0.15); this.hitstop(0.04);
      this.fx.burst(fx, fy, 6, { speed: 120, color: '#c8b8e8', glow: true, life: 0.2, grav: 0 });
      this.fx.text(p.x, p.y - 70, 'GUARD', '#a89cc8', 1, 0.5);
      p.setState('normal');
      return 'guarded';
    }
    this.damagePlayer(dmg, src, false);
    return 'hit';
  }

  private damagePlayer(dmg: number, src: { x: number; y: number }, guarded: boolean) {
    const p = this.player;
    if (!this.god) p.hp -= dmg;
    this.combo = 0;
    if (guarded) return;
    const dx = p.x - src.x, dy = p.y - src.y, l = Math.hypot(dx, dy) || 1;
    p.vx += (dx / l) * 220; p.vy += (dy / l) * 220;
    p.invuln = 0.7; p.flash = 0.1;
    if (p.state === 'parry' || p.state === 'recover') p.setState('normal');
    this.sfx('hurt', p.x); this.audio.muffleFor(0.25, 1400);
    this.hitstop(0.08); this.shake(0.5); this.chroma(1.2); this.flash('#ff1133', 0.22);
    this.fx.burst(p.x, p.y - 30, 14, { speed: 150, colors: ['#8e1b2e', '#5a0f1e'], size: 2, life: 0.6, decal: '#2a0610' });
    this.fx.text(p.x, p.y - 70, `-${dmg}`, '#ff4a6a', 1, 0.7);
    if (p.hp <= 0) {
      p.hp = 0; p.setState('dead'); this.deadT = 0;
      this.slowmo(1.2, 0.25); this.banner('DEFEATED', '#ff3355', 3);
      this.sfx('playerDeath', p.x); this.audio.muffleFor(2.5, 400); this.audio.setMusic(null);
    }
  }

  private perfectParry(x: number, y: number, kind: string) {
    const p = this.player;
    p.parryFlash = 0.12;
    p.parryAngle = Math.atan2(y - (p.y - 30), x - p.x);
    p.setState('normal');
    p.mana = Math.min(p.maxMana, p.mana + 35);
    p.empowered = Math.min(6, p.empowered + 3);
    this.combo++; this.comboT = 3;
    this.sfx('parry', x); this.audio.muffleFor(0.3, 900); this.audio.duck(0.35, 0.5);
    this.hitstop(kind === 'bullet' ? 0.05 : 0.1);
    this.slowmo(0.28, 0.35);
    this.shake(0.3); this.chroma(1.6); this.flash('#ffffff', 0.22); this.zoomPunch(0.035);
    this.fx.ring(x, y, 44, '#ffffff', 0.25, 3);
    this.fx.ring(x, y, 70, '#b26bff', 0.4, 2);
    this.fx.burst(x, y, 22, { speed: 260, colors: ['#ffffff', '#e8dcff', '#ffd84a'], glow: true, life: 0.3, grav: 0, drag: 6, size: 1 });
    this.fx.light(x, y, 140, '#e8dcff', 1);
    this.fx.text(p.x, p.y - 74, this.combo > 1 ? `PERFECT x${this.combo}` : 'PERFECT', '#ffffff', 1, 0.7);
  }

  /** Perfect parry on a normal enemy: stagger it and counter-strike instantly. */
  riposte(e: Enemy, dmg: number) {
    e.parried(this);
    const p = this.player, d = e.dirTo(p.x, p.y);
    this.sfx('riposte', e.x);
    p.vx += -d.dx * 140; p.vy += -d.dy * 140;   // step into the counter
    this.later(0.07, () => {
      if (e.dead) return;
      e.hurt(this, dmg, -d.dx, -d.dy, { crit: true, knock: 160, how: 'riposte' });
      this.fx.burst(e.x, e.y - 16, 10, { speed: 200, color: '#b26bff', glow: true, life: 0.25, grav: 0 });
    });
  }

  /** Perfect parry on the boss: posture instead of stagger. */
  deflect(e: Enemy) { e.parried(this); }

  onEnemyKilled(e: Enemy, how: string) {
    this.kills++;
    if (e.boss) {
      this.slowmo(2, 0.2); this.flash('#ffffff', 0.5); this.shake(1); this.chroma(2);
      this.banner('GATE CLEARED', '#ffd84a', 3.5);
      this.sfx('break', e.x); this.audio.setMusic(null);
      this.bullets = this.bullets.filter((b) => b.team === 'player');
      for (let i = 0; i < 6; i++) this.later(i * 0.12, () => {
        this.fx.ring(e.x, e.y - 40, 60 + i * 30, i % 2 ? '#ffd84a' : '#b26bff', 0.6, 3);
        this.fx.burst(e.x, e.y - 40, 30, { speed: 260, colors: ['#ffd84a', '#b26bff', '#ffffff'], glow: true, life: 0.8, grav: 60 });
        this.shake(0.4);
      });
      return;
    }
    // ARISE: enemies killed by a riposte come back as shadow soldiers
    const allies = this.enemies.filter((x) => x.ally && !x.dead).length;
    if (how === 'riposte' && allies < 4) {
      const anim = (e as Ghoul).idleAnim ?? e.anim;
      this.later(0.45, () => {
        const s = new Shadow(anim, e.x, e.y);
        this.enemies.push(s);
        this.fx.text(e.x, e.y - 48, 'ARISE', '#b26bff', 2, 1);
        this.fx.burst(e.x, e.y, 26, { speed: 30, colors: ['#5a2ccf', '#b26bff', '#1a0a40'], glow: true, grav: -140, vz: 90, life: 1, size: 2, drag: 1 });
        this.fx.ring(e.x, e.y, 30, '#7a3cff', 0.5, 2);
        this.sfx('arise', e.x);
      });
    }
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    this.time += dt;
    const p = this.player;

    // camera feedback decays in real time, unaffected by hitstop
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.kickX *= Math.exp(-dt * 18); this.kickY *= Math.exp(-dt * 18);
    this.post.flash *= Math.exp(-dt * 9);
    this.post.chroma *= Math.exp(-dt * 6);
    this.post.zoom = 1 + (this.post.zoom - 1) * Math.exp(-dt * 10);
    this.bannerT += dt; this.hintT -= dt;
    this.post.lowHp = p.hp / p.maxHp < 0.3 && p.state !== 'dead' ? 0.35 + 0.25 * Math.sin(this.time * 6) : 0;
    this.post.desat += ((p.state === 'dead' ? 0.8 : 0) - this.post.desat) * Math.min(1, dt * 3);

    if (this.stop > 0) { this.stop -= dt; return; }

    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = this.slowScale; }
    else { this.slowScale = 1; this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 8); }
    const sdt = dt * this.timeScale;

    // input
    for (const ev of this.input.events.splice(0)) {
      if (ev.type === 'parry') p.tryParry(this);
      else if (ev.type === 'roll') p.tryRoll(this, ev.dx, ev.dy);
      else if (ev.type === 'key') {
        const map: Record<string, string> = { Digit1: 'ghoul', Digit2: 'caster', Digit3: 'brute', Digit4: 'boss', Digit5: 'wave', Digit0: 'clear', KeyG: 'god', KeyH: 'hitbox' };
        if (map[ev.key]) this.sandbox(map[ev.key]);
      }
    }
    // aim in world space, with a little magnetism on touch
    const a = this.input.aim;
    p.aimX = a.x + this.cam.x; p.aimY = a.y + this.cam.y;
    if (this.input.device === 'touch' && this.input.firing) this.aimAssist();

    p.update(this, sdt);
    if (p.state === 'dead') {
      this.deadT += dt;
      if (this.deadT > 3) this.respawn();
    }

    for (const tm of this.timers) tm.t -= sdt;
    const due = this.timers.filter((tm) => tm.t <= 0);
    this.timers = this.timers.filter((tm) => tm.t > 0);
    for (const tm of due) tm.fn();

    for (const e of this.enemies) e.update(this, sdt);
    this.separate();
    this.updateBullets(sdt);
    this.updateHazards(sdt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.fx.update(sdt);
    const hostile = this.enemies.filter((e) => !e.ally).length;
    if (this.enemies.some((e) => e.boss)) this.audio.setMusic('bossMusic');
    else if (hostile >= 4) { this.audio.setMusic('waveMusic'); this.musicCalm = 0; }
    else if (hostile === 0 && (this.musicCalm += sdt) > 4) this.audio.setMusic(null);
    this.comboT -= sdt;
    if (this.comboT <= 0) this.combo = 0;

    // camera: follow with a lead toward the aim, critically damped feel
    const lead = this.input.device === 'mouse' ? 0.22 : 0;
    let lx = (p.aimX - p.x) * lead, ly = (p.aimY - p.y) * lead;
    const ll = Math.hypot(lx, ly); if (ll > 60) { lx *= 60 / ll; ly *= 60 / ll; }
    if (this.input.device === 'touch') { lx = p.vx * 0.18; ly = p.vy * 0.18; }
    // boss fights: pull the camera toward the boss so both stay framed
    const boss = this.enemies.find((e) => e.boss && e.state !== 'spawn');
    if (boss) {
      const bx = boss.x - p.x, by = boss.y - 40 - p.y, bd = Math.hypot(bx, by);
      const w = Math.max(0, Math.min(0.45, (bd - 40) / 400));
      lx = lx * 0.5 + bx * w; ly = ly * 0.5 + by * w;
    }
    const tx = p.x + lx - this.r.w / 2, ty = p.y - 26 + ly - this.r.h / 2;
    const k = 1 - Math.exp(-dt * 7);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    const L = this.level;
    // clamp to the arena, or center it when the screen is bigger than the arena on that axis
    const clamp = (v: number, view: number, size: number, lo: number, hi: number) =>
      view >= size + lo + hi ? (size - view) / 2 : Math.max(-lo, Math.min(size - view + hi, v));
    this.cam.x = clamp(this.cam.x, this.r.w, L.width, 40, 40);
    this.cam.y = clamp(this.cam.y, this.r.h, L.height, 60, 40);
  }

  private aimAssist() {
    const p = this.player;
    const base = Math.atan2(p.aimY - (p.y - 30), p.aimX - p.x);
    let best: Enemy | null = null, bestScore = 0.3;
    for (const e of this.enemies) {
      if (e.ally || e.state === 'spawn') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > 320) continue;
      let da = Math.abs(Math.atan2(e.y - 16 - (p.y - 30), e.x - p.x) - base);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < bestScore) { bestScore = da; best = e; }
    }
    if (best) { p.aimX = best.x; p.aimY = best.y - best.height() * 0.5; }
  }

  private separate() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.state === 'spawn' || b.state === 'spawn') continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d < m && d > 0.01) {
        const push = (m - d) / 2, nx = dx / d, ny = dy / d;
        const wa = b.heavy / (a.heavy + b.heavy), wb = 1 - wa;
        a.x -= nx * push * wa * 2; a.y -= ny * push * wa * 2;
        b.x += nx * push * wb * 2; b.y += ny * push * wb * 2;
      }
    }
    // the player can't walk through enemies either (soft)
    const p = this.player;
    if (p.state === 'roll') return;
    for (const e of list) {
      if (e.state === 'spawn' || e.ally) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy), m = p.r + e.r - 2;
      if (d < m && d > 0.01) { p.x += (dx / d) * (m - d) * 0.6; p.y += (dy / d) * (m - d) * 0.6; }
    }
  }

  private updateBullets(dt: number) {
    const p = this.player;
    for (const b of this.bullets) {
      b.age += dt; b.life -= dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (this.level.blocks(b.x, b.y + 20)) {
        b.life = 0;
        this.fx.burst(b.x, b.y + 20, 4, { speed: 80, color: b.color, glow: true, life: 0.2, grav: 0, z: 20 });
        continue;
      }
      if (b.team === 'enemy') {
        // bullets fly at chest height (y - 0); the player's hurt circle sits around the torso
        const d = Math.hypot(b.x - p.x, b.y - (p.y - 26));
        if (d < b.r + p.r + 3) {
          const res = this.hitPlayer(b, b.dmg, { parryable: b.parryable, kind: 'bullet' });
          if (res === 'parried') this.reflect(b);
          else if (res !== 'dodged') b.life = 0;
        }
      } else {
        for (const e of this.enemies) {
          if (e.ally || e.dead || e.state === 'spawn' || b.hits?.has(e)) continue;
          const z = e instanceof Boss ? e.z : 0;
          const ex = e.x, ey = e.y - e.height() * 0.45 - z, rr = e.r + b.r + (e.boss ? 10 : 2);
          if (Math.abs(b.x - ex) < rr && Math.abs(b.y - ey) < e.height() * 0.5 + b.r) {
            const l = Math.hypot(b.vx, b.vy) || 1;
            e.hurt(this, b.dmg, b.vx / l, b.vy / l, { knock: b.kind === 'big' ? 120 : 45 });
            this.hitstop(b.kind === 'big' ? 0.035 : 0.012);
            b.hits?.add(e);
            if (b.pierce-- <= 0) { b.life = 0; break; }
          }
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  /** Parried bullets fly back as empowered player shots aimed at whoever fired them. */
  private reflect(b: Bullet) {
    this.sfx('reflect', b.x);
    b.team = 'player'; b.parryable = false; b.color = '#e8dcff'; b.kind = 'big'; b.dmg = 28; b.pierce = 1; b.life = 1.5;
    b.hits = new Set();
    let tx = b.x - b.vx, ty = b.y - b.vy;
    if (b.source && !b.source.dead) { tx = b.source.x; ty = b.source.y - b.source.height() * 0.5; }
    const dx = tx - b.x, dy = ty - b.y, l = Math.hypot(dx, dy) || 1, sp = 380;
    b.vx = (dx / l) * sp; b.vy = (dy / l) * sp;
    if (b.source instanceof Boss) b.source.addPosture(this, 4);
  }

  private updateHazards(dt: number) {
    const p = this.player;
    for (const h of this.hazards) {
      h.r += h.speed * dt;
      if (!h.hit) {
        const d = Math.hypot(p.x - h.x, (p.y - h.y) / 0.62);
        if (Math.abs(d - h.r) < 4 + p.r * 0.5) {   // match the thin ring the player sees
          const res = this.hitPlayer(h, h.dmg, { parryable: false, kind: 'aoe' });
          if (res === 'hit') h.hit = true;
        }
      }
    }
    this.hazards = this.hazards.filter((h) => h.r < h.maxR);
  }

  private respawn() {
    const p = new Player(this.level.width / 2, this.level.height / 2 + 40);
    this.player = p;
    this.bullets = []; this.hazards = [];
    this.enemies = this.enemies.filter((e) => e.boss);
    for (const e of this.enemies) if (e instanceof Boss) { e.hp = e.maxHp; e.phase = 1; e.posture = 0; e.setState('idle'); }
    this.banner('ARISE', '#b26bff', 1.6);
    this.fx.burst(p.x, p.y, 30, { speed: 40, colors: ['#5a2ccf', '#b26bff'], glow: true, grav: -120, vz: 80, life: 1, size: 2 });
  }

  // ------------------------------------------------------------------ render

  render() {
    const R = this.r, W = R.w, H = R.h;
    const s = R.scene.ctx, gl = R.glow.ctx, li = R.light.ctx, ui = R.ui.ctx;
    // shake: smooth noise, squared trauma
    const tr = this.trauma * this.trauma, t = this.time;
    const sx = (Math.sin(t * 47.3) + Math.sin(t * 31.1 + 1.3)) * 0.5 * tr * 9 + this.kickX;
    const sy = (Math.sin(t * 41.7 + 2.1) + Math.sin(t * 27.9 + 0.4)) * 0.5 * tr * 9 + this.kickY;
    const cx = Math.round(this.cam.x + sx), cy = Math.round(this.cam.y + sy);

    s.fillStyle = '#07060c'; s.fillRect(0, 0, W, H);
    gl.clearRect(0, 0, W, H);
    ui.clearRect(0, 0, W, H);
    s.drawImage(this.level.base, -cx, -cy);
    s.drawImage(this.level.decals, -cx, -cy);
    this.level.drawFountains(s, this.time, cx, cy);
    this.fx.drawTelegraphs(s, cx, cy);

    // depth-sorted entities
    const items: { y: number; draw: () => void }[] = [];
    for (const c of this.level.columns) items.push({ y: c.y, draw: () => this.level.drawColumn(s, c, cx, cy) });
    for (const e of this.enemies) items.push({ y: e.y, draw: () => e.draw(this, s, cx, cy) });
    const p = this.player;
    items.push({ y: p.y, draw: () => p.draw(this, s, gl, cx, cy) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    for (const e of this.enemies) e.drawGlow(this, gl, cx, cy);

    this.fx.drawParticles(s, gl, cx, cy);
    this.drawBullets(gl, cx, cy);
    this.drawHazards(gl, cx, cy);
    this.fx.drawGlow(gl, cx, cy);

    // lighting
    li.globalCompositeOperation = 'source-over';
    li.fillStyle = p.state === 'dead' ? '#26242e' : '#33313f'; li.fillRect(0, 0, W, H);
    li.globalCompositeOperation = 'lighter';
    const L = (x: number, y: number, r: number, color: string, a = 1) => {
      if (x + r < cx || x - r > cx + W || y + r < cy || y - r > cy + H) return;
      li.globalAlpha = a; li.drawImage(lightSprite(color), Math.round(x - r - cx), Math.round(y - r - cy), r * 2, r * 2);
    };
    for (const l of this.level.lights) L(l.x, l.y, l.radius * (1 + Math.sin(this.time * 9 + l.x) * l.flicker * 0.3), l.color, 0.9);
    L(p.x, p.y - 26, 140, '#7a6aa0', 0.75);
    L(p.x, p.y - 26, 56, '#d8d0f0', 0.35);
    for (const e of this.enemies) if (e.state !== 'spawn') L(e.x, e.y - 8, e.boss ? 60 : 30, e.ally ? '#7a3cff' : '#ff3355', 0.22);
    for (const b of this.bullets) L(b.x, b.y, b.team === 'player' ? 22 : 18, b.team === 'player' ? '#9a5cff' : '#ff3355', 0.55);
    for (const l of this.fx.lights) L(l.x, l.y, l.r, l.color, l.a);
    this.fx.lights.length = 0;
    li.globalAlpha = 1;

    // world-space UI then HUD
    this.fx.drawTexts(ui, cx, cy);
    if (this.showHitbox) this.drawHitboxes(ui, cx, cy);
    drawHud(this, ui);

    R.present(this.post, this.time);
  }

  private drawBullets(g: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const b of this.bullets) {
      const x = Math.round(b.x - cx), y = Math.round(b.y - cy);
      if (b.kind === 'dagger') {
        // streak along velocity
        const l = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / l, uy = b.vy / l;
        g.fillStyle = b.color;
        for (let i = 0; i < 7; i++) g.fillRect(Math.round(x - ux * i), Math.round(y - uy * i), 1, 1);
        g.fillStyle = '#ffffff'; g.fillRect(x, y, 1, 1); g.fillRect(Math.round(x - ux), Math.round(y - uy), 1, 1);
      } else if (b.kind === 'big') {
        const r = b.r;
        g.fillStyle = b.color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 1, 3, 3);
        const l = Math.hypot(b.vx, b.vy) || 1;
        g.globalAlpha = 0.5; g.fillStyle = b.color;
        for (let i = 1; i < 4; i++) g.fillRect(Math.round(x - (b.vx / l) * i * 3) - 1, Math.round(y - (b.vy / l) * i * 3) - 1, 3, 3);
        g.globalAlpha = 1;
      } else {
        // enemy orb: pulsing ring + hot core so it pops on the dark floor
        const pulse = Math.floor(b.age * 12) % 2;
        g.fillStyle = b.color;
        g.fillRect(x - 2, y - 1, 5, 3); g.fillRect(x - 1, y - 2, 3, 5);
        if (pulse) { g.fillRect(x - 3, y, 7, 1); g.fillRect(x, y - 3, 1, 7); }
        g.fillStyle = '#ffe0e8'; g.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }

  private drawHazards(g: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const h of this.hazards) {
      const k = h.r / h.maxR;
      g.globalAlpha = 1 - k * 0.7;
      g.strokeStyle = '#ff3355'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(Math.round(h.x - cx), Math.round(h.y - cy), h.r, h.r * 0.62, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#ffb0c0'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(Math.round(h.x - cx), Math.round(h.y - cy), h.r, h.r * 0.62, 0, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
  }

  private drawHitboxes(g: CanvasRenderingContext2D, cx: number, cy: number) {
    g.strokeStyle = '#00ff88'; g.lineWidth = 1;
    const c = (x: number, y: number, r: number) => { g.beginPath(); g.arc(Math.round(x - cx), Math.round(y - cy), r, 0, Math.PI * 2); g.stroke(); };
    const p = this.player;
    c(p.x, p.y, p.r); c(p.x, p.y - 26, p.r);
    for (const e of this.enemies) c(e.x, e.y, e.r);
    g.strokeStyle = '#ff8800';
    for (const b of this.bullets) c(b.x, b.y, b.r);
    if (p.state === 'parry') { g.fillStyle = p.t < PARRY_PERFECT ? '#ffffff' : '#888888'; g.fillRect(4, this.r.h - 10, 6, 6); }
  }
}
