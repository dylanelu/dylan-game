import type { Sprite } from './assets';
import { drawText, textWidth } from './font';

export interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; color: string; size: number; glow: boolean; drag: number; grav: number;
  decal?: string;  // leave a mark on the floor when it lands
}
interface Ring { x: number; y: number; r0: number; r1: number; t: number; dur: number; color: string; width: number }
interface Glint { x: number; y: number; t: number; dur: number; color: string; size: number }
interface FloatText { x: number; y: number; text: string; color: string; t: number; dur: number; scale: number; vy: number }
interface After { img: Sprite; x: number; y: number; flip: boolean; t: number; dur: number; ax: number; ay: number }
export interface Light { x: number; y: number; r: number; color: string; a: number }
export interface Telegraph { x: number; y: number; r: number; t: number; dur: number; color: string; angle?: number; arc?: number; len?: number; width?: number }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Fx {
  parts: Particle[] = [];
  rings: Ring[] = [];
  glints: Glint[] = [];
  texts: FloatText[] = [];
  afters: After[] = [];
  lights: Light[] = [];           // cleared every frame
  telegraphs: Telegraph[] = [];
  /** co-op host: set while enemies think, so their visual cues are mirrored to other players */
  emit: ((op: string, args: unknown[]) => void) | null = null;

  constructor(private paint: (x: number, y: number, color: string, n: number, size: number) => void) {}

