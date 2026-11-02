// Loads the hero sprite and the 0x72 dungeon sheet (CC0) and pre-bakes the variants
// the game needs: integer-scaled frames, white hit-flash frames, shadow-tinted frames.

export type Sprite = HTMLCanvasElement;
export interface Anim { normal: Sprite[]; flash: Sprite[]; shadow: Sprite[]; w: number; h: number }

export interface Assets {
  /** the 0x72 elf, recolored and hand-edited into Dylan: black hair, black coat, purple trim */
  hero: { idle: Anim; run: Anim; hit: Anim; roll: Anim; fall: Anim };
  /** shadow dagger (knife sprite recolored), blade pointing up, grip at the bottom */
  dagger: { img: Sprite; flash: Sprite; w: number; h: number };
  tile(name: string, frame?: number): Sprite;   // 2x scaled
  anim(name: string, scale?: number): Anim;
}

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

// elf_m palette → Dylan. Hair goes black with a violet sheen, eyes dark, tunic becomes a black coat with
// a purple collar, pants charcoal. Skin stays.
const DYLAN_PALETTE: Record<string, [number, number, number]> = {
  facb3e: [0x1d, 0x1a, 0x29],   // hair light → near-black
  ee8e2e: [0x10, 0x0e, 0x16],   // hair dark → black
  fccba3: [0xee, 0xb8, 0x90],   // skin, a touch warmer so it holds up under light
  e2b694: [0xc9, 0x92, 0x6e],   // skin shadow
  '5698cc': [0x16, 0x12, 0x20], // eyes
  '4ba747': [0x33, 0x2f, 0x48], // tunic → coat
  '314152': [0x8a, 0x4c, 0xf0], // collar line → purple trim
  '3d734f': [0x1f, 0x1d, 0x29], // pants/hem
};
const HAIR_SHEEN: [number, number, number] = [0x46, 0x3c, 0x6c];

/** Recolor one elf frame into Dylan, then apply the hand edits, at integer scale. */
function dylanize(img: HTMLImageElement, sx: number, sy: number, w: number, h: number, s: number): Sprite {
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
    const m = DYLAN_PALETTE[k];
    if (m) { p[i] = m[0]; p[i + 1] = m[1]; p[i + 2] = m[2]; }
  }
  // hand edits ---------------------------------------------------------------------------------
  // 1. a two-pixel violet glint on the crown: reads as glossy black hair (a full row read as a headband)
  for (const x of [8, 9]) {
    const i = at(x, top + 1);
    if (p[i + 3] && p[i] === 0x1d && p[i + 1] === 0x1a) { p[i] = HAIR_SHEEN[0]; p[i + 1] = HAIR_SHEEN[1]; p[i + 2] = HAIR_SHEEN[2]; }
  }
  // 2. a messy spike above the crown (Dylan's hair sticks up), drawn with outline
  const sx0 = 6;
  if (top > 1) {
    const i = at(sx0, top - 1), o = at(sx0, top - 2);
    p.set([0x12, 0x10, 0x19, 255], i); p.set([0x22, 0x22, 0x22, 255], o);
    p.set([0x22, 0x22, 0x22, 255], at(sx0 - 1, top - 1));
  }
  // 3. purple trim down the coat's front edge, matching the reference's open coat
  for (let y = top + 10; y < h - 4; y++) {
    const i = at(11, y);
    if (p[i + 3] && p[i] === 0x33 && p[i + 1] === 0x2f) { p[i] = 0x4e; p[i + 1] = 0x2e; p[i + 2] = 0x90; }
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
  const [heroImg, sheetImg, list] = await Promise.all([load(base + 'assets/hero.png'), load(base + SHEET), fetch(base + LIST).then((r) => r.text())]);
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
  const heroCut = (name: string) => {
    const d = defs.get(name)!;
    return Array.from({ length: d.n }, (_, i) => dylanize(sheetImg, d.x + i * d.w, d.y, d.w, d.h, 2));
  };
  const run = heroCut('elf_m_run_anim'), idle = heroCut('elf_m_idle_anim'), hit = heroCut('elf_m_hit_anim');
  // roll: the run pose tumbling in quarter turns (90° rotations stay pixel-perfect)
  const roll = [1, 2, 3, 0].map((q) => rotated(run[1], q * Math.PI / 2, 16, 40));
  // fall: the hit pose tipping over backwards
  const fall = [-0.45, -1.0, -Math.PI / 2].map((a) => rotated(hit[0], a, 16, 54));
  const knife = defs.get('weapon_knife')!;
  const dagger = shadowBlade(sheetImg, knife.x, knife.y, knife.w, knife.h, 2);
  return {
    hero: {
      idle: variants(idle, 32, 56), run: variants(run, 32, 56), hit: variants(hit, 32, 56),
      roll: variants(roll, roll[0].width, roll[0].height), fall: variants(fall, fall[0].width, fall[0].height),
    },
    dagger: { img: dagger, flash: tinted(dagger, '#ffffff'), w: dagger.width, h: dagger.height },
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
