import type { Assets, Sprite } from './assets';

// The gate: one huge, fixed dungeon city. A 6×6 grid of rooms joined by wide corridors, a great hall in the
// middle where the final boss waits, mini-boss arenas on the corners and edges. Built from a constant seed,
// so every player and every run sees the same map. Drawn in cached 512px chunks; nothing is baked whole.

export const TILE = 32;
const CELLS = 6, CELL = 20;                 // macro grid: 6×6 cells of 20×20 tiles
const CHUNK = 16;                           // tiles per chunk side (512px)

export type RoomKind = 'camp' | 'miniboss' | 'arena' | 'spawn';
export interface Room {
  id: number; kind: RoomKind; x0: number; y0: number; x1: number; y1: number;   // tile rect, inclusive-exclusive
  cx: number; cy: number;                   // center, world px
  ring: number;                             // 0 = center, 1 = inner, 2 = outer
  level: number;                            // base enemy level here
}
export interface Column { x: number; y: number; r: number }
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

export class World {
  readonly cols = CELLS * CELL;
  readonly rows = CELLS * CELL;
  readonly width = this.cols * TILE;
  readonly height = this.rows * TILE;
  readonly grid: Uint8Array;                // 1 = floor
  readonly roomAt: Int16Array;              // room id per tile, -1 in corridors/void
  readonly rooms: Room[] = [];
  readonly columns: Column[] = [];
  readonly fountains: Fountain[] = [];
  readonly lights: LightSource[] = [];
  readonly minimap: Sprite;                 // 1px per tile
  readonly arena: Room;
  private chunks = new Map<number, Sprite>();
  private decals = new Map<number, { c: Sprite; ctx: CanvasRenderingContext2D }>();
  private skulls: { x: number; y: number }[] = [];

  constructor(private A: Assets, seed = 0x5ad0) {
    const rand = rng(seed);
    const W = this.cols, H = this.rows;
    this.grid = new Uint8Array(W * H);
    this.roomAt = new Int16Array(W * H).fill(-1);
    const carve = (x0: number, y0: number, x1: number, y1: number, room = -1) => {
      for (let y = Math.max(2, y0); y < Math.min(H - 2, y1); y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
        this.grid[y * W + x] = 1;
        if (room >= 0) this.roomAt[y * W + x] = room;
      }
    };

    // rooms: the center 2×2 cells merge into the great hall
    const cellRoom: number[][] = [];
    const minibossCells = new Set(['0,0', '5,0', '0,5', '5,5', '2,0', '3,5']);
    for (let cy = 0; cy < CELLS; cy++) {
      cellRoom.push([]);
      for (let cx = 0; cx < CELLS; cx++) {
        const center = (cx === 2 || cx === 3) && (cy === 2 || cy === 3);
        if (center) {
          if (cx === 2 && cy === 2) {
            const id = this.rooms.length;
            const r = this.addRoom(id, 'arena', 2 * CELL + 4, 2 * CELL + 4, 4 * CELL - 4, 4 * CELL - 3, 0, 12);
            carve(r.x0, r.y0, r.x1, r.y1, id);
          }
          cellRoom[cy].push(this.rooms.length - 1 - (cx === 2 && cy === 2 ? 0 : 0));
          continue;
        }
        const ring = Math.max(Math.abs(cx - 2.5), Math.abs(cy - 2.5)) > 2 ? 2 : 1;
        const isMb = minibossCells.has(`${cx},${cy}`);
        const w = isMb ? 16 : 9 + Math.floor(rand() * 7), h = isMb ? 14 : 8 + Math.floor(rand() * 6);
        const x0 = cx * CELL + 2 + Math.floor(rand() * (CELL - 4 - w)), y0 = cy * CELL + 3 + Math.floor(rand() * (CELL - 5 - h));
        const kind: RoomKind = isMb ? 'miniboss' : ring === 2 && rand() < 0.45 ? 'spawn' : 'camp';
        const base = ring === 2 ? 1 + Math.floor(rand() * 3) : 4 + Math.floor(rand() * 3);
        const id = this.rooms.length;
        const r = this.addRoom(id, kind, x0, y0, x0 + w, y0 + h, ring, isMb ? base + 3 : base);
        carve(r.x0, r.y0, r.x1, r.y1, id);
        cellRoom[cy].push(id);
      }
    }
    // the four center cells all point at the arena
    const arenaId = this.rooms.findIndex((r) => r.kind === 'arena');
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) cellRoom[y][x] = arenaId;
    this.arena = this.rooms[arenaId];

