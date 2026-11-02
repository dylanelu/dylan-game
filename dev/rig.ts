// Dev viewer: every hero animation looping live, plus a contact sheet of all frames.
// /dev/rig.html?sheet shows only a compact contact sheet (for screenshots).
import { loadAssets } from '../src/game/assets';
import { AX, AY, FH, FW } from '../src/game/hero';

const A = await loadAssets('../');
const rig = A.rig;
const sheetOnly = location.search.includes('sheet');

if (sheetOnly) {
  const names = Object.keys(rig.anims), cw = 64, ch = FH, S = 2, cols = 8;
  const c = document.createElement('canvas'); c.width = cw * cols * S; c.height = names.length * ch * S;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
  names.forEach((n, row) => {
    rig.anims[n].frames.forEach((f, i) => {
      x.fillStyle = (i + row) % 2 ? '#262036' : '#1e1a2c';
      x.fillRect(i * cw * S, row * ch * S, cw * S, ch * S);
      x.fillStyle = '#3a3155'; x.fillRect(i * cw * S, (row * ch + AY) * S, cw * S, S);
      x.drawImage(f.img, AX - cw / 2, 0, cw, ch, i * cw * S, row * ch * S, cw * S, ch * S);
    });
    x.fillStyle = '#ffd84a'; x.font = '14px monospace'; x.fillText(n, 4, row * ch * S + 16);
  });
  document.body.append(c);
} else {
  const S = 3;
  const live: { name: string; ctx: CanvasRenderingContext2D }[] = [];
  for (const name of Object.keys(rig.anims)) {
    const c = document.createElement('canvas'); c.width = FW; c.height = FH;
    c.style.width = `${FW * S}px`; c.style.height = `${FH * S}px`;
    const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    const d = document.createElement('div'); d.className = 'cell'; d.append(c, name);
    document.getElementById('live')!.append(d);
    live.push({ name, ctx });
  }
  const t0 = performance.now();
  (function tick() {
    const t = (performance.now() - t0) / 1000;
    for (const { name, ctx } of live) {
      ctx.fillStyle = '#221d30'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#3a3155'; ctx.fillRect(0, AY, FW, 1);
      const a = rig.anims[name];
      ctx.drawImage(rig.frameAt(name, a.loop ? t : t % (a.total + 0.6)).img, 0, 0);
    }
    requestAnimationFrame(tick);
  })();
}
