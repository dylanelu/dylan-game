// Loads the hero sprite and the 0x72 dungeon sheet (CC0) and pre-bakes the variants
// the game needs: integer-scaled frames, white hit-flash frames, shadow-tinted frames.

export type Sprite = HTMLCanvasElement;
export interface HeroSet { idle: Anim; run: Anim; hit: Anim; roll: Anim; fall: Anim }
export interface Anim { normal: Sprite[]; flash: Sprite[]; shadow: Sprite[]; w: number; h: number }

export interface Assets {
  /** the 0x72 elf, recolored and hand-edited into Dylan; one set per player color (index 0 is Dylan) */
  heroes: HeroSet[];
  /** shadow dagger (knife sprite recolored), blade pointing up, grip at the bottom */
  dagger: { img: Sprite; flash: Sprite; w: number; h: number };
  tile(name: string, frame?: number): Sprite;   // 2x scaled
  /** a rect from a Ninja Adventure sheet (CC0), night-graded, scaled */
  nt(sheet: NinjaSheet, x: number, y: number, w: number, h: number, scale?: number, raw?: boolean): Sprite;
  /** a row of equal frames from a Ninja Adventure sheet as an Anim */
  nAnim(sheet: NinjaSheet, x: number, y: number, w: number, h: number, frames: number, stepX: number, stepY: number, scale?: number): Anim;
  anim(name: string, scale?: number): Anim;
}

export type NinjaSheet = 'TilesetFloor' | 'TilesetNature' | 'TilesetTowers' | 'TilesetWater' | 'NinjaDark' | 'RedSamuraiWalk' | 'RedSamuraiIdle'
  | 'RedSamuraiAttack' | 'BlueSamuraiWalk' | 'BlueSamuraiIdle' | 'IconHook' | 'IconSummon' | 'IconMana';
const NINJA: NinjaSheet[] = ['TilesetFloor', 'TilesetNature', 'TilesetTowers', 'TilesetWater', 'NinjaDark', 'RedSamuraiWalk', 'RedSamuraiIdle',
  'RedSamuraiAttack', 'BlueSamuraiWalk', 'BlueSamuraiIdle', 'IconHook', 'IconSummon', 'IconMana'];
const SHEET = 'assets/vendor/0x72/0x72_DungeonTilesetII_v1.3.png';
const LIST = 'assets/vendor/0x72/tiles_list_v1.3';

function load(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
  });
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

