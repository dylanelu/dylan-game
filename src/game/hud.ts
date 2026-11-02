import { Boss } from './boss';
import { HERO_LOOKS } from './assets';
import { drawText, textWidth } from './font';
import type { Game } from './game';

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, fg: string, bg = '#120e1e', ghost?: number) {
  ctx.fillStyle = '#07060c'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  if (ghost !== undefined && ghost > k) { ctx.fillStyle = '#e8dcff'; ctx.fillRect(x, y, Math.round(w * ghost), h); }
  ctx.fillStyle = fg; ctx.fillRect(x, y, Math.round(w * Math.max(0, k)), h);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y, Math.round(w * Math.max(0, k)), 1);
}

let hpGhost = 1, bossGhost = 1;

export function drawHud(g: Game, ctx: CanvasRenderingContext2D) {
  const W = g.r.w, H = g.r.h, p = g.player;

  // player: HP with a trailing "damage ghost", mana, roll pip, empowered shots
  const hk = p.hp / p.maxHp;
  hpGhost = Math.max(hk, hpGhost - 0.5 / 60);
  bar(ctx, 8, 8, 90, 5, hk, hk < 0.3 ? '#ff3355' : '#e04a6a', '#120e1e', hpGhost);
  bar(ctx, 8, 16, 70, 3, p.mana / p.maxMana, '#8a4cff');
  ctx.fillStyle = p.rollCd > 0 ? '#3a3155' : '#9ad0ff';
  ctx.fillRect(82, 16, 3, 3);
  for (let i = 0; i < p.empowered; i++) { ctx.fillStyle = '#d8a8ff'; ctx.fillRect(8 + i * 5, 22, 3, 3); }
  if (g.god) drawText(ctx, 'GOD', 102, 8, '#ffd84a');
  if (g.combo > 1) drawText(ctx, `${g.combo} PARRY CHAIN`, 8, 28, '#e8dcff');

  // co-op: room line + every player's color and health
  if (g.coop) {
    const c = g.coop, line = `ROOM ${c.roomId}  ${c.count}/6  ${c.status}`;
    drawText(ctx, line, Math.round((W - textWidth(line)) / 2), 6, '#8a7ab8');
    const all = [g.player, ...g.remotes.values()].sort((a, b) => a.slot - b.slot);
    all.forEach((pl, i) => {
      const y = 40 + i * 9, look = HERO_LOOKS[pl.slot];
      ctx.fillStyle = look.trim; ctx.fillRect(8, y, 5, 5);
      bar(ctx, 16, y + 1, 40, 3, pl.hp / pl.maxHp, pl.state === 'dead' ? '#3a3155' : look.trim);
      drawText(ctx, pl === g.player ? `${look.name} (YOU)` : look.name, 60, y, look.trim);
    });
  }

  // boss bar: health on top, posture growing from the center underneath (Sekiro style)
  const boss = g.enemies.find((e) => e instanceof Boss) as Boss | undefined;
  if (boss && boss.state !== 'spawn') {
    const bw = Math.min(W - 60, 300), bx = Math.round((W - bw) / 2), by = H - 30;
    drawText(ctx, boss.name, bx, by - 8, '#e8dcff');
    const k = boss.hp / boss.maxHp;
    bossGhost = Math.max(k, bossGhost - 0.25 / 60);
    bar(ctx, bx, by, bw, 4, k, boss.phase === 2 ? '#ff2244' : '#c0304a', '#120e1e', bossGhost);
    const pk = boss.posture / boss.maxPosture, pw = Math.round(bw * 0.6 * pk);
    if (pk > 0.01) {
      ctx.fillStyle = '#07060c'; ctx.fillRect(Math.round(W / 2 - pw / 2) - 1, by + 7, pw + 2, 4);
      ctx.fillStyle = pk > 0.75 ? '#ffd84a' : '#d89a3a'; ctx.fillRect(Math.round(W / 2 - pw / 2), by + 8, pw, 2);
    }
  } else bossGhost = 1;

  // banner
  if (g.bannerT < g.bannerDur) {
    const k = g.bannerT / g.bannerDur, sc = W > 420 ? 3 : 2;
    const a = k < 0.1 ? k / 0.1 : k > 0.8 ? (1 - k) / 0.2 : 1;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(7,6,12,0.6)'; ctx.fillRect(0, Math.round(H * 0.3) - 6, W, 5 * sc + 12);
    drawText(ctx, g.bannerText, (W - textWidth(g.bannerText, sc)) / 2, Math.round(H * 0.3), g.bannerColor, sc);
    ctx.globalAlpha = 1;
  }

  // controls hint
  if (g.hintT > 0 && !boss) {
    ctx.globalAlpha = Math.min(1, g.hintT / 2);
    const lines = g.input.device === 'touch'
      ? ['LEFT THUMB: DRAG MOVE, RELEASE PARRY', 'TAP: SHOOT    FLICK: ROLL']
      : ['WASD MOVE   LMB SHOOT   RMB PARRY   SPACE ROLL', '1-5 SPAWN   4 BOSS   G GOD   H HITBOX'];
    lines.forEach((l, i) => drawText(ctx, l, (W - textWidth(l)) / 2, H - 52 + i * 8, '#8a7ab8'));
    ctx.globalAlpha = 1;
  }

  // pause overlay
  if (g.paused) {
    ctx.fillStyle = 'rgba(7,6,12,0.55)'; ctx.fillRect(0, 0, W, H);
    const sc = W > 420 ? 4 : 3;
    drawText(ctx, 'PAUSED', (W - textWidth('PAUSED', sc)) / 2, Math.round(H * 0.4), '#e8dcff', sc);
    const hint = g.input.device === 'touch' ? 'TAP II TO RESUME' : 'ESC TO RESUME';
    drawText(ctx, hint, (W - textWidth(hint)) / 2, Math.round(H * 0.4) + 6 * sc + 6, '#8a7ab8');
    return;
  }

  // touch joystick
  const j = g.input.joy;
  if (j) {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#e8dcff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(Math.round(j.ox), Math.round(j.oy), 22, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.6; ctx.fillStyle = '#e8dcff';
    ctx.beginPath(); ctx.arc(Math.round(j.x), Math.round(j.y), 7, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // crosshair on mouse
  if (g.input.device === 'mouse') {
    const x = Math.round(g.input.aim.x), y = Math.round(g.input.aim.y);
    ctx.fillStyle = '#07060c';
    ctx.fillRect(x - 5, y - 1, 11, 3); ctx.fillRect(x - 1, y - 5, 3, 11);
    ctx.fillStyle = p.empowered > 0 ? '#d8a8ff' : '#e8dcff';
    ctx.fillRect(x - 4, y, 3, 1); ctx.fillRect(x + 2, y, 3, 1); ctx.fillRect(x, y - 4, 1, 3); ctx.fillRect(x, y + 2, 1, 3);
  }
}
