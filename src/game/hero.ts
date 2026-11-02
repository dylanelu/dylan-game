// Cut-out rig for the hero sprite. The 25×60 sprite is split into parts (hair, head, torso, arms, coat
// tails, legs) that pivot at joints. Animations are lists of poses, baked at load into crisp canvases
// so per-frame drawing stays a single drawImage. The gun arm is also kept as a separate part so it can
// rotate toward the aim at runtime.

import { tinted } from './assets';

type Part = 'hair' | 'head' | 'torso' | 'armB' | 'armF' | 'coat' | 'legB' | 'legF';
/** [dx, dy, rotation (rad, clockwise), scaleY] relative to the bind pose */
type T = [number, number, number?, number?];
export interface Pose {
  hair?: T; head?: T; torso?: T; armB?: T; armF?: T; coat?: T; legB?: T; legF?: T;
  bob?: number;                 // moves everything above the legs
  blade?: number;               // dagger angle relative to the forearm (default: along it)
  all?: { rot?: number; sx?: number; sy?: number; dx?: number; dy?: number };
}
export interface Frame {
  img: HTMLCanvasElement; noArm: HTMLCanvasElement; flash: HTMLCanvasElement; shadow: HTMLCanvasElement;
  shoulder: { x: number; y: number };
  /** front hand position and dagger angle in frame space (null when the body is tumbling) */
  hand: { x: number; y: number; a: number } | null;
}
export interface Anim { frames: Frame[]; durs: number[]; loop: boolean; total: number }

// sprite is drawn facing right; viewer-right arm/leg are the "front" ones
const PIVOT: Record<Part, [number, number]> = {
  hair: [12, 9], head: [12, 23], torso: [12, 43], armB: [4, 27], armF: [21, 27], coat: [12, 44], legB: [8, 50], legF: [16, 50],
};
const ORDER: Part[] = ['armB', 'legB', 'legF', 'coat', 'torso', 'head', 'hair', 'armF'];
const UPPER: Part[] = ['hair', 'head', 'torso', 'armB', 'armF', 'coat'];

function label(x: number, y: number): Part {
  if (y <= 8) return 'hair';
  if (y <= 23) return 'head';
  if (y >= 50) return x <= 12 ? 'legB' : 'legF';
  if (y >= 26 && y <= 44 && (x <= 5 || (x === 6 && y >= 38))) return 'armB';
  if (y >= 26 && y <= 44 && x >= 19) return 'armF';
  if (y >= 44) return 'coat';
  return 'torso';
}

// frame canvas: room for rotations (lying down, tumbling); feet anchor at (AX, AY)
export const FW = 112, FH = 84, AX = 56, AY = 76;
/** shoulder to fist, in sprite pixels */
export const ARM_LEN = 14;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

const r = (deg: number) => (deg * Math.PI) / 180;

// -------------------------------------------------------------------------------------------- poses

const idle: Pose[] = [
  {}, {},
  { head: [0, 1], hair: [0, 1], armB: [0, 1], armF: [0, 1] },
  { bob: 1, hair: [1, 0] },
  { bob: 1, hair: [1, 0], armB: [0, 0, r(-3)], armF: [0, 0, r(3)], coat: [0, 0] },
  { bob: 1, hair: [0, 0], coat: [-1, 0] },
  { head: [0, 1], hair: [0, 1], armB: [0, 1], armF: [0, 1], coat: [-1, 0] },
  { hair: [-1, 0] },
];