export function tinted(src: Sprite, color: string, alpha = 1): Sprite {
  const { c, ctx } = canvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Night grade for the bright vendor art so it sits in the violet palette next to the hero. */
function grade(img: HTMLImageElement): Sprite {
  const { c, ctx } = canvas(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
    p[i] = (p[i] * 0.7 + l * 0.3) * 0.95;
    p[i + 1] = (p[i + 1] * 0.7 + l * 0.3) * 0.93;
    p[i + 2] = Math.min(255, (p[i + 2] * 0.7 + l * 0.3) * 1.0 + 4);
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

type RGB = [number, number, number];
const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** A player look: coat, trim, hair. Index 0 is Dylan (black hair, black coat, purple trim). */
export interface HeroLook { name: string; coat: string; trim: string; trimDark: string; hair: string; hairDark: string; sheen: string; pants: string }
export const HERO_LOOKS: HeroLook[] = [
  { name: 'DYLAN', coat: '#332f48', trim: '#8a4cf0', trimDark: '#4e2e90', hair: '#1d1a29', hairDark: '#100e16', sheen: '#463c6c', pants: '#1f1d29' },
  { name: 'CRIMSON', coat: '#3a2228', trim: '#ff4a5a', trimDark: '#8e2230', hair: '#4a2a1e', hairDark: '#2a1610', sheen: '#7a4a32', pants: '#26171a' },
  { name: 'AZURE', coat: '#1f2c44', trim: '#3ab0ff', trimDark: '#1e5a8e', hair: '#d8dcec', hairDark: '#9aa0b8', sheen: '#ffffff', pants: '#161e2e' },
  { name: 'GOLD', coat: '#3a3020', trim: '#ffc83a', trimDark: '#8e6a1e', hair: '#facb3e', hairDark: '#ee8e2e', sheen: '#fff0a0', pants: '#261f14' },
  { name: 'VERDANT', coat: '#1d3628', trim: '#4aff8a', trimDark: '#1e8e4a', hair: '#26402e', hairDark: '#14241a', sheen: '#4a7a56', pants: '#14241a' },
  { name: 'ROSE', coat: '#3a2238', trim: '#ff6ad8', trimDark: '#8e2e78', hair: '#c04a9a', hairDark: '#7a2a60', sheen: '#ff9ade', pants: '#26162a' },
];

/** Recolor one elf frame into a player look, then apply the hand edits, at integer scale. */
function dylanize(img: HTMLImageElement, sx: number, sy: number, w: number, h: number, s: number, look: HeroLook): Sprite {
  // elf_m palette → look. Skin is warmed a touch so it holds up under light; eyes go dark.
  const PALETTE: Record<string, RGB> = {
    facb3e: rgb(look.hair), ee8e2e: rgb(look.hairDark),
    fccba3: [0xee, 0xb8, 0x90], e2b694: [0xc9, 0x92, 0x6e], '5698cc': [0x16, 0x12, 0x20],
    '4ba747': rgb(look.coat), '314152': rgb(look.trim), '3d734f': rgb(look.pants),
  };
  const hair = rgb(look.hair), coat = rgb(look.coat), sheen = rgb(look.sheen), trimDark = rgb(look.trimDark);
  const src = canvas(w, h);
  src.ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  const d = src.ctx.getImageData(0, 0, w, h), p = d.data;
  const at = (x: number, y: number) => (y * w + x) * 4;
  const hex = (i: number) => ((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]).toString(16).padStart(6, '0');
  let top = h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = at(x, y);
    if (!p[i + 3]) continue;
    const k = hex(i);
    if ((k === 'facb3e' || k === 'ee8e2e') && y < top) top = y;
    const m = PALETTE[k];
    if (m) { p[i] = m[0]; p[i + 1] = m[1]; p[i + 2] = m[2]; }
  }
  // hand edits ---------------------------------------------------------------------------------
  // 1. a two-pixel violet glint on the crown: reads as glossy black hair (a full row read as a headband)
  for (const x of [8, 9]) {
    const i = at(x, top + 1);
    if (p[i + 3] && p[i] === hair[0] && p[i + 1] === hair[1] && p[i + 2] === hair[2]) p.set([...sheen, 255], i);
  }
  // 2. a messy spike above the crown (Dylan's hair sticks up), drawn with outline
  const sx0 = 6;
  if (top > 1) {
    const i = at(sx0, top - 1), o = at(sx0, top - 2);
    p.set([...rgb(look.hairDark), 255], i); p.set([0x22, 0x22, 0x22, 255], o);
    p.set([0x22, 0x22, 0x22, 255], at(sx0 - 1, top - 1));
  }
  // 3. trim down the coat's front edge, matching the reference's open coat
  for (let y = top + 10; y < h - 4; y++) {
    const i = at(11, y);
    if (p[i + 3] && p[i] === coat[0] && p[i + 1] === coat[1] && p[i + 2] === coat[2]) p.set([...trimDark, 255], i);
  }
  src.ctx.putImageData(d, 0, 0);
  const out = canvas(w * s, h * s);
  out.ctx.drawImage(src.c, 0, 0, w * s, h * s);
  return out.c;
}

/** The knife sprite turned into a shadow blade: violet steel, pale edge, dark grip. */
function shadowBlade(img: HTMLImageElement, sx: number, sy: number, w: number, h: number, s: number): Sprite {
  const src = canvas(w, h);
  src.ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  const d = src.ctx.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const l = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) / 255;
    if (l > 0.8) { p[i] = 0xc8; p[i + 1] = 0xb0; p[i + 2] = 0xf4; }                           // edge glint
    else if (l > 0.25) { p[i] = 80 * l + 40; p[i + 1] = 30 * l + 22; p[i + 2] = 170 * l + 70; }  // violet blade
    else { p[i] = 20; p[i + 1] = 16; p[i + 2] = 30; }                                     // grip, outline
  }
  src.ctx.putImageData(d, 0, 0);
  const out = canvas(w * s, h * s);
  out.ctx.drawImage(src.c, 0, 0, w * s, h * s);
  return out.c;
}

/** Rotate a 32×56 hero frame about (cx, cy) into a square canvas; feet anchor stays at the bottom center. */
function rotated(src: Sprite, a: number, cx: number, cy: number): Sprite {
  const S = 64, out = canvas(S, S);
  out.ctx.translate(S / 2, S - (56 - cy));
  out.ctx.rotate(a);
  out.ctx.drawImage(src, -cx, -cy);
  return out.c;
}

