import { Boss } from './boss';
import { teamColor } from '../net/lobby';
import { ACTIVES, PASSIVES, RARITY, RELICS, WEAPONS, xpToNext } from './items';
import { weaponIcon } from './weapons';
import { BOSS_AT } from './night';
import { drawText, textWidth } from './font';
import type { Game } from './game';

// The in-game HUD. Few things, always in the same place:
//   top-left   pause (a DOM button, see index.html), level badge, health, mana, gear, teammates
//   top-center the clock and the storm warning (stacked under the top row when a phone is upright)
//   top-right  minimap (tap: full map), then battle royale counters and the kill feed
//   bottom     boss bar, item buttons under the right thumb
// Everything is laid out in HUD units `u`: 1 native px on a desktop, 2 on a phone, so text stays readable
// at roughly the same physical size everywhere.

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, fg: string, bg = '#120e1e', ghost?: number) {
  ctx.fillStyle = '#07060c'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  if (ghost !== undefined && ghost > k) { ctx.fillStyle = '#e8dcff'; ctx.fillRect(x, y, Math.round(w * ghost), h); }
  ctx.fillStyle = fg; ctx.fillRect(x, y, Math.round(w * Math.max(0, k)), h);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y, Math.round(w * Math.max(0, k)), Math.max(1, Math.round(h / 4)));
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let hpGhost = 1, bossGhost = 1;
let lastBoss: Boss | undefined;

