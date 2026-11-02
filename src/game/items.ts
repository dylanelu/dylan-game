import type { NinjaSheet } from './assets';

// Loot. Sparse on purpose: mini-bosses always drop something good, cleared camps leave a chest,
// everything else rarely drops more than a flask. Rarity scales the numbers.

export const RARITY = [
  { name: 'COMMON', color: '#c8c4d8', mul: 1 },
  { name: 'RARE', color: '#4aa8ff', mul: 1.18 },
  { name: 'EPIC', color: '#b26bff', mul: 1.36 },
  { name: 'LEGENDARY', color: '#ffc83a', mul: 1.6 },
];

/** How a weapon attacks. 'thrown' is the original dagger stream (Player.fire); the rest live in weapons.ts. */
export type WeaponType = 'thrown' | 'katana' | 'fists' | 'greatbow' | 'thunder' | 'invspear' | 'whip';
export interface WeaponDef {
  name: string; type: WeaponType;
  icon: string;                            // 0x72 tile (thrown) ...
  sheet?: [NinjaSheet, number, number];    // ... or a Ninja Adventure sprite [sheet, w, h]
  dmg: number; interval: number; cost: number; color: string;
  // thrown
  shots?: number; spread?: number;         // fan of shots (radians between them)
  parallel?: number;                       // side-by-side shots (px apart)
  speed?: number; pierce?: number; life?: number; big?: boolean;
  // melee: reach (px) and swing width (radians); greatbow: full draw time
  range?: number; arc?: number; draw?: number;
}
export const WEAPONS: Record<string, WeaponDef> = {
  dagger:     { name: 'SHADOW DAGGER', type: 'thrown', icon: 'weapon_knife', shots: 1, spread: 0, parallel: 0, dmg: 9, interval: 0.13, speed: 440, pierce: 0, life: 0.85, big: false, color: '#a45cff', cost: 7 },
  twin:       { name: 'TWIN FANGS', type: 'thrown', icon: 'weapon_duel_sword', shots: 1, spread: 0, parallel: 7, dmg: 6.5, interval: 0.14, speed: 460, pierce: 0, life: 0.8, big: false, color: '#c08aff', cost: 8 },
  scatter:    { name: 'SCATTERFANG', type: 'thrown', icon: 'weapon_saw_sword', shots: 3, spread: 0.2, parallel: 0, dmg: 6, interval: 0.2, speed: 400, pierce: 0, life: 0.55, big: false, color: '#ff8ad8', cost: 10 },
  monarch:    { name: "MONARCH'S EDGE", type: 'thrown', icon: 'weapon_anime_sword', shots: 1, spread: 0, parallel: 0, dmg: 20, interval: 0.3, speed: 380, pierce: 3, life: 1, big: true, color: '#e0c0ff', cost: 12 },
  needle:     { name: 'STORMNEEDLE', type: 'thrown', icon: 'weapon_katana', shots: 1, spread: 0, parallel: 0, dmg: 5.5, interval: 0.07, speed: 560, pierce: 0, life: 0.7, big: false, color: '#7ad8ff', cost: 4.5 },
  // melee is free: mana is for abilities. Slashes cut enemy bullets out of the air (Sekiro).
  kusabimaru: { name: 'KUSABIMARU', type: 'katana', icon: '', sheet: ['WKatana', 6, 14], dmg: 13, interval: 0.24, range: 44, arc: 2.0, color: '#e8dcff', cost: 0 },
  yoru:       { name: 'YORU', type: 'katana', icon: '', sheet: ['WKatana', 6, 14], dmg: 19, interval: 0.33, range: 56, arc: 2.2, color: '#ff5a8a', cost: 0 },
  divergent:  { name: 'DIVERGENT FIST', type: 'fists', icon: '', sheet: ['IconFists', 24, 24], dmg: 7, interval: 0.16, range: 30, arc: 1.6, color: '#7ad8ff', cost: 0 },
  kokusen:    { name: 'KOKUSEN', type: 'fists', icon: '', sheet: ['IconFists', 24, 24], dmg: 9, interval: 0.19, range: 32, arc: 1.7, color: '#ff3355', cost: 0 },
  greatbow:   { name: "HUNTER'S GREATBOW", type: 'greatbow', icon: '', sheet: ['WBow', 15, 7], dmg: 14, interval: 0.2, draw: 0.75, speed: 620, color: '#ffd88a', cost: 5 },
  skypiercer: { name: 'SKYPIERCER', type: 'greatbow', icon: '', sheet: ['WBow', 15, 7], dmg: 19, interval: 0.24, draw: 1.0, speed: 700, color: '#9ad0ff', cost: 7 },
  thunder:    { name: 'THUNDER SPEAR', type: 'thunder', icon: '', sheet: ['WLance2', 7, 21], dmg: 48, interval: 0.45, range: 66, color: '#ffd84a', cost: 0 },
  invspear:   { name: 'INVERTED SPEAR', type: 'invspear', icon: '', sheet: ['WSai', 7, 13], dmg: 21, interval: 0.36, range: 92, color: '#d8ffe8', cost: 0 },
  whip:       { name: 'THOUSAND-MILE CHAIN', type: 'whip', icon: '', sheet: ['WWhip', 9, 13], dmg: 11, interval: 0.42, range: 98, arc: 2.8, color: '#c8c4d8', cost: 0 },
  kusarigama: { name: 'KUSARIGAMA', type: 'whip', icon: '', sheet: ['WWhip', 9, 13], dmg: 15, interval: 0.5, range: 86, arc: 2.6, color: '#ff8a5a', cost: 0 },
};

