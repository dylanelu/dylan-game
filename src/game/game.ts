import type { Audio } from '../engine/audio';
import type { Input } from '../engine/input';
import type { PostParams, Renderer } from '../engine/renderer';
import type { Coop } from '../net/coop';
import { HERO_LOOKS, type Assets } from './assets';
import { Boss } from './boss';
import { Brute, Caster, Enemy, Ghoul, Shadow, type EnemyKind } from './enemies';
import { Fx } from './fx';
import { drawText, textWidth } from './font';
import { drawHud } from './hud';
import { Level } from './level';
import { PARRY_PERFECT, Player } from './player';

export type HitResult = 'hit' | 'parried' | 'guarded' | 'dodged' | 'ignored';

export interface Bullet {
  x: number; y: number; vx: number; vy: number; r: number; dmg: number;
  team: 'enemy' | 'player'; heavy: boolean; life: number; age: number;
  color: string; kind: 'orb' | 'dagger' | 'big'; pierce: number;
  hits: Set<Enemy> | null; source: Enemy | null;
  nid?: number;          // network id for enemy bullets (co-op)
  cosmetic?: boolean;    // another player's shot: drawn, never deals damage here
}

export interface Hazard { x: number; y: number; r: number; maxR: number; speed: number; dmg: number; hit: boolean }

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
  post: PostParams = { chroma: 0, flash: 0, flashColor: [1, 1, 1], zoom: 1, lowHp: 0, vignette: 0.7, grain: 0.035, desat: 0, fracX: 0, fracY: 0 };
  god = false;
  showHitbox = false;
  combo = 0; comboT = 0;
  bannerText = ''; bannerColor = '#fff'; bannerT = 0; bannerDur = 0;
  hintT = 14;
  deadT = 0;
  kills = 0;
  renderDt = 1 / 60;
  paused = false;
  /** co-op session (null when playing solo) and the other players' characters */
  coop: Coop | null = null;
  remotes = new Map<string, Player>();
  nextId = 0;
  private bulletSeq = 0;
  private mirroring = false;
  /** solo, or the co-op host: this machine owns enemies, bullets and spawning */
  get authority() { return !this.coop || this.coop.isHost; }
  private timers: { t: number; fn: () => void }[] = [];

  /** Schedule on game time, so hitstop and slow-mo stretch it like everything else. */
  later(sec: number, fn: () => void) { this.timers.push({ t: sec, fn }); }

  /** Play a sound panned by where it happens on screen. */
  sfx(name: string, x?: number, vol = 1) {
    if (this.mirroring) this.coop?.push({ t: 'sfx', n: name, x, v: vol });
    const pan = x === undefined || this.r.w < 2 ? 0 : ((x - this.cam.x) / this.r.w - 0.5) * 2;
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

  shake(t: number) { if (this.mirroring) this.coop?.push({ t: 'shake', v: t }); this.trauma = Math.min(1, this.trauma + t); }
  kick(x: number, y: number) { this.kickX += x; this.kickY += y; }
  hitstop(t: number) { this.stop = Math.max(this.stop, t); }
  slowmo(t: number, scale: number) { this.slowT = Math.max(this.slowT, t); this.slowScale = Math.min(this.slowScale, scale); }
  flash(color: string, a: number) {
    if (this.mirroring) this.coop?.push({ t: 'flash', c: color, v: a });
    const c = parseInt(color.slice(1), 16);
    this.post.flashColor = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    this.post.flash = Math.max(this.post.flash, a);
  }
  chroma(a: number) { if (this.mirroring) this.coop?.push({ t: 'chroma', v: a }); this.post.chroma = Math.max(this.post.chroma, a); }
  zoomPunch(a: number) { this.post.zoom = Math.max(this.post.zoom, 1 + a); }
  banner(text: string, color: string, dur = 1.6) { if (this.mirroring) this.coop?.push({ t: 'banner', s: text, c: color, d: dur }); this.bannerText = text; this.bannerColor = color; this.bannerT = 0; this.bannerDur = dur; }
  hazard(x: number, y: number, maxR: number, speed: number, dmg: number) {
    this.hazards.push({ x, y, r: 10, maxR, speed, dmg, hit: false });
    if (this.coop?.isHost) this.coop.push({ t: 'hz', x, y, mr: maxR, sp: speed, dmg });
  }

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
    const e = this.makeEnemy(kind, x!, y!);
    e.id = ++this.nextId;
    this.level.collide(e, e.r);
    this.enemies.push(e);
    this.portal(e);
    return e;
  }

  makeEnemy(kind: EnemyKind, x: number, y: number, shadowAnim = ''): Enemy {
    if (kind === 'shadow') return new Shadow(this.A.anim(shadowAnim || 'masked_orc_idle_anim'), x, y, shadowAnim);
    return kind === 'ghoul' ? new Ghoul(this, x, y) : kind === 'caster' ? new Caster(this, x, y)
      : kind === 'brute' ? new Brute(this, x, y) : new Boss(this, x, y);
  }

  /** gate portal an enemy rises out of */
  portal(e: Enemy) {
    this.fx.ring(e.x, e.y, e.boss ? 70 : 26, '#7a3cff', 0.7, 2);
    this.fx.burst(e.x, e.y, e.boss ? 40 : 12, { speed: 40, colors: ['#7a3cff', '#3a1a80', '#b26bff'], glow: true, grav: -90, vz: 50, life: 0.9, size: 2, drag: 2 });
    this.fx.splat(e.x, e.y, '#120a24', 10, e.boss ? 26 : 10);
    this.sfx('spawn', e.x);
  }

  spawnWave(kinds: EnemyKind[]) { kinds.forEach((k, i) => this.later(i * 0.14, () => this.spawn(k))); }

  sandbox(act: string) {
    // in co-op only the host spawns; everyone else asks it to
    if (!this.authority && ['ghoul', 'caster', 'brute', 'boss', 'wave', 'clear'].includes(act)) { this.coop!.push({ t: 'cmd', act }); return; }
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
    const b: Bullet = {
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 4, dmg: 10, team: 'enemy', heavy: false,
      life: 6, age: 0, color: '#ff4a6a', kind: 'orb', pierce: 0, hits: null, source: null, nid: ++this.bulletSeq, ...o,
    };
    this.bullets.push(b);
    if (this.coop?.isHost) this.coop.enemyBulletSpawned(b);
  }

  /** A shot from the local player: tell the others so they see it. */
  onShot(b: Bullet) {
    this.coop?.push({ t: 'pb', x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), r: b.r, c: b.color, k: b.kind, l: b.life });
  }

  /** Who an enemy goes after: the nearest living player, local or remote. */
  targetFor(e: { x: number; y: number }): Player {
    let best = this.player, bd = this.player.state === 'dead' ? Infinity : Math.hypot(this.player.x - e.x, this.player.y - e.y);
    for (const p of this.remotes.values()) {
      if (p.state === 'dead' || p.dissolved) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** An enemy attack landing on `target`. Local targets resolve now; remote ones resolve on their own machine,
   *  and a parry there calls `onParried` here a moment later. */
  attack(target: Player, src: { x: number; y: number }, dmg: number, o: { heavy?: boolean; kind: 'melee' | 'bullet' | 'aoe'; counter?: boolean }, onParried?: () => void): HitResult | 'pending' {
    if (target.peerId && this.coop) { this.coop.remoteAttack(target, src, dmg, o, onParried); return 'pending'; }
    const res = this.hitPlayer(src, dmg, o);
    if (res === 'parried') onParried?.();
    return res;
  }

  // ------------------------------------------------------------------ combat resolution

  /** Every attack on the player funnels through here so dodge/parry/guard rules live in one place.
   *  Everything can be parried. Heavy (red-glint) attacks pay out more on a perfect parry and chip harder through a late guard. */
  hitPlayer(src: { x: number; y: number }, dmg: number, o: { heavy?: boolean; kind: 'melee' | 'bullet' | 'aoe'; counter?: boolean; lag?: number }): HitResult {
    // the local player's own reactions are never mirrored to other machines
    const mirroring = this.mirroring, emit = this.fx.emit;
    this.mirroring = false; this.fx.emit = null;
    try { return this.resolveHit(src, dmg, o); } finally { this.mirroring = mirroring; this.fx.emit = emit; }
  }

  private resolveHit(src: { x: number; y: number }, dmg: number, o: { heavy?: boolean; kind: 'melee' | 'bullet' | 'aoe'; counter?: boolean; lag?: number }): HitResult {
    const p = this.player;
    if (p.state === 'dead') return 'ignored';
    if (p.iframes > 0) {
      if (o.kind !== 'bullet') this.fx.text(p.x, p.y - Player.HEAD - 12, 'DODGE', '#9ad0ff', 1, 0.5);
      return 'dodged';
    }
    if (p.invuln > 0) return 'ignored';
    // co-op: an attack resolved here for a host-side enemy arrives late (snapshot + network delay), so the
    // perfect window stretches by that lag; the player reacted to what they saw, which was behind the host
    const phase = p.state === 'parry' ? (p.t < PARRY_PERFECT + (o.lag ?? 0) ? 'perfect' : 'guard') : null;
    if (phase) {
      const fx = (src.x + p.x) / 2, fy = (src.y + p.y) / 2 - 28;
      if (phase === 'perfect') {
        this.perfectParry(fx, fy, o.kind, !!o.heavy);
        if (o.counter) {
          // counter-strike: step into the attacker
          const dx = src.x - p.x, dy = src.y - p.y, l = Math.hypot(dx, dy) || 1;
          p.play('riposte'); p.face = Math.sign(dx) || p.face;
          p.vx += (dx / l) * 140; p.vy += (dy / l) * 140;
        }
        return 'parried';
      }
      // guard: late parry still blocks most of it
      this.damagePlayer(Math.round(dmg * (o.heavy ? 0.5 : 0.25)), src, true);
      this.sfx('guard', p.x); this.shake(0.15); this.hitstop(0.04);
      this.fx.burst(fx, fy, 6, { speed: 120, color: '#c8b8e8', glow: true, life: 0.2, grav: 0 });
      this.fx.text(p.x, p.y - Player.HEAD - 12, 'GUARD', '#a89cc8', 1, 0.5);
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
    p.play('hit');
    if (p.state === 'parry' || p.state === 'recover') p.setState('normal');
    this.sfx('hurt', p.x); this.audio.muffleFor(0.25, 1400);
    this.hitstop(0.08); this.shake(0.5); this.chroma(1.2); this.flash('#ff1133', 0.22);
    this.fx.burst(p.x, p.y - Player.CHEST, 14, { speed: 150, colors: ['#8e1b2e', '#5a0f1e'], size: 2, life: 0.6, decal: '#2a0610' });
    this.fx.text(p.x, p.y - Player.HEAD - 12, `-${dmg}`, '#ff4a6a', 1, 0.7);
    if (p.hp <= 0) {
      p.hp = 0; p.setState('dead'); this.deadT = 0;
      this.slowmo(1.2, 0.25); this.banner('DEFEATED', '#ff3355', 3);
      this.sfx('playerDeath', p.x); this.audio.muffleFor(2.5, 400); this.audio.setMusic(null);
    }
  }

  private perfectParry(x: number, y: number, kind: string, heavy = false) {
    const p = this.player;
    p.parryFlash = 0.12;
    p.parryAngle = Math.atan2(y - (p.y - Player.CHEST), x - p.x);
    p.setState('normal');
    p.mana = Math.min(p.maxMana, p.mana + 35);
    p.empowered = Math.min(6, p.empowered + 3);
    this.combo++; this.comboT = 3;
    this.audio.muffleFor(0.3, 900); this.audio.duck(0.35, 0.5);
    this.hitstop(heavy ? 0.15 : kind === 'bullet' ? 0.05 : 0.1);
    this.slowmo(heavy ? 0.45 : 0.28, heavy ? 0.25 : 0.35);
    this.shake(heavy ? 0.55 : 0.3); this.chroma(heavy ? 2.2 : 1.6); this.flash(heavy ? '#ffd8e0' : '#ffffff', heavy ? 0.32 : 0.22); this.zoomPunch(heavy ? 0.06 : 0.035);
    if (heavy) p.empowered = Math.min(8, p.empowered + 2);
    this.parryFx(x, y, heavy, false);
    this.coop?.push({ t: 'pfx', x: Math.round(x), y: Math.round(y), h: heavy ? 1 : 0 });
    const word = heavy ? 'DEFLECT' : 'PERFECT';
    this.fx.text(p.x, p.y - Player.HEAD - 16, this.combo > 1 ? `${word} x${this.combo}` : word, heavy ? '#ffd84a' : '#ffffff', heavy ? 2 : 1, 0.8);
  }

  /** The sparks, rings and clang of a perfect parry; `remote` is another player's parry seen from here. */
  parryFx(x: number, y: number, heavy: boolean, remote: boolean) {
    this.sfx('parry', x, remote ? 0.6 : 1);
    if (heavy) this.fx.ring(x, y, 100, '#ff3355', 0.45, 3);
    this.fx.ring(x, y, 44, '#ffffff', 0.25, 3);
    this.fx.ring(x, y, 70, '#b26bff', 0.4, 2);
    this.fx.burst(x, y, remote ? 12 : 22, { speed: 260, colors: ['#ffffff', '#e8dcff', '#ffd84a'], glow: true, life: 0.3, grav: 0, drag: 6, size: 1 });
    this.fx.light(x, y, 140, '#e8dcff', 1);
  }

  /** Perfect parry on a normal enemy: stagger it and land the counter-strike. (The parrying player's lunge
   *  plays on their own machine, in resolveHit.) */
  riposte(e: Enemy, dmg: number) {
    e.parried(this);
    const t = this.targetFor(e), d = e.dirTo(t.x, t.y);
    this.sfx('riposte', e.x);
    this.later(0.07, () => {
      if (e.dead) return;
      e.hurt(this, dmg, -d.dx, -d.dy, { crit: true, knock: 160, how: 'riposte' });
      this.fx.burst(e.x, e.y - 16, 10, { speed: 200, color: '#b26bff', glow: true, life: 0.25, grav: 0 });
    });
  }

  /** Perfect parry on the boss: posture instead of stagger. Heavy attacks are worth more. */
  deflect(e: Enemy, heavy = false) {
    if (e instanceof Boss) e.deflected(this, heavy ? 34 : 19);
    else e.parried(this);
  }

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
    if (how === 'riposte' && allies < 4 && this.authority) {
      const anim = (e as Ghoul).idleAnim ?? e.anim;
      this.later(0.45, () => {
        const s = new Shadow(anim, e.x, e.y, e.shadowAnim);
        s.id = ++this.nextId;
        this.enemies.push(s);
        this.fx.text(e.x, e.y - 48, 'ARISE', '#b26bff', 2, 1);
        this.fx.burst(e.x, e.y, 26, { speed: 30, colors: ['#5a2ccf', '#b26bff', '#1a0a40'], glow: true, grav: -140, vz: 90, life: 1, size: 2, drag: 1 });
        this.fx.ring(e.x, e.y, 30, '#7a3cff', 0.5, 2);
        this.sfx('arise', e.x);
      });
    }
  }

  // ------------------------------------------------------------------ update

  setPaused(p: boolean) {
    if (this.paused === p || (p && this.player.state === 'dead')) return;
    this.paused = p;
    this.audio.setPaused(p);
    this.input.events.length = 0;     // nothing pressed while paused fires on resume
    this.input.firing = false;
  }

  update(dt: number) {
    if (this.paused) {
      this.post.desat += (0.55 - this.post.desat) * Math.min(1, dt * 8);
      // solo: freeze. co-op: the world keeps going for everyone else; only our inputs stop
      if (!this.coop || !this.remotes.size) return;
      this.input.events.length = 0; this.input.firing = false; this.input.move = { x: 0, y: 0 };
    }
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
    for (const rp of this.remotes.values()) rp.simRemote(this, sdt);
    this.coop?.tick(dt);
    if (p.state === 'dead') {
      this.deadT += dt;
      // after the fall, the body burns away into shadow
      if (this.deadT > 1.1 && !p.dissolved) {
        p.dissolved = true;
        if (p.sprite) this.fx.dissolve(p.sprite.img, p.x, p.y, p.sprite.ax, p.sprite.ay, p.face < 0, { every: 1 });
        this.sfx('arise', p.x, 0.6);
      }
      if (this.deadT > 3.2) this.respawn();
    }

    for (const tm of this.timers) tm.t -= sdt;
    const due = this.timers.filter((tm) => tm.t <= 0);
    this.timers = this.timers.filter((tm) => tm.t > 0);
    for (const tm of due) tm.fn();

    // the host's AI cues (glints, telegraphs, roars, shakes) are mirrored to everyone else
    if (this.coop?.isHost) { this.mirroring = true; this.fx.emit = (op, args) => this.coop!.mirror(op, args); }
    for (const e of this.enemies) e.update(this, sdt);
    this.mirroring = false; this.fx.emit = null;
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
    const tx = p.x + lx - this.r.w / 2, ty = p.y - Player.CHEST + ly - this.r.h / 2;
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
    const base = Math.atan2(p.aimY - (p.y - Player.CHEST), p.aimX - p.x);
    let best: Enemy | null = null, bestScore = 0.3;
    for (const e of this.enemies) {
      if (e.ally || e.state === 'spawn') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > 320) continue;
      let da = Math.abs(Math.atan2(e.y - 16 - (p.y - Player.CHEST), e.x - p.x) - base);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < bestScore) { bestScore = da; best = e; }
    }
    if (best) { p.aimX = best.x; p.aimY = best.y - best.height() * 0.5; }
  }

  private separate() {
    const list = this.enemies;
    if (this.authority) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
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
        const d = Math.hypot(b.x - p.x, b.y - (p.y - Player.CHEST));
        if (d < b.r + p.r + 3) {
          const res = this.hitPlayer(b, b.dmg, { heavy: b.heavy, kind: 'bullet' });
          if (res === 'parried') this.reflect(b);
          else if (res !== 'dodged') { b.life = 0; if (b.nid) this.coop?.push({ t: 'bk', id: b.nid }); }
        }
      } else {
        for (const e of this.enemies) {
          if (b.cosmetic) break;
          if (e.ally || e.dead || e.state === 'spawn' || b.hits?.has(e)) continue;
          const z = e instanceof Boss ? e.z : 0;
          const ex = e.x, ey = e.y - e.height() * 0.45 - z, rr = e.r + b.r + (e.boss ? 10 : 2);
          if (Math.abs(b.x - ex) < rr && Math.abs(b.y - ey) < e.height() * 0.5 + b.r) {
            const l = Math.hypot(b.vx, b.vy) || 1;
            const knock = b.kind === 'big' ? 120 : 45;
            e.hurt(this, b.dmg, b.vx / l, b.vy / l, { knock });
            // on a co-op client that was instant feedback; the host owns the real hp
            if (!this.authority) this.coop!.push({ t: 'dmg', id: e.id, dmg: b.dmg, dx: b.vx / l, dy: b.vy / l, kn: knock });
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
  reflect(b: Bullet, broadcast = true) {
    this.sfx('reflect', b.x);
    const wasHeavy = b.heavy;
    b.team = 'player'; b.heavy = false; b.color = wasHeavy ? '#ffd84a' : '#e8dcff'; b.kind = 'big'; b.dmg = wasHeavy ? 60 : 28; b.pierce = wasHeavy ? 3 : 1; b.life = 1.5;
    b.hits = new Set();
    let tx = b.x - b.vx, ty = b.y - b.vy;
    if (b.source && !b.source.dead) { tx = b.source.x; ty = b.source.y - b.source.height() * 0.5; }
    const dx = tx - b.x, dy = ty - b.y, l = Math.hypot(dx, dy) || 1, sp = 380;
    b.vx = (dx / l) * sp; b.vy = (dy / l) * sp;
    if (this.authority && b.source instanceof Boss) b.source.addPosture(this, wasHeavy ? 10 : 4);
    if (broadcast && b.nid) this.coop?.push({ t: 'rf', id: b.nid, vx: Math.round(b.vx), vy: Math.round(b.vy), h: wasHeavy ? 1 : 0 });
  }

  private updateHazards(dt: number) {
    const p = this.player;
    for (const h of this.hazards) {
      h.r += h.speed * dt;
      if (!h.hit) {
        const d = Math.hypot(p.x - h.x, (p.y - h.y) / 0.62);
        if (Math.abs(d - h.r) < 4 + p.r * 0.5) {   // match the thin ring the player sees
          const res = this.hitPlayer(h, h.dmg, { heavy: true, kind: 'aoe' });
          // a parried shockwave is cut: it passes harmlessly from here on
          if (res === 'hit' || res === 'parried' || res === 'guarded') h.hit = true;
        }
      }
    }
    this.hazards = this.hazards.filter((h) => h.r < h.maxR);
  }

  private respawn() {
    const p = new Player(this.level.width / 2, this.level.height / 2 + 40);
    p.slot = this.player.slot;
    this.player = p;
    p.slot = this.player.slot;
    this.hazards = [];
    if (this.authority && !this.remotes.size) {
      this.bullets = [];
      this.enemies = this.enemies.filter((e) => e.boss);
      for (const e of this.enemies) if (e instanceof Boss) { e.hp = e.maxHp; e.phase = 1; e.posture = 0; e.setState('idle'); }
    }
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
    // world layers are (W+2)×(H+2): draw from one pixel up-left of the integer camera, the shader adds the fraction
    const camX = this.cam.x + sx, camY = this.cam.y + sy;
    const cx = Math.floor(camX) - 1, cy = Math.floor(camY) - 1;
    this.post.fracX = camX - Math.floor(camX); this.post.fracY = camY - Math.floor(camY);

    s.fillStyle = '#07060c'; s.fillRect(0, 0, W + 2, H + 2);
    gl.clearRect(0, 0, W + 2, H + 2);
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
    items.push({ y: p.y, draw: () => p.draw(this, s, gl, cx, cy, this.renderDt) });
    for (const rp of this.remotes.values()) items.push({ y: rp.y, draw: () => rp.draw(this, s, gl, cx, cy, this.renderDt) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    for (const e of this.enemies) e.drawGlow(this, gl, cx, cy);

    this.fx.drawParticles(s, gl, cx, cy);
    this.drawBullets(gl, cx, cy);
    this.drawHazards(gl, cx, cy);
    this.fx.drawGlow(gl, cx, cy);

    // lighting
    li.globalCompositeOperation = 'source-over';
    li.fillStyle = p.state === 'dead' ? '#26242e' : '#33313f'; li.fillRect(0, 0, W + 2, H + 2);
    li.globalCompositeOperation = 'lighter';
    const L = (x: number, y: number, r: number, color: string, a = 1) => {
      if (x + r < cx || x - r > cx + W + 2 || y + r < cy || y - r > cy + H + 2) return;
      li.globalAlpha = a; li.drawImage(lightSprite(color), Math.round(x - r - cx), Math.round(y - r - cy), r * 2, r * 2);
    };
    for (const l of this.level.lights) L(l.x, l.y, l.radius * (1 + Math.sin(this.time * 9 + l.x) * l.flicker * 0.3), l.color, 0.9);
    L(p.x, p.y - Player.CHEST, 140, '#7a6aa0', 0.75);
    L(p.x, p.y - Player.CHEST, 56, '#d8d0f0', 0.18);
    for (const e of this.enemies) if (e.state !== 'spawn') L(e.x, e.y - 8, e.boss ? 60 : 30, e.ally ? '#7a3cff' : '#ff3355', 0.22);
    for (const b of this.bullets) L(b.x, b.y, b.team === 'player' ? 22 : 18, b.team === 'player' ? '#9a5cff' : '#ff3355', 0.55);
    for (const l of this.fx.lights) L(l.x, l.y, l.r, l.color, l.a);
    this.fx.lights.length = 0;
    li.globalAlpha = 1;

    // world-space UI then HUD
    const ux = Math.round(camX), uy = Math.round(camY);
    this.fx.drawTexts(ui, ux, uy);
    if (this.showHitbox) this.drawHitboxes(ui, ux, uy);
    // co-op name tags in each player's trim color
    if (this.coop) {
      for (const pl of [this.player, ...this.remotes.values()]) {
        if (pl.dissolved) continue;
        const look = HERO_LOOKS[pl.slot], tag = pl === this.player ? 'YOU' : `P${pl.slot + 1}`;
        drawText(ui, tag, Math.round(pl.x - ux) - textWidth(tag) / 2, Math.round(pl.y - uy) - Player.HEAD - 10, look.trim);
      }
    }
    drawHud(this, ui);
    this.coop?.flush();

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
    c(p.x, p.y, p.r); c(p.x, p.y - Player.CHEST, p.r);
    for (const e of this.enemies) c(e.x, e.y, e.r);
    g.strokeStyle = '#ff8800';
    for (const b of this.bullets) c(b.x, b.y, b.r);
    if (p.state === 'parry') { g.fillStyle = p.t < PARRY_PERFECT ? '#ffffff' : '#888888'; g.fillRect(4, this.r.h - 10, 6, 6); }
  }
}