    // corridors between every pair of neighboring cells: wide L-shaped halls
    const link = (a: Room, b: Room) => {
      const wdt = 4;
      const ax = Math.round(a.cx / TILE), ay = Math.round(a.cy / TILE), bx = Math.round(b.cx / TILE), by = Math.round(b.cy / TILE);
      const h = rand() < 0.5;
      const mx = h ? bx : ax, my = h ? ay : by;
      carve(Math.min(ax, mx) - 1, Math.min(ay, my) - 1, Math.max(ax, mx) + wdt - 1, Math.max(ay, my) + wdt - 1);
      carve(Math.min(mx, bx) - 1, Math.min(my, by) - 1, Math.max(mx, bx) + wdt - 1, Math.max(my, by) + wdt - 1);
    };
    for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
      const a = this.rooms[cellRoom[cy][cx]];
      if (cx + 1 < CELLS && cellRoom[cy][cx + 1] !== cellRoom[cy][cx]) link(a, this.rooms[cellRoom[cy][cx + 1]]);
      if (cy + 1 < CELLS && cellRoom[cy + 1][cx] !== cellRoom[cy][cx]) link(a, this.rooms[cellRoom[cy + 1][cx]]);
    }

    // dressing: pillars, fountains on north walls, braziers, bones
    for (const r of this.rooms) {
      const big = r.kind !== 'camp' && r.kind !== 'spawn';
      const n = r.kind === 'arena' ? 8 : big ? 4 : rand() < 0.6 ? 2 : 0;
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      for (let i = 0; i < n; i++) {
        // symmetric-ish pillar pairs
        const fx = i % 2 ? 0.25 : 0.75, fy = 0.3 + 0.4 * Math.floor(i / 2) / Math.max(1, Math.ceil(n / 2) - 1);
        const tx = r.x0 + Math.round(w * (r.kind === 'arena' ? [0.18, 0.82][i % 2] : fx)), ty = r.y0 + Math.round(h * (n <= 2 ? 0.5 : fy));
        this.columns.push({ x: tx * TILE + 16, y: ty * TILE + 28, r: 12 });
      }
      // fountain on the north wall, colored by danger
      const ftx = Math.round((r.x0 + r.x1) / 2) - 1;
      if (this.grid[(r.y0 - 1) * W + ftx] === 0 && this.grid[(r.y0 - 1) * W + ftx + 1] === 0) {
        const color = r.ring === 2 ? 'blue' : 'red';
        this.fountains.push({ x: ftx * TILE, y: (r.y0 - 1) * TILE, color });
        this.lights.push({ x: ftx * TILE + 16, y: r.y0 * TILE + 8, color: color === 'blue' ? '#4a6cff' : '#ff3a3a', radius: 120, flicker: 0.12 });
      }
      // warm braziers in the corners
      for (const [bx, by] of [[r.x0 + 1, r.y0 + 1], [r.x1 - 2, r.y0 + 1], [r.x0 + 1, r.y1 - 2], [r.x1 - 2, r.y1 - 2]]) {
        if (rand() < (big ? 1 : 0.5)) this.lights.push({ x: bx * TILE + 16, y: by * TILE + 16, color: r.kind === 'miniboss' ? '#ff5a2a' : '#ff9a3c', radius: big ? 110 : 90, flicker: 0.3 });
      }
      for (let i = 0; i < w * h * 0.03; i++) this.skulls.push({ x: (r.x0 + rand() * w) * TILE, y: (r.y0 + rand() * h) * TILE });
    }

    // minimap: floor vs void, rooms tinted by danger
    const mm = document.createElement('canvas'); mm.width = W; mm.height = H;
    const mctx = mm.getContext('2d')!, img = mctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      if (!this.grid[i]) continue;
      const rm = this.roomAt[i] >= 0 ? this.rooms[this.roomAt[i]] : null;
      const c = !rm ? [70, 64, 92] : rm.kind === 'arena' ? [150, 40, 60] : rm.kind === 'miniboss' ? [120, 60, 70] : rm.ring === 2 ? [86, 80, 112] : [100, 76, 110];
      img.data.set([...c, 255], i * 4);
    }
    mctx.putImageData(img, 0, 0);
    this.minimap = mm;
  }

  private addRoom(id: number, kind: RoomKind, x0: number, y0: number, x1: number, y1: number, ring: number, level: number): Room {
    const r: Room = { id, kind, x0, y0, x1, y1, cx: ((x0 + x1) / 2) * TILE, cy: ((y0 + y1) / 2) * TILE, ring, level };
    this.rooms.push(r);
    return r;
  }

  floorAt(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows && this.grid[ty * this.cols + tx] === 1;
  }
  solidAt(x: number, y: number) { return !this.floorAt(Math.floor(x / TILE), Math.floor(y / TILE)); }
  roomOf(x: number, y: number): Room | null {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return null;
    const id = this.roomAt[ty * this.cols + tx];
    return id >= 0 ? this.rooms[id] : null;
  }
  /** Enemy level for a spot: its room's level, or the surrounding ring's for corridors. */
  levelAt(x: number, y: number) {
    const r = this.roomOf(x, y);
    if (r) return r.level;
    const d = Math.hypot(x - this.width / 2, y - this.height / 2) / (this.width / 2);
    return d > 0.62 ? 2 : d > 0.32 ? 5 : 9;
  }

  /** Push a circle (feet) out of walls and pillars. Returns true if it collided. */
  collide(p: { x: number; y: number }, r: number) {
    let hit = false;
    const ry = r * 0.5;
    if (this.solidAt(p.x - r, p.y)) { p.x = (Math.floor((p.x - r) / TILE) + 1) * TILE + r; hit = true; }
    if (this.solidAt(p.x + r, p.y)) { p.x = Math.floor((p.x + r) / TILE) * TILE - r - 0.01; hit = true; }
    if (this.solidAt(p.x, p.y - ry - 4)) { p.y = (Math.floor((p.y - ry - 4) / TILE) + 1) * TILE + ry + 4; hit = true; }
    if (this.solidAt(p.x, p.y + 2)) { p.y = Math.floor((p.y + 2) / TILE) * TILE - 2.01; hit = true; }
    for (const c of this.columns) {
      if (Math.abs(p.x - c.x) > 40 || Math.abs(p.y - c.y) > 40) continue;
      const dx = p.x - c.x, dy = (p.y - c.y) * 1.6, d = Math.hypot(dx, dy), m = c.r + r;
      if (d < m && d > 0.001) { p.x = c.x + (dx / d) * m; p.y = c.y + (dy / d) * m / 1.6; hit = true; }
    }
    return hit;
  }

  /** Bullets (at ground position) die on walls and pillar bodies. */
  blocks(x: number, y: number) {
    if (this.solidAt(x, y)) return true;
    for (const c of this.columns) if (Math.abs(x - c.x) < 13 && y < c.y + 2 && y > c.y - 54) return true;
    return false;
  }

  /** A random floor spot inside a room, at least `pad` tiles from its walls. */
  spotIn(r: Room, rand = Math.random, pad = 2) {
    for (let i = 0; i < 20; i++) {
      const x = (r.x0 + pad + rand() * Math.max(1, r.x1 - r.x0 - pad * 2)) * TILE, y = (r.y0 + pad + rand() * Math.max(1, r.y1 - r.y0 - pad * 2)) * TILE;
      if (!this.solidAt(x, y) && !this.columns.some((c) => Math.hypot(c.x - x, c.y - y) < 30)) return { x, y };
    }
    return { x: r.cx, y: r.cy };
  }

  // ---------------------------------------------------------------- drawing

  /** Wall autotile: picks the piece a void tile shows based on the floor around it. */
  private wallTile(tx: number, ty: number): string | null {
    const f = (dx: number, dy: number) => this.floorAt(tx + dx, ty + dy);
    if (f(0, 1)) return 'wall_mid';                       // face of a wall, floor just below
    if (f(0, 2)) return 'wall_top_mid';                   // cap above the face
    if (f(1, 0) || f(1, 1)) return 'wall_side_mid_left';  // west edge of a room
    if (f(-1, 0) || f(-1, 1)) return 'wall_side_mid_right';
    if (f(0, -1)) return 'wall_top_mid';                  // south edge, seen from above
    if (f(1, -1)) return 'wall_side_mid_left';
    if (f(-1, -1)) return 'wall_side_mid_right';
    return null;
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
      if (this.floorAt(tx, ty)) {
        const h = hash(tx, ty), rm = this.roomOf(tx * TILE, ty * TILE);
        const cracked = rm ? (rm.ring === 2 ? 0.15 : rm.ring === 1 ? 0.3 : 0.45) : 0.25;
        g.drawImage(this.A.tile(h < 1 - cracked ? 'floor_1' : floors[Math.floor(hash(ty, tx) * floors.length)]), x * TILE, y * TILE);
      } else {
        const w = this.wallTile(tx, ty);
        if (w) g.drawImage(this.A.tile(w), x * TILE, y * TILE);
      }
    }
    // banners on wall faces, fountain caps
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
      const tx = cx * CHUNK + x, ty = cy * CHUNK + y;
      if (!this.floorAt(tx, ty) && this.floorAt(tx, ty + 1) && hash(tx * 7, ty * 3) < 0.08) {
        g.drawImage(this.A.tile(hash(tx, ty * 5) < 0.5 ? 'wall_banner_red' : 'wall_banner_blue'), x * TILE, y * TILE);
      }
    }
    for (const f of this.fountains) {
      const fx = f.x - cx * S, fy = f.y - cy * S;
      if (fx > -TILE && fy > -TILE * 2 && fx < S && fy < S) g.drawImage(this.A.tile('wall_fountain_top'), fx, fy - TILE);
    }
    for (const s of this.skulls) {
      const sx = s.x - cx * S, sy = s.y - cy * S;
      if (sx >= 0 && sy >= 0 && sx < S && sy < S) g.drawImage(this.A.tile('skull'), Math.round(sx), Math.round(sy));
    }
    this.chunks.set(key, c);
    // keep memory bounded on phones: drop the oldest chunks past ~28 (28 × 1MB)
    if (this.chunks.size > 28) this.chunks.delete(this.chunks.keys().next().value!);
    return c;
  }

  /** Floor, walls and decals for the view. */
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, time: number) {
    const S = CHUNK * TILE;
    const x0 = Math.floor(camX / S), y0 = Math.floor(camY / S), x1 = Math.floor((camX + w) / S), y1 = Math.floor((camY + h) / S);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cy < 0 || cx * CHUNK >= this.cols || cy * CHUNK >= this.rows) continue;
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

  drawColumn(ctx: CanvasRenderingContext2D, c: Column, camX: number, camY: number) {
    const x = Math.round(c.x - 16 - camX), y = Math.round(c.y - 28 - camY);
    ctx.drawImage(this.A.tile('column_mid'), x, y);
    ctx.drawImage(this.A.tile('column_top'), x, y - TILE);
  }

  /** Blood and scorch marks, painted into lazily-created per-chunk decal layers. */
  splat(x: number, y: number, color: string, n: number, size: number) {
    const S = CHUNK * TILE, cx = Math.floor(x / S), cy = Math.floor(y / S);
    if (cx < 0 || cy < 0 || cx * CHUNK >= this.cols || cy * CHUNK >= this.rows) return;
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
