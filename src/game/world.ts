import type { Assets, NinjaSheet, Sprite } from './assets';

// The overworld: one big fixed map with named places, Fortnite-style. Outdoors is the Ninja Adventure pack
// (CC0), the dungeons and fortresses use 0x72's stone. Built from a constant seed so every player and every
// run sees the same map. Drawn in cached 512px chunks.
//
//   ARISE ARENA     center, the old gate dungeon. Shadow Knight in the north chamber (→ Summon); the night's
//                   final boss rises in its great hall, where the storm ends.
//   GOJO GATE       walled courtyard, the only way into ↓
//   TOJI TOWERS     fortress compound, Toji waits in the inner keep (→ unlimited mana)
//   TITAN WALLS     ring-walled district full of titans, the Armored Titan at its heart (→ grappling hook)
//   SHADOW WOODS, MIRROR LAKE, RUINED VILLAGE   wilder ground with camps

export const TILE = 32;
const N = 160;                               // map is N×N tiles
const CHUNK = 16;                            // tiles per chunk side (512px)

export enum T { VOID, GRASS, FOREST, DIRT, SAND, STONE, DUNGEON, WALL, WATER }
const WALKABLE = [false, true, true, true, true, true, true, false, false];

export type RoomKind = 'camp' | 'miniboss' | 'arena' | 'spawn';
export type BossKey = 'shadowKnight' | 'toji' | 'armoredTitan';
export interface Room {
  id: number; kind: RoomKind; x0: number; y0: number; x1: number; y1: number;   // tile rect, inclusive-exclusive
  cx: number; cy: number;                   // center, world px
  ring: number;                             // kept for older callers: 0 center, 1 inner, 2 outer
  level: number;                            // base enemy level here
  poi: string;                              // the named place it belongs to
  boss?: BossKey;
  titans?: boolean;                         // camps in Titan Walls field titans
}
export interface Poi { name: string; x0: number; y0: number; x1: number; y1: number; color: string; indoor: boolean }
/** Solid prop: tree, rock, pillar, tower. Drawn depth-sorted; collides as a circle at its base. */
export interface Column { x: number; y: number; r: number; sheet?: NinjaSheet; sx?: number; sy?: number; sw?: number; sh?: number }
export interface LightSource { x: number; y: number; color: string; radius: number; flicker: number }
export interface Fountain { x: number; y: number; color: 'blue' | 'red' }

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const hash = (x: number, y: number) => {
  let n = x * 374761393 + y * 668265263; n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
};
/** smooth value noise in [0,1] */
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf);
}

// Ninja Adventure sprite rects [x, y, w, h]
const TREES: [number, number, number, number][] = [[0, 0, 32, 32], [32, 0, 32, 32], [256, 0, 32, 32], [224, 0, 32, 32], [0, 288, 48, 48], [48, 288, 48, 48]];
const BIG_TREES: [number, number, number, number][] = [[0, 32, 64, 48], [64, 32, 64, 48], [192, 32, 64, 48]];
const DEAD_TREES: [number, number, number, number][] = [[64, 0, 32, 32], [0, 80, 64, 48]];
const ROCKS: [number, number, number, number][] = [[192, 80, 64, 48], [256, 80, 64, 48]];
const TUFTS: [number, number][] = [[0, 160], [16, 160], [32, 160], [48, 160], [64, 160], [80, 160], [96, 160], [112, 160]];
const FLOWERS: [number, number][] = [[0, 176], [16, 176], [32, 176], [48, 176], [96, 176]];
const TOWERS: [number, number][] = [[0, 32], [32, 32], [96, 32], [0, 0]];   // stone + timber watchtowers on stilts
const FLOOR: Record<number, [number, number][]> = {
  [T.GRASS]: [[0, 12], [0, 12], [0, 12], [3, 11], [2, 12]],
  [T.FOREST]: [[11, 12], [11, 12], [15, 12]],
  [T.DIRT]: [[12, 8], [14, 11]],
  [T.SAND]: [[1, 1], [0, 4], [19, 1]],
};

export class World {
  readonly cols = N;
  readonly rows = N;
  readonly width = N * TILE;
  readonly height = N * TILE;
  readonly terrain = new Uint8Array(N * N);
  /** 1 where walkable (kept for callers that predate terrain types) */
  readonly grid = new Uint8Array(N * N);
  readonly roomAt = new Int16Array(N * N).fill(-1);
  readonly rooms: Room[] = [];
  readonly pois: Poi[] = [];
  readonly columns: Column[] = [];
  readonly fountains: Fountain[] = [];
  readonly lights: LightSource[] = [];
  readonly minimap: Sprite;
  readonly arena: Room;
  readonly spawns: { x: number; y: number }[] = [];
  private decor: { x: number; y: number; sx: number; sy: number }[] = [];
  private propGrid = new Map<number, Column[]>();
  private chunks = new Map<number, Sprite>();
  private decals = new Map<number, { c: Sprite; ctx: CanvasRenderingContext2D }>();

