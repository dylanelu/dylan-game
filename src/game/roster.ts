import type { Item } from './items';

// Every monster and boss beyond the original handful, as data. Sprites are Ninja Adventure (CC0) actors under
// public/assets/vendor/ninja/actors/ (plus a few 0x72 monsters, by anim name). Behaviors live in mobs.ts
// (base enemies, by archetype) and bossmoves.ts (bosses, by move list).

/** A strip of frames from a content sheet: frame i is at (x0 + i·dx, y0 + i·dy). */
export interface AnimSpec { p: string; fw: number; fh: number; n: number; s: number; x0?: number; y0?: number; dx?: number; dy?: number }
/** 0x72 monster by its tiles_list anim name */
export interface TileAnimSpec { tile: string; s: number }
export type SpriteSpec = AnimSpec | TileAnimSpec;

const strip = (p: string, fw: number, fh: number, n: number, s: number): AnimSpec => ({ p, fw, fh, n, s });
/** Ninja monsters / characters: 16×16 cells, a column per facing (down, up, left, right), rows are frames */
const side = (p: string, s: number, rows = 4, row0 = 0): AnimSpec => ({ p, fw: 16, fh: 16, n: rows, s, x0: 48, y0: row0 * 16, dx: 0, dy: 16 });
const front = (p: string, s: number, rows = 4, row0 = 0): AnimSpec => ({ p, fw: 16, fh: 16, n: rows, s, x0: 0, y0: row0 * 16, dx: 0, dy: 16 });

// ------------------------------------------------------------------ base enemies

export type MobKind = 'flyhead' | 'slime' | 'skull' | 'spider' | 'larva' | 'viper' | 'spore' | 'lantern' | 'cyclops' | 'bear' | 'kappa' | 'phantom';
export type Archetype = 'swarm' | 'splitter' | 'exploder' | 'trapper' | 'burrower' | 'lunger' | 'turret' | 'healer' | 'sniper' | 'charger' | 'shielded' | 'phaser';

export interface MobDef {
  name: string; arch: Archetype; sprite: AnimSpec;
  hp: number; speed: number; r: number; dmg: number; xp: number; heavy: number;
  color: string;           // its bullets / glow
  flying?: boolean;
}

export const MOBS: Record<MobKind, MobDef> = {
  flyhead: { name: 'FLY HEAD', arch: 'swarm', sprite: side('monster/Eye.png', 2), hp: 12, speed: 95, r: 7, dmg: 6, xp: 4, heavy: 0.8, color: '#ff8a5a', flying: true },
  slime:   { name: 'GATE SLIME', arch: 'splitter', sprite: side('monster/Slime.png', 2.5), hp: 40, speed: 60, r: 10, dmg: 9, xp: 8, heavy: 1.2, color: '#6ad8ff' },
  skull:   { name: 'BURNING SKULL', arch: 'exploder', sprite: side('monster/Skull.png', 2), hp: 18, speed: 120, r: 8, dmg: 22, xp: 6, heavy: 0.8, color: '#ff6a2a', flying: true },
  spider:  { name: 'WEB SPINNER', arch: 'trapper', sprite: side('monster/SpiderRed.png', 2.5), hp: 30, speed: 70, r: 10, dmg: 8, xp: 9, heavy: 1, color: '#e8e0ff' },
  larva:   { name: 'ANT LARVA', arch: 'burrower', sprite: side('monster/Larva.png', 2.5), hp: 34, speed: 110, r: 10, dmg: 14, xp: 10, heavy: 1.2, color: '#c8a050' },
  viper:   { name: 'VIPER', arch: 'lunger', sprite: side('monster/Snake.png', 2.5), hp: 28, speed: 80, r: 9, dmg: 12, xp: 8, heavy: 1, color: '#8aff6a' },
  spore:   { name: 'SPOREMAW', arch: 'turret', sprite: side('monster/Mushroom.png', 2.5), hp: 50, speed: 22, r: 11, dmg: 8, xp: 10, heavy: 2.5, color: '#d08aff' },
  lantern: { name: 'CURSED LANTERN', arch: 'healer', sprite: side('monster/LanternRed.png', 2.5), hp: 32, speed: 60, r: 9, dmg: 7, xp: 12, heavy: 1, color: '#6aff9a', flying: true },
  cyclops: { name: 'CYCLOPS', arch: 'sniper', sprite: side('monster/Cyclope.png', 3), hp: 60, speed: 45, r: 13, dmg: 18, xp: 14, heavy: 2.5, color: '#ff3355' },
  bear:    { name: 'FROST BEAR', arch: 'charger', sprite: side('monster/Bear.png', 3), hp: 110, speed: 55, r: 15, dmg: 22, xp: 18, heavy: 4, color: '#9ad8ff' },
  kappa:   { name: 'KAPPA', arch: 'shielded', sprite: side('monster/KappaGreen.png', 2.5), hp: 55, speed: 58, r: 11, dmg: 12, xp: 12, heavy: 2, color: '#8ad0a0' },
  phantom: { name: 'PHANTOM', arch: 'phaser', sprite: side('monster/Spirit.png', 2.5), hp: 38, speed: 75, r: 10, dmg: 14, xp: 12, heavy: 1, color: '#b8a8ff', flying: true },
};