  burst(x: number, y: number, n: number, o: Partial<Particle> & { speed?: number; spread?: number; angle?: number; colors?: string[] } = {}) {
    this.emit?.('burst', [x, y, n, o]);
    const speed = o.speed ?? 120, spread = o.spread ?? Math.PI * 2, angle = o.angle ?? 0;
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread, s = speed * rnd(0.3, 1);
      const life = (o.life ?? 0.5) * rnd(0.6, 1.2);
      this.parts.push({
        x, y, z: o.z ?? 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.75, vz: o.vz ?? rnd(20, 90),
        life, max: life, color: o.colors ? o.colors[Math.floor(Math.random() * o.colors.length)] : (o.color ?? '#fff'),
        size: o.size ?? 1, glow: o.glow ?? false, drag: o.drag ?? 3, grav: o.grav ?? 300, decal: o.decal,
      });
    }
  }

  ring(x: number, y: number, r1: number, color: string, dur = 0.3, width = 2, r0 = 2) {
    this.emit?.('ring', [x, y, r1, color, dur, width, r0]);
    this.rings.push({ x, y, r0, r1, t: 0, dur, color, width });
  }
  glint(x: number, y: number, color: string, size = 7, dur = 0.32) { this.emit?.('glint', [x, y, color, size, dur]); this.glints.push({ x, y, t: 0, dur, color, size }); }
  telegraph(t: Telegraph) { this.emit?.('telegraph', [t]); this.telegraphs.push({ ...t }); }
  text(x: number, y: number, text: string, color: string, scale = 1, dur = 0.7, vy = -28) {
    this.emit?.('text', [x, y, text, color, scale, dur, vy]);
    this.texts.push({ x, y, text, color, t: 0, dur, scale, vy });
  }
  /** Fading ghost of a sprite; (ax, ay) is the sprite's feet anchor inside `img`. */
  after(img: Sprite, x: number, y: number, flip: boolean, ax: number, ay: number, dur = 0.25) {
    this.afters.push({ img, x, y, flip, t: 0, dur, ax, ay });
  }

  /** Break a sprite into its own pixels: they lift off and burn out as shadow embers. */
  dissolve(img: Sprite, x: number, y: number, ax: number, ay: number, flip: boolean, o: { every?: number; tint?: string; up?: number } = {}) {
    const ctx = img.getContext('2d')!, d = ctx.getImageData(0, 0, img.width, img.height).data;
    const every = o.every ?? 2, up = o.up ?? 60;
    for (let py = 0; py < img.height; py += 1) for (let px = (py % every); px < img.width; px += every) {
      const i = (py * img.width + px) * 4;
      if (d[i + 3] < 128) continue;
      const lx = (px - ax) * (flip ? -1 : 1), ly = py - ay;
      const life = 0.5 + Math.random() * 0.9 + (-ly / 60) * 0.3;
      const color = Math.random() < 0.35 ? (o.tint ?? '#7a3cff') : `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
      this.parts.push({
        x: x + lx, y: y, z: -ly, vx: (Math.random() - 0.5) * 30 + lx * 0.8, vy: (Math.random() - 0.5) * 10,
        vz: up * (0.4 + Math.random()) + (-ly) * 0.3, life, max: life, color, size: 1, glow: color === (o.tint ?? '#7a3cff'),
        drag: 2.2, grav: -40 - Math.random() * 60,
      });
    }
  }
  light(x: number, y: number, r: number, color: string, a = 1) { this.lights.push({ x, y, r, color, a }); }

  splat(x: number, y: number, color: string, n = 6, size = 5) {
    this.emit?.('splat', [x, y, color, n, size]);
    this.paint(x, y, color, n, size);
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life -= dt;
      p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.grav * dt; p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        if (p.decal) { this.splat(p.x, p.y, p.decal, 2, 2); p.decal = undefined; }
        p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5;
      }
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const list of [this.rings, this.glints, this.texts, this.afters, this.telegraphs] as { t: number }[][]) for (const r of list) r.t += dt;
    for (const t of this.texts) t.y += t.vy * dt * Math.max(0, 1 - t.t / t.dur);
    this.rings = this.rings.filter((r) => r.t < r.dur);
    this.glints = this.glints.filter((r) => r.t < r.dur);
    this.texts = this.texts.filter((r) => r.t < r.dur);
    this.afters = this.afters.filter((r) => r.t < r.dur);
    this.telegraphs = this.telegraphs.filter((r) => r.t < r.dur);
  }

  /** Ground telegraphs go on the scene layer under entities. */
  drawTelegraphs(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const t of this.telegraphs) {
      const k = Math.min(1, t.t / t.dur);
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.25 * k;
      ctx.fillStyle = t.color; ctx.strokeStyle = t.color;
      if (t.len !== undefined && t.angle !== undefined) {
        // line telegraph (charges)
        ctx.translate(Math.round(t.x - cx), Math.round(t.y - cy)); ctx.rotate(t.angle);
        ctx.fillRect(0, -(t.width ?? 16) / 2, t.len * k, t.width ?? 16);
      } else {
        ctx.beginPath(); ctx.ellipse(Math.round(t.x - cx), Math.round(t.y - cy), t.r, t.r * 0.62, 0, 0, Math.PI * 2);
        ctx.globalAlpha = 0.12; ctx.fill();
        ctx.globalAlpha = 0.5; ctx.beginPath();
        ctx.ellipse(Math.round(t.x - cx), Math.round(t.y - cy), t.r * k, t.r * 0.62 * k, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawParticles(scene: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const p of this.parts) {
      const ctx = p.glow ? glow : scene;
      const k = p.life / p.max;
      ctx.globalAlpha = p.glow ? Math.min(1, k * 1.5) : Math.min(1, k * 3);
      ctx.fillStyle = p.color;
      const s = Math.max(1, Math.round(p.size * (p.glow ? 0.5 + k * 0.5 : 1)));
      ctx.fillRect(Math.round(p.x - cx - s / 2), Math.round(p.y - p.z - cy - s / 2), s, s);
    }
    scene.globalAlpha = 1; glow.globalAlpha = 1;
  }

  drawGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const a of this.afters) {
      const k = 1 - a.t / a.dur;
      ctx.globalAlpha = 0.3 * k * k;   // glow layer blooms, so keep ghosts faint
      ctx.save();
      ctx.translate(Math.round(a.x - cx), Math.round(a.y - cy));
      if (a.flip) ctx.scale(-1, 1);
      ctx.drawImage(a.img, -a.ax, -a.ay);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      const k = r.t / r.dur, e = 1 - Math.pow(1 - k, 3);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color; ctx.lineWidth = Math.max(1, r.width * (1 - k));
      ctx.beginPath(); ctx.ellipse(Math.round(r.x - cx), Math.round(r.y - cy), rad, rad * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const g of this.glints) {
      // 4-point star that pops in then shrinks: the Sekiro "parry this" cue
      const k = g.t / g.dur, s = Math.round(g.size * Math.sin(Math.min(1, k * 1.4) * Math.PI));
      if (s <= 0) continue;
      const x = Math.round(g.x - cx), y = Math.round(g.y - cy);
      ctx.fillStyle = g.color;
      ctx.fillRect(x - s, y, s * 2 + 1, 1); ctx.fillRect(x, y - s, 1, s * 2 + 1);
      const d = Math.max(1, Math.floor(s / 3));
      ctx.fillRect(x - d, y - d, d * 2 + 1, d * 2 + 1);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 1, 1);
    }
  }

  drawTexts(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const t of this.texts) {
      const k = t.t / t.dur;
      if (k > 0.75 && Math.floor(t.t * 30) % 2) continue;  // blink out
      const pop = k < 0.1 ? 1 + (0.1 - k) * 6 : 1;
      const sc = Math.max(1, Math.round(t.scale * pop));
      drawText(ctx, t.text, t.x - cx - textWidth(t.text, sc) / 2, t.y - cy, t.color, sc);
    }
  }
}
