// Loot. Sparse on purpose: mini-bosses always drop something good, cleared camps leave a chest,
// everything else rarely drops more than a flask. Rarity scales the numbers.

export const RARITY = [
  { name: 'COMMON', color: '#c8c4d8', mul: 1 },
  { name: 'RARE', color: '#4aa8ff', mul: 1.18 },
  { name: 'EPIC', color: '#b26bff', mul: 1.36 },
  { name: 'LEGENDARY', color: '#ffc83a', mul: 1.6 },
];

export interface WeaponDef {
  name: string; icon: string;
  shots: number; spread: number;          // fan of shots (radians between them)
  parallel: number;                       // side-by-side shots (px apart)
  dmg: number; interval: number; speed: number; pierce: number; life: number;
  big: boolean; color: string; cost: number;
}
export const WEAPONS: Record<string, WeaponDef> = {
  dagger:   { name: 'SHADOW DAGGER', icon: 'weapon_knife', shots: 1, spread: 0, parallel: 0, dmg: 9, interval: 0.13, speed: 440, pierce: 0, life: 0.85, big: false, color: '#a45cff', cost: 7 },
  twin:     { name: 'TWIN FANGS', icon: 'weapon_duel_sword', shots: 1, spread: 0, parallel: 7, dmg: 6.5, interval: 0.14, speed: 460, pierce: 0, life: 0.8, big: false, color: '#c08aff', cost: 8 },
  scatter:  { name: 'SCATTERFANG', icon: 'weapon_saw_sword', shots: 3, spread: 0.2, parallel: 0, dmg: 6, interval: 0.2, speed: 400, pierce: 0, life: 0.55, big: false, color: '#ff8ad8', cost: 10 },
  monarch:  { name: "MONARCH'S EDGE", icon: 'weapon_anime_sword', shots: 1, spread: 0, parallel: 0, dmg: 20, interval: 0.3, speed: 380, pierce: 3, life: 1, big: true, color: '#e0c0ff', cost: 12 },
  needle:   { name: 'STORMNEEDLE', icon: 'weapon_katana', shots: 1, spread: 0, parallel: 0, dmg: 5.5, interval: 0.07, speed: 560, pierce: 0, life: 0.7, big: false, color: '#7ad8ff', cost: 4.5 },
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

export type Item =
  | { kind: 'weapon'; key: string; rarity: number }
  | { kind: 'passive'; key: string; rarity: number }
  | { kind: 'flask'; rarity: number };

export function itemName(it: Item) {
  if (it.kind === 'flask') return 'HEALING FLASK';
  return it.kind === 'weapon' ? WEAPONS[it.key].name : PASSIVES[it.key].name;
}
export function itemIcon(it: Item) {
  if (it.kind === 'flask') return 'flask_red';
  return it.kind === 'weapon' ? WEAPONS[it.key].icon : PASSIVES[it.key].icon;
}

const pick = <T>(xs: T[], r: () => number) => xs[Math.floor(r() * xs.length)];

/** Roll loot for a source. Mini-bosses: rare+ gear and a flask. Chests: gear or a flask. Elites: maybe a flask. */
export function rollLoot(source: 'miniboss' | 'chest' | 'elite' | 'boss', r = Math.random): Item[] {
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
    case 'chest': return r() < 0.65 ? [gear(0)] : [{ kind: 'flask', rarity: 0 }];
    case 'elite': return r() < 0.2 ? [{ kind: 'flask', rarity: 0 }] : [];
  }
}

/** XP to go from `level` to the next. */
export const xpToNext = (level: number) => Math.round(28 * Math.pow(level, 1.55));
