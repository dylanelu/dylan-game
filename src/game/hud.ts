import { Boss } from './boss';
import { HERO_LOOKS } from './assets';
import { ACTIVES, PASSIVES, RARITY, RELICS, WEAPONS, xpToNext } from './items';
import { BOSS_AT } from './night';
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
let lastBoss: Boss | undefined;

export function drawHud(g: Game, ctx: CanvasRenderingContext2D) {
  const W = g.r.w, H = g.r.h, p = g.player;

  // player: HP with a trailing "damage ghost", mana, roll pip, empowered shots
  const hk = p.hp / p.maxHp;
  hpGhost = Math.max(hk, hpGhost - 0.5 / 60);
  bar(ctx, 8, 8, 90, 5, hk, hk < 0.3 ? '#ff3355' : '#e04a6a', '#120e1e', hpGhost);
  bar(ctx, 8, 16, 70, 3, p.mana / p.maxMana, p.boundless ? '#7ad8ff' : '#8a4cff');
  if (p.boundless) drawText(ctx, 'INF', 80, 14, '#7ad8ff');
  ctx.fillStyle = p.rollCd > 0 ? '#3a3155' : '#9ad0ff';
  ctx.fillRect(82, 16, 3, 3);
  for (let i = 0; i < p.empowered; i++) { ctx.fillStyle = '#d8a8ff'; ctx.fillRect(8 + i * 5, 22, 3, 3); }

  // level + xp, then gear icons
  drawText(ctx, `LV ${p.level}`, 102, 15, '#ffd84a');
  bar(ctx, 8, 28, 70, 2, p.xp / xpToNext(p.level), '#ffd84a');
  const icons = [{ name: WEAPONS[p.weapon.key].icon, r: p.weapon.rarity }, ...p.passives.map((q) => ({ name: PASSIVES[q.key].icon, r: q.rarity }))];
  p.relics.forEach((k, i) => { const ic = g.A.nt(RELICS[k].icon, 0, 0, 24, 24, 1, true); ctx.drawImage(ic, 8 + (icons.length + i) * 18 - 4, 30); });
  icons.forEach((ic, i) => {
    const x = 8 + i * 18, y = 34;
    ctx.fillStyle = '#07060c'; ctx.fillRect(x - 1, y - 1, 18, 18);
    ctx.fillStyle = RARITY[ic.r].color; ctx.fillRect(x, y + 15, 16, 1);
    const t = g.A.tile(ic.name);
    ctx.drawImage(t, 0, 0, t.width, t.height, x + 8 - Math.min(16, t.width / 2) / 2, y + 16 - Math.min(16, t.height / 2), Math.min(16, t.width / 2), Math.min(16, t.height / 2));
  });

  // night clock + storm warning
  const n = g.night, left = Math.max(0, BOSS_AT - n.t);
  const clock = n.bossSpawned ? 'THE GATE IS OPEN' : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  drawText(ctx, clock, Math.round((W - textWidth(clock, 2)) / 2), g.coop ? 14 : 6, n.bossSpawned ? '#ff3355' : '#e8dcff', 2);
  if (n.closing) {
    const warn = 'SHADOW CLOSING';
    if (Math.floor(g.time * 2) % 2) drawText(ctx, warn, Math.round((W - textWidth(warn)) / 2), g.coop ? 28 : 20, '#b26bff');
  }
  if (n.outside(p.x, p.y) && p.state !== 'dead') {
    const warn = 'YOU ARE IN THE SHADOW';
    drawText(ctx, warn, Math.round((W - textWidth(warn)) / 2), Math.round(H * 0.62), '#ff6680');
  }

  // minimap (top right) — tap / click / M for the full map
  {
    const M = Math.min(88, Math.round(Math.min(W, H) * 0.26)), mx = W - M - 8, my = 44;
    drawMap(g, ctx, mx, my, M, false);
    mapRect = { x: mx, y: my, w: M, h: M };
  }

  // item buttons (bottom right, under the right thumb)
  drawItemButtons(g, ctx, W, H);

  // loot toast
  if (g.toastT < 2.2) {
    const a = g.toastT < 0.15 ? g.toastT / 0.15 : g.toastT > 1.8 ? (2.2 - g.toastT) / 0.4 : 1;
    ctx.globalAlpha = a;
    drawText(ctx, g.toastText, Math.round((W - textWidth(g.toastText)) / 2), Math.round(H * 0.72), g.toastColor);
    ctx.globalAlpha = 1;
  }
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
  const boss = g.nearBoss;
  if (boss !== lastBoss) { lastBoss = boss; bossGhost = 1; }
  if (boss) {
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
      ? ['LEFT THUMB: DRAG MOVE, RELEASE PARRY', 'TAP: SHOOT    FLICK: ROLL', 'ITEMS: TAP, OR DRAG TO AIM    MAP: TAP IT']
      : ['WASD MOVE   LMB SHOOT   RMB PARRY   SPACE ROLL', 'Q E ITEMS   M MAP   1-5 SPAWN   G GOD'];
    lines.forEach((l, i) => drawText(ctx, l, (W - textWidth(l)) / 2, H - 52 + i * 8, '#8a7ab8'));
    ctx.globalAlpha = 1;
  }

  if (g.mapOpen) drawFullMap(g, ctx);

  // end of the night
  if (n.ended) {
    const k = Math.min(1, n.endT / 1.2);
    ctx.fillStyle = `rgba(7,6,12,${0.65 * k})`; ctx.fillRect(0, 0, W, H);
    const title = n.ended === 'won' ? 'GATE CLEARED' : 'THE NIGHT CLAIMS YOU', sc = W > 420 ? 4 : 2;
    ctx.globalAlpha = k;
    drawText(ctx, title, Math.round((W - textWidth(title, sc)) / 2), Math.round(H * 0.32), n.ended === 'won' ? '#ffd84a' : '#ff3355', sc);
    const stats = `LEVEL ${p.level}   KILLS ${g.kills}   ${Math.floor(n.t / 60)}:${String(Math.floor(n.t % 60)).padStart(2, '0')}`;
    drawText(ctx, stats, Math.round((W - textWidth(stats)) / 2), Math.round(H * 0.32) + 6 * sc + 10, '#e8dcff');
    if (n.endT > 1.5) {
      const again = g.input.device === 'touch' ? 'TAP TO FACE ANOTHER NIGHT' : 'PRESS R TO FACE ANOTHER NIGHT';
      if (Math.floor(g.time * 2) % 2) drawText(ctx, again, Math.round((W - textWidth(again)) / 2), Math.round(H * 0.32) + 6 * sc + 26, '#8a7ab8');
    }
    ctx.globalAlpha = 1;
    return;
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

// ---------------------------------------------------------------- map + item buttons

let mapRect = { x: 0, y: 0, w: 0, h: 0 };
let buttons: { x: number; y: number; r: number }[] = [];

/** Hit tests the input layer uses for taps and clicks (native px). */
export function hudHit(g: Game) {
  g.input.buttonAt = (x, y) => buttons.findIndex((b) => Math.hypot(x - b.x, y - b.y) <= b.r + 4);
  g.input.mapAt = (x, y) => g.mapOpen || (x >= mapRect.x && y >= mapRect.y && x <= mapRect.x + mapRect.w && y <= mapRect.y + mapRect.h);
}

function drawMap(g: Game, ctx: CanvasRenderingContext2D, mx: number, my: number, M: number, labels: boolean) {
  const n = g.night, p = g.player, sc = M / g.level.width;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#07060c'; ctx.fillRect(mx - 2, my - 2, M + 4, M + 4);
  ctx.drawImage(g.level.minimap, mx, my, M, M);
  ctx.globalAlpha = 1;
  const cxm = mx + n.cx * sc, cym = my + n.cy * sc;
  ctx.save(); ctx.beginPath(); ctx.rect(mx, my, M, M); ctx.clip();
  // the storm: dark outside the circle
  ctx.fillStyle = 'rgba(40,10,60,0.55)';
  ctx.beginPath(); ctx.rect(mx, my, M, M); ctx.arc(cxm, cym, n.stormR * sc, 0, Math.PI * 2, true); ctx.fill('evenodd');
  ctx.strokeStyle = '#b26bff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cxm, cym, n.stormR * sc, 0, Math.PI * 2); ctx.stroke();
  if (n.nextR < n.stormR - 1) { ctx.strokeStyle = '#ffffff'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(cxm, cym, n.nextR * sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  for (const r of g.level.rooms) {
    if (r.kind === 'miniboss' && n.activeMb.has(r.id)) { ctx.fillStyle = '#ff3355'; ctx.fillRect(Math.round(mx + r.cx * sc) - 1, Math.round(my + r.cy * sc) - 1, 3, 3); }
  }
  ctx.fillStyle = n.bossSpawned ? '#ff3355' : '#ffd84a'; ctx.fillRect(Math.round(cxm) - 2, Math.round(cym) - 2, 4, 4);
  for (const c of n.chests) if (!c.opened) { ctx.fillStyle = '#ffc83a'; ctx.fillRect(Math.round(mx + c.x * sc), Math.round(my + c.y * sc), 1, 1); }
  for (const pl of [...g.remotes.values(), p]) {
    ctx.fillStyle = pl === p ? '#ffffff' : HERO_LOOKS[pl.slot].trim;
    ctx.fillRect(Math.round(mx + pl.x * sc) - 1, Math.round(my + pl.y * sc) - 1, 3, 3);
  }
  if (labels) {
    for (const q of g.level.pois) {
      const lx = mx + ((q.x0 + q.x1) / 2) * 32 * sc, ly = my + ((q.y0 + q.y1) / 2) * 32 * sc;
      drawText(ctx, q.name, Math.round(lx - textWidth(q.name) / 2), Math.round(ly - 2), q.color);
    }
  }
  ctx.restore();
}

/** Full map: big, labelled; tap / click / M again to close. */
export function drawFullMap(g: Game, ctx: CanvasRenderingContext2D) {
  const W = g.r.w, H = g.r.h, M = Math.min(W, H) - 30;
  ctx.fillStyle = 'rgba(7,6,12,0.7)'; ctx.fillRect(0, 0, W, H);
  drawMap(g, ctx, Math.round((W - M) / 2), Math.round((H - M) / 2), M, true);
  const hint = g.input.device === 'touch' ? 'TAP TO CLOSE' : 'M TO CLOSE';
  drawText(ctx, hint, Math.round((W - textWidth(hint)) / 2), H - 12, '#8a7ab8');
}

function drawItemButtons(g: Game, ctx: CanvasRenderingContext2D, W: number, H: number) {
  const p = g.player, touch = g.input.device === 'touch';
  const r = touch ? 20 : 13;
  // thumb arc in the bottom-right, lifted clear of the phone's home-indicator strip
  const lift = H > W ? 64 : 34;
  buttons = touch
    ? [{ x: W - 86, y: H - lift, r }, { x: W - 38, y: H - lift - 30, r }]
    : [{ x: W - 70, y: H - 22, r }, { x: W - 38, y: H - 22, r }];
  buttons.forEach((b, slot) => {
    const key = p.actives[slot], def = key ? ACTIVES[key] : null;
    ctx.globalAlpha = def ? 0.95 : 0.4;
    ctx.fillStyle = '#07060c'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1430'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    if (def) {
      const ic = g.A.nt(def.icon, 0, 0, 24, 24, 1, true);
      ctx.drawImage(ic, Math.round(b.x - 12), Math.round(b.y - 12));
      // cooldown sweep and mana shortfall
      const cd = (p.cooldowns[key!] ?? 0) / def.cooldown;
      if (cd > 0) { ctx.fillStyle = 'rgba(7,6,12,0.7)'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + cd * Math.PI * 2); ctx.fill(); }
      else if (!p.boundless && p.mana < def.cost) { ctx.fillStyle = 'rgba(30,20,60,0.6)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = cd > 0 ? '#3a3155' : def.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    }
    if (!touch) drawText(ctx, slot === 0 ? 'Q' : 'E', b.x - 1, b.y + b.r + 3, '#8a7ab8');
    ctx.globalAlpha = 1;
  });
  // drag-to-aim preview from the player
  const d = g.input.itemDrag;
  if (d) {
    const dx = d.x - d.ox, dy = d.y - d.oy, l = Math.hypot(dx, dy);
    if (l > 10) {
      const px = p.x - Math.round(g.cam.x), py = p.y - 18 - Math.round(g.cam.y);
      ctx.strokeStyle = '#ffd88a'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (dx / l) * 140, py + (dy / l) * 140); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}