// ------------------------------------------------------------------ bosses

export type BossKind =
  | 'sukuna' | 'antares'                                                       // final bosses (one per night)
  | 'patchwork' | 'antking' | 'baruka' | 'genichiro' | 'femaletitan'          // named places
  | 'frog' | 'kingslime' | 'dcyclops' | 'stengu' | 'tanuki' | 'goldtanuki' | 'kraken'
  | 'bamboo' | 'jogo' | 'hanami' | 'kargalgan' | 'vulcan' | 'gravekeeper';   // mini-boss lairs (random each night)

export type Move = 'combo' | 'cleave' | 'lunge' | 'slam' | 'ring' | 'spiral' | 'fan' | 'spray' | 'summon' | 'rain' | 'beam'
  | 'blink' | 'charge' | 'nova' | 'mines' | 'harden';

export interface BossDef {
  name: string; title?: string;
  idle: SpriteSpec; walk?: SpriteSpec; attack?: SpriteSpec;
  hp: number; r: number; speed: number; posture: number;
  /** move pool: [move, weight, minDist, maxDist] */
  moves: [Move, number, number?, number?][];
  color: string;            // bullets, telegraphs
  adds?: string[];          // what `summon` raises
  reward: Item | 'lair';    // 'lair': mini-boss loot plus a chance at a rare ability
  final?: boolean;
  armor?: number;           // damage taken multiplier while not staggered (titans)
  nape?: boolean;           // grapple / thunder spear weak point
  serpent?: boolean;        // drawn as a segmented flying body (Antares)
  fps?: number;
}

const char = (name: string, s: number) => ({ idle: front(`char/${name}.png`, s, 1), walk: side(`char/${name}.png`, s), attack: side(`char/${name}.png`, s, 1, 4) });
const b = (name: string, anim: string, fw: number, fh: number, n: number, s: number) => strip(`boss/${name}/${anim}.png`, fw, fh, n, s);

