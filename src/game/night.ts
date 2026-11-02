import type { EnemyKind } from './enemies';
import type { Game } from './game';
import { itemName, RARITY, rollLoot, type Item } from './items';
import { TILE, type Room } from './world';

// One night, ~10 minutes. Drop in, clear camps and mini-bosses to level up and find gear while the shadow
// storm closes in on the gate at the center. At 9:00 the gate opens and the final boss rises there.

export const NIGHT_LENGTH = 600;
export const BOSS_AT = 540;
/** [time (s), storm radius (px)]: holds, then shrinks; interpolated between keys */
const STORM: [number, number][] = [[0, 3800], [120, 3800], [180, 2400], [290, 2400], [350, 1400], [440, 1400], [500, 620], [BOSS_AT, 620], [NIGHT_LENGTH, 340]];

interface Camp { room: Room; state: 'dormant' | 'active' | 'cleared'; ids: number[] }
export interface Chest { id: number; x: number; y: number; opened: boolean; t: number }
export interface Drop { x: number; y: number; z: number; vz: number; vx: number; vy: number; item: Item; t: number }

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class Night {
  t = 0;
  ended: null | 'won' | 'lost' = null;
  endT = 0;
  readonly camps = new Map<number, Camp>();
  activeMb = new Set<number>();
  chests: Chest[] = [];
  drops: Drop[] = [];
  bossSpawned = false;
  /** solo safety net: one revival per night */
  revives = 1;
  private said = new Set<string>();
  private stormTick = 0;

  constructor(private g: Game, seed = Math.floor(Math.random() * 1e9)) {
    const w = g.level, rand = rng(seed);
    // drop rooms stay quiet so nobody lands in a fight
    for (const r of w.rooms) if (r.kind === 'camp') this.camps.set(r.id, { room: r, state: 'dormant', ids: [] });
    // every named place has its boss, each guarding a unique reward
    const mbs = w.rooms.filter((r) => r.kind === 'miniboss');
    this.activeMb = new Set(mbs.map((r) => r.id));
    for (const r of mbs) this.camps.set(r.id, { room: r, state: 'dormant', ids: [] });
    void rand;
  }

  get cx() { return this.g.level.arena.cx; }
  get cy() { return this.g.level.arena.cy; }

  stormAt(t: number) {
    for (let i = 1; i < STORM.length; i++) {
      const [t1, r1] = STORM[i], [t0, r0] = STORM[i - 1];
      if (t <= t1) return r0 + (r1 - r0) * Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    }
    return STORM[STORM.length - 1][1];
  }
  get stormR() { return this.stormAt(this.t); }
  /** The circle the storm is heading to next (for the minimap). */
  get nextR() {
    for (const [tk, r] of STORM) if (tk > this.t && r < this.stormR - 1) return r;
    return this.stormR;
  }
  get closing() { return this.stormAt(this.t + 1) < this.stormR - 0.1; }
  outside(x: number, y: number) { return Math.hypot(x - this.cx, y - this.cy) > this.stormR; }

  /** Pick the squad's drop point: open ground somewhere on the rim. */
  dropPoint(rand = Math.random) {
    const s = this.g.level.spawns;
    return { ...s[Math.floor(rand() * s.length)] };
  }

  update(dt: number) {
    const g = this.g, p = g.player;
    if (this.ended) { this.endT += dt; return; }
    this.t += dt;

    // story beats, shown on every machine from the shared clock
    const say = (key: string, at: number, text: string, color: string, dur = 2.4) => {
      if (this.t >= at && !this.said.has(key)) { this.said.add(key); g.banner(text, color, dur); if (key !== 'start') g.sfx('danger', p.x); }
    };
    say('start', 0.5, 'NIGHT FALLS', '#b26bff', 2.6);
    say('storm1', 120, 'THE SHADOW CLOSES IN', '#b26bff');
    say('storm2', 290, 'THE SHADOW CLOSES IN', '#b26bff');
    say('storm3', 440, 'THE SHADOW CLOSES IN', '#ff6680');
    say('soon', BOSS_AT - 30, 'THE GATE STIRS', '#ff6680');

    // storm hurts whoever stands in it, more as the night goes on
    if (p.state !== 'dead' && this.outside(p.x, p.y)) {
      this.stormTick -= dt;
      if (this.stormTick <= 0) {
        this.stormTick = 0.5;
        g.stormHurt(Math.round(3 + this.t / 60));
      }
    } else this.stormTick = 0;

    if (g.authority) this.direct();
    this.updateLoot(dt);
  }

  /** Host / solo only: wake camps near players, notice cleared ones, open the gate. */
  private direct() {
    const g = this.g;
    const players = [g.player, ...g.remotes.values()].filter((pl) => pl.state !== 'dead');
    for (const camp of this.camps.values()) {
      const r = camp.room;
      if (camp.state === 'dormant') {
        const near = players.some((pl) => Math.hypot(pl.x - r.cx, pl.y - r.cy) < 190 + (r.x1 - r.x0) * TILE * 0.35);
        if (near && !this.outside(r.cx, r.cy)) this.wake(camp);
      } else if (camp.state === 'active') {
        if (camp.ids.every((id) => !g.enemies.some((e) => e.id === id && !e.dead))) {
          camp.state = 'cleared';
          if (r.kind !== 'miniboss') this.addChest(++g.nextId, r.cx, r.cy);
        }
      }
    }
    if (!this.bossSpawned && this.t >= BOSS_AT) {
      this.bossSpawned = true;
      // everyone still out in the dark is pulled to the gate
      for (const e of g.enemies) if (!e.ally && !e.boss) e.dead = true;
      g.enemies = g.enemies.filter((e) => !e.dead);
      const boss = g.spawn('boss', this.cx, this.cy - 60, 12);
      g.banner('THE GATE OPENS', '#ff3355', 3);
      g.coop?.push({ t: 'gate' });
      g.gatePull();
      void boss;
    }
  }

  private wake(camp: Camp) {
    const g = this.g, r = camp.room;
    camp.state = 'active';
    if (r.kind === 'miniboss') {
      const kind: EnemyKind = r.boss === 'toji' ? 'toji' : r.boss === 'armoredTitan' ? 'atitan' : 'knight';
      const e = g.spawn(kind, r.cx, r.cy, r.level);
      camp.ids.push(e.id);
      return;
    }
    const area = (r.x1 - r.x0) * (r.y1 - r.y0);
    const n = r.titans ? 4 : Math.min(7, 3 + Math.floor(area / 45));
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      const kind: EnemyKind = r.titans && i < 2 ? 'titan' : roll < 0.55 ? 'ghoul' : roll < 0.85 || r.level < 3 ? 'caster' : 'brute';
      const pos = g.level.spotIn(r);
      g.later(i * 0.12, () => { const e = g.spawn(kind, pos.x, pos.y, r.level + (Math.random() < 0.25 ? 1 : 0)); camp.ids.push(e.id); });
      camp.ids.push(-1 - i);   // placeholder so the camp isn't "cleared" before its wave finishes spawning
    }
    g.later(n * 0.12 + 0.05, () => { camp.ids = camp.ids.filter((id) => id > 0); });
  }

  addChest(id: number, x: number, y: number) {
    this.chests.push({ id, x, y, opened: false, t: 0 });
    this.g.fx.ring(x, y, 40, '#ffd84a', 0.6, 2);
    if (this.g.coop?.isHost) this.g.coop.push({ t: 'chest', id, x: Math.round(x), y: Math.round(y) });
  }

  /** Loot pops out of a spot with a little arc; each player gets their own drops. */
  spill(items: Item[], x: number, y: number) {
    items.forEach((item, i) => {
      const a = -Math.PI / 2 + (i - (items.length - 1) / 2) * 0.9;
      this.drops.push({ x, y, z: 6, vz: 140, vx: Math.cos(a) * 40, vy: Math.sin(a) * 18 + 10, item, t: 0 });
    });
  }

  private updateLoot(dt: number) {
    const g = this.g, p = g.player;
    for (const d of this.drops) {
      d.t += dt;
      d.vz -= 420 * dt; d.z = Math.max(0, d.z + d.vz * dt);
      if (d.z === 0) { d.vx *= 0.8; d.vy *= 0.8; }
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.t > 0.5 && p.state !== 'dead' && Math.hypot(p.x - d.x, p.y - d.y) < 18) {
        d.t = -999;
        g.pickup(d.item);
      }
    }
    this.drops = this.drops.filter((d) => d.t >= 0);
    for (const c of this.chests) {
      c.t += dt;
      if (!c.opened && p.state !== 'dead' && Math.hypot(p.x - c.x, p.y - c.y) < 22) {
        c.opened = true; c.t = 0;
        g.sfx('select', c.x); g.sfx('reflect', c.x, 0.5);
        g.fx.burst(c.x, c.y - 10, 16, { speed: 90, colors: ['#ffd84a', '#fff2b0'], glow: true, life: 0.6, grav: 120 });
        this.spill(rollLoot('chest'), c.x, c.y - 4);
      }
    }
  }

  /** Short label for a loot pickup toast. */
  static label(it: Item) { return `${itemName(it)}${it.kind === 'flask' ? '' : ' · ' + RARITY[it.rarity].name}`; }
}