/** Run cycle; `lean` pushes the head forward for sideways runs. Legs stay planted, the body bobs. */
function runCycle(lean: number, stride: number): Pose[] {
  const half = (s: number): Pose[] => [
    // contact
    { bob: 1, head: [lean, 0], hair: [lean, 1], legF: [s * stride, 0], legB: [-s * stride, -1], armF: [0, 0, r(-28 * s)], armB: [0, 0, r(24 * s)], coat: [-lean, 0] },
    // down / push
    { bob: 0, head: [lean, 0], hair: [lean, 1], legF: [s * stride, 0], legB: [-s * stride * 0.5, -3], armF: [0, 0, r(-16 * s)], armB: [0, 0, r(14 * s)], coat: [-lean, -1] },
    // passing / airborne
    { bob: -1, head: [lean, 0], hair: [lean, 0], legF: [0, 0], legB: [s * stride * 0.5, -2], armF: [0, 0, 0], armB: [0, 0, 0], coat: [-lean, -1] },
    // reach
    { bob: 0, head: [lean, 0], hair: [lean, -1], legF: [-s * stride * 0.5, -1], legB: [s * stride, 0], armF: [0, 0, r(14 * s)], armB: [0, 0, r(-12 * s)], coat: [-lean, 0] },
  ];
  // second half: other leg leads. Swap leg roles by mirroring the stride sign and lifts.
  const a = half(1);
  const b = half(-1).map((p) => ({ ...p, legF: p.legB, legB: p.legF }));
  return [...a, ...b];
}

const roll: Pose[] = [
  { bob: 2, all: { sy: 0.82 }, armF: [0, 0, r(-30)], armB: [0, 0, r(30)] },
  { all: { rot: r(80), sx: 0.8, sy: 0.7 }, head: [1, 3], hair: [1, 3], legF: [0, -6], legB: [0, -6] },
  { all: { rot: r(175), sx: 0.75, sy: 0.65 }, head: [1, 4], hair: [1, 4], legF: [0, -7], legB: [0, -7] },
  { all: { rot: r(265), sx: 0.8, sy: 0.7 }, head: [1, 3], hair: [1, 3], legF: [0, -6], legB: [0, -6] },
  { bob: 2, all: { sy: 0.85 }, armF: [0, 0, r(-20)], armB: [0, 0, r(20)], legF: [1, 0], legB: [-1, 0] },
  { all: { sy: 1.05 } },
];

// guard: forearms up in front of the face, wide braced stance
const guardBase: Pose = { bob: 1, head: [-1, 1], hair: [-1, 1], torso: [0, 0], armF: [1, -2, r(-118)], armB: [3, -1, r(-95)], coat: [-1, 0], legF: [2, 0], legB: [-1, 0], blade: r(-20) };
const parry: Pose[] = [
  { bob: 0, armF: [1, -1, r(-100)], armB: [2, 0, r(-70)], head: [-1, 0], blade: r(-40) },
  guardBase,
  { ...guardBase, coat: [-2, 0], hair: [-2, 1] },
  { ...guardBase, coat: [-1, 0] },
];
const parryRecover: Pose[] = [
  { bob: 1, armF: [0, 0, r(-90)], armB: [0, 0, r(-60)] },
  { bob: 0, armF: [0, 0, r(-40)], armB: [0, 0, r(-25)] },
];

// counter-strike: wind back, explode forward with the gun arm, coat whipping behind
const riposte: Pose[] = [
  { bob: 1, head: [-1, 0], hair: [-1, 0], torso: [-1, 0], armF: [-1, 0, r(40)], armB: [-1, 0, r(10)], coat: [1, 0], legF: [-1, 0] },
  { bob: 1, all: { dx: 4 }, head: [2, 1], hair: [2, 1], torso: [1, 0], armF: [2, 0, r(-90)], armB: [0, 0, r(45)], coat: [-3, -1], legF: [4, 0], legB: [-3, 0] },
  { bob: 1, all: { dx: 4 }, head: [2, 1], hair: [1, 1], torso: [1, 0], armF: [2, 0, r(-84)], armB: [0, 0, r(40)], coat: [-4, -2], legF: [4, 0], legB: [-3, 0] },
  { bob: 0, all: { dx: 2 }, head: [1, 0], hair: [1, 0], armF: [1, 0, r(-50)], armB: [0, 0, r(20)], coat: [-2, -1], legF: [2, 0], legB: [-1, 0] },
  { bob: 0, armF: [0, 0, r(-15)], coat: [-1, 0] },
];

