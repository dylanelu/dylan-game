import type { Audio } from '../engine/audio';
import type { Input } from '../engine/input';
import type { PostParams, Renderer } from '../engine/renderer';
import type { Coop } from '../net/coop';
import { teamColor, type Mode } from '../net/lobby';
import { HERO_LOOKS, type Assets } from './assets';
import { Boss } from './boss';
import { isRosterBoss, ScriptedBoss } from './bossmoves';
import { isMob, Mob } from './mobs';
import { ArmoredTitan, ShadowKnight, Titan, Toji } from './bosses';
import { Brute, Caster, Enemy, Ghoul, Shadow, type EnemyKind } from './enemies';
import { Fx } from './fx';
import { drawText, textWidth } from './font';
import { ACTIVES, PASSIVES, RARITY, RELICS, rollLoot, xpToNext, type Item } from './items';
import { Night } from './night';
import { clearSave } from './save';
import { drawHud, hudHit } from './hud';
import { TILE, World } from './world';
import { PARRY_PERFECT, Player } from './player';
import { hitMods, strikeDist, weaponIcon, WeaponWorld, type StrikeOpts, type StrikeShape } from './weapons';

export type HitResult = 'hit' | 'parried' | 'guarded' | 'dodged' | 'ignored';

export interface Bullet {
  x: number; y: number; vx: number; vy: number; r: number; dmg: number;
  team: 'enemy' | 'player'; heavy: boolean; life: number; age: number;
  color: string; kind: 'orb' | 'dagger' | 'big' | 'arrow'; pierce: number;
  hits: Set<Enemy> | null; source: Enemy | null;
  knock?: number;        // knockback on hit (default by kind)
  nid?: number;          // network id for enemy bullets (co-op)
  cosmetic?: boolean;    // another player's shot: drawn, never deals damage to enemies here
  owner?: string;        // peer id of the player who fired it (unset: this machine's own shots, or enemies)
  pid?: number;          // the shooter's shot number, so a PvP target can say which shot it stopped
  pvp?: boolean;         // fired by someone on another team: it can hit this machine's player
}

/** A battle royale in progress: who's on which team (by peer id) and how it went for us. */
export interface Match {
  teams: Map<string, number>;
  nTeams: number;
  startT: number;
  /** our team is out (or won): placement 1 = winner */
  result: { won: boolean; place: number } | null;
  /** one team (or none) left: the match is over for everyone */
  over: boolean;
}

