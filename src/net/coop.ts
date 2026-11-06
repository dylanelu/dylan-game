// Glue between the game and the network.
//
//  every player   → 'pl'   their character state, 20 Hz (only while a match runs)
//  host           → 'snap' every enemy (position, state, hp...), 15 Hz
//  anyone         → 'evt'  batched events, flushed once per rendered frame:
//     fx / sfx / shake / flash / chroma / banner   enemy cues mirrored from the host's AI
//     eb  enemy bullet spawned     bk  bullet consumed     rf  bullet reflected
//     pb  someone's shot (id, dmg: cosmetic on other machines, except it can hit you in PvP)
//     pbk a shot was stopped by its PvP target           die  I died (killer, cause): kill feed, eliminations
//     pfx a remote perfect parry (cosmetic)                 dmg damage report → host
//     cmd sandbox command → host
//  sent immediately:
//     lobby  host → all: the room's settings and teams (on every change)
//     start  host → all: the match begins (settings + one drop point per team)
//     atk    attacker asks the victim's machine to resolve an attack (so parry timing is judged where it was
//            pressed); host enemies, or a player's melee in PvP (pv: 1)
//     atkr   the victim's answer; on 'parried' the attacker is staggered / deflected
//     ph     PvP victim → shooter: your shot landed (damage number + hit marker over there)
//     ctl / dom / xsw / beru / wfx   weapons + abilities (weapons.ts: telekinesis → host, domain, swap, BERU, swing fx)

import { Boss } from '../game/boss';
import type { Enemy, EnemyKind, Shadow } from '../game/enemies';
import type { Bullet, Game, HitResult } from '../game/game';
import { Player } from '../game/player';
import { balance, defaultLobby, type LobbyState } from './lobby';
import { Net, type Me, type Wire } from './net';

const r1 = (v: number) => Math.round(v * 10) / 10;
/** extra perfect-parry time for attacks resolved on a remote victim: ~1 snapshot interval + one-way latency */
const LAG_COMP = 0.12;

export class Coop {
  readonly net: Net;
  private outbox: Wire[] = [];
  private pending = new Map<number, () => void>();
  private atkSeq = 0;
  private plT = 0; private snapT = 0;
  private wasHost = false;
  /** the room's settings; the host's copy is the truth, everyone else mirrors it */
  lobby: LobbyState;
  /** heard from the host (or we are it): until then the lobby shown is a placeholder */
  synced = false;
  /** UI hooks: the lobby changed / the host started a match (drop points per team) */
  onLobby: () => void = () => {};
  onStart: (drops: [number, number][]) => void = () => {};
  /** joined a night already under way: move next to the host once we know where they are */
  regroup = false;

  constructor(private g: Game, readonly roomId: string, me: Me) {
    const net = this.net = new Net(roomId, me);
    this.lobby = defaultLobby(me.name);
    net.onPeersChanged = () => this.peersChanged();
    net.onLeave = (id) => { g.remotes.delete(id); };
    net.onPlayer = (s, from) => this.applyPlayer(s, from);
    net.onSnap = (s, from) => { if (from === net.hostId && !net.isHost) this.applySnap(s); };
    net.onEvt = (e, from) => this.applyEvt(e, from);
    this.wasHost = true;
    this.peersChanged();
  }

  get isHost() { return this.net.isHost; }
  get count() { return this.net.order.length; }
  get selfId() { return this.net.selfId; }

  private peersChanged() {
    const g = this.g, n = this.net;
    for (const [id, p] of g.remotes) { p.slot = n.lookOf(id); p.name = n.nameOf(id); }
    if (n.isHost && !this.wasHost) {
      // host migration: our replicas become the real thing, and the lobby is ours to keep
      for (const e of g.enemies) { e.remote = false; if (e instanceof Boss) e.introDone = true; }
      g.nextId = Math.max(g.nextId, ...g.enemies.map((e) => e.id));
      this.lobby.name = n.me.name;
      if (!g.menu) g.banner('YOU ARE THE HOST', '#b26bff', 1.6);
    }
    if (!n.isHost && this.wasHost && n.peers.size) {
      // we joined someone else's room: their world replaces ours
      g.enemies = []; g.bullets = []; g.hazards = [];
      this.synced = false;
    }
    this.wasHost = n.isHost;
    if (n.isHost) {
      this.synced = true;
      balance(this.lobby, n.order);
      this.sendLobby();
    }
    this.onLobby();
  }

  // ------------------------------------------------------------------ lobby (host)

