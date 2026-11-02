// Glue between the game and the network.
//
//  every player   → 'pl'   their character state, 20 Hz
//  host           → 'snap' every enemy (position, state, hp...), 15 Hz
//  anyone         → 'evt'  batched events, flushed once per rendered frame:
//     fx / sfx / shake / flash / chroma / banner   enemy cues mirrored from the host's AI
//     eb  enemy bullet spawned     bk  bullet consumed     rf  bullet reflected
//     pb  someone's shot (cosmetic on other machines)       hz  boss shockwave
//     pfx a remote perfect parry (cosmetic)                 dmg damage report → host
//     cmd sandbox command → host
//  targeted (sent immediately):
//     atk  host asks the victim's machine to resolve an attack (so parry timing is judged where it was pressed)
//     atkr the victim's answer; on 'parried' the host staggers / deflects the attacker

import { Boss } from '../game/boss';
import type { Enemy, EnemyKind } from '../game/enemies';
import type { Bullet, Game, HitResult } from '../game/game';
import { Player } from '../game/player';
import { MAX_PLAYERS, Net, type Wire } from './net';

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
  status = 'CONNECTING';

  constructor(private g: Game, readonly roomId: string) {
    const net = this.net = new Net(roomId);
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

  private peersChanged() {
    const g = this.g, n = this.net;
    g.player.slot = n.slotOf(n.selfId);
    for (const [id, p] of g.remotes) p.slot = n.slotOf(id);
    this.status = n.full ? 'ROOM FULL' : n.peers.size ? (n.isHost ? 'HOST' : 'JOINED') : 'WAITING';
    if (n.isHost && !this.wasHost) {
      // host migration: our replicas become the real thing
      for (const e of g.enemies) { e.remote = false; if (e instanceof Boss) e.introDone = true; }
      g.nextId = Math.max(g.nextId, ...g.enemies.map((e) => e.id));
      g.banner('YOU ARE THE HOST', '#b26bff', 1.6);
    }
    if (!n.isHost && this.wasHost && n.peers.size) {
      // we joined someone else's gate: their world replaces ours
      g.enemies = []; g.bullets = []; g.hazards = [];
    }
    this.wasHost = n.isHost;
  }

  // ------------------------------------------------------------------ outgoing

  push(e: Wire) { this.outbox.push(e); }
  mirror(op: string, args: unknown[]) { this.outbox.push({ t: 'fx', op, a: args }); }

  tick(dt: number) {
    const g = this.g, p = g.player;
    this.plT -= dt;
    if (this.plT <= 0) {
      this.plT = 1 / 20;
      this.net.sendPlayer({
        x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), f: p.face, s: p.state, t: r1(p.t),
        a: p.action?.name ?? null, at: r1(p.action?.t ?? 0), ax: r1(p.aimX), ay: r1(p.aimY), ah: r1(p.aimHold),
        hp: p.hp, mh: p.maxHp, if: r1(p.iframes), iv: r1(p.invuln), fl: p.flash > 0 ? 1 : 0, pf: r1(p.parryFlash), pa: r1(p.parryAngle),
        d: p.dissolved ? 1 : 0, mz: p.muzzle > 0 ? 1 : 0, rc: r1(p.recoil),
      });
    }
    if (this.isHost && this.net.peers.size) {
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / 15;
        this.net.sendSnap({
          e: g.enemies.filter((e) => !e.dead).map((e) => ({
            i: e.id, k: e.kind, x: r1(e.x), y: r1(e.y), vx: r1(e.vx), vy: r1(e.vy), f: e.face, s: e.state, st: r1(e.stateT),
            h: Math.round(e.hp), m: e.maxHp, fl: e.flash > 0 ? 1 : 0, a: e.shadowAnim,
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

  /** Host → victim's machine: resolve this attack there. Returns immediately; parries call back later. */
  remoteAttack(victim: Player, src: { x: number; y: number }, dmg: number, o: { heavy?: boolean; kind: string; counter?: boolean }, onParried?: () => void) {
    const id = ++this.atkSeq;
    if (onParried) this.pending.set(id, onParried);
    this.net.sendEvt({ t: 'atk', id, sx: r1(src.x), sy: r1(src.y), dmg, h: o.heavy ? 1 : 0, k: o.kind, c: o.counter ? 1 : 0 }, victim.peerId!);
  }

  // ------------------------------------------------------------------ incoming

  private applyPlayer(s: Wire, from: string) {
    const g = this.g;
    if (this.net.slotOf(from) >= MAX_PLAYERS) return;
    let p = g.remotes.get(from);
    if (!p) {
      p = new Player(s.x, s.y);
      p.peerId = from;
      g.remotes.set(from, p);
      g.fx.burst(s.x, s.y, 20, { speed: 40, colors: ['#5a2ccf', '#b26bff'], glow: true, grav: -120, vz: 80, life: 1, size: 2 });
    }
    p.slot = this.net.slotOf(from);
    p.netX = s.x; p.netY = s.y; p.vx = s.vx; p.vy = s.vy; p.face = s.f;
    if (p.state !== s.s) { p.state = s.s; p.t = s.t; }
    if ((p.action?.name ?? null) !== s.a) p.action = s.a ? { name: s.a, t: s.at } : null;
    p.aimX = s.ax; p.aimY = s.ay; p.aimHold = s.ah;
    p.hp = s.hp; p.maxHp = s.mh; p.iframes = s.if; p.invuln = s.iv;
    if (s.fl) p.flash = 0.08;
    p.parryFlash = s.pf; p.parryAngle = s.pa; p.dissolved = !!s.d; p.recoil = Math.max(p.recoil, s.rc);
    if (s.mz) p.muzzle = 0.06;
  }

  private applySnap(s: Wire) {
    const g = this.g, seen = new Set<number>();
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
    }
    // enemies the host no longer has died there: play their death here
    for (const e of g.enemies) if (e.remote && !e.dead && !seen.has(e.id)) e.die(g, 'net');
    g.enemies = g.enemies.filter((e) => !e.dead);
  }

  private applyEvt(m: Wire, from: string) {
    const g = this.g;
    if (m.t === 'batch') { for (const e of m.l) this.applyEvt(e, from); return; }
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
        g.bullets.push({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, r: m.r, dmg: 0, team: 'player', heavy: false, life: m.l, age: 0, color: m.c, kind: m.k, pierce: 0, hits: new Set(), source: null, cosmetic: true });
        g.sfx(m.k === 'big' ? 'shootBig' : 'shoot', m.x, 0.5);
        break;
      case 'hz': g.hazards.push({ x: m.x, y: m.y, r: 10, maxR: m.mr, speed: m.sp, dmg: m.dmg, hit: false }); break;
      case 'pfx': g.parryFx(m.x, m.y, !!m.h, true); break;
      case 'dmg': {
        if (!this.isHost) break;
        const e = g.enemies.find((x) => x.id === m.id);
        if (e && !e.dead) e.hurt(g, m.dmg, m.dx, m.dy, { knock: m.kn, how: m.how, crit: !!m.c });
        break;
      }
      case 'cmd': if (this.isHost) g.sandbox(m.act); break;
      case 'atk': {
        const res: HitResult = g.hitPlayer({ x: m.sx, y: m.sy }, m.dmg, { heavy: !!m.h, kind: m.k, counter: !!m.c, lag: LAG_COMP });
        this.net.sendEvt({ t: 'atkr', id: m.id, res }, from);
        break;
      }
      case 'atkr': {
        const cb = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.res === 'parried') cb?.();
        break;
      }
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

  leave() { this.net.leave(); }
}

export type { Enemy };