export interface PassiveDef { name: string; icon: string; desc: string }
export const PASSIVES: Record<string, PassiveDef> = {
  iron:      { name: 'IRON WILL', icon: 'flask_big_red', desc: '+MAX HP' },
  swift:     { name: 'SWIFT STEP', icon: 'flask_big_blue', desc: '+SPEED, FASTER ROLLS' },
  vampire:   { name: 'VAMPIRIC PARRY', icon: 'flask_big_red', desc: 'PERFECT PARRIES HEAL' },
  font:      { name: 'MANA FONT', icon: 'flask_big_blue', desc: '+MANA REGEN' },
  pact:      { name: 'SHADOW PACT', icon: 'flask_big_green', desc: 'KILLS MAY ARISE' },
  deflector: { name: 'DEFLECTOR', icon: 'flask_big_yellow', desc: 'WIDER PERFECT PARRY' },
  execution: { name: 'EXECUTIONER', icon: 'flask_big_yellow', desc: '+CRIT DAMAGE' },
};

/** Active items live in the two ability slots (Q / E, or the thumb buttons) and cost mana (DOMAIN EXPANSION spends its own charge). */
export interface ActiveDef { name: string; icon: NinjaSheet; cost: number; cooldown: number; aimed: boolean; desc: string; color: string }
export const ACTIVES: Record<string, ActiveDef> = {
  summon:  { name: 'SHADOW SUMMON', icon: 'IconSummon', cost: 45, cooldown: 7, aimed: false, desc: 'RAISE TWO SHADOW SOLDIERS', color: '#b26bff' },
  grapple: { name: 'GRAPPLING HOOK', icon: 'IconHook', cost: 8, cooldown: 0.9, aimed: true, desc: 'ZIP TO WALLS, TREES, FOES', color: '#ffc83a' },
  domain:  { name: 'DOMAIN EXPANSION', icon: 'IconDomain', cost: 0, cooldown: 2, aimed: false, desc: 'CHARGE BY PARRIES AND KILLS', color: '#ff3355' },
  ruler:   { name: "RULER'S AUTHORITY", icon: 'IconRuler', cost: 22, cooldown: 1.6, aimed: true, desc: 'TAP: SHOVE  HOLD OR DRAG: PULL', color: '#7ad8ff' },
  exchange:{ name: 'SHADOW EXCHANGE', icon: 'IconExchange', cost: 18, cooldown: 2.5, aimed: true, desc: 'SWAP WITH YOUR SHADOW', color: '#b26bff' },
  stealth: { name: 'STEALTH', icon: 'IconStealth', cost: 35, cooldown: 9, aimed: false, desc: 'VANISH; NEXT HIT CRITS x3', color: '#6aff9a' },
};
/** Relics: unique rewards from the named places' bosses. */
export interface RelicDef { name: string; icon: NinjaSheet; desc: string; color: string }
export const RELICS: Record<string, RelicDef> = {
  boundless: { name: 'BOUNDLESS', icon: 'IconMana', desc: 'UNLIMITED MANA', color: '#7ad8ff' },
  mikiri:    { name: 'MIKIRI COUNTER', icon: 'IconMikiri', desc: 'ROLL INTO A THRUST TO COUNTER', color: '#ffd84a' },
  beru:      { name: 'BERU', icon: 'IconBeru', desc: 'THE ANT KING FOLLOWS YOU', color: '#b26bff' },
};

export type Item =
  | { kind: 'weapon'; key: string; rarity: number }
  | { kind: 'passive'; key: string; rarity: number }
  | { kind: 'active'; key: string; rarity: number }
  | { kind: 'relic'; key: string; rarity: number }
  | { kind: 'flask'; rarity: number };

export function itemName(it: Item) {
  switch (it.kind) {
    case 'flask': return 'HEALING FLASK';
    case 'weapon': return WEAPONS[it.key].name;
    case 'passive': return PASSIVES[it.key].name;
    case 'active': return ACTIVES[it.key].name;
    case 'relic': return RELICS[it.key].name;
  }
}

const pick = <T>(xs: T[], r: () => number) => xs[Math.floor(r() * xs.length)];

/** Roll loot for a source. Mini-bosses: rare+ gear and a flask. Chests: gear or a flask. Elites: often a flask.
 *  Ordinary enemies: now and then a flask, so a long fight away from chests can still be won back. */
export function rollLoot(source: 'miniboss' | 'chest' | 'elite' | 'boss' | 'mob', r = Math.random): Item[] {
  const rarity = (floor: number) => {
    const x = r();
    return Math.max(floor, x < 0.55 ? 0 : x < 0.85 ? 1 : x < 0.97 ? 2 : 3);
  };
  const gear = (floor: number): Item => r() < 0.4
    ? { kind: 'weapon', key: pick(Object.keys(WEAPONS).filter((k) => k !== 'dagger'), r), rarity: rarity(floor) }
    : { kind: 'passive', key: pick(Object.keys(PASSIVES), r), rarity: rarity(floor) };
  switch (source) {
    case 'boss': return [gear(3), { kind: 'flask', rarity: 0 }];
    case 'miniboss': return [gear(1), { kind: 'flask', rarity: 0 }];
    case 'chest': return r() < 0.55 ? [gear(0)] : [{ kind: 'flask', rarity: 0 }];
    case 'elite': return r() < 0.35 ? [{ kind: 'flask', rarity: 0 }] : [];
    case 'mob': return r() < 0.04 ? [{ kind: 'flask', rarity: 0 }] : [];
  }
}

/** XP to go from `level` to the next. */
export const xpToNext = (level: number) => Math.round(28 * Math.pow(level, 1.55));