export const BOSSES: Record<BossKind, BossDef> = {
  // finals --------------------------------------------------------
  sukuna: {
    name: 'SUKUNA', title: 'KING OF CURSES', ...char('Tengu', 6), hp: 2600, r: 20, speed: 70, posture: 220, final: true,
    moves: [['fan', 3, 60], ['cleave', 2, 0, 120], ['beam', 2, 120], ['rain', 2], ['blink', 2], ['mines', 1]],
    color: '#ff2a4a', reward: { kind: 'weapon', key: 'monarch', rarity: 3 },
  },
  antares: {
    name: 'ANTARES', title: 'MONARCH OF DESTRUCTION', idle: b('DragonBlue', 'Head', 44, 46, 1, 2.5), hp: 3000, r: 26, speed: 120, posture: 260, final: true,
    moves: [['spray', 3, 0, 260], ['rain', 2], ['charge', 2, 140], ['ring', 2], ['nova', 1, 0, 160]],
    color: '#6ab0ff', reward: { kind: 'weapon', key: 'monarch', rarity: 3 }, serpent: true,
  },
  // named places --------------------------------------------------
  patchwork: {
    name: 'THE PATCHWORK CURSE', title: 'SHIBUYA STATION', idle: b('GiantSpirit', 'Idle', 50, 50, 5, 2.2), hp: 900, r: 20, speed: 55, posture: 120,
    moves: [['summon', 2], ['beam', 3, 80], ['slam', 2], ['blink', 2], ['ring', 1]],
    color: '#c06aff', adds: ['ghoul', 'ghoul', 'flyhead', 'flyhead'], reward: { kind: 'active', key: 'domain', rarity: 3 },
  },
  antking: {
    name: 'THE ANT KING', title: 'JEJU ISLAND', idle: b('TenguRed', 'Idle', 82, 82, 6, 1.7), walk: b('TenguRed', 'Walk', 82, 82, 10, 1.7), hp: 950, r: 18, speed: 120, posture: 130,
    moves: [['blink', 2], ['lunge', 3, 60], ['combo', 3, 0, 110], ['summon', 1], ['spray', 2, 0, 200]],
    color: '#a0ff4a', adds: ['larva', 'larva', 'larva'], reward: { kind: 'relic', key: 'beru', rarity: 3 },
  },
  baruka: {
    name: 'BARUKA', title: 'RED GATE', ...char('NinjaEskimo', 4.5), hp: 800, r: 14, speed: 110, posture: 110,
    moves: [['blink', 3], ['fan', 3, 60], ['nova', 2, 0, 130], ['combo', 2, 0, 100]],
    color: '#8ae8ff', reward: { kind: 'active', key: 'stealth', rarity: 3 },
  },
  genichiro: {
    name: 'GENICHIRO', title: 'ASHINA CASTLE', ...char('SamuraiBlue', 4.5), hp: 900, r: 14, speed: 90, posture: 150,
    moves: [['combo', 3, 0, 110], ['lunge', 3, 70], ['fan', 2, 140], ['rain', 2]],
    color: '#7ad8ff', reward: { kind: 'relic', key: 'mikiri', rarity: 3 },
  },
  femaletitan: {
    name: 'THE FEMALE TITAN', title: 'FOREST OF GIANT TREES', ...char('Woman', 7), hp: 1300, r: 26, speed: 70, posture: 160,
    moves: [['charge', 3, 120], ['cleave', 3, 0, 130], ['slam', 2], ['summon', 1], ['harden', 1]],
    color: '#ffd88a', adds: ['titan', 'titan'], reward: { kind: 'weapon', key: 'thunder', rarity: 3 }, armor: 0.6, nape: true,
  },
  // mini-boss lairs ------------------------------------------------
  frog:       { name: 'GIANT FROG', idle: b('GiantFrog', 'Idle', 40, 40, 5, 2.5), attack: b('GiantFrog', 'Jump', 40, 40, 6, 2.5), hp: 600, r: 20, speed: 50, posture: 90, moves: [['slam', 3], ['beam', 2, 80], ['ring', 2]], color: '#8aff9a', reward: 'lair' },
  kingslime:  { name: 'KING SLIME', idle: b('GiantSlime', 'Idle', 62, 52, 5, 2), attack: b('GiantSlime', 'Jump', 62, 52, 13, 2), hp: 640, r: 22, speed: 45, posture: 80, moves: [['slam', 4], ['ring', 2], ['summon', 1]], color: '#6ad8ff', adds: ['slime', 'slime'], reward: 'lair' },
  dcyclops:   { name: 'DEMON CYCLOPS', idle: b('DemonCyclop', 'Idle', 50, 50, 5, 2.2), walk: b('DemonCyclop', 'Walk', 50, 50, 6, 2.2), hp: 700, r: 20, speed: 50, posture: 110, moves: [['beam', 3, 90], ['slam', 2], ['cleave', 2, 0, 110]], color: '#ff3355', reward: 'lair' },
  stengu:     { name: 'STORM TENGU', idle: b('TenguBlue', 'Idle', 68, 68, 6, 1.9), walk: b('TenguBlue', 'Walk', 82, 82, 10, 1.6), hp: 620, r: 16, speed: 100, posture: 100, moves: [['fan', 3], ['blink', 2], ['spiral', 2], ['nova', 1, 0, 120]], color: '#9ad8ff', reward: 'lair' },
  tanuki:     { name: 'TANUKI', idle: b('GiantRacoon', 'Idle', 60, 60, 6, 2), attack: b('GiantRacoon', 'Jump', 60, 60, 5, 2), hp: 650, r: 20, speed: 60, posture: 100, moves: [['slam', 3], ['fan', 2], ['charge', 2, 120], ['rain', 1]], color: '#8aff6a', reward: 'lair' },
  goldtanuki: { name: 'GOLDEN TANUKI', idle: b('GiantRacoonGold', 'Idle', 60, 60, 6, 2), attack: b('GiantRacoonGold', 'Jump', 60, 60, 5, 2), hp: 680, r: 20, speed: 60, posture: 100, moves: [['rain', 3], ['slam', 2], ['ring', 2]], color: '#ffd84a', reward: 'lair' },
  kraken:     { name: 'KRAKEN', idle: b('SquidRed', 'Idle', 76, 79, 4, 1.5), attack: b('SquidRed', 'Shoot', 76, 79, 5, 1.5), hp: 700, r: 22, speed: 40, posture: 110, moves: [['spray', 3], ['rain', 2], ['ring', 2]], color: '#a06aff', reward: 'lair' },
  bamboo:     { name: 'BAMBOO GOLEM', idle: b('GiantBamboo', 'Idle', 62, 62, 6, 2), walk: b('GiantBamboo', 'Walk', 62, 62, 12, 2), hp: 720, r: 20, speed: 45, posture: 130, moves: [['charge', 3, 110], ['rain', 2], ['cleave', 2, 0, 110]], color: '#c8e86a', reward: 'lair' },
  jogo:       { name: 'JOGO', idle: b('GiantFlam', 'Idle', 50, 50, 5, 2.2), hp: 660, r: 18, speed: 55, posture: 100, moves: [['mines', 2], ['spiral', 3], ['rain', 2], ['nova', 1, 0, 120]], color: '#ff7a2a', reward: 'lair' },
  hanami:     { name: 'HANAMI', idle: b('GiantBamboo2', 'Idle', 62, 62, 6, 2), walk: b('GiantBamboo2', 'Walk', 62, 62, 12, 2), hp: 700, r: 20, speed: 45, posture: 120, moves: [['rain', 3], ['spray', 2], ['summon', 1], ['cleave', 2, 0, 110]], color: '#ff8ad8', adds: ['spore', 'spore'], reward: 'lair' },
  kargalgan:  { name: 'KARGALGAN', title: 'HIGH ORC SHAMAN', idle: { tile: 'orc_shaman_idle_anim', s: 3.5 }, walk: { tile: 'orc_shaman_run_anim', s: 3.5 }, hp: 600, r: 16, speed: 60, posture: 90, moves: [['summon', 2], ['fan', 3], ['ring', 2], ['blink', 1]], color: '#ff6a3a', adds: ['brute', 'ghoul', 'ghoul'], reward: 'lair' },
  vulcan:     { name: 'VULCAN', title: 'DEMON OF THE CASTLE', idle: { tile: 'big_demon_idle_anim', s: 3 }, walk: { tile: 'big_demon_run_anim', s: 3 }, hp: 780, r: 24, speed: 55, posture: 140, moves: [['slam', 2], ['cleave', 3, 0, 120], ['spiral', 2], ['charge', 2, 120]], color: '#ff4422', reward: 'lair' },
  gravekeeper:{ name: 'THE GRAVEKEEPER', idle: { tile: 'necromancer_idle_anim', s: 3.5 }, hp: 560, r: 14, speed: 55, posture: 90, moves: [['summon', 2], ['spiral', 2], ['blink', 2], ['beam', 2, 90]], color: '#9a6aff', adds: ['phantom', 'ghoul', 'ghoul'], reward: 'lair' },
};