const hit: Pose[] = [
  { bob: 1, all: { dx: -2, sy: 0.95 }, head: [-2, 1, r(-10)], hair: [-3, 1], torso: [-1, 0], armF: [0, -1, r(-50)], armB: [0, -1, r(45)], coat: [2, 0] },
  { bob: 1, all: { dx: -1 }, head: [-1, 0, r(-5)], hair: [-1, 0], armF: [0, 0, r(-25)], armB: [0, 0, r(22)], coat: [1, 0] },
  { head: [0, 0], hair: [1, 0], coat: [1, 0] },
];

const death: Pose[] = [
  hit[0],
  { bob: 3, head: [-1, 3, r(12)], hair: [-1, 3], torso: [0, 2], armF: [0, 2, r(18)], armB: [0, 2, r(-18)], coat: [0, 1], legF: [1, -2], legB: [-1, -2] },
  { bob: 6, head: [0, 7, r(25)], hair: [0, 7], torso: [0, 5], armF: [0, 5, r(10)], armB: [0, 5, r(-10)], coat: [0, 3], legF: [2, -4], legB: [-2, -4] },
  { bob: 6, all: { rot: r(-25) }, head: [0, 7, r(25)], hair: [0, 7], torso: [0, 5], armF: [0, 5, r(40)], armB: [0, 5, r(-30)], coat: [0, 3], legF: [2, -4], legB: [-2, -4] },
  { bob: 6, all: { rot: r(-60), dy: 6 }, head: [0, 6, r(15)], hair: [0, 6], torso: [0, 5], armF: [0, 5, r(70)], armB: [0, 5, r(-40)], coat: [0, 3], legF: [2, -3], legB: [-2, -3] },
  { bob: 6, all: { rot: r(-92), sy: 0.92, dy: 12 }, head: [0, 5], hair: [0, 5], torso: [0, 4], armF: [0, 4, r(90)], armB: [0, 4, r(-20)], coat: [0, 2], legF: [2, -2], legB: [-2, -2] },
  { bob: 6, all: { rot: r(-88), dy: 12 }, head: [0, 5], hair: [0, 5], torso: [0, 4], armF: [0, 4, r(85)], armB: [0, 4, r(-20)], coat: [0, 2], legF: [2, -2], legB: [-2, -2] },
];

const skid: Pose[] = [
  { bob: 1, head: [-1, 0], hair: [-2, 0], coat: [2, 0], armF: [0, 0, r(15)], armB: [0, 0, r(-12)], legF: [2, 0], legB: [1, 0] },
  { bob: 0, head: [0, 0], hair: [-1, 0], coat: [1, 0] },
];

// -------------------------------------------------------------------------------------------- rig

export class HeroRig {
  private parts = {} as Record<Part, HTMLCanvasElement>;
  readonly anims: Record<string, Anim> = {};
  /** gun arm alone (hanging down, pivot at its shoulder), for live aiming */
  readonly gunArm: HTMLCanvasElement; readonly gunArmFlash: HTMLCanvasElement;
  readonly gunPivot = PIVOT.armF;
  readonly w: number; readonly h: number;

  constructor(hero: HTMLCanvasElement) {
    this.w = hero.width; this.h = hero.height;
    const src = hero.getContext('2d')!.getImageData(0, 0, this.w, this.h);
    for (const p of ORDER) {
      const { c, ctx } = canvas(this.w, this.h);
      const img = ctx.createImageData(this.w, this.h);
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        if (src.data[i + 3] && label(x, y) === p) img.data.set(src.data.subarray(i, i + 4), i);
      }
      ctx.putImageData(img, 0, 0);
      this.parts[p] = c;
    }
    this.gunArm = this.parts.armF;
    this.gunArmFlash = tinted(this.gunArm, '#ffffff');