export async function loadAssets(base = ''): Promise<Assets> {
  const [heroImg, sheetImg, list, ...ninjaImgs] = await Promise.all([
    load(base + 'assets/hero.png'), load(base + SHEET), fetch(base + LIST).then((r) => r.text()),
    ...NINJA.map((n) => load(`${base}assets/vendor/ninja/${n}.png`)),
  ]);
  const ninja = new Map<NinjaSheet, { raw: HTMLImageElement; graded: Sprite }>();
  NINJA.forEach((n, i) => ninja.set(n, { raw: ninjaImgs[i], graded: grade(ninjaImgs[i]) }));
  const ntCache = new Map<string, Sprite>();
  const nAnimCache = new Map<string, Anim>();
  const sheet = grade(sheetImg);
  const defs = new Map<string, { x: number; y: number; w: number; h: number; n: number }>();
  for (const line of list.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [name, x, y, w, h, n] = parts;
    defs.set(name, { x: +x, y: +y, w: +w, h: +h, n: n ? +n : 1 });
  }

  void heroImg;

  const cut = (x: number, y: number, w: number, h: number, s: number) => {
    const { c, ctx } = canvas(w * s, h * s);
    ctx.drawImage(sheet, x, y, w, h, 0, 0, w * s, h * s);
    return c;
  };
  const tileCache = new Map<string, Sprite>();
  const animCache = new Map<string, Anim>();
  const variants = (normal: Sprite[], w: number, h: number): Anim => ({
    normal, w, h, flash: normal.map((f) => tinted(f, '#ffffff')), shadow: normal.map((f) => tinted(f, '#4a22b0', 0.9)),
  });
  const heroSet = (look: HeroLook): HeroSet => {
    const cutHero = (name: string) => {
      const d = defs.get(name)!;
      return Array.from({ length: d.n }, (_, i) => dylanize(sheetImg, d.x + i * d.w, d.y, d.w, d.h, 2, look));
    };
    const run = cutHero('elf_m_run_anim'), idle = cutHero('elf_m_idle_anim'), hit = cutHero('elf_m_hit_anim');
    // roll: the run pose tumbling in quarter turns (90° rotations stay pixel-perfect)
    const roll = [1, 2, 3, 0].map((q) => rotated(run[1], q * Math.PI / 2, 16, 40));
    // fall: the hit pose tipping over backwards
    const fall = [-0.45, -1.0, -Math.PI / 2].map((a) => rotated(hit[0], a, 16, 54));
    return {
      idle: variants(idle, 32, 56), run: variants(run, 32, 56), hit: variants(hit, 32, 56),
      roll: variants(roll, roll[0].width, roll[0].height), fall: variants(fall, fall[0].width, fall[0].height),
    };
  };
  const knife = defs.get('weapon_knife')!;
  const dagger = shadowBlade(sheetImg, knife.x, knife.y, knife.w, knife.h, 2);
  const nt = (sheet: NinjaSheet, x: number, y: number, w: number, h: number, scale = 2, raw = false): Sprite => {
    const key = `${sheet}:${x}:${y}:${w}:${h}:${scale}:${raw}`;
    let c = ntCache.get(key);
    if (!c) {
      const src = ninja.get(sheet)!;
      const out = canvas(w * scale, h * scale);
      out.ctx.drawImage(raw ? src.raw : src.graded, x, y, w, h, 0, 0, w * scale, h * scale);
      c = out.c; ntCache.set(key, c);
    }
    return c;
  };
  return {
    heroes: HERO_LOOKS.map(heroSet),
    dagger: { img: dagger, flash: tinted(dagger, '#ffffff'), w: dagger.width, h: dagger.height },
    nt,
    nAnim(sheet, x, y, w, h, frames, stepX, stepY, scale = 2) {
      const key = `${sheet}:${x}:${y}:${w}:${h}:${frames}:${stepX}:${stepY}:${scale}`;
      let a = nAnimCache.get(key);
      if (!a) {
        const normal = Array.from({ length: frames }, (_, i) => nt(sheet, x + i * stepX, y + i * stepY, w, h, scale));
        a = { normal, flash: normal.map((f) => tinted(f, '#ffffff')), shadow: normal.map((f) => tinted(f, '#2a1060', 0.9)), w: w * scale, h: h * scale };
        nAnimCache.set(key, a);
      }
      return a;
    },
    tile(name, frame = 0) {
      const key = `${name}:${frame}`;
      let t = tileCache.get(key);
      if (!t) {
        const d = defs.get(name);
        if (!d) throw new Error(`missing tile ${name}`);
        t = cut(d.x + frame * d.w, d.y, d.w, d.h, 2);
        tileCache.set(key, t);
      }
      return t;
    },
    anim(name, scale = 2) {
      const key = `${name}@${scale}`;
      let a = animCache.get(key);
      if (!a) {
        const d = defs.get(name);
        if (!d) throw new Error(`missing anim ${name}`);
        const normal = Array.from({ length: d.n }, (_, i) => cut(d.x + i * d.w, d.y, d.w, d.h, scale));
        a = {
          normal,
          flash: normal.map((f) => tinted(f, '#ffffff')),
          shadow: normal.map((f) => tinted(f, '#2a1060', 0.9)),
          w: d.w * scale, h: d.h * scale,
        };
        animCache.set(key, a);
      }
      return a;
    },
  };
}