/** Safe-area insets (notch, home bar) in CSS px, read from a probe element; refreshed on resize. */
let insets = { t: 0, r: 0, b: 0, l: 0 }, insetsAt = -1;
function readInsets() {
  if (insetsAt === innerWidth * 10000 + innerHeight) return insets;
  insetsAt = innerWidth * 10000 + innerHeight;
  let probe = document.getElementById('safe');
  if (!probe) {
    probe = document.createElement('div'); probe.id = 'safe';
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  insets = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  return insets;
}

/** HUD unit for this screen (see the header). */
export const hudUnit = (g: Game) => Math.max(1, Math.round(2.2 / g.r.cssPx));

export function drawHud(g: Game, ctx: CanvasRenderingContext2D) {
  const W = g.r.w, H = g.r.h, p = g.player, k = g.r.cssPx, u = hudUnit(g);
  const ins = readInsets();
  const top = Math.round((ins.t + 8) / k), left = Math.round((ins.l + 8) / k), right = W - Math.round((ins.r + 8) / k);

  // ---- top-left: [pause] [level] health / mana, gear, teammates
  const x0 = left + Math.round(52 / k);        // clear of the 44 css px pause button
  const bs = 11 * u;                            // level badge
  ctx.fillStyle = '#07060c'; ctx.fillRect(x0 - 1, top - 1, bs + 2, bs + 2);
  ctx.fillStyle = '#1a1430'; ctx.fillRect(x0, top, bs, bs);
  const xk = Math.min(1, p.xp / xpToNext(p.level));
  ctx.fillStyle = '#6a5520'; ctx.fillRect(x0, top + bs - u, bs, u);
  ctx.fillStyle = '#ffd84a'; ctx.fillRect(x0, top + bs - u, Math.round(bs * xk), u);
  const lv = String(p.level);
  drawText(ctx, lv, x0 + Math.round((bs - textWidth(lv, u)) / 2), top + Math.round((bs - u - 5 * u) / 2), '#ffd84a', u);

  const bx = x0 + bs + 3 * u, bw = Math.max(40 * u, Math.min(80 * u, Math.round(W * 0.28)));
  const hk = Math.max(0, p.hp / p.maxHp);
  hpGhost = Math.max(hk, hpGhost - 0.5 / 60);
  bar(ctx, bx, top, bw, 5 * u, hk, hk < 0.3 ? '#ff3355' : '#e04a6a', '#120e1e', hpGhost);
  const hpTxt = String(Math.max(0, Math.ceil(p.hp)));
  drawText(ctx, hpTxt, bx + bw - textWidth(hpTxt, u) - u, top + 0, '#ffffff', u, null);
  bar(ctx, bx, top + 7 * u, Math.round(bw * 0.8), 2 * u, p.mana / p.maxMana, p.boundless ? '#7ad8ff' : '#8a4cff');
  for (let i = 0; i < p.empowered; i++) { ctx.fillStyle = '#d8a8ff'; ctx.fillRect(bx + i * 4 * u, top + 10 * u, 2 * u, 2 * u); }
  if (g.god) drawText(ctx, 'GOD', bx + bw + 3 * u, top, '#ffd84a', u);

  // gear: weapon, passives, relics (small; it's how you see your build at a glance)
  let gy = top + bs + 4 * u;
  const icons = [{ img: weaponIcon(g.A, p.weapon.key), r: p.weapon.rarity }, ...p.passives.map((q) => ({ img: g.A.tile(PASSIVES[q.key].icon), r: q.rarity }))];
  const is = Math.max(12, 8 * u);
  icons.forEach((ic, i) => {
    const x = x0 + i * (is + u);
    ctx.fillStyle = 'rgba(7,6,12,0.7)'; ctx.fillRect(x, gy, is, is);
    ctx.fillStyle = RARITY[ic.r].color; ctx.fillRect(x, gy + is - 1, is, 1);
    const t = ic.img, s = Math.min(is / t.width, is / t.height);
    ctx.drawImage(t, x + Math.round((is - t.width * s) / 2), gy + Math.round((is - t.height * s) / 2), Math.round(t.width * s), Math.round(t.height * s));
  });
  p.relics.forEach((rk, i) => {
    const ic = g.A.nt(RELICS[rk].icon, 0, 0, 24, 24, 1, true), x = x0 + (icons.length + i) * (is + u);
    ctx.drawImage(ic, x, gy, is, is);
  });
  // thunder spear charges under the weapon icon
  if (WEAPONS[p.weapon.key]?.type === 'thunder') for (let i = 0; i < 3; i++) { ctx.fillStyle = i < p.ws.spears ? '#ffd84a' : '#3a3155'; ctx.fillRect(x0 + 1 + i * Math.round(is / 3), gy + is + 1, Math.max(2, Math.round(is / 4)), 2); }
  gy += is + 4 * u;

  // teammates: name and a sliver of health
  const mates = [...g.remotes.values()].filter((r) => r.peerId && (g.mode !== 'br' || r.team === p.team));
  for (const m of mates.slice(0, 8)) {
    const c = g.colorOf(m.peerId!), dead = m.state === 'dead' || m.dissolved;
    drawText(ctx, m.name || '?', x0, gy, dead ? '#5a5070' : c, u);
    bar(ctx, x0 + textWidth('MMMMMMMMMM', u) + 3 * u, gy + u, 24 * u, 2 * u, dead ? 0 : m.hp / m.maxHp, c);
    gy += 8 * u;
  }
  if (g.combo > 1) drawText(ctx, `${g.combo} PARRY CHAIN`, x0, gy, '#e8dcff', u);
  const leftBottom = gy, leftRight = Math.max(bx + bw, x0 + icons.length * (is + u));

  // ---- top-right: minimap (tap / click / M for the full map)
  const M = Math.min(96 * Math.max(1, u * 0.6), Math.round(Math.min(W, H) * 0.26)), mx = right - M, my = top;
  drawMap(g, ctx, mx, my, M, false);
  mapRect = { x: mx, y: my, w: M, h: M };
  let ry = my + M + 4 * u;

  // battle royale: players left, teams left, your eliminations
  if (g.mode === 'br' && g.match) {
    const alive = new Set<number>();
    let n = 0;
    for (const [id, t] of g.match.teams) {
      const pl = id === g.selfId ? p : g.remotes.get(id);
      if (pl ? pl.state !== 'dead' && !pl.dissolved : g.coop?.net.peers.has(id)) { n++; alive.add(t); }
    }
    const items: [string, (x: number, y: number) => void][] = [
      [String(n), (x, y) => iconPerson(ctx, x, y, u, '#e8e4f0')],
      ...(g.match.nTeams !== g.match.teams.size ? [[String(alive.size), (x: number, y: number) => iconFlag(ctx, x, y, u, '#9ad0ff')] as [string, (x: number, y: number) => void]] : []),
      [String(g.pvpKills), (x, y) => iconSkull(ctx, x, y, u, '#ff6680')],
    ];
    let x = right;
    for (const [txt, icon] of items.reverse()) {
      x -= textWidth(txt, u); drawText(ctx, txt, x, ry, '#ffffff', u);
      x -= 7 * u; icon(x, ry); x -= 5 * u;
    }
    ry += 8 * u;
  }
  // kill feed
  for (const f of g.feed) {
    const a = f.t > 5 ? 6 - f.t : 1;
    ctx.globalAlpha = a;
    let x = right - textWidth(f.b, u);
    drawText(ctx, f.b, x, ry, f.bc, u);
    if (f.a) {
      x -= 8 * u; iconBlade(ctx, x, ry, u);
      x -= textWidth(f.a, u) + 2 * u; drawText(ctx, f.a, x, ry, f.ac, u);
    } else { x -= textWidth('FELL ', u); drawText(ctx, 'FELL', x, ry, '#8a7ab8', u); }
    ctx.globalAlpha = 1;
    ry += 7 * u;
  }

  // ---- top-center: the clock. Stacks under the top row when the corners leave no room (upright phone).
  const n = g.night;
  let ct: string, cc = '#e8dcff';
  if (g.mode === 'br') {
    const next = n.nextClose;
    ct = n.closing ? 'STORM CLOSING' : next !== null ? `STORM ${clock(next)}` : 'FINAL CIRCLE';
    cc = n.closing ? '#ff6680' : '#e8dcff';
  } else {
    ct = n.bossSpawned ? 'THE GATE IS OPEN' : clock(Math.max(0, BOSS_AT - n.t));
    if (n.bossSpawned) cc = '#ff3355';
  }
  const cs = ct.length > 10 ? u : 2 * u, cw = textWidth(ct, cs);
  let cy = top;
  if ((W - cw) / 2 < leftRight + 4 * u || (W + cw) / 2 > mx - 4 * u) cy = Math.max(leftBottom, my + M) + 4 * u;
  drawText(ctx, ct, Math.round((W - cw) / 2), cy, cc, cs);
  if (g.mode !== 'br' && n.closing && Math.floor(g.time * 2) % 2) {
    const w = 'SHADOW CLOSING';
    drawText(ctx, w, Math.round((W - textWidth(w, u)) / 2), cy + 5 * cs + 3 * u, '#b26bff', u);
  }
  if (n.outside(p.x, p.y) && p.state !== 'dead') {
    const w = 'GET OUT OF THE SHADOW';
    if (Math.floor(g.time * 3) % 3) drawText(ctx, w, Math.round((W - textWidth(w, u)) / 2), Math.round(H * 0.62), '#ff6680', u);
  }

  // item buttons (bottom right, under the right thumb)
  if (p.state !== 'dead') drawItemButtons(g, ctx, W, H, u, ins.b / k); else buttons = [];

  if (g.overlay) { if (g.mapOpen) drawFullMap(g, ctx); return; }

  // loot toast
  if (g.toastT < 2.2) {
    const a = g.toastT < 0.15 ? g.toastT / 0.15 : g.toastT > 1.8 ? (2.2 - g.toastT) / 0.4 : 1;
    ctx.globalAlpha = a;
    drawText(ctx, g.toastText, Math.round((W - textWidth(g.toastText, u)) / 2), Math.round(H * 0.72), g.toastColor, u);
    ctx.globalAlpha = 1;
  }

  // boss bar: health on top, posture growing from the center underneath (Sekiro style)
  const boss = g.nearBoss;
  if (boss !== lastBoss) { lastBoss = boss; bossGhost = 1; }
  if (boss) {
    const bbw = Math.min(W - 40 * u, 300 * u), bbx = Math.round((W - bbw) / 2), by = H - Math.round((ins.b + 8) / k) - (H > W ? 70 * u : 16 * u);
    drawText(ctx, boss.name, bbx, by - 8 * u, '#e8dcff', u);
    const bk = boss.hp / boss.maxHp;
    bossGhost = Math.max(bk, bossGhost - 0.25 / 60);
    bar(ctx, bbx, by, bbw, 3 * u, bk, boss.phase === 2 ? '#ff2244' : '#c0304a', '#120e1e', bossGhost);
    const pk = boss.posture / boss.maxPosture, pw = Math.round(bbw * 0.6 * pk);
    if (pk > 0.01) {
      ctx.fillStyle = '#07060c'; ctx.fillRect(Math.round(W / 2 - pw / 2) - 1, by + 4 * u, pw + 2, 2 * u + 2);
      ctx.fillStyle = pk > 0.75 ? '#ffd84a' : '#d89a3a'; ctx.fillRect(Math.round(W / 2 - pw / 2), by + 4 * u + 1, pw, 2 * u);
    }
  } else bossGhost = 1;

  // spectating
  if (p.state === 'dead' && g.spectating) {
    const s = `SPECTATING ${g.spectating.name}`;
    drawText(ctx, s, Math.round((W - textWidth(s, u)) / 2), Math.round(H * 0.8), g.colorOf(g.spectating.peerId!), u);
  }

  // banner
  if (g.bannerT < g.bannerDur) {
    const kk = g.bannerT / g.bannerDur;
    const sc = Math.max(1, Math.min(3 * u, Math.floor((W - 16) / Math.max(1, textWidth(g.bannerText)))));
    const a = kk < 0.1 ? kk / 0.1 : kk > 0.8 ? (1 - kk) / 0.2 : 1;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(7,6,12,0.6)'; ctx.fillRect(0, Math.round(H * 0.3) - 6, W, 5 * sc + 12);
    drawText(ctx, g.bannerText, (W - textWidth(g.bannerText, sc)) / 2, Math.round(H * 0.3), g.bannerColor, sc);
    ctx.globalAlpha = 1;
  }

  // first solo run: three lines on how to play, then never again
  if (g.tutorialT > 0 && !boss) {
    ctx.globalAlpha = Math.min(1, g.tutorialT / 1.5);
    const lines = g.input.device === 'touch'
      ? ['DRAG LEFT SIDE: MOVE', 'LET GO: PARRY THE GLINT', 'TAP RIGHT: SHOOT   FLICK: ROLL']
      : ['WASD: MOVE   CLICK: SHOOT', 'RIGHT CLICK: PARRY THE GLINT', 'SPACE: ROLL   Q E: ITEMS   M: MAP'];
    const lw = Math.max(...lines.map((l) => textWidth(l, u))) + 12 * u, lh = lines.length * 9 * u + 8 * u;
    const lx = Math.round((W - lw) / 2), ly = Math.round(H * 0.6);
    ctx.fillStyle = 'rgba(7,6,12,0.75)'; ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = '#4a3a7a'; ctx.fillRect(lx, ly, lw, 1); ctx.fillRect(lx, ly + lh - 1, lw, 1);
    lines.forEach((l, i) => drawText(ctx, l, Math.round((W - textWidth(l, u)) / 2), ly + 5 * u + i * 9 * u, i === 1 ? '#ffd84a' : '#e8dcff', u));
    ctx.globalAlpha = 1;
  }

  if (g.mapOpen) drawFullMap(g, ctx);
  if (g.paused || g.night.ended || g.match?.result) return;

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

// ---------------------------------------------------------------- tiny pixel icons (5x5 at scale u)

function glyph(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, u: number, c: string) {
  ctx.fillStyle = '#07060c';
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') ctx.fillRect(x + (i - 1) * u, y + (j - 1) * u, 3 * u, 3 * u); });
  ctx.fillStyle = c;
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') ctx.fillRect(x + i * u, y + j * u, u, u); });
}
const iconPerson = (c: CanvasRenderingContext2D, x: number, y: number, u: number, col: string) => glyph(c, ['.#.', '###', '.#.', '#.#', '#.#'], x, y, u, col);
const iconFlag = (c: CanvasRenderingContext2D, x: number, y: number, u: number, col: string) => glyph(c, ['###', '#.#', '###', '#..', '#..'], x, y, u, col);
const iconSkull = (c: CanvasRenderingContext2D, x: number, y: number, u: number, col: string) => glyph(c, ['###', '#.#', '###', '.#.', '#.#'], x, y, u, col);
const iconBlade = (c: CanvasRenderingContext2D, x: number, y: number, u: number) => glyph(c, ['....#', '...#.', '#.#..', '.#...', '#.#..'], x, y, u, '#e8dcff');

// ---------------------------------------------------------------- map + item buttons

let mapRect = { x: 0, y: 0, w: 0, h: 0 };
let buttons: { x: number; y: number; r: number }[] = [];

/** Hit tests the input layer uses for taps and clicks (native px). */
export function hudHit(g: Game) {
  // an empty slot on a phone isn't drawn, so it doesn't swallow taps either
  g.input.buttonAt = (x, y) => buttons.findIndex((b, i) => (g.player.actives[i] || g.input.device !== 'touch') && Math.hypot(x - b.x, y - b.y) <= b.r + 4);
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
  if (g.mode !== 'br') { ctx.fillStyle = n.bossSpawned ? '#ff3355' : '#ffd84a'; ctx.fillRect(Math.round(cxm) - 2, Math.round(cym) - 2, 4, 4); }
  for (const c of n.chests) if (!c.opened) { ctx.fillStyle = '#ffc83a'; ctx.fillRect(Math.round(mx + c.x * sc), Math.round(my + c.y * sc), 1, 1); }
  // teammates in their color (enemy players stay off your map), you in white on top
  for (const pl of g.remotes.values()) {
    if (!pl.peerId || pl.dissolved || (g.mode === 'br' && pl.team !== p.team)) continue;
    ctx.fillStyle = g.mode === 'br' ? teamColor(pl.team) : g.colorOf(pl.peerId);
    ctx.fillRect(Math.round(mx + pl.x * sc) - 1, Math.round(my + pl.y * sc) - 1, 3, 3);
  }
  if (p.state !== 'dead') {
    ctx.fillStyle = '#07060c'; ctx.fillRect(Math.round(mx + p.x * sc) - 2, Math.round(my + p.y * sc) - 2, 5, 5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(mx + p.x * sc) - 1, Math.round(my + p.y * sc) - 1, 3, 3);
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
  drawText(ctx, hint, Math.round((W - textWidth(hint, hudUnit(g))) / 2), Math.round((H + M) / 2) + 6, '#8a7ab8', hudUnit(g));
}

function drawItemButtons(g: Game, ctx: CanvasRenderingContext2D, W: number, H: number, u: number, insetB: number) {
  const p = g.player, touch = g.input.device === 'touch';
  const r = touch ? 20 : 13;
  // thumb arc in the bottom-right, lifted clear of the phone's home-indicator strip
  const lift = (H > W ? 64 : 34) + Math.round(insetB);
  buttons = touch
    ? [{ x: W - 86, y: H - lift, r }, { x: W - 38, y: H - lift - 30, r }]
    : [{ x: W - 70, y: H - 22, r }, { x: W - 38, y: H - 22, r }];
  buttons.forEach((b, slot) => {
    const key = p.actives[slot], def = key ? ACTIVES[key] : null;
    // an empty slot on a phone is just clutter under the thumb; on desktop it teaches Q / E
    if (!def && touch) return;
    ctx.globalAlpha = def ? 0.95 : 0.35;
    ctx.fillStyle = '#07060c'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1430'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    if (def) {
      const ic = g.A.nt(def.icon, 0, 0, 24, 24, 1, true);
      ctx.drawImage(ic, Math.round(b.x - 12), Math.round(b.y - 12));
      // cooldown sweep and mana shortfall
      const cd = (p.cooldowns[key!] ?? 0) / def.cooldown;
      if (cd > 0) { ctx.fillStyle = 'rgba(7,6,12,0.7)'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + cd * Math.PI * 2); ctx.fill(); }
      else if (key === 'domain') {
        // the domain's charge meter: dim until full, then it pulses
        const ch = p.domainCharge;
        if (ch < 1) { ctx.fillStyle = 'rgba(30,8,20,0.65)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = def.color; ctx.lineWidth = 2; ctx.globalAlpha = ch < 1 ? 0.95 : 0.6 + 0.4 * Math.sin(g.time * 8);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2, -Math.PI / 2, -Math.PI / 2 + ch * Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.95;
      }
      else if (!p.boundless && p.mana < def.cost) { ctx.fillStyle = 'rgba(30,20,60,0.6)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = cd > 0 ? '#3a3155' : def.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    }
    if (!touch) drawText(ctx, slot === 0 ? 'Q' : 'E', b.x - 1, b.y + b.r + 3, '#8a7ab8');
    ctx.globalAlpha = 1;
  });
  void u;
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
