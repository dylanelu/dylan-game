// Loads the hero sprite and the 0x72 dungeon sheet (CC0) and pre-bakes the variants
// the game needs: integer-scaled frames, white hit-flash frames, shadow-tinted frames.

export type Sprite = HTMLCanvasElement;
export interface Anim { normal: Sprite[]; flash: Sprite[]; shadow: Sprite[]; w: number; h: number }

export interface Assets {
  hero: Sprite; heroFlash: Sprite; heroShadow: Sprite;
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

export async function loadAssets(): Promise<Assets> {
  const [heroImg, sheetImg, list] = await Promise.all([load('assets/hero.png'), load(SHEET), fetch(LIST).then((r) => r.text())]);
  const sheet = grade(sheetImg);
  const defs = new Map<string, { x: number; y: number; w: number; h: number; n: number }>();
  for (const line of list.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [name, x, y, w, h, n] = parts;
    defs.set(name, { x: +x, y: +y, w: +w, h: +h, n: n ? +n : 1 });
  }

  const { c: hero, ctx: hctx } = canvas(heroImg.width, heroImg.height);
  hctx.drawImage(heroImg, 0, 0);

  const cut = (x: number, y: number, w: number, h: number, s: number) => {
    const { c, ctx } = canvas(w * s, h * s);
    ctx.drawImage(sheet, x, y, w, h, 0, 0, w * s, h * s);
    return c;
  };
  const tileCache = new Map<string, Sprite>();
  const animCache = new Map<string, Anim>();
  return {
    hero,
    heroFlash: tinted(hero, '#ffffff'),
    heroShadow: tinted(hero, '#5a2ccf', 0.85),
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