    const def = (name: string, poses: Pose[], durs: number | number[], loop: boolean) => {
      const d = typeof durs === 'number' ? poses.map(() => durs) : durs;
      const frames = poses.map((p) => this.bake(p));
      this.anims[name] = { frames, durs: d, loop, total: d.reduce((a, b) => a + b, 0) };
    };
    def('idle', idle, [0.16, 0.14, 0.12, 0.12, 0.16, 0.12, 0.12, 0.14], true);
    def('run', runCycle(1, 1), 0.065, true);
    def('runFront', runCycle(0, 0), 0.065, true);
    def('roll', roll, [0.035, 0.045, 0.045, 0.045, 0.05, 0.06], false);
    def('parry', parry, [0.03, 0.08, 0.1, 0.1], false);
    def('parryRecover', parryRecover, [0.09, 0.09], false);
    def('riposte', riposte, [0.05, 0.05, 0.12, 0.09, 0.09], false);
    def('hit', hit, [0.07, 0.09, 0.1], false);
    def('death', death, [0.09, 0.12, 0.14, 0.09, 0.08, 0.1, 2], false);
    def('skid', skid, [0.07, 0.07], false);
  }

  /** Compose one pose into a frame canvas (with and without the gun arm). */
  private bake(pose: Pose): Frame {
    const compose = (withArm: boolean) => {
      const tmp = canvas(FW, FH);
      const ox = AX - Math.floor(this.w / 2), oy = AY - this.h;   // sprite top-left inside the frame
      for (const p of ORDER) {
        if (p === 'armF' && !withArm) continue;
        const t = pose[p] ?? [0, 0];
        const bob = UPPER.includes(p) ? pose.bob ?? 0 : 0;
        const [px, py] = PIVOT[p];
        const x = ox + px + Math.round(t[0]), y = oy + py + Math.round(t[1]) + bob;
        tmp.ctx.save();
        tmp.ctx.translate(x, y);
        if (t[2]) tmp.ctx.rotate(t[2]);
        if (t[3]) tmp.ctx.scale(1, t[3]);
        tmp.ctx.drawImage(this.parts[p], -px, -py);
        tmp.ctx.restore();
      }
      const a = pose.all;
      if (!a) return tmp.c;
      // whole-body transform around the body's center (tumbles, falls, squash)
      const out = canvas(FW, FH);
      const cx = AX, cy = AY - (a.rot ? 26 : 0);
      out.ctx.translate(cx + (a.dx ?? 0), cy + (a.dy ?? 0));
      if (a.rot) out.ctx.rotate(a.rot);
      out.ctx.scale(a.sx ?? 1, a.sy ?? 1);
      out.ctx.drawImage(tmp.c, -cx, -cy);
      return out.c;
    };
    const img = compose(true);
    const t = pose.armF ?? [0, 0], bob = pose.bob ?? 0;
    const a = pose.all;
    const sx = AX - Math.floor(this.w / 2) + PIVOT.armF[0] + Math.round(t[0]) + (a?.dx ?? 0);
    const sy = AY - this.h + PIVOT.armF[1] + Math.round(t[1]) + bob;
    const rot = t[2] ?? 0, armDir = Math.PI / 2 + rot;   // the arm hangs down at rot 0
    const hand = a?.rot ? null : { x: sx + Math.cos(armDir) * ARM_LEN, y: sy + Math.sin(armDir) * ARM_LEN, a: armDir + (pose.blade ?? 0) };
    return {
      hand,
      img, noArm: a?.rot ? img : compose(false), flash: tinted(img, '#ffffff'), shadow: tinted(img, '#4a22b0', 0.9),
      // where the gun shoulder ends up in frame space, so the live arm attaches to the posed body
      shoulder: { x: sx, y: sy },
    };
  }

  frameAt(name: string, time: number): Frame {
    const a = this.anims[name];
    let t = a.loop ? time % a.total : Math.min(time, a.total - 1e-6);
    for (let i = 0; i < a.frames.length; i++) {
      if (t < a.durs[i]) return a.frames[i];
      t -= a.durs[i];
    }
    return a.frames[a.frames.length - 1];
  }

  /** Index of the frame at `time`, used to fire footsteps on contact frames. */
  indexAt(name: string, time: number) {
    const a = this.anims[name];
    let t = a.loop ? time % a.total : Math.min(time, a.total - 1e-6);
    for (let i = 0; i < a.frames.length; i++) { if (t < a.durs[i]) return i; t -= a.durs[i]; }
    return a.frames.length - 1;
  }
}
