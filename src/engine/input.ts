import type { Renderer } from './renderer';

// Touch: first finger on the left side is a floating joystick (drag = move, release = parry).
// Any other finger fires toward where it touches; a fast flick with it rolls that way.
// Mouse/keyboard: WASD move, LMB fire at cursor, RMB parry, Space/Shift roll, Q/E use the two item slots.
// Item buttons (touch): tap to use with auto-aim, or drag from the button to aim and release to fire.

export type InputEvent =
  | { type: 'parry' }
  | { type: 'roll'; dx: number; dy: number }
  | { type: 'key'; key: string }
  | { type: 'item'; slot: number; dx: number; dy: number; dragged: boolean };

interface GunTouch { sx: number; sy: number; t0: number; rolled: boolean }

const FLICK_PX = 26;      // css px a gun finger must travel...
const FLICK_MS = 200;     // ...within this long to count as a roll

/** The physical key. Some setups (remote desktops, a few Linux / VM keyboards) report no `code`; fall back to
 *  the typed letter so WASD still works there. */
function codeOf(e: KeyboardEvent) {
  if (e.code && e.code !== 'Unidentified') return e.code;
  return /^[a-z]$/i.test(e.key) ? 'Key' + e.key.toUpperCase() : e.key;
}

export class Input {
  move = { x: 0, y: 0 };
  firing = false;
  aim = { x: 0, y: 0 };         // native screen coords
  device: 'mouse' | 'touch' = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  joy: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  /** an item button being dragged to aim (touch), in native screen px */
  itemDrag: { id: number; slot: number; ox: number; oy: number; x: number; y: number } | null = null;
  /** set by the HUD: which item button (0/1) is at a native screen point, or -1 */
  buttonAt: (x: number, y: number) => number = () => -1;
  /** set by the HUD: the full-map toggle area */
  mapAt: (x: number, y: number) => boolean = () => false;
  events: InputEvent[] = [];
  private keys = new Set<string>();
  private guns = new Map<number, GunTouch>();
  private mouseDown = false;
  private onFirst: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private r: Renderer) {
    addEventListener('keydown', (e) => this.keyDown(e));
    addEventListener('keyup', (e) => {
      // macOS sends no keyups for keys released while Cmd is held, so a Cmd-shortcut could leave one stuck
      if (e.key === 'Meta') this.keys.clear(); else this.keys.delete(codeOf(e));
      this.updateKeys();
    });
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
    if (e.metaKey || e.ctrlKey || e.altKey) return;   // browser / OS shortcuts aren't game input
    if (e.target instanceof HTMLInputElement) return;  // typing a name or a room code
    const code = codeOf(e);
    // keep the browser from acting on game keys: Firefox's find-as-you-type would open its find bar on the
    // first letter and swallow the rest, arrows and Space would scroll
    if (/^(Key[A-Z]|Digit\d|Arrow\w+|Space|Escape)$/.test(code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(code);
    if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight') {
      this.events.push({ type: 'roll', dx: 0, dy: 0 });
    } else if (code === 'KeyK') {
      this.events.push({ type: 'parry' });
    } else if (code === 'KeyQ' || code === 'KeyE') {
      this.events.push({ type: 'item', slot: code === 'KeyQ' ? 0 : 1, dx: 0, dy: 0, dragged: false });
    } else {
      this.events.push({ type: 'key', key: code });
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
    // clicking an on-screen item button or the minimap uses it instead of firing
    if (down && e.button === 0) {
      const slot = this.buttonAt(this.aim.x, this.aim.y);
      if (slot >= 0) { this.events.push({ type: 'item', slot, dx: 0, dy: 0, dragged: false }); return; }
      if (this.mapAt(this.aim.x, this.aim.y)) { this.events.push({ type: 'key', key: 'KeyM' }); return; }
    }
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
        const slot = this.buttonAt(p.x, p.y);
        if (slot >= 0 && !this.itemDrag) { this.itemDrag = { id: t.identifier, slot, ox: p.x, oy: p.y, x: p.x, y: p.y }; continue; }
        if (this.mapAt(p.x, p.y)) { this.events.push({ type: 'key', key: 'KeyM' }); continue; }
        if (!this.joy && t.clientX < innerWidth * 0.45) {
          this.joy = { id: t.identifier, ox: p.x, oy: p.y, x: p.x, y: p.y };
        } else {
          this.guns.set(t.identifier, { sx: t.clientX, sy: t.clientY, t0: now, rolled: false });
          this.aim = p;
        }
      } else if (phase === 'move') {
        if (this.itemDrag && t.identifier === this.itemDrag.id) { this.itemDrag.x = p.x; this.itemDrag.y = p.y; continue; }
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
        if (this.itemDrag && t.identifier === this.itemDrag.id) {
          const d = this.itemDrag, dx = d.x - d.ox, dy = d.y - d.oy;
          this.events.push({ type: 'item', slot: d.slot, dx, dy, dragged: Math.hypot(dx, dy) > 10 });
          this.itemDrag = null;
          continue;
        }
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
