import { Boss } from './boss';
import type { EnemyKind } from './enemies';
import type { Game } from './game';
import { itemName, RARITY, rollLoot, type Item } from './items';
import type { NightSave } from './save';
import { FINALS, LAIR_POOLS } from './roster';
import { TILE, type Room } from './world';

// One night, ~10 minutes. Drop in, clear camps and mini-bosses to level up and find gear while the shadow
// storm closes in, each circle drifting toward tonight's gate: a random spot, different every night. At 9:00 the
// gate opens and the final boss rises there; once the circle has closed all the way, it grows far stronger.

export const NIGHT_LENGTH = 600;
export const BOSS_AT = 540;
/** [time (s), storm radius (px)]: holds, then shrinks; interpolated between keys */
const STORM_PVE: [number, number][] = [[0, 7800], [120, 7800], [180, 4600], [290, 4600], [350, 2600], [440, 2600], [500, 1100], [BOSS_AT, 1100], [NIGHT_LENGTH, 450]];
/** Battle royale: no gate; the circle keeps closing to nothing, so a match always ends */
const STORM_BR: [number, number][] = [[0, 7800], [90, 7800], [150, 5000], [230, 5000], [290, 3000], [370, 3000], [430, 1600], [500, 1600], [550, 700], [600, 700], [660, 0]];

interface Camp { room: Room; state: 'dormant' | 'active' | 'cleared'; ids: number[]; boss?: EnemyKind }