/** Which bosses a lair can roll, by the lair's surroundings. Each lair picks one per night. */
export const LAIR_POOLS: Record<string, BossKind[]> = {
  wild:  ['frog', 'kingslime', 'tanuki', 'goldtanuki', 'bamboo', 'hanami', 'dcyclops', 'stengu'],
  ruin:  ['dcyclops', 'kargalgan', 'vulcan', 'gravekeeper', 'jogo', 'stengu', 'goldtanuki', 'kingslime'],
  water: ['kraken', 'frog', 'kingslime', 'jogo', 'hanami', 'stengu', 'gravekeeper', 'tanuki'],
};
export const FINALS: ('boss' | BossKind)[] = ['boss', 'sukuna', 'antares'];

/** Every content sheet, preloaded by assets.ts. */
export const CONTENT_SHEETS: string[] = [...new Set([
  ...Object.values(MOBS).map((m) => m.sprite.p),
  ...Object.values(BOSSES).flatMap((d) => [d.idle, d.walk, d.attack]).filter((s): s is AnimSpec => !!s && 'p' in s).map((s) => s.p),
  'boss/DragonBlue/Body1.png', 'boss/DragonBlue/Body2.png', 'boss/DragonBlue/BodyEnd.png', 'boss/DragonBlue/Wing.png',
])];
