// Dev viewer for the hero: every animation strip (normal, flash, shadow) and the shadow dagger, at 4x.
import { loadAssets } from '../src/game/assets';

const A = await loadAssets('../');
const S = 4;
const root = document.getElementById('live')!;
for (const [slot, set] of A.heroes.entries()) for (const [name, anim] of Object.entries(set)) {
  for (const variant of (slot === 0 ? ['normal', 'flash', 'shadow'] : ['normal']) as ('normal' | 'flash' | 'shadow')[]) {
    const frames: HTMLCanvasElement[] = (anim as { normal: HTMLCanvasElement[]; flash: HTMLCanvasElement[]; shadow: HTMLCanvasElement[] })[variant];
    const c = document.createElement('canvas');
    c.width = frames.reduce((w, f) => w + f.width + 4, 0); c.height = Math.max(...frames.map((f) => f.height));
    c.style.width = `${c.width * S}px`; c.style.height = `${c.height * S}px`;
    const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#221d30'; ctx.fillRect(0, 0, c.width, c.height);
    let x = 0;
    for (const f of frames) { ctx.drawImage(f, x, c.height - f.height); x += f.width + 4; }
    const d = document.createElement('div'); d.className = 'cell'; d.append(c, `P${slot + 1} ${name} ${variant}`);
    root.append(d);
  }
}
const c = document.createElement('canvas'); c.width = A.dagger.w; c.height = A.dagger.h;
c.style.width = `${c.width * S}px`; c.getContext('2d')!.drawImage(A.dagger.img, 0, 0);
const d = document.createElement('div'); d.className = 'cell'; d.append(c, 'dagger'); root.append(d);