  private sendLobby() { if (this.net.peers.size) this.net.sendEvt({ t: 'lobby', l: this.lobby }); }

  /** Host: change a setting; teams rebalance and everyone hears about it. */
  setLobby(patch: Partial<LobbyState>) {
    if (!this.isHost) return;
    const modeChanged = (patch.mode && patch.mode !== this.lobby.mode) || (patch.ts && patch.ts !== this.lobby.ts);
    Object.assign(this.lobby, patch);
    if (modeChanged) this.lobby.teams = {};
    balance(this.lobby, this.net.order);
    this.sendLobby();
    this.onLobby();
  }

  /** Host: START. One drop point per team, spread around the rim (everyone together in PvE). */
  start() {
    if (!this.isHost) return;
    balance(this.lobby, this.net.order);
    const l = this.lobby, nTeams = Math.max(1, ...Object.values(l.teams).map((t) => t + 1));
    l.started = true; l.round++;
    const dr = this.g.dropPoints(l.mode === 'br' ? nTeams : 1).map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]);
    this.net.sendEvt({ t: 'start', l, dr });
    this.onStart(dr);
  }

  /** Host: everyone back to the lobby for another round. */
  backToLobby() {
    if (!this.isHost) return;
    this.lobby.started = false;
    balance(this.lobby, this.net.order);
    this.sendLobby();
    this.onLobby();
  }

  // ------------------------------------------------------------------ outgoing

  push(e: Wire) { this.outbox.push(e); }
  mirror(op: string, args: unknown[]) { this.outbox.push({ t: 'fx', op, a: args }); }
  /** Straight to one peer, not batched (rare, and the receiver acts on it). */
  sendTo(id: string, e: Wire) { this.net.sendEvt(e, id); }

  tick(dt: number) {
    const g = this.g, p = g.player;
    this.plT -= dt;
    if (this.plT <= 0) {
      this.plT = 1 / 20;
      this.net.sendPlayer({
        x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), f: p.face, s: p.state, t: r1(p.t),
        a: p.action?.name ?? null, at: r1(p.action?.t ?? 0), ax: r1(p.aimX), ay: r1(p.aimY), ah: r1(p.aimHold),
        hp: p.hp, mh: p.maxHp, if: r1(p.iframes), iv: r1(p.invuln), fl: p.flash > 0 ? 1 : 0, pf: r1(p.parryFlash), pa: r1(p.parryAngle),
        d: p.dissolved ? 1 : 0, mz: p.muzzle > 0 ? 1 : 0, rc: r1(p.recoil), w: p.weapon.key, sh: p.stealth > 0 ? 1 : 0, lv: p.level,
      });
    }
    if (this.isHost && this.net.peers.size) {
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / 15;
        this.net.sendSnap({
          n: { t: r1(g.night.t), mb: [...g.night.activeMb], bs: g.night.bossSpawned ? 1 : 0, sd: g.night.seed },
          e: g.enemies.filter((e) => !e.dead).map((e) => ({
            i: e.id, k: e.kind, x: r1(e.x), y: r1(e.y), vx: r1(e.vx), vy: r1(e.vy), f: e.face, s: e.state, st: r1(e.stateT),
            h: Math.round(e.hp), m: e.maxHp, fl: e.flash > 0 ? 1 : 0, a: e.shadowAnim, ...(e.kind === 'shadow' ? { o: (e as Shadow).owner } : {}),
            ...(e instanceof Boss ? { z: r1(e.z), ph: e.phase, po: r1(e.posture) } : {}),
          })),
        });
      }
    }
  }

  /** Send everything queued this frame as one message. */
  flush() {
    if (!this.outbox.length) return;
    if (this.net.peers.size) this.net.sendEvt({ t: 'batch', l: this.outbox });
    this.outbox = [];
  }

  /** Ask the victim's machine to resolve this attack there. Returns immediately; parries call back later.
   *  `pvp`: a player's strike (the victim credits us if it kills them). */
  remoteAttack(victim: Player, src: { x: number; y: number }, dmg: number, o: { heavy?: boolean; kind: string; counter?: boolean; pvp?: boolean }, onParried?: () => void) {
    const id = ++this.atkSeq;
    if (onParried) this.pending.set(id, onParried);
    this.net.sendEvt({ t: 'atk', id, sx: r1(src.x), sy: r1(src.y), dmg, h: o.heavy ? 1 : 0, k: o.kind, c: o.counter ? 1 : 0, ...(o.pvp ? { pv: 1 } : {}) }, victim.peerId!);
  }

  // ------------------------------------------------------------------ incoming

  private applyPlayer(s: Wire, from: string) {
    const g = this.g;
    if (g.menu) return;
    if (this.regroup && from === this.net.hostId) {
      this.regroup = false;
      g.player.x = s.x + 24; g.player.y = s.y + 8;
      g.level.collide(g.player, g.player.r);
      g.cam.x = g.player.x - g.r.w / 2; g.cam.y = g.player.y - g.r.h / 2;
    }
    let p = g.remotes.get(from);
    if (!p) {
      p = new Player(s.x, s.y);
      p.peerId = from;
      g.remotes.set(from, p);
      if (!s.d) g.fx.burst(s.x, s.y, 20, { speed: 40, colors: ['#5a2ccf', '#b26bff'], glow: true, grav: -120, vz: 80, life: 1, size: 2 });
    }
    p.slot = this.net.lookOf(from); p.name = this.net.nameOf(from); p.team = g.teamOf(from);
    p.netX = s.x; p.netY = s.y; p.vx = s.vx; p.vy = s.vy; p.face = s.f;
    if (p.state !== s.s) { p.state = s.s; p.t = s.t; }
    if ((p.action?.name ?? null) !== s.a) p.action = s.a ? { name: s.a, t: s.at } : null;
    p.aimX = s.ax; p.aimY = s.ay; p.aimHold = s.ah;
    p.hp = s.hp; p.maxHp = s.mh; p.iframes = s.if; p.invuln = s.iv;
    if (s.fl) p.flash = 0.08;
    p.parryFlash = s.pf; p.parryAngle = s.pa; p.dissolved = !!s.d; p.recoil = Math.max(p.recoil, s.rc); p.level = s.lv ?? p.level;
    if (s.mz) p.muzzle = 0.06;
    if (s.w) p.weapon.key = s.w;
    p.stealth = s.sh ? 1 : 0;
  }

  private applySnap(s: Wire) {
    const g = this.g, seen = new Set<number>();
    if (g.menu) return;
    if (s.n) {
      const n = g.night;
      n.t = Math.abs(n.t - s.n.t) > 1 ? s.n.t : n.t + (s.n.t - n.t) * 0.2;   // follow the host's clock
      n.activeMb = new Set(s.n.mb);
      n.bossSpawned = !!s.n.bs;
      if (s.n.sd !== undefined && s.n.sd !== n.seed) n.setSeed(s.n.sd);   // the host's storm path
    }
    for (const w of s.e) {
      seen.add(w.i);
      let e = g.enemies.find((x) => x.id === w.i);
      if (!e) {
        e = g.makeEnemy(w.k as EnemyKind, w.x, w.y, w.a);
        e.id = w.i; e.remote = true;
        e.state = w.s; e.stateT = w.st;
        if (w.s === 'spawn') g.portal(e);
        g.enemies.push(e);
      }
      e.netX = w.x; e.netY = w.y; e.vx = w.vx; e.vy = w.vy; e.face = w.f;
      if (e.state !== w.s) { e.state = w.s; e.stateT = w.st; e.hitThisAttack = false; }
      e.hp = w.h; e.maxHp = w.m;
      if (w.fl && e.flash <= 0) e.flash = 0.07;
      if (e instanceof Boss) { e.z = w.z; e.phase = w.ph; e.posture = w.po; e.introDone = true; }
      if (w.o !== undefined) (e as Shadow).owner = w.o;
    }
    // enemies the host no longer has died there: play their death here
    for (const e of g.enemies) if (e.remote && !e.dead && !seen.has(e.id)) e.die(g, 'net');
    g.enemies = g.enemies.filter((e) => !e.dead);
  }

  private applyEvt(m: Wire, from: string) {
    const g = this.g;
    if (m.t === 'batch') { for (const e of m.l) this.applyEvt(e, from); return; }
    // room management works from the menus; everything else is gameplay and waits for a match
    if (m.t === 'lobby' || m.t === 'start') {
      if (from !== this.net.hostId) return;
      this.lobby = m.l; this.synced = true;
      // a start is its own news: as a plain lobby update, started=true would read as joining a match under way
      if (m.t === 'start') this.onStart(m.dr); else this.onLobby();
      return;
    }
    if (g.menu) return;
    switch (m.t) {
      case 'fx': {
        const f = g.fx as unknown as Record<string, (...a: unknown[]) => void>;
        if (typeof f[m.op] === 'function') f[m.op](...m.a);
        break;
      }
      case 'sfx': g.sfx(m.n, m.x, m.v); break;
      case 'shake': g.shake(m.v * 0.8); break;
      case 'flash': g.flash(m.c, m.v); break;
      case 'chroma': g.chroma(m.v); break;
      case 'banner': g.banner(m.s, m.c, m.d); break;
      case 'eb': {
        const src = g.enemies.find((e) => e.id === m.src) ?? null;
        g.bullets.push({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, r: m.r, dmg: m.dmg, team: 'enemy', heavy: !!m.h, life: 6, age: 0, color: m.c, kind: m.k, pierce: 0, hits: null, source: src, nid: m.id });
        break;
      }
      case 'bk': { const b = g.bullets.find((x) => x.nid === m.id); if (b) b.life = 0; break; }
      case 'rf': {
        const b = g.bullets.find((x) => x.nid === m.id);
        if (b) { g.reflect(b, false); b.vx = m.vx; b.vy = m.vy; b.cosmetic = true; }
        if (this.isHost && b?.source instanceof Boss) b.source.addPosture(g, m.h ? 10 : 4);
        break;
      }
      case 'pb':
        g.bullets.push({
          x: m.x, y: m.y, vx: m.vx, vy: m.vy, r: m.r, dmg: m.d ?? 0, team: 'player', heavy: false, life: m.l, age: 0, color: m.c, kind: m.k,
          pierce: 0, hits: new Set(), source: null, cosmetic: true, owner: from, pid: m.id, pvp: g.isFoeId(from),
        });
        g.sfx(m.k === 'big' ? 'shootBig' : 'shoot', m.x, 0.5);
        break;
      case 'pbk': {
        const b = g.bullets.find((x) => x.pid === m.id && (x.owner ?? this.selfId) === m.o);
        if (b) b.life = 0;
        break;
      }
      case 'ph': g.pvpHitLanded(from, m.d, !!m.p); break;
      case 'die': g.remoteDied(from, m.by ?? null, m.how ?? ''); break;
      case 'hz': g.hazards.push({ x: m.x, y: m.y, r: 10, maxR: m.mr, speed: m.sp, dmg: m.dmg, hit: false }); break;
      case 'pfx': g.parryFx(m.x, m.y, !!m.h, true); break;
      case 'dmg': {
        if (!this.isHost) break;
        const e = g.enemies.find((x) => x.id === m.id);
        if (e && !e.dead) e.hurt(g, m.dmg, m.dx, m.dy, { knock: m.kn, how: m.how, crit: !!m.c, pierce: !!m.p });
        break;
      }
      case 'cmd': if (this.isHost) g.sandbox(m.act); break;
      case 'summon': if (this.isHost) g.raiseShadows(m.x, m.y, from); break;
      case 'chest': if (!g.night.chests.some((c) => c.id === m.id)) g.night.chests.push({ id: m.id, x: m.x, y: m.y, opened: false, t: 0 }); break;
      case 'gate': g.night.bossSpawned = true; g.banner('THE GATE OPENS', '#ff3355', 3); g.gatePull(); break;
      case 'atk': {
        // a player's strike only counts from someone on another team
        if (m.pv && !g.isFoeId(from)) { this.net.sendEvt({ t: 'atkr', id: m.id, res: 'ignored' }, from); break; }
        if (m.pv) g.lastHitBy = { id: from, t: g.time };
        const res: HitResult = g.hitPlayer({ x: m.sx, y: m.sy }, m.dmg, { heavy: !!m.h, kind: m.k, counter: !!m.c, lag: LAG_COMP });
        this.net.sendEvt({ t: 'atkr', id: m.id, res }, from);
        if (m.pv && (res === 'hit' || res === 'guarded')) this.net.sendEvt({ t: 'ph', d: m.dmg, p: g.player.state === 'dead' ? 1 : 0 }, from);
        break;
      }
      case 'atkr': {
        const cb = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.res === 'parried') cb?.();
        break;
      }
      default: g.wx.onNet(m, from);
    }
  }

  /** Bullet spawned by the host's enemies: everyone simulates it, each machine checks its own player. */
  enemyBulletSpawned(b: Bullet) {
    this.push({ t: 'eb', id: b.nid, x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy), r: b.r, dmg: b.dmg, h: b.heavy ? 1 : 0, c: b.color, k: b.kind, src: b.source?.id ?? 0 });
  }

  /** Link for others to join this room. */
  get link() {
    const u = new URL(location.href);
    u.hash = `room=${this.roomId}`;
    return u.toString();
  }

  leave() { this.net.leave(); this.pending.clear(); this.outbox = []; }
}

export type { Enemy };
