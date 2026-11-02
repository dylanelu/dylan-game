import type { Assets, Sprite } from './assets';

// A single gate arena built from 0x72 tiles (16px art drawn at 2x = 32 native px per tile).

export const TILE = 32;

export interface Column { x: number; y: number; r: number }
export interface LightSource { x: number; y: number; color: string; radius: number; flicker: number }
export interface Fountain { x: number; y: number; color: 'blue' | 'red' }

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class Level {
  readonly cols = 34;
  readonly rows = 24;
  readonly width = this.cols * TILE;
  readonly height = this.rows * TILE;
  /** playable rectangle for feet positions */
  readonly bounds = { x0: TILE + 10, y0: TILE * 2 + 6, x1: (34 - 1) * TILE - 10, y1: (24 - 1) * TILE - 4 };
  readonly base: Sprite;          // floor + walls, baked once
  readonly decals: Sprite;        // blood and scorch marks accumulate here
  readonly decalCtx: CanvasRenderingContext2D;
  readonly columns: Column[] = [];
  readonly fountains: Fountain[] = [];
  readonly lights: LightSource[] = [];

  constructor(private A: Assets, seed = 7) {
    const rand = rng(seed);
    const mk = () => {
      const c = document.createElement('canvas'); c.width = this.width; c.height = this.height;
      const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false; return { c, ctx };
    };
    const base = mk(); this.base = base.c;
    const dec = mk(); this.decals = dec.c; this.decalCtx = dec.ctx;
    const g = base.ctx;
    g.fillStyle = '#07060c'; g.fillRect(0, 0, this.width, this.height);

    // floor: mostly plain stone, some cracked variants
    const floors = ['floor_2', 'floor_3', 'floor_4', 'floor_5', 'floor_6', 'floor_7', 'floor_8'];
    for (let ty = 1; ty < this.rows - 1; ty++) for (let tx = 1; tx < this.cols - 1; tx++) {
      const r = rand();
      g.drawImage(A.tile(r < 0.78 ? 'floor_1' : floors[Math.floor(rand() * floors.length)]), tx * TILE, ty * TILE);
    }
    // top wall: cap row + face row
    for (let tx = 0; tx < this.cols; tx++) {
      g.drawImage(A.tile('wall_top_mid'), tx * TILE, 0);
      g.drawImage(A.tile('wall_mid'), tx * TILE, TILE);
    }
    // banners and fountains on the top wall
    for (let tx = 3; tx < this.cols - 3; tx += 5) {
      if (tx % 10 === 3) {
        const color = (tx / 5) % 2 ? 'red' : 'blue';
        g.drawImage(A.tile('wall_fountain_top'), tx * TILE, 0);
        this.fountains.push({ x: tx * TILE, y: TILE, color });
        this.lights.push({ x: tx * TILE + 16, y: TILE * 2 + 8, color: color === 'blue' ? '#4a6cff' : '#ff3a3a', radius: 110, flicker: 0.12 });
      } else {
        g.drawImage(A.tile(tx % 2 ? 'wall_banner_blue' : 'wall_banner_red'), tx * TILE, TILE);
      }
    }
    // side walls
    for (let ty = 1; ty < this.rows - 1; ty++) {
      g.drawImage(A.tile('wall_side_mid_left'), 0, ty * TILE);
      g.drawImage(A.tile('wall_side_mid_right'), (this.cols - 1) * TILE, ty * TILE);
    }
    // bottom wall seen from above
    for (let tx = 0; tx < this.cols; tx++) g.drawImage(A.tile('wall_top_mid'), tx * TILE, (this.rows - 1) * TILE);
    g.drawImage(A.tile('wall_side_front_left'), 0, (this.rows - 1) * TILE);
    g.drawImage(A.tile('wall_side_front_right'), (this.cols - 1) * TILE, (this.rows - 1) * TILE);

    // scattered bones and grime
    for (let i = 0; i < 26; i++) {
      const x = TILE * 2 + rand() * (this.width - TILE * 4), y = TILE * 3 + rand() * (this.height - TILE * 5);
      if (rand() < 0.5) g.drawImage(A.tile('skull'), Math.round(x), Math.round(y));
      else { g.fillStyle = 'rgba(10,6,20,0.35)'; g.fillRect(Math.round(x), Math.round(y), 6 + Math.floor(rand() * 10), 2); }
    }

    // four pillars give cover from bullet patterns
    for (const [tx, ty] of [[9, 8], [24, 8], [9, 17], [24, 17]]) {
      this.columns.push({ x: tx * TILE + 16, y: ty * TILE + 28, r: 12 });
    }
    // braziers: warm lights along the side walls
    for (const ty of [6, 12, 18]) {
      this.lights.push({ x: TILE + 6, y: ty * TILE, color: '#ff9a3c', radius: 90, flicker: 0.3 });
      this.lights.push({ x: (this.cols - 1) * TILE - 6, y: ty * TILE, color: '#ff9a3c', radius: 90, flicker: 0.3 });
    }
  }

  /** Column sprites: base tile + top tile above it. Drawn in the entity pass so the hero can walk behind. */
  drawColumn(ctx: CanvasRenderingContext2D, c: Column, camX: number, camY: number) {
    const x = Math.round(c.x - 16 - camX), y = Math.round(c.y - 28 - camY);
    ctx.drawImage(this.A.tile('column_mid'), x, y);
    ctx.drawImage(this.A.tile('column_top'), x, y - TILE);
  }

  drawFountains(ctx: CanvasRenderingContext2D, time: number, camX: number, camY: number) {
    const f = Math.floor(time * 8) % 3;
    for (const ft of this.fountains) {
      ctx.drawImage(this.A.tile(`wall_fountain_mid_${ft.color}_anim`, f), Math.round(ft.x - camX), Math.round(ft.y - camY));
      ctx.drawImage(this.A.tile(`wall_fountain_basin_${ft.color}_anim`, f), Math.round(ft.x - camX), Math.round(ft.y + TILE - camY));
    }
  }

  /** Push a circle out of walls and pillars. Returns true if it collided. */
  collide(p: { x: number; y: number }, r: number) {
    let hit = false;
    const b = this.bounds;
    if (p.x < b.x0 + r) { p.x = b.x0 + r; hit = true; }
    if (p.x > b.x1 - r) { p.x = b.x1 - r; hit = true; }
    if (p.y < b.y0 + r * 0.5) { p.y = b.y0 + r * 0.5; hit = true; }
    if (p.y > b.y1) { p.y = b.y1; hit = true; }
    for (const c of this.columns) {
      const dx = p.x - c.x, dy = (p.y - c.y) * 1.6, d = Math.hypot(dx, dy), m = c.r + r;
      if (d < m && d > 0.001) { p.x = c.x + (dx / d) * m; p.y = c.y + (dy / d) * m / 1.6; hit = true; }
    }
    return hit;
  }

  /** Bullets die on walls and on the pillar bodies. */
  blocks(x: number, y: number) {
    const b = this.bounds;
    if (x < b.x0 - 8 || x > b.x1 + 8 || y < b.y0 - 30 || y > b.y1 + 8) return true;
    for (const c of this.columns) if (Math.abs(x - c.x) < 13 && y < c.y + 2 && y > c.y - 54) return true;
    return false;
  }
}
