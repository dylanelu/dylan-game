import type { Renderer } from './renderer';

// Touch: first finger on the left side is a floating joystick (drag = move, release = parry).
// Any other finger fires toward where it touches; a fast flick with it rolls that way.
// Mouse/keyboard: WASD move, LMB fire at cursor, RMB parry, Space/Shift roll.

export type InputEvent =
  | { type: 'parry' }
  | { type: 'roll'; dx: number; dy: number }
  | { type: 'key'; key: string };

interface GunTouch { sx: number; sy: number; t0: number; rolled: boolean }

const FLICK_PX = 26;      // css px a gun finger must travel...
const FLICK_MS = 200;     // ...within this long to count as a roll

export class Input {
  move = { x: 0, y: 0 };
  firing = false;
  aim = { x: 0, y: 0 };         // native screen coords
  device: 'mouse' | 'touch' = 'mouse';
  joy: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  events: InputEvent[] = [];
  private keys = new Set<string>();
  private guns = new Map<number, GunTouch>();
  private mouseDown = false;
  private onFirst: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private r: Renderer) {
    addEventListener('keydown', (e) => this.keyDown(e));
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.updateKeys(); });
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; this.updateKeys(); this.firing = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => this.mouse(e, true));
    addEventListener('mouseup', (e) => this.mouse(e, false));
    addEventListener('mousemove', (e) => {
      if (this.device !== 'mouse') return;
      this.aim = this.r.clientToNative(e.clientX, e.clientY);
    });
    canvas.addEventListener('touchstart', (e) => this.touch(e, 'start'), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.touch(e, 'move'), { passive: false });
    canvas.addEventListener('touchend', (e) => this.touch(e, 'end'), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this.touch(e, 'end'), { passive: false });
  }

  /** Runs once on the first user gesture (audio unlock). */
  onFirstGesture(fn: () => void) { this.onFirst.push(fn); }
  private gesture() { for (const f of this.onFirst.splice(0)) f(); }

  private keyDown(e: KeyboardEvent) {
    this.gesture();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      e.preventDefault();
      this.events.push({ type: 'roll', dx: 0, dy: 0 });
    } else if (e.code === 'KeyK') {
      this.events.push({ type: 'parry' });
    } else {
      this.events.push({ type: 'key', key: e.code });
    }
    this.device = 'mouse';
    this.updateKeys();
  }

  private updateKeys() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    const l = Math.hypot(x, y);
    if (l > 0) { x /= l; y /= l; }
    if (!this.joy) this.move = { x, y };
  }

  private mouse(e: MouseEvent, down: boolean) {
    this.gesture();
    this.device = 'mouse';
    this.aim = this.r.clientToNative(e.clientX, e.clientY);
    if (e.button === 0) { this.mouseDown = down; this.firing = down; }
    if (e.button === 2 && down) this.events.push({ type: 'parry' });
  }

  private touch(e: TouchEvent, phase: 'start' | 'move' | 'end') {
    e.preventDefault();
    this.gesture();
    this.device = 'touch';
    const now = performance.now();
    for (const t of Array.from(e.changedTouches)) {
      const p = this.r.clientToNative(t.clientX, t.clientY);
      if (phase === 'start') {
        if (!this.joy && t.clientX < innerWidth * 0.45) {
          this.joy = { id: t.identifier, ox: p.x, oy: p.y, x: p.x, y: p.y };
        } else {
          this.guns.set(t.identifier, { sx: t.clientX, sy: t.clientY, t0: now, rolled: false });
          this.aim = p;
        }
      } else if (phase === 'move') {
        if (this.joy && t.identifier === this.joy.id) {
          this.joy.x = p.x; this.joy.y = p.y;
          const radius = 22; // native px for full speed
          let dx = (p.x - this.joy.ox) / radius, dy = (p.y - this.joy.oy) / radius;
          const l = Math.hypot(dx, dy);
          if (l > 1) {
            dx /= l; dy /= l;
            // drag the base along so the stick never feels "stuck" at the rim
            this.joy.ox = p.x - dx * radius; this.joy.oy = p.y - dy * radius;
          }
          this.move = l < 0.12 ? { x: 0, y: 0 } : { x: dx, y: dy };
        } else {
          const g = this.guns.get(t.identifier);
          if (!g) continue;
          this.aim = p;
          const dx = t.clientX - g.sx, dy = t.clientY - g.sy;
          if (!g.rolled && now - g.t0 < FLICK_MS && Math.hypot(dx, dy) > FLICK_PX) {
            g.rolled = true;
            this.events.push({ type: 'roll', dx, dy });
          }
        }
      } else {
        if (this.joy && t.identifier === this.joy.id) {
          this.joy = null;
          this.move = { x: 0, y: 0 };
          this.events.push({ type: 'parry' });
        } else {
          this.guns.delete(t.identifier);
        }
      }
    }
    this.firing = [...this.guns.values()].some((g) => !g.rolled);
  }
}