  constructor(private A: Assets, seed = 0x5ad0) {
    const rand = rng(seed);
    const t = this.terrain;
    const set = (x: number, y: number, v: T) => { if (x >= 0 && y >= 0 && x < N && y < N) t[y * N + x] = v; };
    const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < N && y < N ? t[y * N + x] : T.VOID);
    const rect = (x0: number, y0: number, x1: number, y1: number, v: T) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, v); };
    const ring = (x0: number, y0: number, x1: number, y1: number, v: T, th = 1) => {
      rect(x0, y0, x1, y0 + th, v); rect(x0, y1 - th, x1, y1, v); rect(x0, y0, x0 + th, y1, v); rect(x1 - th, y0, x1, y1, v);
    };
    const poi = (name: string, x0: number, y0: number, x1: number, y1: number, color: string, indoor = false) => { this.pois.push({ name, x0, y0, x1, y1, color, indoor }); };
    const room = (kind: RoomKind, x0: number, y0: number, x1: number, y1: number, level: number, poiName: string, extra: Partial<Room> = {}) => {
      const r: Room = { id: this.rooms.length, kind, x0, y0, x1, y1, cx: ((x0 + x1) / 2) * TILE, cy: ((y0 + y1) / 2) * TILE, ring: 2, level, poi: poiName, ...extra };
      this.rooms.push(r);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (x >= 0 && y >= 0 && x < N && y < N) this.roomAt[y * N + x] = r.id;
      return r;
    };

    // ground: grass everywhere, darker patches by noise, a void border
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const edge = x < 2 || y < 3 || x >= N - 2 || y >= N - 2;
      t[y * N + x] = edge ? T.VOID : noise(x / 9, y / 9) > 0.62 ? T.FOREST : T.GRASS;
    }

    // ------------------------------------------------------------ MIRROR LAKE (east)
    for (let y = 70; y < 110; y++) for (let x = 112; x < 158; x++) {
      const d = Math.hypot((x - 136) / 15, (y - 90) / 12) + (noise(x / 4, y / 4) - 0.5) * 0.25;
      if (d < 1) set(x, y, T.WATER);
    }
    poi('MIRROR LAKE', 112, 72, 158, 108, '#6ac8ff');

    // ------------------------------------------------------------ SHADOW WOODS (west)
    poi('SHADOW WOODS', 4, 18, 52, 72, '#7ad08a');
    for (let y = 18; y < 72; y++) for (let x = 4; x < 52; x++) if (get(x, y) === T.GRASS && noise(x / 5 + 40, y / 5) > 0.35) set(x, y, T.FOREST);

    // ------------------------------------------------------------ ARISE ARENA (center dungeon)
    const AX0 = 60, AY0 = 60, AX1 = 100, AY1 = 100;
    rect(AX0, AY0, AX1, AY1, T.WALL);
    const hall = [70, 74, 90, 89], north = [72, 63, 88, 71], west = [62, 76, 68, 87], east = [92, 76, 98, 87], south = [72, 92, 88, 98];
    for (const r of [hall, north, west, east, south]) rect(r[0], r[1], r[2], r[3], T.DUNGEON);
    rect(78, 70, 82, 75, T.DUNGEON);           // hall ↔ north
    rect(67, 79, 71, 83, T.DUNGEON);           // hall ↔ west
    rect(89, 79, 93, 83, T.DUNGEON);           // hall ↔ east
    rect(78, 88, 82, 93, T.DUNGEON);           // hall ↔ south
    rect(58, 79, 63, 83, T.DIRT);              // west gate
    rect(97, 79, 102, 83, T.DIRT);             // east gate
    rect(78, 97, 82, 102, T.DIRT);             // south gate
    poi('ARISE ARENA', AX0, AY0, AX1, AY1, '#b26bff', true);
    this.arena = room('arena', hall[0], hall[1], hall[2], hall[3], 12, 'ARISE ARENA');
    room('miniboss', north[0], north[1], north[2], north[3], 9, 'ARISE ARENA', { boss: 'shadowKnight' });
    room('camp', west[0], west[1], west[2], west[3], 6, 'ARISE ARENA');
    room('camp', east[0], east[1], east[2], east[3], 6, 'ARISE ARENA');
    room('camp', south[0], south[1], south[2], south[3], 5, 'ARISE ARENA');

    // ------------------------------------------------------------ TOJI TOWERS + GOJO GATE (north-east)
    rect(100, 8, 142, 44, T.STONE); ring(100, 8, 142, 44, T.WALL, 2);
    rect(113, 12, 129, 25, T.WALL); rect(115, 14, 127, 24, T.STONE);   // inner keep
    rect(119, 24, 123, 27, T.STONE);                                    // keep door
    poi('TOJI TOWERS', 100, 8, 142, 44, '#ff6a5a');
    room('miniboss', 115, 14, 127, 24, 10, 'TOJI TOWERS', { boss: 'toji' });
    room('camp', 103, 28, 112, 41, 7, 'TOJI TOWERS');
    room('camp', 130, 28, 139, 41, 7, 'TOJI TOWERS');
    room('camp', 103, 11, 111, 22, 8, 'TOJI TOWERS');
    // the gate courtyard below: the only way in
    rect(110, 44, 132, 56, T.STONE); ring(110, 44, 132, 56, T.WALL, 2);
    rect(118, 42, 124, 46, T.STONE);           // north gate into the towers
    rect(118, 54, 124, 58, T.DIRT);            // south gate from the world
    poi('GOJO GATE', 110, 44, 132, 56, '#7ad8ff');
    room('camp', 112, 46, 130, 54, 5, 'GOJO GATE');

    // ------------------------------------------------------------ TITAN WALLS (south-west)
    const TX = 34, TY = 124, TR = 24;
    for (let y = TY - TR - 2; y <= TY + TR + 2; y++) for (let x = TX - TR - 2; x <= TX + TR + 2; x++) {
      const d = Math.hypot(x - TX, y - TY);
      if (d < TR - 1) set(x, y, noise(x / 6, y / 6) > 0.55 ? T.DIRT : T.SAND);
      else if (d < TR + 1) set(x, y, T.WALL);
    }
    rect(TX - 2, TY - TR - 2, TX + 3, TY - TR + 2, T.DIRT);   // north gate
    rect(TX + TR - 2, TY - 2, TX + TR + 3, TY + 3, T.DIRT);   // east gate
    poi('TITAN WALLS', TX - TR, TY - TR, TX + TR, TY + TR, '#ffb46a');
    room('miniboss', TX - 7, TY - 6, TX + 7, TY + 6, 9, 'TITAN WALLS', { boss: 'armoredTitan' });
    room('camp', TX - 18, TY - 14, TX - 8, TY - 4, 6, 'TITAN WALLS', { titans: true });
    room('camp', TX + 6, TY + 7, TX + 18, TY + 17, 7, 'TITAN WALLS', { titans: true });
    room('camp', TX - 16, TY + 6, TX - 5, TY + 16, 6, 'TITAN WALLS');

    // ------------------------------------------------------------ RUINED VILLAGE (south-east)
    poi('RUINED VILLAGE', 102, 112, 152, 152, '#d8c8a0');
    for (let y = 114; y < 150; y++) for (let x = 104; x < 150; x++) if (noise(x / 5 + 9, y / 5 + 3) > 0.48) set(x, y, T.DIRT);
    room('camp', 108, 118, 120, 128, 3, 'RUINED VILLAGE');
    room('camp', 128, 126, 142, 138, 4, 'RUINED VILLAGE');
    room('camp', 112, 138, 124, 148, 3, 'RUINED VILLAGE');

    // wilder camps
    room('camp', 14, 28, 24, 36, 1, 'SHADOW WOODS');
    room('camp', 32, 44, 42, 52, 2, 'SHADOW WOODS');
    room('camp', 16, 58, 26, 66, 2, 'SHADOW WOODS');
    room('camp', 112, 64, 122, 72, 3, 'MIRROR LAKE');
    room('camp', 120, 108, 132, 114, 3, 'MIRROR LAKE');
    room('camp', 64, 16, 76, 26, 2, 'THE FIELDS');
    room('camp', 64, 128, 76, 138, 3, 'THE FIELDS');

    // ------------------------------------------------------------ roads between places
    const road = (x0: number, y0: number, x1: number, y1: number) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= steps; i++) {
        const k = i / steps, wob = (noise(i / 7, x0 + y0) - 0.5) * 4;
        const x = Math.round(x0 + (x1 - x0) * k + (y1 !== y0 ? wob : 0)), y = Math.round(y0 + (y1 - y0) * k + (x1 !== x0 ? wob : 0));
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const v = get(x + dx, y + dy);
          if (v === T.GRASS || v === T.FOREST) set(x + dx, y + dy, T.DIRT);
        }
      }
    };
    road(58, 81, 28, 81); road(28, 81, 26, 46);              // west gate → woods
    road(80, 102, 80, 112); road(80, 112, 36, 112); road(36, 112, 36, 98);   // south gate → titan north gate
    road(80, 112, 116, 112); road(116, 112, 116, 120);       // → village
    road(102, 81, 112, 81); road(112, 81, 112, 60); road(112, 60, 121, 60); road(121, 60, 121, 57);   // east gate → gojo
    road(60, 81, 60, 40); road(60, 40, 70, 22);              // → fields north
    road(58 + TR, TY, 70, 132);                              // titan east gate → fields south

    // ------------------------------------------------------------ props
    const W = (x: number, y: number) => WALKABLE[get(x, y)];
    const clearOf = (x: number, y: number, pad: number) => {
      for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) {
        const v = get(x + dx, y + dy);
        if (v === T.DIRT || v === T.WALL || v === T.WATER || v === T.STONE || v === T.DUNGEON || v === T.SAND || v === T.VOID) return false;
        if (this.roomAt[(y + dy) * N + x + dx] >= 0) return false;
      }
      return true;
    };
    for (let y = 4; y < N - 4; y += 2) for (let x = 4; x < N - 4; x += 2) {
      const v = get(x, y), r = hash(x * 3, y * 7);
      const inWoods = x < 52 && y > 18 && y < 72;
      const density = v === T.FOREST ? (inWoods ? 0.55 : 0.32) : v === T.GRASS ? 0.07 : 0;
      if (r < density && clearOf(x, y, 1)) {
        const big = hash(y, x) < 0.25 && clearOf(x, y, 2);
        const set0 = big ? BIG_TREES : inWoods && hash(x, y * 3) < 0.25 ? DEAD_TREES : TREES;
        const s = set0[Math.floor(hash(x + 1, y) * set0.length)];
        this.addProp({ x: x * TILE + 16, y: y * TILE + 26, r: big ? 18 : 11, sheet: 'TilesetNature', sx: s[0], sy: s[1], sw: s[2], sh: s[3] });
      } else if (v === T.GRASS && r > 0.985 && clearOf(x, y, 1)) {
        const s = ROCKS[Math.floor(hash(x, y + 5) * ROCKS.length)];
        this.addProp({ x: x * TILE + 16, y: y * TILE + 24, r: 22, sheet: 'TilesetNature', sx: s[0], sy: s[1], sw: s[2], sh: s[3] });
      }
      // grass tufts and flowers, no collision
      if ((v === T.GRASS || v === T.FOREST) && hash(x * 11, y * 13) < 0.42) {
        const d = hash(x, y * 17) < 0.25 ? FLOWERS[Math.floor(hash(x * 5, y) * FLOWERS.length)] : TUFTS[Math.floor(hash(x * 7, y) * TUFTS.length)];
        this.decor.push({ x: x * TILE + Math.floor(hash(x, y + 1) * 16), y: y * TILE + Math.floor(hash(x + 2, y) * 16), sx: d[0], sy: d[1] });
      }
    }
    // towers along the Toji compound walls and the gate
    for (const [tx, ty] of [[103, 10], [138, 10], [103, 41], [138, 41], [112, 46], [129, 46], [115, 26], [126, 26]]) {
      const s = TOWERS[Math.floor(hash(tx, ty) * TOWERS.length)];
      this.addProp({ x: tx * TILE + 16, y: ty * TILE + 28, r: 14, sheet: 'TilesetTowers', sx: s[0], sy: s[1], sw: 32, sh: 32 });
      this.lights.push({ x: tx * TILE + 16, y: ty * TILE, color: '#ff9a3c', radius: 110, flicker: 0.3 });
    }
    // pillars inside Arise Arena (0x72 columns, drawn by drawColumn)
    for (const [tx, ty] of [[72, 76], [87, 76], [72, 86], [87, 86], [74, 65], [85, 65]]) this.addProp({ x: tx * TILE + 16, y: ty * TILE + 28, r: 12 });
    // ruined pillars in Titan Walls and the village
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, d = 5 + rand() * (TR - 7);
      const x = Math.round(TX + Math.cos(a) * d), y = Math.round(TY + Math.sin(a) * d);
      if (this.roomAt[y * N + x] < 0 && W(x, y)) this.addProp({ x: x * TILE + 16, y: y * TILE + 28, r: 12 });
    }
    for (let i = 0; i < 16; i++) {
      const x = 106 + Math.floor(rand() * 42), y = 116 + Math.floor(rand() * 32);
      if (this.roomAt[y * N + x] < 0 && W(x, y)) this.addProp({ x: x * TILE + 16, y: y * TILE + 28, r: 14, sheet: 'TilesetTowers', sx: 224, sy: 64, sw: 32, sh: 32 });
    }

    // fountains + braziers in the dungeon, campfire glow at outdoor camps
    for (const [fx, fy, c] of [[79, 73, 'red'], [79, 62, 'red'], [64, 75, 'blue'], [94, 75, 'blue']] as [number, number, 'red' | 'blue'][]) {
      if (get(fx, fy) === T.WALL && get(fx + 1, fy) === T.WALL) {
        this.fountains.push({ x: fx * TILE, y: fy * TILE, color: c });
        this.lights.push({ x: fx * TILE + 16, y: (fy + 1) * TILE + 8, color: c === 'blue' ? '#4a6cff' : '#ff3a3a', radius: 120, flicker: 0.12 });
      }
    }
    for (const r of this.rooms) {
      const indoor = get(Math.floor(r.cx / TILE), Math.floor(r.cy / TILE)) === T.DUNGEON || get(Math.floor(r.cx / TILE), Math.floor(r.cy / TILE)) === T.STONE;
      if (!indoor) {
        // out under the moon a camp is one campfire, not four floodlights
        this.lights.push({ x: r.cx, y: r.cy, color: r.kind === 'miniboss' ? '#ff5a2a' : '#ff9a3c', radius: 100, flicker: 0.3 });
        continue;
      }
      for (const [bx, by] of [[r.x0 + 1, r.y0 + 1], [r.x1 - 2, r.y0 + 1], [r.x0 + 1, r.y1 - 2], [r.x1 - 2, r.y1 - 2]]) {
        this.lights.push({ x: bx * TILE + 16, y: by * TILE + 16, color: r.kind === 'miniboss' ? '#ff5a2a' : '#ff9a3c', radius: 110, flicker: 0.3 });
      }
    }

    // drop points around the rim, on open grass
    for (const [x, y] of [[24, 10], [80, 8], [150, 30], [150, 60], [146, 156], [80, 152], [8, 96], [10, 150], [60, 50], [96, 136]]) {
      let px = x, py = y;
      for (let k = 0; k < 40 && !(W(px, py) && this.roomAt[py * N + px] < 0); k++) { px = x + Math.round((rand() - 0.5) * 10); py = y + Math.round((rand() - 0.5) * 10); }
      this.spawns.push({ x: px * TILE + 16, y: py * TILE + 16 });
    }

    for (let i = 0; i < N * N; i++) this.grid[i] = WALKABLE[t[i]] ? 1 : 0;

    // minimap: terrain colors, places tinted
    const mm = document.createElement('canvas'); mm.width = N; mm.height = N;
    const mctx = mm.getContext('2d')!, img = mctx.createImageData(N, N);
    const MM: Record<number, number[]> = {
      [T.VOID]: [8, 7, 14], [T.GRASS]: [58, 78, 52], [T.FOREST]: [38, 60, 40], [T.DIRT]: [96, 76, 56], [T.SAND]: [120, 104, 76],
      [T.STONE]: [92, 88, 100], [T.DUNGEON]: [70, 60, 92], [T.WALL]: [30, 26, 40], [T.WATER]: [52, 96, 140],
    };
    for (let i = 0; i < N * N; i++) img.data.set([...MM[t[i]], 255], i * 4);
    mctx.putImageData(img, 0, 0);
    mctx.fillStyle = 'rgba(20,40,20,0.9)';
    for (const c of this.columns) if (c.sheet === 'TilesetNature') mctx.fillRect(Math.floor(c.x / TILE), Math.floor(c.y / TILE) - 1, 1, 1);
    this.minimap = mm;
  }

  private addProp(c: Column) {
    this.columns.push(c);
    const k = Math.floor(c.x / 256) * 1000 + Math.floor(c.y / 256);
    let b = this.propGrid.get(k);
    if (!b) { b = []; this.propGrid.set(k, b); }
    b.push(c);
  }
  /** props in the 3×3 buckets around a point (buckets are 256px) */
  private near(x: number, y: number) {
    const bx = Math.floor(x / 256), by = Math.floor(y / 256), out: Column[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const b = this.propGrid.get((bx + dx) * 1000 + by + dy); if (b) out.push(...b); }
    return out;
  }

  terrainAt(x: number, y: number): T {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return tx >= 0 && ty >= 0 && tx < N && ty < N ? this.terrain[ty * N + tx] : T.VOID;
  }
  floorAt(tx: number, ty: number) { return tx >= 0 && ty >= 0 && tx < N && ty < N && this.grid[ty * N + tx] === 1; }
  solidAt(x: number, y: number) { return !this.floorAt(Math.floor(x / TILE), Math.floor(y / TILE)); }
  /** Under a roof: dungeon or fortress stone. Used for lighting and ambience. */
  indoorAt(x: number, y: number) { const v = this.terrainAt(x, y); return v === T.DUNGEON; }
  poiAt(x: number, y: number): Poi | null {
    const tx = x / TILE, ty = y / TILE;
    for (const p of this.pois) if (tx >= p.x0 && tx < p.x1 && ty >= p.y0 && ty < p.y1) return p;
    return null;
  }
  roomOf(x: number, y: number): Room | null {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= N || ty >= N) return null;
    const id = this.roomAt[ty * N + tx];
    return id >= 0 ? this.rooms[id] : null;
  }
  /** Enemy level for a spot: its room's level, else by distance from the arena. */
  levelAt(x: number, y: number) {
    const r = this.roomOf(x, y);
    if (r) return r.level;
    const d = Math.hypot(x - this.arena.cx, y - this.arena.cy) / (this.width / 2);
    return d > 0.7 ? 1 : d > 0.45 ? 3 : 5;
  }

  /** Push a circle (feet) out of walls, water and props. Returns true if it collided. */
  collide(p: { x: number; y: number }, r: number) {
    let hit = false;
    const ry = r * 0.5;
    if (this.solidAt(p.x - r, p.y)) { p.x = (Math.floor((p.x - r) / TILE) + 1) * TILE + r; hit = true; }
    if (this.solidAt(p.x + r, p.y)) { p.x = Math.floor((p.x + r) / TILE) * TILE - r - 0.01; hit = true; }
    if (this.solidAt(p.x, p.y - ry - 4)) { p.y = (Math.floor((p.y - ry - 4) / TILE) + 1) * TILE + ry + 4; hit = true; }
    if (this.solidAt(p.x, p.y + 2)) { p.y = Math.floor((p.y + 2) / TILE) * TILE - 2.01; hit = true; }
    for (const c of this.near(p.x, p.y)) {
      if (Math.abs(p.x - c.x) > 50 || Math.abs(p.y - c.y) > 50) continue;
      const dx = p.x - c.x, dy = (p.y - c.y) * 1.6, d = Math.hypot(dx, dy), m = c.r + r;
      if (d < m && d > 0.001) { p.x = c.x + (dx / d) * m; p.y = c.y + (dy / d) * m / 1.6; hit = true; }
    }
    return hit;
  }

  /** Bullets (at ground position) die on walls, the map edge and prop bodies. Water doesn't stop them. */
  blocks(x: number, y: number) {
    const v = this.terrainAt(x, y);
    if (v === T.WALL || v === T.VOID) return true;
    for (const c of this.near(x, y)) if (Math.abs(x - c.x) < c.r + 1 && y < c.y + 2 && y > c.y - (c.sh ? c.sh * 1.6 : 54)) return true;
    return false;
  }
  /** Something a grappling hook can bite into at this point: a wall, a tree, a rock, a pillar. */
  anchorAt(x: number, y: number) {
    if (this.terrainAt(x, y) === T.WALL) return true;
    for (const c of this.near(x, y)) if (Math.abs(x - c.x) < c.r + 6 && y < c.y + 6 && y > c.y - (c.sh ? c.sh * 1.8 : 60)) return true;
    return false;
  }

  /** A random walkable spot inside a room, at least `pad` tiles from its edge. */
  spotIn(r: Room, rand = Math.random, pad = 2) {
    for (let i = 0; i < 30; i++) {
      const x = (r.x0 + pad + rand() * Math.max(1, r.x1 - r.x0 - pad * 2)) * TILE, y = (r.y0 + pad + rand() * Math.max(1, r.y1 - r.y0 - pad * 2)) * TILE;
      if (!this.solidAt(x, y) && !this.near(x, y).some((c) => Math.hypot(c.x - x, c.y - y) < c.r + 14)) return { x, y };
    }
    return { x: r.cx, y: r.cy };
  }

  // ---------------------------------------------------------------- drawing

  /** Wall autotile (0x72 stone): picks the piece a wall tile shows based on the walkable ground around it. */
  private wallTile(tx: number, ty: number): string | null {
    const f = (dx: number, dy: number) => this.floorAt(tx + dx, ty + dy);
    if (f(0, 1)) return 'wall_mid';
    if (f(0, 2)) return 'wall_top_mid';
    if (f(1, 0) || f(1, 1)) return 'wall_side_mid_left';
    if (f(-1, 0) || f(-1, 1)) return 'wall_side_mid_right';
    if (f(0, -1)) return 'wall_top_mid';
    if (f(1, -1)) return 'wall_side_mid_left';
    if (f(-1, -1)) return 'wall_side_mid_right';
    return 'wall_top_mid';
  }

  private chunk(cx: number, cy: number): Sprite {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (c) return c;
    const S = CHUNK * TILE;
    c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
    g.fillStyle = '#07060c'; g.fillRect(0, 0, S, S);
    const floors = ['floor_2', 'floor_3', 'floor_4', 'floor_5', 'floor_6', 'floor_7', 'floor_8'];
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
      const tx = cx * CHUNK + x, ty = cy * CHUNK + y;
      if (tx >= N || ty >= N) continue;
      const v = this.terrain[ty * N + tx], h = hash(tx, ty);
      const px = x * TILE, py = y * TILE;
      if (v === T.DUNGEON || v === T.STONE) {
        const cracked = v === T.DUNGEON ? 0.3 : 0.15;
        g.drawImage(this.A.tile(h < 1 - cracked ? 'floor_1' : floors[Math.floor(hash(ty, tx) * floors.length)]), px, py);
      } else if (v === T.WALL) {
        g.drawImage(this.A.tile(this.wallTile(tx, ty)!), px, py);
        if (this.floorAt(tx, ty + 1) && hash(tx * 7, ty * 3) < 0.07) g.drawImage(this.A.tile(hash(tx, ty * 5) < 0.5 ? 'wall_banner_red' : 'wall_banner_blue'), px, py);
      } else if (v === T.WATER) {
        const deep = [this.terrain[(ty - 1) * N + tx], this.terrain[(ty + 1) * N + tx], this.terrain[ty * N + tx - 1], this.terrain[ty * N + tx + 1]].every((n) => n === T.WATER);
        g.drawImage(this.A.nt('TilesetWater', deep ? 176 : 16, deep ? 0 : 16, 16, 16), px, py);
      } else if (v !== T.VOID) {
        const opts = FLOOR[v] ?? FLOOR[T.GRASS];
        const [fx, fy] = opts[Math.floor(h * opts.length)];
        g.drawImage(this.A.nt('TilesetFloor', fx * 16, fy * 16, 16, 16), px, py);
        this.texture(g, v, tx, ty, px, py);
        // soften terrain seams with a dark lip where a lighter ground meets a darker one
        const below = ty + 1 < N ? this.terrain[(ty + 1) * N + tx] : v;
        if (below !== v && (below === T.WATER || below === T.WALL)) { g.fillStyle = 'rgba(10,8,20,0.35)'; g.fillRect(px, py + TILE - 3, TILE, 3); }
      }
    }
    for (const d of this.decor) {
      const dx = d.x - cx * S, dy = d.y - cy * S;
      if (dx > -32 && dy > -32 && dx < S && dy < S) g.drawImage(this.A.nt('TilesetNature', d.sx, d.sy, 16, 16), Math.round(dx), Math.round(dy));
    }
    for (const f of this.fountains) {
      const fx = f.x - cx * S, fy = f.y - cy * S;
      if (fx > -TILE && fy > -TILE * 2 && fx < S && fy < S) g.drawImage(this.A.tile('wall_fountain_top'), fx, fy - TILE);
    }
    this.chunks.set(key, c);
    if (this.chunks.size > 30) this.chunks.delete(this.chunks.keys().next().value!);
    return c;
  }

  /** The pack's ground tiles are flat color; pixel speckles, blade strokes and ragged seams give them grain. */
  private texture(g: CanvasRenderingContext2D, v: T, tx: number, ty: number, px: number, py: number) {
    const shade: Record<number, [string, string]> = {
      [T.GRASS]: ['rgba(40,70,20,0.35)', 'rgba(220,240,140,0.22)'],
      [T.FOREST]: ['rgba(10,40,10,0.4)', 'rgba(160,210,110,0.18)'],
      [T.DIRT]: ['rgba(60,30,10,0.35)', 'rgba(240,200,150,0.2)'],
      [T.SAND]: ['rgba(120,70,20,0.25)', 'rgba(255,240,200,0.3)'],
    };
    const sh = shade[v];
    if (!sh) return;
    for (let i = 0; i < 9; i++) {
      const r = hash(tx * 31 + i, ty * 17 - i);
      const x = px + Math.floor(hash(tx + i * 7, ty) * 15) * 2, y = py + Math.floor(hash(tx, ty + i * 5) * 15) * 2;
      g.fillStyle = r < 0.6 ? sh[0] : sh[1];
      if (v === T.GRASS || v === T.FOREST) { g.fillRect(x, y, 2, 4); }   // little blades
      else g.fillRect(x, y, 2, 2);
    }
    // ragged seam: neighbouring ground bleeds a few pixels across the tile edge
    const nb = (dx: number, dy: number) => { const xx = tx + dx, yy = ty + dy; return xx >= 0 && yy >= 0 && xx < N && yy < N ? this.terrain[yy * N + xx] : v; };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = nb(dx, dy);
      if (o === v || !(o === T.GRASS || o === T.FOREST || o === T.DIRT || o === T.SAND)) continue;
      const opts = FLOOR[o]!, [fx, fy] = opts[0];
      const src = this.A.nt('TilesetFloor', fx * 16, fy * 16, 16, 16);
      for (let i = 0; i < 10; i++) {
        const along = Math.floor(hash(tx * 13 + i, ty * 7 + dx + dy * 3) * 16) * 2, depth = 2 + Math.floor(hash(tx + i, ty * 3 + dy) * 3) * 2;
        const x = dx === 1 ? px + TILE - depth : dx === -1 ? px : px + along;
        const y = dy === 1 ? py + TILE - depth : dy === -1 ? py : py + along;
        const w = dx ? depth : 2, h = dy ? depth : 2;
        g.drawImage(src, 0, 0, 2, 2, x, y, w, h);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, time: number) {
    const S = CHUNK * TILE;
    const x0 = Math.floor(camX / S), y0 = Math.floor(camY / S), x1 = Math.floor((camX + w) / S), y1 = Math.floor((camY + h) / S);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cy < 0 || cx * CHUNK >= N || cy * CHUNK >= N) continue;
      ctx.drawImage(this.chunk(cx, cy), cx * S - camX, cy * S - camY);
      const d = this.decals.get(cy * 1000 + cx);
      if (d) ctx.drawImage(d.c, cx * S - camX, cy * S - camY);
    }
    const f = Math.floor(time * 8) % 3;
    for (const ft of this.fountains) {
      if (ft.x < camX - TILE || ft.x > camX + w || ft.y < camY - TILE * 3 || ft.y > camY + h) continue;
      ctx.drawImage(this.A.tile(`wall_fountain_mid_${ft.color}_anim`, f), Math.round(ft.x - camX), Math.round(ft.y - camY));
      ctx.drawImage(this.A.tile(`wall_fountain_basin_${ft.color}_anim`, f), Math.round(ft.x - camX), Math.round(ft.y + TILE - camY));
    }
  }

  /** Props in view, for the depth-sorted entity pass. */
  propsIn(camX: number, camY: number, w: number, h: number) {
    const out: Column[] = [];
    const bx0 = Math.floor((camX - 80) / 256), bx1 = Math.floor((camX + w + 80) / 256), by0 = Math.floor((camY - 40) / 256), by1 = Math.floor((camY + h + 140) / 256);
    for (let bx = bx0; bx <= bx1; bx++) for (let by = by0; by <= by1; by++) {
      const b = this.propGrid.get(bx * 1000 + by);
      if (b) for (const c of b) if (c.x > camX - 80 && c.x < camX + w + 80 && c.y > camY - 20 && c.y < camY + h + 140) out.push(c);
    }
    return out;
  }

  drawColumn(ctx: CanvasRenderingContext2D, c: Column, camX: number, camY: number) {
    if (c.sheet) {
      const img = this.A.nt(c.sheet, c.sx!, c.sy!, c.sw!, c.sh!);
      ctx.drawImage(img, Math.round(c.x - img.width / 2 - camX), Math.round(c.y + 6 - img.height - camY));
      return;
    }
    const x = Math.round(c.x - 16 - camX), y = Math.round(c.y - 28 - camY);
    ctx.drawImage(this.A.tile('column_mid'), x, y);
    ctx.drawImage(this.A.tile('column_top'), x, y - TILE);
  }

  /** Blood and scorch marks, painted into lazily-created per-chunk decal layers. */
  splat(x: number, y: number, color: string, n: number, size: number) {
    const S = CHUNK * TILE, cx = Math.floor(x / S), cy = Math.floor(y / S);
    if (cx < 0 || cy < 0 || cx * CHUNK >= N || cy * CHUNK >= N) return;
    const key = cy * 1000 + cx;
    let d = this.decals.get(key);
    if (!d) {
      const c = document.createElement('canvas'); c.width = S; c.height = S;
      d = { c, ctx: c.getContext('2d')! };
      this.decals.set(key, d);
    }
    d.ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * size, s = 1 + Math.floor(Math.random() * 3);
      d.ctx.fillRect(Math.round(x - cx * S + Math.cos(a) * r * 1.4), Math.round(y - cy * S + Math.sin(a) * r * 0.7), s, Math.max(1, s - 1));
    }
  }
}