/** PvP damage scale: player weapons are tuned against monster hp; players have far less */
const PVP_DMG = 0.6;
/** a death within this long of a PvP hit credits that player (storm, monsters, falls...) */
const CREDIT_SEC = 6;

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
  level: World;
  night!: Night;
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
  deadT = 0;
  kills = 0;
  renderDt = 1 / 60;
  paused = false;
  private indoorK = 0;
  lastPoi: string | null = null;
  mapOpen = false;
  /** co-op session (null when playing solo) and the other players' characters */
  coop: Coop | null = null;
  remotes = new Map<string, Player>();
  /** the front end is up: the world is only a backdrop, nothing simulates */
  menu = true;
  mode: Mode = 'pve';
  match: Match | null = null;
  /** kill feed, newest last */
  feed: { a: string; ac: string; b: string; bc: string; t: number }[] = [];
  /** the last player to hurt us, for kill credit */
  lastHitBy: { id: string; t: number } | null = null;
  pvpKills = 0;
  /** battle royale: dead players watch a teammate */
  spectating: Player | null = null;
  /** a menu (pause, end of match) covers the game: the HUD keeps its corners and drops the middle */
  overlay = false;
  /** first solo run: a short controls card */
  tutorialT = 0;
  private shotSeq = 0;
  nextId = 0;
  private bulletSeq = 0;
  private mirroring = false;
  /** weapon / ability world state: thunder spears, domains, telekinesis, swing fx (weapons.ts) */
  wx: WeaponWorld;
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
    this.level = new World(A);
    this.fx = new Fx((x, y, c, n, sz) => this.level.splat(x, y, c, n, sz));
    this.night = new Night(this);
    this.wx = new WeaponWorld(this);
    const start = this.night.dropPoint();
    this.player = new Player(start.x, start.y);
    this.cam.x = this.player.x - r.w / 2; this.cam.y = this.player.y - r.h / 2;
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

  spawn(kind: EnemyKind, x?: number, y?: number, level?: number, elite = false) {
    const p = this.player;
    if (x === undefined || y === undefined) {
      // somewhere on open floor 130–260px from the player
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, d = 130 + Math.random() * 130;
        x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d;
        if (!this.level.solidAt(x, y) && !this.level.solidAt(x, y - 20)) break;
      }
    }
    const e = this.makeEnemy(kind, x!, y!, '', elite);
    e.id = ++this.nextId;
    // hidden level scales hp (damage scales in attack/enemyBullet)
    e.level = level ?? this.level.levelAt(x!, y!);
    const hpMul = (1 + 0.3 * (e.level - 1)) * (elite ? 5 : 1);
    e.hp = e.maxHp = Math.round(e.maxHp * hpMul);
    if (elite) { e.r = 22; e.heavy = 8; }
    this.level.collide(e, e.r);
    this.enemies.push(e);
    this.portal(e);
    return e;
  }

  makeEnemy(kind: EnemyKind, x: number, y: number, shadowAnim = '', elite = false): Enemy {
    if (kind === 'shadow') return new Shadow(this.A.anim(shadowAnim || 'masked_orc_idle_anim'), x, y, shadowAnim);
    switch (kind) {
      case 'ghoul': return new Ghoul(this, x, y);
      case 'caster': return new Caster(this, x, y);
      case 'brute': return new Brute(this, x, y, elite);
      case 'titan': return new Titan(this, x, y);
      case 'knight': return new ShadowKnight(this, x, y);
      case 'toji': return new Toji(this, x, y);
      case 'atitan': return new ArmoredTitan(this, x, y);
      case 'boss': return new Boss(this, x, y);
      default:
        if (isMob(kind)) return new Mob(this, x, y, kind);
        if (isRosterBoss(kind)) return new ScriptedBoss(this, x, y, kind);
        return new Boss(this, x, y);
    }
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
        this.spawn('boss');
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
    if (b.source) b.dmg = Math.round(b.dmg * b.source.dmgMul);
    this.bullets.push(b);
    if (this.coop?.isHost) this.coop.enemyBulletSpawned(b);
  }

  /** A shot from the local player: tell the others so they see it (and, in PvP, so a target can take it). */
  onShot(b: Bullet) {
    b.pid = ++this.shotSeq;
    this.coop?.push({ t: 'pb', id: b.pid, x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), r: b.r, c: b.color, k: b.kind, l: Math.round(b.life * 100) / 100, d: Math.round(b.dmg) });
  }

  /** Every living hunter in the night, local and remote. */
  allPlayers(): Player[] {
    const out: Player[] = this.player.state === 'dead' ? [] : [this.player];
    for (const p of this.remotes.values()) if (p.state !== 'dead' && !p.dissolved) out.push(p);
    return out;
  }

  /** Who an enemy goes after: the nearest living player it can see, local or remote. With every hunter dead or
   *  stealthed, the spot it last saw a stealthed one (a stand-in that never takes hits). */
  targetFor(e: { x: number; y: number }): Player {
    let best = this.player, bd = this.player.state === 'dead' || this.player.stealth > 0 ? Infinity : Math.hypot(this.player.x - e.x, this.player.y - e.y);
    for (const p of this.remotes.values()) {
      if (p.state === 'dead' || p.dissolved || p.stealth > 0) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < bd) { bd = d; best = p; }
    }
    return bd === Infinity ? this.wx.lost() ?? best : best;
  }

  /** An enemy attack landing on `target`. Local targets resolve now; remote ones resolve on their own machine,
   *  and a parry there calls `onParried` here a moment later. */
  attack(target: Player, src: { x: number; y: number }, dmg: number, o: { heavy?: boolean; kind: 'melee' | 'bullet' | 'aoe'; counter?: boolean; pvp?: boolean }, onParried?: () => void): HitResult | 'pending' {
    if (target === this.wx.decoy) return 'ignored';
    if (src instanceof Enemy) dmg = Math.round(dmg * src.dmgMul);
    if (target.peerId && this.coop) { this.coop.remoteAttack(target, src, dmg, o, onParried); return 'pending'; }
    const res = this.hitPlayer(src, dmg, o);
    if (res === 'parried') onParried?.();
    return res;
  }

  // ------------------------------------------------------------------ PvP (battle royale)

  /** Peer id for this machine ('' solo). */
  get selfId() { return this.coop?.selfId ?? ''; }
  /** Team of a player by peer id, as fixed at the start of the match. */
  teamOf(id: string) { return this.match?.teams.get(id) ?? 0; }
  /** Someone this machine's player may hurt (and be hurt by): battle royale, another team. */
  isFoeId(id: string) { return this.mode === 'br' && !!this.match && this.match.teams.has(id) && this.teamOf(id) !== this.player.team; }
  /** Other players this machine's player can hit right now. */
  pvpFoes(): Player[] {
    if (this.mode !== 'br') return [];
    return [...this.remotes.values()].filter((r) => r.peerId && this.isFoeId(r.peerId) && r.state !== 'dead' && !r.dissolved);
  }

  /** Melee hook (playerStrike calls this): hit every enemy player within `reach` of (x, y). Each hit is
   *  resolved on the victim's machine, so they can still parry or roll it; a parry staggers us. */
  strikePlayers(x: number, y: number, reach: number, dmg: number, o: { heavy?: boolean; counter?: boolean } = {}) {
    for (const foe of this.pvpFoes()) {
      if (Math.hypot(foe.x - x, foe.y - y) > reach + foe.r) continue;
      this.attack(foe, this.player, Math.round(dmg * PVP_DMG), { kind: 'melee', heavy: o.heavy, counter: o.counter, pvp: true }, () => this.strikeParried(foe));
    }
  }

  /** Our strike was perfect-parried on their machine: we reel. */
  private strikeParried(by: Player) {
    const p = this.player;
    if (p.state === 'dead') return;
    p.setState('recover'); p.play('hit');
    const dx = p.x - by.x, dy = p.y - by.y, l = Math.hypot(dx, dy) || 1;
    p.vx += (dx / l) * 160; p.vy += (dy / l) * 160;
    this.parryFx((p.x + by.x) / 2, (p.y + by.y) / 2 - 28, false, true);
    this.fx.text(p.x, p.y - Player.HEAD - 12, 'PARRIED', '#ff6680', 1, 0.6);
    this.shake(0.3); this.hitstop(0.06);
  }

  /** Victim's machine → us: our shot or strike landed. */
  pvpHitLanded(victimId: string, dmg: number, _down: boolean) {
    const v = this.remotes.get(victimId);
    if (!v) return;
    v.flash = 0.08;
    this.fx.text(v.x, v.y - Player.HEAD - 12, `-${dmg}`, '#ffd84a', 1, 0.6);
    this.sfx('hit', v.x, 0.7);
  }

  /** Someone else died (their machine says so): kill feed, credit, and maybe the end of a team. */
  remoteDied(id: string, by: string | null, how: string) {
    const v = this.remotes.get(id);
    if (v) { v.hp = 0; v.state = 'dead'; }
    const vName = this.coop?.net.nameOf(id) ?? '?';
    this.addFeed(by, vName, this.teamOf(id), how);
    if (by && by === this.selfId) {
      this.pvpKills++;
      this.fx.text(this.player.x, this.player.y - Player.HEAD - 20, `ELIMINATED ${vName}`, '#ffd84a', 1, 1.2);
      this.sfx('crit', this.player.x); this.flash('#ffd84a', 0.12);
      this.gainXp(120 + 30 * (v?.level ?? 1));
    }
  }

  private addFeed(by: string | null, victim: string, vTeam: number, how: string) {
    const name = (id: string) => id === this.selfId ? this.player.name : this.coop?.net.nameOf(id) ?? '?';
    const a = by ? name(by) : how === 'storm' ? 'STORM' : how === 'left' ? '' : 'MONSTERS';
    this.feed.push({ a, ac: by ? this.colorOf(by) : '#b26bff', b: victim, bc: this.mode === 'br' ? teamColor(vTeam) : '#e8e4f0', t: 0 });
    if (this.feed.length > 5) this.feed.shift();
  }

  /** Name tag / minimap color: the team color in battle royale, the hero's trim in PvE. */
  colorOf(id: string) {
    if (this.mode === 'br') return teamColor(this.teamOf(id));
    const look = id === this.selfId ? this.player.slot : this.coop?.net.lookOf(id) ?? 0;
    return HERO_LOOKS[look].trim;
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
    // MIKIRI COUNTER: a roll into a thrust or heavy swing steps on it, and counts as a perfect parry
    if (p.state === 'roll' && o.kind === 'melee' && (o.heavy || o.counter) && p.relics.includes('mikiri') && this.wx.mikiri(src)) return 'parried';
    if (p.iframes > 0) {
      if (o.kind !== 'bullet') this.fx.text(p.x, p.y - Player.HEAD - 12, 'DODGE', '#9ad0ff', 1, 0.5);
      return 'dodged';
    }
    if (p.invuln > 0) return 'ignored';
    // co-op: an attack resolved here for a host-side enemy arrives late (snapshot + network delay), so the
    // perfect window stretches by that lag; the player reacted to what they saw, which was behind the host
    const phase = p.state === 'parry' ? (p.t < p.perfectWindow + (o.lag ?? 0) ? 'perfect' : 'guard') : null;
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
    const how = this.lastHitBy && this.time - this.lastHitBy.t < 0.5 ? 'pvp' : 'monster';
    if (guarded) { if (p.hp <= 0) this.killPlayer(how); return; }
    const dx = p.x - src.x, dy = p.y - src.y, l = Math.hypot(dx, dy) || 1;
    p.vx += (dx / l) * 220; p.vy += (dy / l) * 220;
    p.invuln = 0.7; p.flash = 0.1;
    p.play('hit');
    if (p.state === 'parry' || p.state === 'recover') p.setState('normal');
    this.sfx('hurt', p.x); this.audio.muffleFor(0.25, 1400);
    this.hitstop(0.08); this.shake(0.5); this.chroma(1.2); this.flash('#ff1133', 0.22);
    this.fx.burst(p.x, p.y - Player.CHEST, 14, { speed: 150, colors: ['#8e1b2e', '#5a0f1e'], size: 2, life: 0.6, decal: '#2a0610' });
    this.fx.text(p.x, p.y - Player.HEAD - 12, `-${dmg}`, '#ff4a6a', 1, 0.7);
    if (p.hp <= 0) this.killPlayer(how);
  }

  private perfectParry(x: number, y: number, kind: string, heavy = false) {
    const p = this.player;
    p.parryFlash = 0.12;
    p.parryAngle = Math.atan2(y - (p.y - Player.CHEST), x - p.x);
    p.setState('normal');
    p.mana = Math.min(p.maxMana, p.mana + 35);
    p.empowered = Math.min(6, p.empowered + 3);
    this.combo++; this.comboT = 3;
    this.wx.onPerfectParry();
    this.audio.muffleFor(0.3, 900); this.audio.duck(0.35, 0.5);
    this.hitstop(heavy ? 0.15 : kind === 'bullet' ? 0.05 : 0.1);
    this.slowmo(heavy ? 0.45 : 0.28, heavy ? 0.25 : 0.35);
    this.shake(heavy ? 0.55 : 0.3); this.chroma(heavy ? 2.2 : 1.6); this.flash(heavy ? '#ffd8e0' : '#ffffff', heavy ? 0.32 : 0.22); this.zoomPunch(heavy ? 0.06 : 0.035);
    if (heavy) p.empowered = Math.min(8, p.empowered + 2);
    const heal = Math.round(8 * p.has('vampire'));
    if (heal) { p.hp = Math.min(p.maxHp, p.hp + heal); this.fx.text(p.x + 10, p.y - Player.HEAD, `+${heal}`, '#6aff9a', 1, 0.6); }
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

  // ------------------------------------------------------------------ progression

  /** The storm doesn't knock you around; it just eats at you. */
  stormHurt(dmg: number) {
    const p = this.player;
    if (p.state === 'dead' || this.god) return;
    p.hp -= dmg; p.flash = 0.06;
    this.fx.text(p.x, p.y - Player.HEAD - 12, `-${dmg}`, '#b26bff', 1, 0.6);
    this.post.chroma = Math.max(this.post.chroma, 0.5);
    this.sfx('hurt', p.x, 0.4);
    if (p.hp <= 0) this.killPlayer('storm');
  }

  private killPlayer(how = '') {
    const p = this.player;
    p.hp = 0; p.setState('dead'); this.deadT = 0;
    this.slowmo(1.2, 0.25); this.banner(this.mode === 'br' ? 'ELIMINATED' : 'DEFEATED', '#ff3355', 3);
    this.sfx('playerDeath', p.x); this.audio.muffleFor(2.5, 400); this.audio.setMusic(null);
    // everyone hears who fell and to whom: kill feed, credit, eliminations
    const by = this.lastHitBy && this.time - this.lastHitBy.t < CREDIT_SEC ? this.lastHitBy.id : null;
    this.coop?.push({ t: 'die', by, how });
    if (this.coop) this.addFeed(by, p.name, p.team, how);
  }

  /** The gate opened: anyone outside the final circle is pulled in through the shadows. */
  gatePull() {
    const p = this.player, n = this.night;
    if (p.state === 'dead' || Math.hypot(p.x - n.cx, p.y - n.cy) < n.stormAt(n.t + 60) - 40) return;
    this.fx.dissolve(p.sprite?.img ?? this.A.heroes[p.slot].idle.normal[0], p.x, p.y, p.sprite?.ax ?? 16, p.sprite?.ay ?? 56, p.face < 0, { every: 2 });
    const a = Math.random() * Math.PI * 2;
    p.x = n.cx + Math.cos(a) * 140; p.y = n.cy + 80 + Math.sin(a) * 60;
    this.level.collide(p, p.r);
    this.cam.x = p.x - this.r.w / 2; this.cam.y = p.y - this.r.h / 2;
    this.fx.burst(p.x, p.y, 30, { speed: 40, colors: ['#5a2ccf', '#b26bff'], glow: true, grav: -120, vz: 80, life: 1, size: 2 });
    this.sfx('arise', p.x);
  }

  gainXp(n: number) {
    const p = this.player;
    if (p.state === 'dead') return;
    p.xp += n;
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      p.maxHp += 12; p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.4));
      this.banner(`LEVEL ${p.level}`, '#ffd84a', 1.6);
      this.audio.jingle('levelUp', 0.7); this.flash('#ffd84a', 0.15);
      this.fx.ring(p.x, p.y, 50, '#ffd84a', 0.6, 3);
      this.fx.burst(p.x, p.y, 40, { speed: 30, colors: ['#ffd84a', '#fff2b0', '#ffffff'], glow: true, grav: -200, vz: 140, life: 1.1, size: 1, drag: 1 });
    }
  }

  /** Walk over loot: weapons swap (the old one drops), passives stack, flasks heal. */
  pickup(it: Item) {
    const p = this.player;
    const color = it.kind === 'flask' ? '#ff6a7a' : RARITY[it.rarity].color;
    this.toast(Night.label(it), color);
    this.sfx('select', p.x); this.sfx('reflect', p.x, 0.4);
    this.fx.burst(p.x, p.y - Player.CHEST, 14, { speed: 80, color, glow: true, life: 0.5, grav: -60 });
    if (it.kind === 'flask') { p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.35)); return; }
    if (it.kind === 'active') {
      if (p.actives.includes(it.key)) { this.gainXp(60); return; }
      const slot = p.actives.indexOf(null);
      if (slot >= 0) p.actives[slot] = it.key;
      else { this.night.spill([{ kind: 'active', key: p.actives[1]!, rarity: 3 }], p.x + 14, p.y); p.actives[1] = it.key; }
      this.banner(`${ACTIVES[it.key].name}  ${this.input.device === 'touch' ? 'TAP' : slot === 0 || slot < 0 ? 'Q' : 'E'}`, ACTIVES[it.key].color, 2.4);
      return;
    }
    if (it.kind === 'relic') {
      if (!p.relics.includes(it.key)) p.relics.push(it.key);
      this.banner(`${RELICS[it.key].name}: ${RELICS[it.key].desc}`, RELICS[it.key].color, 2.6);
      return;
    }
    if (it.kind === 'weapon') {
      if (p.weapon.key !== 'dagger') this.night.spill([{ kind: 'weapon', key: p.weapon.key, rarity: p.weapon.rarity }], p.x + 14, p.y);
      p.weapon = { key: it.key, rarity: it.rarity };
      return;
    }
    if (p.passives.length >= 6) { this.gainXp(40); return; }
    p.passives.push({ key: it.key, rarity: it.rarity });
    if (it.key === 'iron') { const add = Math.round(30 * RARITY[it.rarity].mul); p.maxHp += add; p.hp += add; }
  }
  toastText = ''; toastColor = '#fff'; toastT = 9;
  toast(text: string, color: string) { this.toastText = text; this.toastColor = color; this.toastT = 0; }

  // ------------------------------------------------------------------ items

  /** Use the item in a slot. Aim: a drag from its button, else the cursor, else the nearest foe ahead. */
  useItem(slot: number, dx: number, dy: number, dragged: boolean) {
    const p = this.player, key = p.actives[slot];
    if (p.state === 'dead' || p.state === 'grapple') return;
    if (!key) { this.toast('EMPTY SLOT', '#8a7ab8'); return; }
    const def = ACTIVES[key];
    if ((p.cooldowns[key] ?? 0) > 0) { this.sfx('whiff', p.x, 0.6); return; }
    // the domain spends its own charge, not mana
    if (key === 'domain' && p.domainCharge < 1) { this.fx.text(p.x, p.y - Player.HEAD - 10, 'NOT READY', '#8a7ab8', 1, 0.5); this.sfx('whiff', p.x, 0.6); return; }
    const cost = p.boundless ? 0 : def.cost;
    if (p.mana < cost) { this.fx.text(p.x, p.y - Player.HEAD - 10, 'NO MANA', '#8a7ab8', 1, 0.5); this.sfx('whiff', p.x, 0.6); return; }
    let ax: number, ay: number;
    if (dragged) { const l = Math.hypot(dx, dy) || 1; ax = dx / l; ay = dy / l; }
    else if (this.input.device === 'mouse') { const l = Math.hypot(p.aimX - p.x, p.aimY - (p.y - Player.CHEST)) || 1; ax = (p.aimX - p.x) / l; ay = (p.aimY - (p.y - Player.CHEST)) / l; }
    else {
      const foe = this.enemies.filter((e) => !e.ally && !e.dead && e.state !== 'spawn').sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (foe && Math.hypot(foe.x - p.x, foe.y - p.y) < 300) { const l = Math.hypot(foe.x - p.x, foe.y - p.y) || 1; ax = (foe.x - p.x) / l; ay = (foe.y - p.y) / l; }
      else { const l = Math.hypot(p.vx, p.vy); ax = l > 10 ? p.vx / l : p.face; ay = l > 10 ? p.vy / l : 0; }
    }
    p.mana -= cost; p.manaDelay = 0.5;
    p.cooldowns[key] = def.cooldown;
    if (key === 'summon') this.summon();
    else if (key === 'grapple') this.fireHook(ax, ay);
    else this.wx.useActive(key, slot, ax, ay, dragged);
  }

  /** Shadow Summon: two shadow soldiers rise beside you and fight for a while. In co-op the host raises them. */
  summon() {
    const p = this.player;
    this.fx.ring(p.x, p.y, 60, '#7a3cff', 0.6, 3);
    this.fx.burst(p.x, p.y, 30, { speed: 40, colors: ['#5a2ccf', '#b26bff', '#1a0a40'], glow: true, grav: -140, vz: 90, life: 1, size: 2, drag: 1 });
    this.fx.text(p.x, p.y - Player.HEAD - 14, 'ARISE', '#b26bff', 2, 1);
    this.sfx('arise', p.x);
    if (this.authority) this.raiseShadows(p.x, p.y, null);
    else this.coop!.push({ t: 'summon', x: Math.round(p.x), y: Math.round(p.y) });
  }

  /** Host: two summoned shadows near (x, y), following `owner` (a peer id, or null for this machine's player). */
  raiseShadows(x: number, y: number, owner: string | null) {
    const kinds = ['masked_orc_idle_anim', 'ogre_idle_anim'];
    kinds.forEach((anim, i) => {
      const a = (i / kinds.length) * Math.PI * 2 + Math.random();
      const s = new Shadow(this.A.anim(anim), x + Math.cos(a) * 30, y + Math.sin(a) * 16, anim);
      s.id = ++this.nextId; s.owner = owner; s.life = 16;
      this.level.collide(s, s.r);
      this.enemies.push(s);
    });
  }

  /** The boss this player is fighting: the closest one awake and within a screen or so. Area bosses elsewhere
   *  on the map don't steal the camera or the boss bar. */
  get nearBoss(): Boss | undefined {
    const p = this.player;
    let best: Boss | undefined, bd = 460;
    for (const e of this.enemies) {
      if (!(e instanceof Boss) || e.dead || e.state === 'spawn') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** The player a shadow soldier follows. */
  ownerOf(owner: string | null): Player { return (owner && this.remotes.get(owner)) || this.player; }

  private fireHook(ax: number, ay: number) {
    const p = this.player, b = p.blade();
    p.hook = { x: b.gx, y: b.gy, vx: ax * 950, vy: ay * 950, phase: 'fly', ax: 0, ay: 0, target: null, t: 0, dist: 0 };
    p.face = Math.sign(ax) || p.face;
    this.sfx('swish', p.x); this.sfx('draw', p.x, 0.6);
  }

  /** Hook flight, latching, the reel-in and the strike on arrival. Local to this machine's player. */
  private updateHook(dt: number) {
    const p = this.player, h = p.hook;
    if (!h) return;
    h.t += dt;
    if (h.phase === 'fly') {
      h.x += h.vx * dt; h.y += h.vy * dt; h.dist += Math.hypot(h.vx, h.vy) * dt;
      const foe = this.enemies.find((e) => !e.ally && !e.dead && e.state !== 'spawn' && Math.abs(h.x - e.x) < e.r + 10 && Math.abs(h.y - (e.y - e.height() * 0.5)) < e.height() * 0.5);
      if (foe) { h.phase = 'pull'; h.target = foe; h.t = 0; }
      else if (this.level.anchorAt(h.x, h.y + Player.CHEST)) { h.phase = 'pull'; h.ax = h.x; h.ay = h.y + Player.CHEST; h.t = 0; }
      else if (h.dist > 320) { h.phase = 'back'; }
      if (h.phase === 'pull') {
        p.setState('grapple');
        this.sfx('metal', h.x, 0.5);
        this.fx.burst(h.x, h.y, 6, { speed: 80, color: '#ffd88a', glow: true, life: 0.25, grav: 0 });
      }
    } else if (h.phase === 'pull') {
      const tx = h.target ? h.target.x : h.ax, ty = h.target ? h.target.y : h.ay;
      if (h.target) { h.x = tx; h.y = ty - 20; }
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
      p.vx = (dx / d) * 620; p.vy = (dy / d) * 620; p.iframes = Math.max(p.iframes, 0.1);
      if (Math.random() < 0.6) this.fx.after(this.A.heroes[p.slot].run.shadow[1], p.x, p.y, p.face < 0, 16, 56, 0.18);
      const stuck = h.t > 0.12 && Math.hypot(p.vx * dt, p.vy * dt) > 0 && this.level.collide({ x: p.x + p.vx * dt, y: p.y + p.vy * dt }, p.r) && d > 30;
      // big foes are wide and shove back, so "arrived" means touching their body, not their feet
      const reach = h.target ? h.target.r + 22 : 20;
      if (d < reach || h.t > 0.9 || h.target?.dead || stuck) {
        const target = h.target;
        p.hook = null; p.setState('normal'); p.vx *= 0.25; p.vy *= 0.25; p.punch(3);
        if (target && !target.dead && d < reach + 30) this.hookStrike(target as Enemy);
        else { this.sfx('step', p.x); this.fx.burst(p.x, p.y, 8, { speed: 50, colors: ['#3a3155', '#2a2340'], size: 2, life: 0.4, z: 1, vz: 10, grav: 40 }); }
      }
    } else {
      const b = p.blade(), dx = b.gx - h.x, dy = b.gy - h.y, d = Math.hypot(dx, dy);
      if (d < 20) { p.hook = null; return; }
      h.x += (dx / d) * 1200 * dt; h.y += (dy / d) * 1200 * dt;
    }
  }

  /** Arriving at the end of the rope: a spinning cut. Titans take it on the nape. */
  private hookStrike(e: Enemy) {
    const p = this.player, titan = e.kind === 'titan' || e.kind === 'atitan' || e.kind === 'femaletitan';
    const dmg = 30 * p.dmgMul * (titan ? 3 : 1), dx = Math.sign(e.x - p.x) || 1;
    this.damageEnemy(e, dmg, dx, 0, { crit: true, knock: 120, how: titan ? 'nape' : 'riposte' });
    p.play('riposte'); p.parryAngle = Math.atan2(e.y - 20 - p.y, e.x - p.x);
    this.hitstop(0.08); this.shake(0.35); this.chroma(1.2);
    this.fx.ring(e.x, e.y - 20, 50, '#ffd88a', 0.3, 3);
    if (titan) this.fx.text(e.x, e.y - e.height() - 10, 'NAPE!', '#ffd84a', 2, 0.8);
    this.sfx('riposte', e.x);
  }

  /** Damage from this machine's player. The host applies it; a co-op client shows it now and reports it. */
  damageEnemy(e: Enemy, dmg: number, dx: number, dy: number, opts: { crit?: boolean; knock?: number; how?: string; pierce?: boolean } = {}) {
    e.hurt(this, dmg, dx, dy, opts);
    if (!this.authority) this.coop!.push({ t: 'dmg', id: e.id, dmg, dx, dy, kn: opts.knock ?? 60, how: opts.how, c: opts.crit ? 1 : 0, p: opts.pierce ? 1 : 0 });
  }

  /** Every melee / blast hit from this machine's player resolves here: whatever the shape touches takes the hit
   *  through damageEnemy (so a co-op client reports it), and `cutBullets` slices enemy bullets it touches.
   *  Returns what was hit, for the attack's own juice. Target finding lives only here (PvP extends it). */
  playerStrike(s: StrikeShape, dmg: number, o: StrikeOpts = {}): Enemy[] {
    const p = this.player, hit: Enemy[] = [];
    for (const e of this.enemies) {
      if (e.ally || e.dead || e.state === 'spawn') continue;
      const z = e instanceof Boss ? e.z : 0, d = strikeDist(s, e.x, e.y - e.height() - z, e.y - z, e.r + 3);
      if (d < 0) continue;
      let dx = s.k === 'line' ? Math.cos(s.a) : e.x - s.x, dy = s.k === 'line' ? Math.sin(s.a) : e.y - z - e.height() * 0.5 - s.y;
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      let knock = o.knock ?? 60;
      if (o.tip !== undefined && d >= o.tip && e.heavy < 3) { dx = -dx; dy = -dy; knock = o.pull ?? 300; }   // dragged in
      const titan = o.titan && (e.kind === 'titan' || e.kind === 'atitan' || e.kind === 'femaletitan') ? o.titan : 1;
      const m = hitMods(this, e, dmg * titan * (e.state === 'stunned' ? p.critMul : 1), !!o.crit);
      this.damageEnemy(e, m.dmg, dx, dy, { crit: m.crit, knock, how: o.how, pierce: o.pierce });
      hit.push(e);
    }
    if (o.cutBullets) for (const b of this.bullets) if (b.team === 'enemy' && b.life > 0 && strikeDist(s, b.x, b.y, b.y, b.r) >= 0) this.wx.cutBullet(b);
    // PvP: the same swing catches hunters of other teams; each judges it on their own machine, so they can parry
    for (const foe of this.pvpFoes()) {
      if (strikeDist(s, foe.x, foe.y - Player.HEAD, foe.y, foe.r + 3) < 0) continue;
      this.attack(foe, p, Math.round(dmg * PVP_DMG), { kind: 'melee', heavy: !!o.crit, pvp: true }, () => this.strikeParried(foe));
    }
    return hit;
  }

  /** XP an enemy is worth when it dies near you. */
  private xpFor(e: Enemy) {
    const base = e instanceof Boss ? (e.final ? 400 : 220) : e instanceof Mob ? e.def.xp * (e.small ? 0.5 : 1) : e.kind === 'titan' ? 45 : e.elite ? 140 : e.kind === 'brute' ? 22 : e.kind === 'caster' ? 9 : e.kind === 'ghoul' ? 7 : 0;
    return Math.round(base * 1.6 * (1 + 0.2 * (e.level - 1)));
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
    this.wx.onKill(e);
    // every machine: XP if you were nearby, and your own loot roll
    const p = this.player;
    if (!e.ally && Math.hypot(p.x - e.x, p.y - e.y) < 700) this.gainXp(this.xpFor(e));
    if (e instanceof Boss && !e.final) {
      // an area boss: its unique reward goes straight to every hunter in the night, wherever they are (every
      // machine runs this kill for its own player); the usual loot still spills where it fell
      this.night.spill(rollLoot('miniboss'), e.x, e.y);
      this.banner(`${e.name} FALLS`, '#ffd84a', 2);
      const reward = e.reward;
      if (reward) this.later(1.6, () => this.pickup(reward));
      this.slowmo(0.8, 0.3); this.flash('#ffffff', 0.3); this.shake(0.6);
      return;
    }
    if (!e.ally && (e.elite || e.boss || e.kind === 'brute' || e.kind === 'titan')) this.night.spill(rollLoot(e.boss ? 'boss' : e.elite ? 'miniboss' : 'elite'), e.x, e.y);
    if (e.boss) {
      this.night.ended = 'won'; this.night.endT = 0;
      this.slowmo(2, 0.2); this.flash('#ffffff', 0.5); this.shake(1); this.chroma(2);
      this.banner('GATE CLEARED', '#ffd84a', 3.5);
      this.sfx('break', e.x); this.audio.setMusic(null);
      this.later(1.2, () => this.audio.jingle('victory'));
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
    const pact = this.player.has('pact');
    if ((how === 'riposte' || how === 'nape' || (pact && Math.random() < 0.15 * pact)) && allies < 4 && this.authority && !e.ally) {
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
    if (this.menu) { this.updateBackdrop(dt); return; }
    if (this.paused) {
      this.post.desat += (0.55 - this.post.desat) * Math.min(1, dt * 8);
      // solo: freeze. co-op: the world keeps going for everyone else; only our inputs stop
      if (!this.coop) return;
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
    this.bannerT += dt; this.tutorialT -= dt;
    this.post.lowHp = p.hp / p.maxHp < 0.3 && p.state !== 'dead' ? 0.35 + 0.25 * Math.sin(this.time * 6) : 0;
    this.post.desat += ((p.state === 'dead' ? 0.8 : 0) - this.post.desat) * Math.min(1, dt * 3);

    if (this.stop > 0) { this.stop -= dt; return; }

    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = this.slowScale; }
    else { this.slowScale = 1; this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 8); }
    const sdt = dt * this.timeScale;

    // input
    for (const ev of this.input.events.splice(0)) {
      if (ev.type === 'item') { this.useItem(ev.slot, ev.dx, ev.dy, ev.dragged); continue; }
      if (ev.type === 'parry') p.tryParry(this);
      else if (ev.type === 'roll') p.tryRoll(this, ev.dx, ev.dy);
      else if (ev.type === 'key') {
        if (ev.key === 'KeyM') this.mapOpen = !this.mapOpen;
        const map: Record<string, string> = { Digit1: 'ghoul', Digit2: 'caster', Digit3: 'brute', Digit4: 'boss', Digit5: 'wave', Digit0: 'clear', KeyG: 'god', KeyH: 'hitbox' };
        if (map[ev.key]) this.sandbox(map[ev.key]);
      }
    }
    // aim in world space, with a little magnetism on touch
    const a = this.input.aim;
    p.aimX = a.x + this.cam.x; p.aimY = a.y + this.cam.y;
    if (this.input.device === 'touch' && this.input.firing) this.aimAssist();

    // early in a touch roll, keep turning it toward the whole swipe (see Input.rollSwipe)
    const sw = this.input.rollSwipe;
    if (sw && p.state === 'roll' && p.t < 0.12) { const l = Math.hypot(sw.dx, sw.dy) || 1; p.rollDx = sw.dx / l; p.rollDy = sw.dy / l; }
    else if (p.state !== 'roll') this.input.rollSwipe = null;
    p.update(this, sdt);
    this.updateHook(sdt);
    this.wx.update(sdt);
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
      if (this.mode === 'br') {
        // battle royale: no coming back; watch a teammate (or whoever's still standing)
        if (this.deadT > 2.5 && (!this.spectating || this.spectating.state === 'dead' || this.spectating.dissolved || !this.remotes.has(this.spectating.peerId!))) this.spectating = this.spectateTarget();
      } else if (this.deadT > 3.2 && !this.night.ended) {
        // solo: the night is lost. co-op: come back beside a teammate, unless everyone is down
        const mates = [...this.remotes.values()].some((r) => r.state !== 'dead' && !r.dissolved);
        if (mates) this.respawn();
        else if (!this.coop && this.night.revives > 0) { this.night.revives--; this.respawn(); this.banner('REVIVED  LAST CHANCE', '#ff6680', 2.2); }
        else { this.night.ended = 'lost'; this.night.endT = 0; this.audio.jingle('defeat'); }
      }
    }

    for (const tm of this.timers) tm.t -= sdt;
    const due = this.timers.filter((tm) => tm.t <= 0);
    this.timers = this.timers.filter((tm) => tm.t > 0);
    for (const tm of due) tm.fn();

    // the host's AI cues (glints, telegraphs, roars, shakes) are mirrored to everyone else
    if (this.coop?.isHost) { this.mirroring = true; this.fx.emit = (op, args) => this.coop!.mirror(op, args); }
    for (const e of this.enemies) e.update(this, sdt * this.wx.timeFor(e));   // a domain all but stops them
    this.night.update(sdt);
    this.mirroring = false; this.fx.emit = null;
    this.toastT += dt;
    // Fortnite-style place names as you cross into them
    const here = this.level.poiAt(p.x, p.y)?.name ?? null;
    if (here !== this.lastPoi) { if (here && p.state !== 'dead') this.banner(here, this.level.pois.find((q) => q.name === here)!.color, 1.8); this.lastPoi = here; }
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
    for (const f of this.feed) f.t += dt;
    this.feed = this.feed.filter((f) => f.t < 6);
    if (this.mode === 'br') this.checkMatch();

    // camera: follow with a lead toward the aim, critically damped feel
    if (this.spectating && p.state === 'dead') { this.follow(this.spectating, dt); return; }
    const lead = this.input.device === 'mouse' ? 0.22 : 0;
    let lx = (p.aimX - p.x) * lead, ly = (p.aimY - p.y) * lead;
    const ll = Math.hypot(lx, ly); if (ll > 60) { lx *= 60 / ll; ly *= 60 / ll; }
    if (this.input.device === 'touch') { lx = p.vx * 0.18; ly = p.vy * 0.18; }
    // boss fights: pull the camera toward the boss so both stay framed
    const boss = this.nearBoss;
    if (boss) {
      const bx = boss.x - p.x, by = boss.y - 40 - p.y, bd = Math.hypot(bx, by);
      const w = Math.max(0, Math.min(0.45, (bd - 40) / 400));
      lx = lx * 0.5 + bx * w; ly = ly * 0.5 + by * w;
    }
    this.follow(p, dt, lx, ly);
  }

  /** Ease the camera onto a player (plus a lead), clamped to the map. */
  private follow(p: Player, dt: number, lx = 0, ly = 0) {
    const tx = p.x + lx - this.r.w / 2, ty = p.y - Player.CHEST + ly - this.r.h / 2;
    const k = 1 - Math.exp(-dt * 7);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    const L = this.level;
    // clamp to the arena, or center it when the screen is bigger than the arena on that axis
    this.cam.x = Math.max(-40, Math.min(L.width - this.r.w + 40, this.cam.x));
    this.cam.y = Math.max(-40, Math.min(L.height - this.r.h + 40, this.cam.y));
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
      if (this.level.blocks(b.x, b.y + Player.CHEST)) {
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
      } else if (b.pvp) {
        // an enemy player's shot: this machine judges whether it hits us, so our parry / roll timing is exact
        if (p.state === 'dead' || b.life <= 0) continue;
        if (Math.hypot(b.x - p.x, b.y - (p.y - Player.CHEST)) < b.r + p.r + 3) {
          this.lastHitBy = { id: b.owner!, t: this.time };
          const dmg = Math.max(1, Math.round(b.dmg * PVP_DMG));
          const res = this.hitPlayer(b, dmg, { kind: 'bullet', heavy: b.kind === 'big' && b.dmg >= 40 });
          if (res === 'parried') this.reflectPvp(b);
          else if (res !== 'dodged' && res !== 'ignored') {
            b.life = 0;
            this.coop?.push({ t: 'pbk', o: b.owner, id: b.pid });
            this.coop?.sendTo(b.owner!, { t: 'ph', d: dmg, p: p.hp <= 0 ? 1 : 0 });
          }
        }
      } else {
        // our own shots stop on an enemy player (they judge the hit; this is just what it looks like here)
        if (!b.cosmetic && this.mode === 'br') {
          const foe = this.pvpFoes().find((f) => f.iframes <= 0 && Math.hypot(b.x - f.x, b.y - (f.y - Player.CHEST)) < b.r + f.r + 3);
          if (foe) {
            b.life = 0;
            this.fx.burst(b.x, b.y, 5, { speed: 90, color: b.color, glow: true, life: 0.2, grav: 0 });
            continue;
          }
        }
        for (const e of this.enemies) {
          if (b.cosmetic) break;
          if (e.ally || e.dead || e.state === 'spawn' || b.hits?.has(e)) continue;
          const z = e instanceof Boss ? e.z : 0;
          const ex = e.x, ey = e.y - e.height() * 0.45 - z, rr = e.r + b.r + (e.boss ? 10 : 2);
          if (Math.abs(b.x - ex) < rr && Math.abs(b.y - ey) < e.height() * 0.5 + b.r) {
            const l = Math.hypot(b.vx, b.vy) || 1;
            const knock = b.knock ?? (b.kind === 'big' ? 120 : 45);
            const m = hitMods(this, e, e.state === 'stunned' ? b.dmg * p.critMul : b.dmg, false), dmg = m.dmg, crit = m.crit;
            e.hurt(this, dmg, b.vx / l, b.vy / l, { knock, crit });
            // on a co-op client that was instant feedback; the host owns the real hp
            if (!this.authority) this.coop!.push({ t: 'dmg', id: e.id, dmg, dx: b.vx / l, dy: b.vy / l, kn: knock, c: crit ? 1 : 0 });
            this.hitstop(b.kind === 'big' || knock > 200 ? 0.035 : 0.012);
            b.hits?.add(e);
            if (b.pierce-- <= 0) { b.life = 0; break; }
          }
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  /** A parried PvP shot: it's ours now, empowered, flying back at whoever fired it. Everyone sees the original
   *  stop and a new shot of ours leave, so the shooter can parry it right back. */
  private reflectPvp(b: Bullet) {
    const shooter = this.remotes.get(b.owner!);
    this.coop?.push({ t: 'pbk', o: b.owner, id: b.pid });
    b.life = 0;
    const tx = shooter ? shooter.x : b.x - b.vx, ty = shooter ? shooter.y - Player.CHEST : b.y - b.vy;
    const dx = tx - b.x, dy = ty - b.y, l = Math.hypot(dx, dy) || 1, sp = 380;
    const r: Bullet = {
      x: b.x, y: b.y, vx: (dx / l) * sp, vy: (dy / l) * sp, r: 5, dmg: Math.max(28, b.dmg * 1.5), team: 'player', heavy: false,
      life: 1.5, age: 0, color: '#e8dcff', kind: 'big', pierce: 1, hits: new Set(), source: null,
    };
    this.bullets.push(r);
    this.onShot(r);
    this.sfx('reflect', b.x);
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

  /** A fresh night: new storm, new mini-boss arenas, everyone back to level 1 at a new drop point.
   *  In co-op the host decides the drop point and tells everyone. */
  restartNight(drop?: { x: number; y: number }) {
    clearSave();
    this.night = new Night(this);
    this.enemies = []; this.bullets = []; this.hazards = []; this.timers = [];
    this.wx.reset();
    const at = drop ?? this.night.dropPoint();
    const old = this.player;
    this.player = new Player(at.x + (Math.random() - 0.5) * 30, at.y + (Math.random() - 0.5) * 20);
    this.player.slot = old.slot; this.player.name = old.name; this.player.team = old.team;
    this.level.collide(this.player, this.player.r);
    this.cam.x = this.player.x - this.r.w / 2; this.cam.y = this.player.y - this.r.h / 2;
    this.post.desat = 0; this.kills = 0; this.pvpKills = 0; this.deadT = 0;
    this.spectating = null; this.lastHitBy = null; this.feed = []; this.mapOpen = false;
    this.bannerDur = 0; this.toastT = 9; this.lastPoi = null;
  }

  /** A match begins (solo, or the host's START): fresh night, fresh hunter, at our team's drop point.
   *  `teams`: peer id -> team (empty solo). `drop` null: a night already under way, regroup with the host. */
  startMatch(mode: Mode, teams: Record<string, number>, drop: { x: number; y: number } | null) {
    this.mode = mode;
    const t = new Map(Object.entries(teams));
    this.match = mode === 'br' ? { teams: t, nTeams: new Set(t.values()).size, startT: this.time, result: null, over: false } : null;
    this.player.team = t.get(this.selfId) ?? 0;
    this.restartNight(drop ?? undefined);
    if (this.coop) this.coop.regroup = !drop;
    for (const [id, r] of this.remotes) { r.team = this.teamOf(id); }
    this.menu = false; this.paused = false;
    this.audio.setPaused(false);
    this.input.events.length = 0; this.input.firing = false;
    if (!this.coop) { try { if (!localStorage.getItem('sg.tutorial')) { this.tutorialT = 12; localStorage.setItem('sg.tutorial', '1'); } } catch { /* ignore */ } }
  }

  /** A late joiner in a battle royale under way: sit it out and watch. */
  spectateOnly(teams: Record<string, number>) {
    this.mode = 'br';
    const t = new Map(Object.entries(teams));
    t.delete(this.selfId);
    this.match = { teams: t, nTeams: new Set(t.values()).size, startT: this.time, result: null, over: false };
    this.restartNight();
    const p = this.player;
    p.hp = 0; p.state = 'dead'; p.dissolved = true; this.deadT = 3;
    this.menu = false;
  }

  /** Back to the front end: drop the session and start from a clean slate. */
  toMenu() {
    this.coop?.leave();
    this.coop = null;
    this.remotes.clear();
    this.mode = 'pve'; this.match = null;
    this.restartNight();
    this.menu = true; this.paused = false;
    this.audio.setPaused(false); this.audio.setMusic(null);
    this.post.desat = 0; this.tutorialT = 0;
  }

  /** Between rounds: keep the room, put the world back to the menu backdrop. */
  toLobby() {
    const coop = this.coop;
    this.coop = null;            // so toMenu doesn't leave the room
    this.toMenu();
    this.coop = coop;
  }

  /** `n` drop points on the rim, spread as far apart as the map allows (greedy farthest-point). */
  dropPoints(n: number) {
    const all = [...this.level.spawns].sort(() => Math.random() - 0.5), out = [all[0]];
    while (out.length < n && out.length < all.length) {
      let best = all[0], bd = -1;
      for (const s of all) { const d = Math.min(...out.map((o) => Math.hypot(o.x - s.x, o.y - s.y))); if (d > bd) { bd = d; best = s; } }
      out.push(best);
    }
    while (out.length < n) out.push(all[out.length % all.length]);
    return out.map((s) => ({ ...s }));
  }

  /** Battle royale bookkeeping on every machine: which teams still stand, and is it over for us? */
  private checkMatch() {
    const m = this.match;
    if (!m || this.time - m.startT < 3) return;   // give everyone's first state a moment to arrive
    const alive = new Set<number>();
    for (const [id, team] of m.teams) {
      if (id === this.selfId) { if (this.player.state !== 'dead') alive.add(team); continue; }
      const r = this.remotes.get(id);
      // a player we haven't heard from yet still counts if they're in the room
      if (r ? r.state !== 'dead' && !r.dissolved : this.coop?.net.peers.has(id)) alive.add(team);
    }
    const mine = this.player.team;
    if (!m.result && m.teams.has(this.selfId)) {
      if (!alive.has(mine)) m.result = { won: false, place: alive.size + 1 };
      else if (alive.size <= 1 && m.nTeams > 1) m.result = { won: true, place: 1 };
      if (m.result) {
        this.audio.setMusic(null);
        this.audio.jingle(m.result.won ? 'victory' : 'defeat');
        if (m.result.won) { this.banner('VICTORY', '#ffd84a', 3); this.slowmo(1.5, 0.3); this.flash('#ffffff', 0.3); }
      }
    }
    m.over = alive.size <= 1 && (m.nTeams > 1 || alive.size === 0);
  }

  /** Who a dead battle royale player watches: a living teammate, else anyone still standing. */
  private spectateTarget(): Player | null {
    const alive = [...this.remotes.values()].filter((r) => r.state !== 'dead' && !r.dissolved);
    return alive.find((r) => r.team === this.player.team) ?? alive[0] ?? null;
  }

  /** The main-menu backdrop: drift slowly across the moonlit map. */
  private updateBackdrop(dt: number) {
    this.time += dt;
    this.input.events.length = 0;
    const a = this.time * 0.03, L = this.level;
    const tx = L.width / 2 + Math.cos(a) * L.width * 0.3 - this.r.w / 2, ty = L.height / 2 + Math.sin(a * 1.3) * L.height * 0.25 - this.r.h / 2;
    const k = 1 - Math.exp(-dt * 0.8);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    this.post.desat += (0.35 - this.post.desat) * Math.min(1, dt * 2);
    this.post.flash *= Math.exp(-dt * 9); this.post.chroma *= Math.exp(-dt * 6);
    this.fx.update(dt);
  }

  /** Where to come back: next to a living teammate if there is one, else a safe room. */
  respawnPoint() {
    const mate = [...this.remotes.values()].find((r) => r.state !== 'dead' && !r.dissolved);
    if (mate) return { x: mate.x + 20, y: mate.y };
    return this.night.dropPoint();
  }

  private respawn() {
    const at = this.respawnPoint();
    const old = this.player, p = new Player(at.x, at.y);
    // you keep your level and gear; you come back at half health
    p.slot = old.slot; p.name = old.name; p.team = old.team; p.level = old.level; p.xp = old.xp; p.weapon = old.weapon; p.passives = old.passives;
    p.actives = old.actives; p.relics = old.relics;
    p.maxHp = old.maxHp; p.hp = Math.round(old.maxHp / 2);
    this.player = p;
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
    this.level.draw(s, cx, cy, W + 2, H + 2, this.time);
    this.fx.drawTelegraphs(s, cx, cy);
    this.wx.drawGround(s, cx, cy);
    this.drawLoot(s, gl, cx, cy);

    // depth-sorted entities
    const items: { y: number; draw: () => void }[] = [];
    for (const c of this.level.propsIn(cx, cy, W, H)) items.push({ y: c.y, draw: () => this.level.drawColumn(s, c, cx, cy) });
    for (const e of this.enemies) items.push({ y: e.y, draw: () => e.draw(this, s, cx, cy) });
    // what the camera is about: us, or the teammate we're watching
    const p = this.spectating && this.player.state === 'dead' ? this.spectating : this.player;
    if (!this.menu) {
      items.push({ y: this.player.y, draw: () => this.player.draw(this, s, gl, cx, cy, this.renderDt) });
      for (const rp of this.remotes.values()) items.push({ y: rp.y, draw: () => rp.draw(this, s, gl, cx, cy, this.renderDt) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    for (const e of this.enemies) e.drawGlow(this, gl, cx, cy);

    this.fx.drawParticles(s, gl, cx, cy);
    this.drawBullets(gl, cx, cy);
    this.wx.drawTop(s, gl, cx, cy);
    this.drawHazards(gl, cx, cy);
    this.fx.drawGlow(gl, cx, cy);

    // lighting
    li.globalCompositeOperation = 'source-over';
    // moonlight outdoors, torchlit dark inside the dungeon; eased so walking through a gate fades between them
    const indoor = this.level.indoorAt(p.x, p.y) ? 1 : 0;
    this.indoorK += (indoor - this.indoorK) * Math.min(1, this.renderDt * 3);
    const mix = (a: number, b: number) => Math.round(a + (b - a) * this.indoorK);
    li.fillStyle = p.state === 'dead' && !this.menu ? '#26242e' : `rgb(${mix(70, 51)},${mix(74, 49)},${mix(108, 63)})`;
    li.fillRect(0, 0, W + 2, H + 2);
    li.globalCompositeOperation = 'lighter';
    const L = (x: number, y: number, r: number, color: string, a = 1) => {
      if (x + r < cx || x - r > cx + W + 2 || y + r < cy || y - r > cy + H + 2) return;
      li.globalAlpha = a; li.drawImage(lightSprite(color), Math.round(x - r - cx), Math.round(y - r - cy), r * 2, r * 2);
    };
    // world lights carry the dungeon; under the moon they're accents, not floodlights
    const lw = 0.25 + 0.65 * this.indoorK;
    for (const l of this.level.lights) L(l.x, l.y, l.radius * (1 + Math.sin(this.time * 9 + l.x) * l.flicker * 0.3), l.color, lw);
    // the hunter's own glow: strong in the dungeon dark, a gentle halo under the moon
    if (!this.menu) {
      L(p.x, p.y - Player.CHEST, 140, '#7a6aa0', 0.18 + 0.57 * this.indoorK);
      L(p.x, p.y - Player.CHEST, 56, '#d8d0f0', 0.06 + 0.12 * this.indoorK);
    }
    // moonlit ground is already lit, so additive glows need less to read and saturate much sooner
    const lo = 0.6 + 0.4 * this.indoorK;
    for (const e of this.enemies) if (e.state !== 'spawn') L(e.x, e.y - 8, e.boss ? 60 : 30, e.ally ? '#7a3cff' : '#ff3355', 0.22 * lo * lo);
    // bullet lights share a budget: dense patterns would otherwise stack into a white-out
    const share = Math.min(1, 22 / Math.max(1, this.bullets.length));
    for (const b of this.bullets) L(b.x, b.y, b.team === 'player' ? 22 : 18, b.team === 'player' ? '#9a5cff' : '#ff3355', 0.55 * share);
    for (const l of this.fx.lights) L(l.x, l.y, l.r, l.color, l.a * lo);
    this.fx.lights.length = 0;
    li.globalAlpha = 1;
    this.drawStorm(li, gl, cx, cy, W, H);
    this.wx.drawLight(li, cx, cy, W, H);

    // world-space UI then HUD
    const ux = Math.round(camX), uy = Math.round(camY);
    this.fx.drawTexts(ui, ux, uy);
    if (this.showHitbox) this.drawHitboxes(ui, ux, uy);
    if (!this.menu) {
      // name tags: team color in battle royale, the hero's trim in PvE
      for (const pl of this.remotes.values()) {
        if (pl.dissolved || !pl.peerId) continue;
        const tag = pl.name || '?';
        drawText(ui, tag, Math.round(pl.x - ux) - textWidth(tag) / 2, Math.round(pl.y - uy) - Player.HEAD - 10, this.colorOf(pl.peerId));
      }
      this.drawThreats(ui, ux, uy);
      drawHud(this, ui);
      hudHit(this);
    }
    this.coop?.flush();

    R.present(this.post, this.time);
  }

  /** The shadow storm: everything outside the circle sinks into violet dark; the edge burns. */
  private drawStorm(li: CanvasRenderingContext2D, gl: CanvasRenderingContext2D, cx: number, cy: number, W: number, H: number) {
    const n = this.night, R = n.stormR, sx = n.cx - cx, sy = n.cy - cy;
    if (Math.hypot(Math.max(Math.abs(sx), Math.abs(sx - W)), Math.max(Math.abs(sy), Math.abs(sy - H))) < R) return;  // all inside
    li.globalCompositeOperation = 'source-over';
    li.fillStyle = 'rgba(28,6,44,0.88)';
    li.beginPath(); li.rect(0, 0, W + 2, H + 2); li.arc(sx, sy, R, 0, Math.PI * 2, true); li.fill('evenodd');
    // edge: a ragged burning ring
    gl.strokeStyle = '#9a3cff'; gl.lineWidth = 2; gl.globalAlpha = 0.85;
    gl.beginPath();
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2, rr = R + Math.sin(a * 23 + this.time * 3) * 3 + Math.sin(a * 7 - this.time * 2) * 4;
      const x = sx + Math.cos(a) * rr, y = sy + Math.sin(a) * rr;
      if (i) gl.lineTo(x, y); else gl.moveTo(x, y);
    }
    gl.stroke(); gl.globalAlpha = 1;
    // embers drifting off the wall near the player
    const p = this.player, d = Math.hypot(p.x - n.cx, p.y - n.cy);
    if (Math.abs(d - R) < 200 && Math.random() < 0.6) {
      const a = Math.atan2(p.y - n.cy, p.x - n.cx) + (Math.random() - 0.5) * 0.6;
      this.fx.burst(n.cx + Math.cos(a) * R, n.cy + Math.sin(a) * R, 1, { speed: 20, color: '#b26bff', glow: true, grav: -60, vz: 30, life: 1.2, size: 1 });
    }
  }

  /** Chests and dropped loot. Gear stands in a beam of its rarity color, like Nightreign. */
  private drawLoot(s: CanvasRenderingContext2D, gl: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const c of this.night.chests) {
      const f = c.opened ? Math.min(2, Math.floor(c.t * 10)) : 0;
      const img = this.A.tile(c.opened ? 'chest_empty_open_anim' : 'chest_full_open_anim', f);
      s.drawImage(img, Math.round(c.x - 16 - cx), Math.round(c.y - 28 - cy));
      if (!c.opened) this.fx.light(c.x, c.y - 10, 50, '#ffc83a', 0.5);
    }
    for (const d of this.night.drops) {
      const it = d.item, x = Math.round(d.x - cx), y = Math.round(d.y - cy);
      const color = it.kind === 'flask' ? '#ff6a7a' : RARITY[it.rarity].color;
      if (it.kind !== 'flask') {
        const h = 40 + it.rarity * 20, pulse = 0.5 + Math.sin(this.time * 4 + d.x) * 0.15;
        gl.globalAlpha = pulse * 0.6; gl.fillStyle = color;
        gl.fillRect(x - 1, y - h, 3, h); gl.globalAlpha = pulse * 0.3; gl.fillRect(x - 3, y - h * 0.6, 7, h * 0.6);
        gl.globalAlpha = 1;
      }
      const icon = it.kind === 'flask' ? this.A.tile('flask_red')
        : it.kind === 'weapon' ? weaponIcon(this.A, it.key)
        : it.kind === 'passive' ? this.A.tile(PASSIVES[it.key].icon)
        : this.A.nt(it.kind === 'active' ? ACTIVES[it.key].icon : RELICS[it.key].icon, 0, 0, 24, 24, 1, true);
      const bob = Math.round(Math.sin(this.time * 3 + d.x) * 1.5 + d.z);
      s.fillStyle = 'rgba(4,2,10,0.5)'; s.fillRect(x - 6, y - 1, 12, 2);
      s.drawImage(icon, x - Math.round(icon.width / 2), y - icon.height - bob);
      this.fx.light(d.x, d.y - 8, 40, color, 0.5);
    }
  }

  /** Over each enemy: white = fair fight, red = well above you, purple skull = you will die. Levels stay hidden. */
  private drawThreats(ui: CanvasRenderingContext2D, ux: number, uy: number) {
    const lvl = this.player.level;
    for (const e of this.enemies) {
      if (e.ally || e.dead || e.state === 'spawn') continue;
      const d = e.level - lvl, x = Math.round(e.x - ux), y = Math.round(e.y - uy - e.height() - (e instanceof Boss ? e.z : 0) - 6);
      if (x < -10 || y < -10 || x > this.r.w + 10 || y > this.r.h + 10) continue;
      if (d >= 6) {
        // purple skull
        ui.fillStyle = '#07060c'; ui.fillRect(x - 4, y - 4, 9, 9);
        ui.fillStyle = '#b26bff'; ui.fillRect(x - 3, y - 3, 7, 4); ui.fillRect(x - 2, y + 1, 5, 2);
        ui.fillStyle = '#07060c'; ui.fillRect(x - 2, y - 2, 2, 2); ui.fillRect(x + 1, y - 2, 2, 2); ui.fillRect(x, y + 1, 1, 1);
      } else {
        const c = d >= 3 ? '#ff3355' : '#e8e4f0';
        ui.fillStyle = '#07060c'; ui.fillRect(x - 3, y - 2, 7, 5);
        ui.fillStyle = c; ui.fillRect(x - 2, y - 1, 5, 1); ui.fillRect(x - 1, y, 3, 1); ui.fillRect(x, y + 1, 1, 1);
      }
      // health sliver once it's been hit
      if (e.hp < e.maxHp && !e.boss) {
        ui.fillStyle = '#07060c'; ui.fillRect(x - 8, y + 4, 17, 3);
        ui.fillStyle = d >= 3 ? '#ff3355' : '#e04a6a'; ui.fillRect(x - 7, y + 5, Math.max(1, Math.round(15 * e.hp / e.maxHp)), 1);
      }
    }
  }

  private drawBullets(g: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const b of this.bullets) {
      const x = Math.round(b.x - cx), y = Math.round(b.y - cy);
      if (b.kind === 'arrow') {
        // long shaft with a bright head; gold when fully drawn
        const l = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / l, uy = b.vy / l;
        g.fillStyle = b.color;
        for (let i = 2; i < 12; i++) g.fillRect(Math.round(x - ux * i), Math.round(y - uy * i), 1, 1);
        g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 1, 2, 2);
      } else if (b.kind === 'dagger') {
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