/** What each place's camps are made of (titan camps add titans on top). */
const MOBS_AT: Record<string, EnemyKind[]> = {
  'ARISE ARENA': ['ghoul', 'caster', 'brute', 'ghoul'],
  'TOJI TOWERS': ['ghoul', 'brute', 'cyclops', 'kappa'],
  'GOJO GATE': ['ghoul', 'caster', 'kappa'],
  'TITAN WALLS': ['brute', 'ghoul', 'cyclops'],
  'RUINED VILLAGE': ['slime', 'skull', 'ghoul', 'lantern'],
  'MIRROR LAKE': ['slime', 'kappa', 'spore', 'viper'],
  'SHADOW WOODS': ['spider', 'viper', 'ghoul', 'spore'],
  'SHIBUYA STATION': ['ghoul', 'flyhead', 'caster', 'phantom'],
  'ASHINA CASTLE': ['ghoul', 'viper', 'kappa', 'caster', 'cyclops'],
  'RED GATE': ['bear', 'phantom', 'skull', 'caster'],
  'FOREST OF GIANT TREES': ['spider', 'viper', 'spore', 'lantern'],
  'JEJU ISLAND': ['larva', 'spider', 'flyhead', 'larva'],
  'THE FIELDS': ['ghoul', 'slime', 'flyhead', 'caster', 'viper', 'skull'],
  'THE OUTLANDS': ['slime', 'flyhead', 'ghoul', 'viper', 'spore'],
  'MT. FUJIKASANE': ['ghoul', 'phantom', 'flyhead'],
  'MT. SAGIRI': ['viper', 'spider', 'ghoul'],
  'TROST DISTRICT': ['ghoul', 'brute', 'skull'],
  'SWORDSMITH VILLAGE': ['kappa', 'ghoul', 'lantern'],
  'KYOTO SCHOOL': ['caster', 'phantom', 'ghoul'],
  'MUGEN TRAIN': ['ghoul', 'flyhead', 'skull', 'caster'],
};
const NAMED_BOSS: Record<string, EnemyKind> = { shadowKnight: 'knight', toji: 'toji', armoredTitan: 'atitan', patchwork: 'patchwork', antking: 'antking', baruka: 'baruka', genichiro: 'genichiro', femaletitan: 'femaletitan' };
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
  /** wandering packs out between the camps (host / solo): their ids, and the time to the next check */
  private roamers = new Set<number>();
  private roamT = 8;

  /** Tonight's seed: picks the lair bosses and the storm's path. Co-op clients take the host's. */
  seed: number;
  /** Where each storm key's circle is centered (same length as the storm table). */
  private centers: { x: number; y: number }[] = [];
  private centersOf: unknown = null;   // the storm table they were laid out for (the mode can change after we're made)
  /** The final boss has gone berserk: the circle closed all the way. */
  enraged = false;

  constructor(private g: Game, seed = Math.floor(Math.random() * 1e9)) {
    this.seed = seed;
    const w = g.level, rand = rng(seed);
    // drop rooms stay quiet so nobody lands in a fight
    for (const r of w.rooms) if (r.kind === 'camp') this.camps.set(r.id, { room: r, state: 'dormant', ids: [] });
    // every named place has its boss, each guarding a unique reward
    const mbs = w.rooms.filter((r) => r.kind === 'miniboss');
    this.activeMb = new Set(mbs.map((r) => r.id));
    // lairs roll tonight's boss from their pool; the gate rolls tonight's final boss
    for (const r of mbs) {
      const pool = r.pool ? LAIR_POOLS[r.pool] : null;
      this.camps.set(r.id, { room: r, state: 'dormant', ids: [], boss: pool ? pool[Math.floor(rand() * pool.length)] : NAMED_BOSS[r.boss!] });
    }
    this.finalBoss = FINALS[Math.floor(rand() * FINALS.length)];
  }
  /** tonight's final boss */
  finalBoss: EnemyKind = 'boss';

  private get table() { return this.g.mode === 'br' ? STORM_BR : STORM_PVE; }

  /** Lay out the storm's path from the seed: pick the gate (open ground, not too near the edge), then let each
   *  circle drift toward it, never poking outside the circle before it. Every machine with the seed agrees. */
  setSeed(seed: number) {
    this.seed = seed;
    const w = this.g.level, rand = rng(seed ^ 0x5707), keys = this.table;
    this.centersOf = keys;
    const c0 = { x: w.width / 2, y: w.height / 2 };
    // how far the circles can carry the center, in total
    let reach = 0;
    for (let i = 1; i < keys.length; i++) reach += Math.max(0, keys[i - 1][1] - keys[i][1]) * 0.9;
    const open = (x: number, y: number) => {
      if (w.solidAt(x, y) || w.roomOf(x, y)) return false;
      let ok = 0;
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; if (!w.solidAt(x + Math.cos(a) * 220, y + Math.sin(a) * 220)) ok++; }
      return ok >= 13;
    };
    let gate = { x: w.arena.cx, y: w.arena.cy - 60 };
    for (let i = 0; i < 400; i++) {
      const x = 700 + rand() * (w.width - 1400), y = 700 + rand() * (w.height - 1400);
      if (Math.hypot(x - c0.x, y - c0.y) < reach && open(x, y)) { gate = { x, y }; break; }
    }
    this.centers = [];
    let c = c0;
    for (let i = 0; i < keys.length; i++) {
      const shrink = i > 0 ? Math.max(0, keys[i - 1][1] - keys[i][1]) : 0;
      if (shrink > 0) {
        // step toward the gate as far as this shrink allows, wandering a little sideways when there's slack
        const dx = gate.x - c.x, dy = gate.y - c.y, d = Math.hypot(dx, dy), step = Math.min(d, shrink * 0.9);
        const slack = shrink * 0.9 - step, side = (rand() - 0.5) * slack * (keys[i][1] > 0 ? 0.8 : 0);
        c = d > 0 ? { x: c.x + (dx / d) * step - (dy / d) * side, y: c.y + (dy / d) * step + (dx / d) * side } : { ...c };
      }
      this.centers.push(c);
    }
    // the last circle lands exactly on the gate
    this.centers[this.centers.length - 1] = gate;
    for (let i = this.centers.length - 2; i >= 0 && keys[i + 1][1] >= keys[i][1]; i--) this.centers[i] = gate;
  }
  /** Where the final boss rises and the storm ends. */
  get gate() { if (this.centersOf !== this.table) this.setSeed(this.seed); return this.centers[this.centers.length - 1]; }

  private lerpAt(t: number) {
    const keys = this.table;
    if (this.centersOf !== keys) this.setSeed(this.seed);
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const k = Math.min(1, Math.max(0, (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]))), a = this.centers[i - 1], b = this.centers[i];
        return { r: keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * k, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    const l = this.centers[this.centers.length - 1];
    return { r: keys[keys.length - 1][1], x: l.x, y: l.y };
  }
  get cx() { return this.lerpAt(this.t).x; }
  get cy() { return this.lerpAt(this.t).y; }
  stormAt(t: number) { return this.lerpAt(t).r; }
  /** Center of the circle the storm is heading to next (for the map). */
  get next() {
    const keys = this.table;
    if (this.centersOf !== keys) this.setSeed(this.seed);
    for (let i = 0; i < keys.length; i++) if (keys[i][0] > this.t && keys[i][1] < this.stormR - 1) return { r: keys[i][1], ...this.centers[i] };
    return { r: this.stormR, x: this.cx, y: this.cy };
  }
  /** The circle has finished closing for good. */
  get closed() { return this.t >= this.table[this.table.length - 1][0]; }
  get stormR() { return this.stormAt(this.t); }
  /** The circle the storm is heading to next (for the minimap). */
  get nextR() { return this.next.r; }
  get closing() { return this.stormAt(this.t + 1) < this.stormR - 0.1; }
  /** Seconds until the circle next starts closing (0 while it is), or null when it never will again. */
  get nextClose(): number | null {
    if (this.closing) return 0;
    const keys = this.table;
    for (let i = 1; i < keys.length; i++) if (keys[i - 1][0] > this.t && keys[i][1] < keys[i - 1][1]) return keys[i - 1][0] - this.t;
    return null;
  }
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
    if (g.mode === 'br') {
      for (const [i, at] of [90, 230, 370, 500, 600].entries()) say(`storm${i}`, at, 'THE SHADOW CLOSES IN', i > 2 ? '#ff6680' : '#b26bff');
    } else {
      say('storm1', 120, 'THE SHADOW CLOSES IN', '#b26bff');
      say('storm2', 290, 'THE SHADOW CLOSES IN', '#b26bff');
      say('storm3', 440, 'THE SHADOW CLOSES IN', '#ff6680');
      say('soon', BOSS_AT - 30, 'THE GATE STIRS', '#ff6680');
    }

    // storm hurts whoever stands in it, more as the night goes on
    if (p.state !== 'dead' && this.outside(p.x, p.y)) {
      this.stormTick -= dt;
      if (this.stormTick <= 0) {
        this.stormTick = 0.5;
        g.stormHurt(Math.round(4 + this.t / 50));
      }
    } else this.stormTick = 0;

    // the circle has closed for good and the final boss still stands: it goes berserk (every machine sees the same
    // clock, so each one does this to its own copy of the boss)
    if (!this.enraged && this.closed && g.mode !== 'br') {
      const boss = g.enemies.find((e): e is Boss => e instanceof Boss && e.final && !e.dead);
      if (boss) {
        this.enraged = boss.enraged = true;
        boss.level += 8;   // ≈ +40% damage
        g.banner(`${boss.name} IS ENRAGED`, '#ff3355', 2.6);
        g.flash('#ff3355', 0.3); g.shake(0.8); g.sfx('roar', boss.x);
        g.fx.ring(boss.x, boss.y, 120, '#ff3355', 0.6, 4);
      }
    }

    if (g.authority) this.direct(dt);
    this.updateLoot(dt);
  }

  /** Host / solo only: wake camps near players, notice cleared ones, open the gate. */
  private direct(dt: number) {
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
    this.roam(players, dt);
    if (!this.bossSpawned && this.t >= BOSS_AT && g.mode !== 'br') {
      this.bossSpawned = true;
      // everyone still out in the dark is pulled to the gate
      for (const e of g.enemies) if (!e.ally && !e.boss) e.dead = true;
      g.enemies = g.enemies.filter((e) => !e.dead);
      const boss = g.spawn(this.finalBoss, this.gate.x, this.gate.y - 60, 12);
      g.banner('THE GATE OPENS', '#ff3355', 3);
      g.coop?.push({ t: 'gate' });
      g.gatePull();
      void boss;
    }
  }

  /** Small packs wander the open ground between places: every few seconds each hunter with few of them nearby gets
   *  one more, out of sight, never inside a camp or near a boss. More and tougher as the night goes on. Packs left
   *  far behind fade away. */
  private roam(players: { x: number; y: number }[], dt: number) {
    const g = this.g, w = g.level;
    this.roamT -= dt;
    for (const id of this.roamers) {
      const e = g.enemies.find((x) => x.id === id);
      if (!e || e.dead) { this.roamers.delete(id); continue; }
      if (players.every((pl) => Math.hypot(pl.x - e.x, pl.y - e.y) > 1600)) { e.dead = true; this.roamers.delete(id); }
    }
    if (this.roamT > 0 || this.bossSpawned || !players.length) return;
    this.roamT = 3;
    const cap = Math.min(8, 3 + Math.floor(this.t / 100));
    for (const pl of players) {
      let near = 0;
      for (const id of this.roamers) { const e = g.enemies.find((x) => x.id === id); if (e && Math.hypot(pl.x - e.x, pl.y - e.y) < 900) near++; }
      if (near >= cap) continue;
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2, d = 560 + Math.random() * 260;
        const x = pl.x + Math.cos(a) * d, y = pl.y + Math.sin(a) * d;
        if (w.solidAt(x, y) || w.roomOf(x, y) || this.outside(x, y)) continue;
        if (players.some((q) => Math.hypot(q.x - x, q.y - y) < 480)) continue;
        if ([...this.camps.values()].some((c) => c.room.kind === 'miniboss' && c.state !== 'cleared' && Math.hypot(c.room.cx - x, c.room.cy - y) < 520)) continue;
        const poi = w.poiAt(x, y)?.name, table = (poi && MOBS_AT[poi]) || MOBS_AT['THE FIELDS'];
        const level = Math.max(1, w.levelAt(x, y) - 1, 1 + Math.floor(this.t / 90));
        const n = 1 + Math.floor(Math.random() * (this.t > 240 ? 3 : 2));
        for (let i = 0; i < n; i++) {
          const kind = table[Math.floor(Math.random() * Math.min(table.length, 3))];
          const e = g.spawn(kind, x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50, level);
          this.roamers.add(e.id);
        }
        break;
      }
    }
  }

  private wake(camp: Camp) {
    const g = this.g, r = camp.room;
    camp.state = 'active';
    if (r.kind === 'miniboss') {
      const e = g.spawn(camp.boss ?? 'knight', r.cx, r.cy, r.level);
      camp.ids.push(e.id);
      return;
    }
    const area = (r.x1 - r.x0) * (r.y1 - r.y0), table = MOBS_AT[r.poi] ?? MOBS_AT['THE FIELDS'];
    const n = r.titans ? 4 : Math.min(7, 3 + Math.floor(area / 45));
    for (let i = 0; i < n; i++) {
      // low-level camps lean on the first (easiest) entries of their table
      const pick = table[Math.floor(Math.random() * Math.min(table.length, 2 + r.level))];
      const kind: EnemyKind = r.titans && i < 2 ? 'titan' : pick;
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

  save(): NightSave {
    return {
      t: Math.round(this.t * 10) / 10,
      cleared: [...this.camps.values()].filter((c) => c.state === 'cleared').map((c) => c.room.id),
      activeMb: [...this.activeMb], bossSpawned: this.bossSpawned, revives: this.revives, said: [...this.said],
      chests: this.chests.filter((c) => !c.opened).map(({ id, x, y }) => ({ id, x, y })),
      drops: this.drops.map((d) => ({ x: Math.round(d.x), y: Math.round(d.y), item: d.item })),
      bosses: [...this.camps.values()].filter((c) => c.room.pool).map((c) => [c.room.id, c.boss!] as [number, string]),
      finalBoss: this.finalBoss, seed: this.seed,
    };
  }

  /** Resume a saved night. Camps that were mid-fight go back to sleep; a gate that was already open opens again. */
  load(s: NightSave) {
    this.t = s.t; this.revives = s.revives; this.said = new Set(s.said);
    this.activeMb = new Set(s.activeMb);
    for (const id of s.cleared) { const c = this.camps.get(id); if (c) c.state = 'cleared'; }
    for (const [id, k] of s.bosses ?? []) { const c = this.camps.get(id); if (c) c.boss = k as EnemyKind; }
    if (s.finalBoss) this.finalBoss = s.finalBoss as EnemyKind;
    if (s.seed !== undefined) this.setSeed(s.seed);
    this.chests = s.chests.map((c) => ({ ...c, opened: false, t: 0 }));
    this.drops = s.drops.map((d) => ({ ...d, z: 0, vz: 0, vx: 0, vy: 0, t: 1 }));
    this.g.nextId = Math.max(this.g.nextId, ...s.chests.map((c) => c.id));
    // the final boss isn't saved: let the director raise it again
    this.bossSpawned = false;
    if (s.bossSpawned) this.said.delete('soon');
  }

  /** Short label for a loot pickup toast. */
  static label(it: Item) { return `${itemName(it)}${it.kind === 'flask' ? '' : ' · ' + RARITY[it.rarity].name}`; }
}
