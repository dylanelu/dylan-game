import { tinted, type Assets, type NinjaSheet, type Sprite } from './assets';
import { Boss } from './boss';
import { Shadow, type Enemy } from './enemies';
import type { Bullet, Game } from './game';
import { WEAPONS, type WeaponDef, type WeaponType } from './items';
import { Player } from './player';
import type { Wire } from '../net/net';

// Weapon types beyond the thrown dagger, and the abilities / relics that bend the fight around you.
// PvP-agnostic: every hit lands through Game.playerStrike (melee, blasts) or a player Bullet (arrows), so
// co-op damage reporting and later PvP targeting live in one place. Effects that change enemies (stun, push,
// pull, swap) are applied by whoever owns the enemies (solo / co-op host); clients send a small message.

const SPEARS = 3, SPEAR_RECHARGE = 7, FUSE = 0.6;
const BF_LO = 0.22;                       // Black Flash: a fresh punch this long after the last one landed...
const DOMAIN_R = 150, DOMAIN_TIME = 6;
export const BERU_ANIM = 'chort_idle_anim';

/** Per-player weapon timers. */
export class WeaponState {
  since = 9; combo = 0;                   // melee combo: time since the last swing, which hit is next
  swing: { t: number; dur: number; a0: number; a1: number } | null = null;   // blade sweep the held sprite follows
  charge = -1; full = false;              // greatbow draw time (-1: not drawing)
  spears = SPEARS; spearT = 0;            // thunder spear charges
  sinceHit = 9; bf = 0;                   // fists: time since a punch landed; Black Flash window after a perfect parry
  held = false;                           // attack held last frame (a fresh press is what times a Black Flash)
}

export type StrikeShape =
  | { k: 'arc'; x: number; y: number; a: number; r: number; arc: number; r0?: number }
  | { k: 'line'; x: number; y: number; a: number; len: number; w: number }
  | { k: 'circle'; x: number; y: number; r: number };
export interface StrikeOpts {
  knock?: number; crit?: boolean; how?: string;
  pierce?: boolean;                       // ignores armor (Inverted Spear, thunder spears)
  cutBullets?: boolean;                   // slices enemy bullets the shape touches
  titan?: number;                         // damage multiplier vs titans
  tip?: number; pull?: number;            // whip: light foes hit past `tip` px are dragged in at `pull`
}

const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };

/** Distance from the shape's origin to a body if the shape touches it, else -1. A body is a vertical capsule
 *  (x, y0..y1) of radius r, so tall titans can be cut at the knee as well as the chest. */
export function strikeDist(s: StrikeShape, x: number, y0: number, y1: number, r: number): number {
  const py = Math.max(y0, Math.min(y1, s.y)), dx = x - s.x, dy = py - s.y, d = Math.hypot(dx, dy);
  if (s.k === 'circle') return d <= s.r + r ? d : -1;
  if (s.k === 'arc') {
    if (d - r > s.r || d + r < (s.r0 ?? 0)) return -1;
    if (d < r) return d;
    return angDiff(Math.atan2(dy, dx), s.a) <= s.arc / 2 + Math.asin(Math.min(1, r / d)) ? d : -1;
  }
  const ux = Math.cos(s.a), uy = Math.sin(s.a), t = dx * ux + dy * uy, perp = Math.abs(dx * uy - dy * ux);
  return t >= -r && t <= s.len + r && perp <= s.w / 2 + r ? Math.max(0, t) : -1;
}

const M = { dmg: 0, crit: false };
/** Stealth and domain bonuses on a hit from this machine's player (bullets and strikes alike). */
export function hitMods(g: Game, e: Enemy, dmg: number, crit: boolean) {
  const p = g.player;
  M.dmg = dmg; M.crit = crit;
  if (p.stealth > 0) {
    // out of the dark: 1.5x, and the crit doubles it again
    p.stealth = 0; M.dmg *= 1.5; M.crit = true;
    g.fx.text(e.x, e.y - e.height() - 16, 'AMBUSH', '#6aff9a', 2, 0.8);
    g.hitstop(0.1); g.flash('#6aff9a', 0.12); g.chroma(1);
    g.fx.burst(p.x, p.y - Player.CHEST, 16, { speed: 60, colors: ['#1a2a20', '#3a5a44', '#6aff9a'], life: 0.5, grav: -30 });
  } else if (g.wx.inDomain(e.x, e.y, true)) M.crit = true;
  return M;
}

// ---------------------------------------------------------------- the local player's attacks

const aimAngle = (p: Player) => Math.atan2(p.aimY - (p.y - Player.CHEST), p.aimX - p.x);
function swing(p: Player, a: number, arc: number, dir: number, dur: number) { p.ws.swing = { t: 0, dur, a0: a - dir * arc / 2, a1: a + dir * arc / 2 }; }

/** Where a swing has the blade this frame, or null when no swing is playing. */
export function swingAngle(p: Player): number | null {
  const s = p.ws.swing;
  if (!s) return null;
  const k = Math.min(1, s.t / (s.dur * 0.6));
  return s.a0 + (s.a1 - s.a0) * (1 - (1 - k) * (1 - k) * (1 - k));
}

/** Drawing a greatbow slows you to a walk. */
export function weaponSlow(p: Player) { return p.ws.charge >= 0 ? 0.5 : 1; }

/** Runs every frame from Player.update: timers, then whatever the held attack means for this weapon. */
export function updateWeapon(g: Game, p: Player, dt: number) {
  const ws = p.ws, W = WEAPONS[p.weapon.key] ?? WEAPONS.dagger;
  ws.since += dt; ws.sinceHit += dt; ws.bf -= dt;
  if (ws.swing && (ws.swing.t += dt) >= ws.swing.dur) ws.swing = null;
  if (ws.spears < SPEARS && (ws.spearT += dt) >= SPEAR_RECHARGE) {
    ws.spears++; ws.spearT = 0;
    if (W.type === 'thunder') { g.sfx('reflect', p.x, 0.5); g.fx.text(p.x, p.y - Player.HEAD - 8, `SPEAR ${ws.spears}`, '#ffd84a', 1, 0.6); }
  }
  if (p.stealth > 0 && (p.stealth -= dt) <= 0) {
    g.fx.burst(p.x, p.y - 16, 12, { speed: 50, colors: ['#1a2a20', '#3a5a44'], life: 0.5, grav: -30 });
    g.sfx('whiff', p.x);
  }
  const fire = g.input.firing && p.state !== 'roll' && p.state !== 'grapple' && p.action?.name !== 'riposte';
  const press = fire && !ws.held;
  ws.held = g.input.firing;
  if (W.type === 'thrown') { if (g.input.firing && p.state !== 'roll' && p.action?.name !== 'riposte' && p.fireCd <= 0) p.fire(g); }
  else if (W.type === 'greatbow') bow(g, p, W, fire, dt);
  else if (fire && p.fireCd <= 0) attack(g, p, W, press);
}

function attack(g: Game, p: Player, W: WeaponDef, press: boolean) {
  const ws = p.ws, a = aimAngle(p), ux = Math.cos(a), uy = Math.sin(a), cx = p.x, cy = p.y - Player.CHEST;
  if (Math.abs(ux) > 0.05) p.face = Math.sign(ux);
  p.aimHold = 0.45; p.fireCd = W.interval;
  let mul = p.dmgMul;
  // perfect-parry charges empower melee too
  const emp = p.empowered > 0 && W.type !== 'thunder';
  if (emp) { p.empowered--; mul *= 1.8; }
  const color = emp ? '#d8a8ff' : W.color, range = W.range ?? 40, arc = W.arc ?? 2;
  switch (W.type) {
    case 'katana': {
      // three-hit chain; the third is a wide finisher with a real step in
      if (ws.since > 0.6) ws.combo = 0;
      const i = ws.combo, fin = i === 2, dir = i % 2 ? -1 : 1;
      ws.combo = (i + 1) % 3; ws.since = 0;
      const r = range * (fin ? 1.2 : 1), w = arc * (fin ? 1.25 : 1);
      p.vx += ux * (fin ? 210 : 110); p.vy += uy * (fin ? 210 : 110);
      swing(p, a, w, dir, fin ? 0.22 : 0.15);
      const hits = g.playerStrike({ k: 'arc', x: cx, y: cy, a, r, arc: w }, W.dmg * mul * (fin ? 1.7 : 1), { knock: fin ? 170 : 70, cutBullets: true, how: 'slash' });
      g.wx.vfx('arc', cx, cy, a, r, w, dir, fin ? 0.28 : 0.2, color, fin ? 4 : 3);
      g.wx.vfx('anim', cx + ux * r * 0.45, cy + uy * r * 0.45, a, fin ? 2 : 1.5, 0, dir, 0.18, color, 0, 'slash');
      g.sfx(fin ? 'shootBig' : 'shoot', p.x);
      p.punch(fin ? 2.4 : 1.2); g.kick(ux * (fin ? 3 : 1.5), uy * (fin ? 3 : 1.5));
      if (hits.length) { g.hitstop(fin ? 0.07 : 0.035); g.shake(fin ? 0.25 : 0.1); if (fin) g.zoomPunch(0.02); }
      break;
    }
    case 'fists': {
      // jab, cross, jab, uppercut. A fresh press in rhythm (or right after a perfect parry) is a Black Flash.
      if (ws.since > 0.5) ws.combo = 0;
      const i = ws.combo, upper = i === 3, side = i % 2 ? -1 : 1;
      ws.combo = (i + 1) % 4; ws.since = 0;
      const black = ws.bf > 0 || (press && ws.sinceHit >= BF_LO && ws.sinceHit <= BF_LO + (W.arc ?? 1.6) * 0.06);
      p.vx += ux * (upper ? 120 : 60); p.vy += uy * (upper ? 120 : 60);
      swing(p, a + side * 0.5, 1, -side, 0.12);
      const hits = g.playerStrike({ k: 'arc', x: cx, y: cy, a, r: range, arc }, W.dmg * mul * (upper ? 2.2 : 1) * (black ? 1.25 : 1),
        { knock: black ? 260 : upper ? 210 : 45, crit: black, how: black ? 'blackflash' : 'punch' });
      const hx = cx + ux * range * 0.7, hy = cy + uy * range * 0.7;
      g.sfx(upper ? 'shootBig' : 'whiff', p.x, upper ? 0.8 : 1.6);
      p.punch(upper ? 2.5 : 1); g.kick(ux * 1.5, uy * 1.5);
      if (hits.length) {
        ws.sinceHit = 0;
        if (black) { ws.bf = 0; blackFlash(g, p, hits[0], a); }
        else {
          g.hitstop(upper ? 0.06 : 0.025); g.shake(upper ? 0.2 : 0.06);
          g.fx.burst(hx, hy, upper ? 10 : 4, { speed: 120, angle: a, spread: 1.2, color, glow: true, life: 0.18, grav: 0, size: 1 });
          if (upper) g.wx.vfx('arc', cx, cy, a - side * 0.4, range * 0.9, 1.4, side, 0.2, color, 3);
        }
      }
      break;
    }
    case 'thunder': {
      if (ws.spears <= 0) { p.fireCd = 0.4; g.fx.text(p.x, p.y - Player.HEAD - 10, 'NO SPEARS', '#8a7ab8', 1, 0.5); g.sfx('whiff', p.x); return; }
      ws.spears--;
      g.wx.throwSpear(cx + ux * 12, cy + uy * 12, a, W.dmg * mul);
      g.sfx('shootBig', p.x); g.shake(0.12); g.kick(-ux * 3, -uy * 3);
      p.vx -= ux * 50; p.vy -= uy * 50; p.recoil = 6; p.punch(1.8);
      g.fx.burst(cx + ux * 14, cy + uy * 14, 8, { speed: 120, angle: a, spread: 0.7, colors: ['#ffd84a', '#ffffff', '#ff8a3a'], glow: true, life: 0.2, grav: 0 });
      break;
    }
    case 'invspear': {
      // a long straight thrust that goes through armor and unmakes the bullets on its line
      p.vx += ux * 90; p.vy += uy * 90; p.recoil = -10;
      swing(p, a, 0, 1, 0.16);
      const hits = g.playerStrike({ k: 'line', x: cx, y: cy, a, len: range, w: 14 }, W.dmg * mul, { knock: 90, pierce: true, cutBullets: true, how: 'pierce' });
      g.wx.vfx('line', cx, cy, a, range, 0, 1, 0.16, color, 4);
      g.wx.vfx('anim', cx + ux * range * 0.6, cy + uy * range * 0.6, a + Math.PI / 4, 2, 0, 1, 0.16, color, 0, 'cut');
      g.sfx('riposte', p.x, 0.7);
      p.punch(1.6); g.kick(ux * 2.5, uy * 2.5);
      if (hits.length) { g.hitstop(0.05); g.shake(0.15); }
      break;
    }
    case 'whip': {
      // wide sweep, alternating sides; the tip drags light foes in
      const dir = ws.combo = ws.combo > 0 ? -1 : 1;
      swing(p, a, arc * 0.8, dir, 0.24);
      const hits = g.playerStrike({ k: 'arc', x: cx, y: cy, a, r: range, arc, r0: 14 }, W.dmg * mul, { knock: 60, how: 'whip', tip: range * 0.62, pull: 420 });
      g.wx.vfx('chain', cx, cy, a, range, arc, dir, 0.3, color, 2);
      g.sfx('shoot', p.x); g.sfx('roll', p.x, 0.5);
      p.punch(1.2);
      if (hits.length) { g.hitstop(0.03); g.shake(0.1); g.sfx('reflect', p.x, 0.5); }
      break;
    }
  }
}

/** Black Flash: the hit lands within a hair of the last one and space bends. 2.5x, black and red sparks. */
function blackFlash(g: Game, p: Player, e: Enemy, a: number) {
  const x = e.x, y = e.y - e.height() * 0.5;
  g.hitstop(0.17); g.shake(0.55); g.chroma(2.2); g.flash('#ff1133', 0.28); g.zoomPunch(0.05); g.slowmo(0.25, 0.4);
  g.sfx('crit', x); g.sfx('break', x, 0.5);
  g.wx.vfx('anim', x, y, a, 2, 0, 1, 0.3, '#ff1133', 0, 'cutx');
  g.wx.vfx('anim', x, y, a + 0.3, 2, 0, -1, 0.3, '#07060c', 0, 'cutx');
  g.fx.burst(x, y, 20, { speed: 240, colors: ['#07060c', '#1a0008', '#07060c'], life: 0.45, grav: 0, drag: 5, size: 2 });
  g.fx.burst(x, y, 16, { speed: 280, colors: ['#ff1133', '#ff4a6a', '#ffffff'], glow: true, life: 0.3, grav: 0, drag: 6, size: 1 });
  g.fx.ring(x, y, 46, '#ff1133', 0.3, 3);
  g.fx.light(x, y, 120, '#ff1133', 1);
  g.fx.text(p.x, p.y - Player.HEAD - 16, 'BLACK FLASH', '#ff3355', 2, 0.9);
  g.wx.addCharge(0.1);
}

function bow(g: Game, p: Player, W: WeaponDef, fire: boolean, dt: number) {
  const ws = p.ws, draw = W.draw ?? 0.8;
  if (p.state === 'roll' || p.state === 'grapple' || p.state === 'dead') { ws.charge = -1; return; }
  if (ws.charge < 0) {
    if (fire && p.fireCd <= 0) { ws.charge = 0; ws.full = false; g.sfx('cast', p.x, 0.4); }
    return;
  }
  p.aimHold = 0.45;
  if (Math.abs(p.aimX - p.x) > 2) p.face = Math.sign(p.aimX - p.x);
  if (fire) {
    ws.charge += dt;
    if (!ws.full && ws.charge >= draw) {
      // the full-draw cue: a glint on the arrowhead
      ws.full = true;
      const a = aimAngle(p);
      g.fx.glint(p.x + Math.cos(a) * 16, p.y - Player.CHEST + Math.sin(a) * 16, '#ffd84a', 6, 0.3);
      g.sfx('glint', p.x);
    }
    return;
  }
  // released: loose it. A tap is a weak quick shot; a full draw is a piercing, shoving bolt.
  const quick = ws.charge < 0.15, k = Math.min(1, ws.charge / draw), full = ws.full;
  ws.charge = -1;
  const cost = p.boundless || p.empowered > 0 ? 0 : W.cost * (quick ? 0.5 : 1);
  if (p.mana < cost) { g.fx.text(p.x, p.y - Player.HEAD - 10, 'NO MANA', '#8a7ab8', 1, 0.5); return; }
  p.mana -= cost; p.manaDelay = 0.45; p.fireCd = W.interval;
  const emp = p.empowered > 0;
  if (emp) p.empowered--;
  const a = aimAngle(p), ux = Math.cos(a), uy = Math.sin(a), cx = p.x + ux * 4, cy = p.y - Player.CHEST + uy * 4;   // from the chest: point-blank shots still land
  const dmg = W.dmg * p.dmgMul * (quick ? 0.45 : full ? 3 : 0.6 + 1.2 * k) * (emp ? 1.6 : 1);
  const speed = (W.speed ?? 620) * (quick ? 0.8 : full ? 1.25 : 0.8 + 0.4 * k);
  g.bullets.push({
    x: cx, y: cy, vx: ux * speed, vy: uy * speed, r: full ? 4 : 3, dmg, team: 'player', heavy: false, life: 0.9, age: 0,
    color: full ? '#ffd84a' : W.color, kind: 'arrow', pierce: quick ? 0 : full ? 6 : Math.round(1 + 2 * k), hits: new Set(), source: null,
    knock: full ? 260 : quick ? 35 : 90,
  });
  g.onShot(g.bullets[g.bullets.length - 1]);
  if (full) {
    g.sfx('shootBig', p.x); g.shake(0.2); g.hitstop(0.03); g.kick(-ux * 4, -uy * 4);
    g.fx.ring(cx, cy, 22, '#ffd84a', 0.2, 2);
    g.fx.burst(cx, cy, 8, { speed: 160, angle: a, spread: 0.5, colors: ['#ffd84a', '#ffffff'], glow: true, life: 0.2, grav: 0 });
  } else g.sfx('shoot', p.x);
  p.vx -= ux * (full ? 60 : 20); p.vy -= uy * (full ? 60 : 20);
  p.recoil = full ? 6 : 3; p.punch(full ? 2 : 0.8); p.muzzle = 0.06;
  g.fx.light(cx, cy, full ? 70 : 40, '#ffd88a', 1);
}

// ---------------------------------------------------------------- held sprites and icons

/** [sheet, w, h, grip px above the sprite's bottom] for weapons drawn in the hand like the dagger. */
const HELD: Partial<Record<WeaponType, [NinjaSheet, number, number, number]>> = {
  katana: ['WKatana', 6, 14, 4], thunder: ['WLance2', 7, 21, 9], invspear: ['WSai', 7, 13, 4], whip: ['WWhipHand', 3, 14, 4],
};

/** Inventory / HUD icon for a weapon: the 0x72 tile for thrown ones, the Ninja Adventure sprite for the rest. */
export function weaponIcon(A: Assets, key: string): Sprite {
  const W = WEAPONS[key] ?? WEAPONS.dagger;
  if (!W.sheet) return A.tile(W.icon);
  const [sh, w, h] = W.sheet;
  return A.nt(sh, 0, 0, w, h, w > 16 ? 1 : 2);
}

/** The held weapon for any non-thrown type (false: draw the dagger as before). */
export function drawHeld(g: Game, p: Player, ctx: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, cx: number, cy: number, vis: number): boolean {
  const W = WEAPONS[p.weapon.key] ?? WEAPONS.dagger;
  if (W.type === 'thrown') return false;
  const b = p.blade(), gx = Math.round(b.gx - cx), gy = Math.round(b.gy - cy);
  if (W.type === 'fists') {
    // a glowing fist; while a Black Flash is on offer it crackles red and black
    const ws = p.ws, open = p === g.player && (ws.bf > 0 || (ws.sinceHit >= BF_LO - 0.04 && ws.sinceHit <= BF_LO + (W.arc ?? 1.6) * 0.06));
    glow.globalAlpha = vis; glow.fillStyle = open ? '#ff1133' : W.color;
    glow.fillRect(gx - 1, gy - 1, 3, 3);
    if (open) {
      ctx.fillStyle = '#07060c'; ctx.fillRect(gx - 2 + Math.round(Math.random() * 4 - 2), gy - 2 + Math.round(Math.random() * 4 - 2), 2, 2);
      glow.fillRect(gx + Math.round(Math.random() * 8 - 4), gy + Math.round(Math.random() * 8 - 4), 1, 1);
      g.fx.light(b.gx, b.gy, 30, '#ff1133', 0.7);
    }
    glow.globalAlpha = 1;
    return true;
  }
  if (W.type === 'greatbow') {
    const img = g.A.nt('WBow', 0, 0, 15, 7, 2);
    ctx.save(); ctx.translate(gx, gy); ctx.rotate(b.a + Math.PI / 2);   // belly toward the target
    ctx.drawImage(img, -Math.round(img.width / 2), -Math.round(img.height / 2));
    ctx.restore();
    if (p.ws.charge >= 0) {
      // nocked arrow pulled back with the draw
      const k = Math.min(1, p.ws.charge / (W.draw ?? 0.8)), back = 4 + k * 8, ux = Math.cos(b.a), uy = Math.sin(b.a);
      glow.globalAlpha = vis; glow.fillStyle = p.ws.full ? '#ffd84a' : '#e8dcff';
      for (let i = -back; i <= 14; i += 1) glow.fillRect(Math.round(gx + ux * i), Math.round(gy + uy * i), 1, 1);
      glow.globalAlpha = 1;
    }
    return true;
  }
  const h = HELD[W.type];
  if (!h || (W.type === 'thunder' && p === g.player && p.ws.spears <= 0)) return true;   // no spear left to hold
  const [sheet, w, hh, grip] = h, img = g.A.nt(sheet, 0, 0, w, hh, 2);
  ctx.save(); ctx.translate(gx, gy); ctx.rotate(b.a + Math.PI / 2);
  ctx.drawImage(img, -Math.round(img.width / 2), -img.height + grip * 2);
  ctx.restore();
  glow.globalAlpha = 0.5 * vis; glow.fillStyle = W.color;
  const len = (hh - grip) * 2;
  for (let i = 4; i <= len; i += 3) glow.fillRect(Math.round(gx + Math.cos(b.a) * i), Math.round(gy + Math.sin(b.a) * i), 1, 1);
  glow.globalAlpha = 1;
  return true;
}

// ---------------------------------------------------------------- world: spears, domains, abilities, vfx

interface Domain { x: number; y: number; r: number; t: number; dur: number; mine: boolean }
interface Spear { x: number; y: number; vx: number; vy: number; a: number; t: number; fuse: number; on: Enemy | null; ox: number; oy: number; dmg: number; done: boolean }
interface Vfx { k: string; x: number; y: number; a: number; r: number; arc: number; dir: number; t: number; dur: number; color: string; w: number; fr: string }

const frameCache = new Map<string, Sprite[]>();
const r1 = (v: number) => Math.round(v * 100) / 100;

/** One per Game (g.wx). */
export class WeaponWorld {
  domains: Domain[] = [];
  spears: Spear[] = [];
  vfxs: Vfx[] = [];
  /** RULER'S AUTHORITY pull in progress; on desktop it waits a beat to tell a tap (shove) from a hold (pull) */
  ruler: { slot: number; t: number; ax: number; ay: number; hold: boolean; tick: number; dur: number } | null = null;
  private beruT = 0; private beruEver = false;
  /** where enemies go when every hunter they could see has vanished: the last spot one was seen */
  readonly decoy: Player;
  private seen = new Map<Player, { x: number; y: number }>();

  constructor(private g: Game) { this.decoy = new Player(0, 0); this.decoy.state = 'dead'; }

  reset() { this.domains = []; this.spears = []; this.vfxs = []; this.ruler = null; this.beruT = 0; this.beruEver = false; this.seen.clear(); }

  /** A swing / thrust / blast drawn for a moment; shared with the other players so they see your attacks. */
  vfx(k: string, x: number, y: number, a: number, r: number, arc: number, dir: number, dur: number, color: string, w: number, fr = '', net = true) {
    this.vfxs.push({ k, x, y, a, r, arc, dir, t: 0, dur, color, w, fr });
    if (net) this.g.coop?.push({ t: 'wfx', v: [k, Math.round(x), Math.round(y), r1(a), r, r1(arc), dir, dur, color, w, fr] });
  }

  // ---- charge, kills, parries

  addCharge(n: number) {
    const p = this.g.player;
    if (!p.actives.includes('domain')) return;
    const was = p.domainCharge;
    p.domainCharge = Math.min(1, was + n);
    if (was < 1 && p.domainCharge >= 1) { this.g.fx.text(p.x, p.y - Player.HEAD - 18, 'DOMAIN READY', '#ff3355', 1, 1.2); this.g.sfx('glint', p.x); }
  }
  onPerfectParry() { this.addCharge(0.2); this.g.player.ws.bf = 0.6; }
  onKill(e: Enemy) {
    const p = this.g.player;
    if (!e.ally && Math.hypot(p.x - e.x, p.y - e.y) < 420) this.addCharge(e.boss ? 0.35 : e.elite ? 0.2 : 0.05);
  }

  /** MIKIRI COUNTER: rolling into a thrust steps on it. Returns false when the roll wasn't toward the attacker. */
  mikiri(src: { x: number; y: number }) {
    const g = this.g, p = g.player, dx = src.x - p.x, dy = src.y - p.y, l = Math.hypot(dx, dy) || 1;
    if ((dx * p.rollDx + dy * p.rollDy) / l < 0.25) return false;
    p.setState('normal'); p.vx = p.rollDx * 30; p.vy = p.rollDy * 30; p.iframes = 0.3;
    p.parryAngle = Math.atan2(dy, dx); p.parryFlash = 0.14; p.play('riposte'); p.face = Math.sign(dx) || p.face;
    const x = (src.x + p.x) / 2, y = (src.y + p.y) / 2 - 20;
    g.hitstop(0.14); g.slowmo(0.4, 0.3); g.shake(0.45); g.chroma(1.8); g.flash('#ffd84a', 0.25); g.zoomPunch(0.05);
    g.sfx('parry', x); g.sfx('riposte', x);
    g.fx.ring(x, y, 60, '#ffd84a', 0.35, 3);
    g.fx.burst(p.x, p.y, 14, { speed: 90, colors: ['#3a3155', '#5a4a7a'], size: 2, life: 0.4, z: 0, vz: 20, grav: 60 });
    g.fx.burst(x, y, 18, { speed: 220, colors: ['#ffd84a', '#ffffff'], glow: true, life: 0.3, grav: 0, drag: 6 });
    g.fx.text(p.x, p.y - Player.HEAD - 16, 'MIKIRI', '#ffd84a', 2, 0.9);
    g.coop?.push({ t: 'pfx', x: Math.round(x), y: Math.round(y), h: 1 });
    this.addCharge(0.2);
    return true;
  }

  // ---- domain

  /** Inside a domain (ground position). `mine`: only the local player's own. */
  inDomain(x: number, y: number, mine = false) {
    for (const d of this.domains) {
      if (mine && !d.mine) continue;
      if (Math.hypot(x - d.x, (y - d.y) / 0.7) < d.r * this.open(d)) return true;
    }
    return false;
  }
  private open(d: Domain) { return Math.min(1, d.t / 0.35) * Math.min(1, (d.dur - d.t) / 0.3); }

  /** Time scale for an enemy this frame (the host runs enemy AI; replicas just follow the snapshots). */
  timeFor(e: Enemy) {
    if (!this.domains.length || e.ally || e.remote) return 1;
    return this.inDomain(e.x, e.y) ? (e.boss ? 0.3 : 0.06) : 1;
  }

  openDomain(x: number, y: number, mine: boolean) {
    const g = this.g;
    this.domains.push({ x, y, r: DOMAIN_R, t: 0, dur: DOMAIN_TIME, mine });
    g.banner('DOMAIN EXPANSION', '#ff3355', 2.4);
    g.sfx('break', x); g.sfx('arise', x);
    g.audio.muffleFor(0.5, 700);
    g.flash('#ff1133', 0.35); g.chroma(2.4); g.shake(0.7); g.zoomPunch(0.08);
    if (mine) { g.hitstop(0.12); g.slowmo(0.6, 0.3); }
    for (let i = 0; i < 4; i++) g.later(i * 0.08, () => g.fx.ring(x, y, DOMAIN_R * (0.5 + i * 0.2), i % 2 ? '#ff3355' : '#b26bff', 0.5, 3));
    g.fx.burst(x, y, 40, { speed: 200, colors: ['#ff1133', '#b26bff', '#07060c'], glow: true, life: 0.8, grav: -40, drag: 3, size: 2 });
  }

  // ---- thunder spears

  throwSpear(x: number, y: number, a: number, dmg: number) {
    this.spears.push({ x, y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, a, t: 0, fuse: -1, on: null, ox: 0, oy: 0, dmg, done: false });
  }

  private updateSpears(dt: number) {
    const g = this.g;
    for (const s of this.spears) {
      s.t += dt;
      if (s.fuse < 0) {
        s.x += s.vx * dt; s.y += s.vy * dt;
        if (Math.random() < 0.7) g.fx.burst(s.x, s.y + 18, 1, { speed: 10, color: '#ff8a3a', glow: true, life: 0.25, grav: -20, z: 18, size: 1 });
        // sticks into the first foe it meets, else a wall, else drops at the end of its throw
        for (const e of g.enemies) {
          if (e.ally || e.dead || e.state === 'spawn') continue;
          const z = e instanceof Boss ? e.z : 0;
          if (Math.abs(s.x - e.x) < e.r + 4 && Math.abs(s.y - (e.y - e.height() * 0.45 - z)) < e.height() * 0.5 + 4) {
            s.on = e; s.ox = s.x - e.x; s.oy = s.y - e.y;
            g.damageEnemy(e, 6 * g.player.dmgMul, Math.cos(s.a), Math.sin(s.a), { knock: 30, how: 'thunder' });
            break;
          }
        }
        if (s.on || g.level.blocks(s.x, s.y + Player.CHEST) || s.t > 0.7) {
          s.fuse = FUSE;
          g.sfx('guard', s.x, 0.6); g.sfx('glint', s.x);
          g.fx.burst(s.x, s.y, 6, { speed: 90, colors: ['#ffd84a', '#ffffff'], glow: true, life: 0.2, grav: 0 });
        }
      } else {
        if (s.on) { if (s.on.dead) s.on = null; else { s.x = s.on.x + s.ox; s.y = s.on.y + s.oy; } }
        s.fuse -= dt;
        if (Math.random() < 0.5) g.fx.burst(s.x, s.y, 1, { speed: 60, color: '#ffd84a', glow: true, life: 0.12, grav: 0, size: 1 });
        if (s.fuse <= 0) {
          s.done = true;
          g.playerStrike({ k: 'circle', x: s.x, y: s.y, r: WEAPONS.thunder.range ?? 66 }, s.dmg, { knock: 220, titan: 3, pierce: true, how: 'thunder', cutBullets: true });
          this.boom(s.x, s.y, true);
        }
      }
    }
    let n = 0;
    for (const s of this.spears) if (!s.done) this.spears[n++] = s;
    this.spears.length = n;
  }

  /** The explosion; `net` shares it with the other players. */
  boom(x: number, y: number, net: boolean) {
    const g = this.g;
    this.vfx('anim', x, y, 0, 2, 0, 1, 0.5, '', 0, 'boom', false);
    g.fx.ring(x, y + 10, 72, '#ffd84a', 0.35, 3);
    g.fx.burst(x, y, 26, { speed: 220, colors: ['#ffd84a', '#ff8a3a', '#ffffff'], glow: true, life: 0.5, grav: 60, drag: 3 });
    g.fx.burst(x, y + 16, 14, { speed: 120, colors: ['#3a3155', '#5a4a7a', '#24061a'], size: 2, life: 0.7 });
    g.fx.splat(x, y + 18, '#120a14', 8, 12);
    g.fx.light(x, y, 160, '#ffb84a', 1);
    g.sfx('slam', x); g.shake(net ? 0.45 : 0.25); g.flash('#ffe0a0', net ? 0.15 : 0.06);
    if (net) { g.hitstop(0.06); g.coop?.push({ t: 'wfx', v: ['boom', Math.round(x), Math.round(y)] }); }
  }

  // ---- abilities

  useActive(key: string, slot: number, ax: number, ay: number, dragged: boolean) {
    const g = this.g, p = g.player;
    switch (key) {
      case 'domain':
        p.domainCharge = 0;
        this.openDomain(p.x, p.y, true);
        g.coop?.push({ t: 'dom', x: Math.round(p.x), y: Math.round(p.y) });
        break;
      case 'ruler':
        if (dragged) this.ruler = { slot, t: 0.3, ax, ay, hold: false, tick: 0, dur: 1.2 };                  // a drag pulls along it
        else if (g.input.device === 'mouse' && g.input.itemHeld[slot]) this.ruler = { slot, t: 0, ax, ay, hold: true, tick: 0, dur: 2.4 };
        else this.shove(ax, ay);
        break;
      case 'exchange': this.exchange(ax, ay); break;
      case 'stealth': {
        p.stealth = 4;
        g.fx.burst(p.x, p.y - 12, 26, { speed: 70, colors: ['#1a2a20', '#3a5a44', '#2a2340'], size: 2, life: 0.7, grav: -40, drag: 2 });
        g.fx.text(p.x, p.y - Player.HEAD - 14, 'STEALTH', '#6aff9a', 1, 0.8);
        g.sfx('spawn', p.x); g.sfx('roll', p.x, 0.6);
        break;
      }
    }
  }

  /** Telekinesis on the enemies (host); a client asks the host. */
  control(k: 'push' | 'pull', x: number, y: number, a: number, arc: number, r: number, s: number) {
    const g = this.g;
    if (g.authority) this.applyControl(k, x, y, a, arc, r, s);
    else g.coop!.push({ t: 'ctl', k, x: Math.round(x), y: Math.round(y), a: r1(a), arc, r, s });
  }

  private applyControl(k: 'push' | 'pull', x: number, y: number, a: number, arc: number, r: number, s: number) {
    const g = this.g;
    for (const e of g.enemies) {
      if (e.ally || e.dead || e.state === 'spawn') continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
      if (d > r + e.r || (d > e.r && angDiff(Math.atan2(dy, dx), a) > arc / 2)) continue;
      const ux = dx / d, uy = dy / d, w = 1 / Math.sqrt(e.heavy);
      if (k === 'push') {
        e.vx += ux * s * w; e.vy += uy * s * w;
        if (e instanceof Boss) e.addPosture(g, 12);
        else if (e.heavy < 10) e.setState('stunned');
      } else if (d > 28) { e.vx = -ux * s * w; e.vy = -uy * s * w; }
    }
  }

  /** RULER'S AUTHORITY tap: everything in the cone is thrown back and staggered; bullets fly home. */
  private shove(ax: number, ay: number) {
    const g = this.g, p = g.player, a = Math.atan2(ay, ax), cx = p.x, cy = p.y - Player.CHEST;
    this.control('push', p.x, p.y, a, 1.9, 130, 430);
    const cone: StrikeShape = { k: 'arc', x: cx, y: cy, a, r: 140, arc: 1.9 };
    for (const b of g.bullets) if (b.team === 'enemy' && b.life > 0 && strikeDist(cone, b.x, b.y, b.y, b.r) >= 0) g.reflect(b);
    this.vfx('cone', cx, cy, a, 130, 1.9, 1, 0.35, '#7ad8ff', 2);
    g.sfx('shootBig', p.x); g.sfx('cast', p.x);
    g.shake(0.3); g.kick(Math.cos(a) * 4, Math.sin(a) * 4); g.chroma(1); g.hitstop(0.04);
    g.fx.burst(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20, 18, { speed: 260, angle: a, spread: 1.6, colors: ['#7ad8ff', '#e8f4ff'], glow: true, life: 0.3, grav: 0, drag: 4 });
    p.vx -= Math.cos(a) * 60; p.vy -= Math.sin(a) * 60; p.punch(2);
  }

  /** SHADOW EXCHANGE: trade places with your farthest shadow; with none, blink a short way along the aim. */
  private exchange(ax: number, ay: number) {
    const g = this.g, p = g.player, me = g.authority ? null : g.coop!.net.selfId;
    let best: Enemy | null = null, bd = -1;
    for (const e of g.enemies) {
      if (!(e instanceof Shadow) || e.dead || e.state === 'spawn' || e.owner !== me) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > bd) { bd = d; best = e; }
    }
    const smoke = (x: number, y: number) => {
      g.fx.burst(x, y - 14, 22, { speed: 70, colors: ['#1a1424', '#3a2a4a', '#5a2ccf'], size: 2, life: 0.6, grav: -30, drag: 2 });
      g.fx.ring(x, y, 26, '#b26bff', 0.3, 2);
    };
    const ox = p.x, oy = p.y;
    smoke(ox, oy);
    if (best) {
      p.x = best.x; p.y = best.y;
      best.x = ox; best.y = oy; best.netX = ox; best.netY = oy;
      if (!g.authority) g.coop!.push({ t: 'xsw', id: best.id, x: Math.round(ox), y: Math.round(oy) });
      g.fx.text(p.x, p.y - Player.HEAD - 12, 'EXCHANGE', '#b26bff', 1, 0.7);
    } else {
      const l = Math.hypot(ax, ay) || 1;
      for (let d = 0; d < 96; d += 6) {
        const nx = p.x + (ax / l) * 6, ny = p.y + (ay / l) * 6;
        if (g.level.solidAt(nx, ny)) break;
        p.x = nx; p.y = ny;
      }
    }
    g.level.collide(p, p.r);
    p.iframes = Math.max(p.iframes, 0.25); p.vx = p.vy = 0; p.punch(-3);
    g.fx.after(g.A.heroes[p.slot].run.shadow[1], ox, oy, p.face < 0, 16, 56, 0.4);
    smoke(p.x, p.y);
    g.sfx('arise', p.x, 0.7); g.sfx('roll', p.x);
    g.shake(0.2); g.chroma(1);
  }

  /** BERU: a shadow that never expires and keeps to its owner's side. Host only. */
  raiseBeru(x: number, y: number, owner: string | null) {
    const g = this.g, s = new Shadow(g.A.anim(BERU_ANIM), x + 22, y, BERU_ANIM);
    s.id = ++g.nextId; s.owner = owner; s.life = Infinity; s.power = 22; s.leash = 230; s.r = 9;
    g.level.collide(s, s.r);
    g.enemies.push(s);
    g.fx.text(s.x, s.y - 40, 'BERU', '#b26bff', 2, 1);
    g.fx.burst(s.x, s.y, 26, { speed: 30, colors: ['#5a2ccf', '#b26bff', '#1a0a40'], glow: true, grav: -140, vz: 90, life: 1, size: 2, drag: 1 });
    g.sfx('arise', s.x);
  }
  private beruOf(owner: string | null) {
    for (const e of this.g.enemies) if (e instanceof Shadow && !e.dead && e.shadowAnim === BERU_ANIM && e.owner === owner) return e;
    return null;
  }

  /** Enemies that can't see anyone hunt the last place they saw a stealthed hunter (null: nobody is hiding). */
  lost(): Player | null {
    const g = this.g;
    if (this.hide(g.player)) return this.decoy;
    for (const p of g.remotes.values()) if (this.hide(p)) return this.decoy;
    return null;
  }
  private hide(p: Player) {
    if (p.state === 'dead' || p.stealth <= 0) return false;
    const s = this.seen.get(p);
    this.decoy.x = s ? s.x : p.x; this.decoy.y = s ? s.y : p.y;
    return true;
  }

  private mark(pl: Player) {
    if (pl.stealth > 0) return;
    const s = this.seen.get(pl);
    if (s) { s.x = pl.x; s.y = pl.y; } else this.seen.set(pl, { x: pl.x, y: pl.y });
  }

  update(dt: number) {
    const g = this.g, p = g.player;
    // last-seen spots for stealth (enemy AI reads them on whichever machine runs it)
    this.mark(p); for (const rp of g.remotes.values()) this.mark(rp);

    // domains: enemy bullets inside stall, then come apart
    if (this.domains.length) {
      let n = 0;
      for (const d of this.domains) if ((d.t += dt) < d.dur) this.domains[n++] = d;
      this.domains.length = n;
      for (const b of g.bullets) {
        if (b.team !== 'enemy' || b.life <= 0 || !this.inDomain(b.x, b.y + Player.CHEST)) continue;
        const k = Math.exp(-10 * dt); b.vx *= k; b.vy *= k; b.age = 0;
        if (Math.hypot(b.vx, b.vy) < 14) { b.life = 0; g.fx.burst(b.x, b.y, 4, { speed: 40, colors: ['#ff1133', '#07060c'], life: 0.3, grav: -40, glow: true }); }
      }
      if (Math.random() < 0.5) for (const d of this.domains) {
        const a = Math.random() * Math.PI * 2;
        g.fx.burst(d.x + Math.cos(a) * d.r, d.y + Math.sin(a) * d.r * 0.7, 1, { speed: 10, color: '#ff3355', glow: true, life: 0.8, grav: -50, vz: 30, size: 1 });
      }
    }
    if (this.spears.length) this.updateSpears(dt);

    // ruler's pull
    const r = this.ruler;
    if (r) {
      r.t += dt;
      if (r.hold && !g.input.itemHeld[r.slot]) { if (r.t < 0.2) this.shove(r.ax, r.ay); this.ruler = null; }
      else if (r.t > r.dur || p.state === 'dead') this.ruler = null;
      else if (!r.hold || r.t >= 0.2) {
        if (r.hold) { const dx = p.aimX - p.x, dy = p.aimY - (p.y - Player.CHEST), l = Math.hypot(dx, dy) || 1; r.ax = dx / l; r.ay = dy / l; }
        const a = Math.atan2(r.ay, r.ax);
        if ((r.tick -= dt) <= 0) {
          r.tick = 0.1;
          this.control('pull', p.x, p.y, a, 1.1, 200, 170);
          if (!p.boundless) p.mana = Math.max(0, p.mana - 2);
          g.sfx('cast', p.x, 0.3);
        }
        const d = 40 + Math.random() * 160, s = a + (Math.random() - 0.5) * 1.1;
        g.fx.burst(p.x + Math.cos(s) * d, p.y - Player.CHEST + Math.sin(s) * d, 1, { speed: 160, angle: s + Math.PI, spread: 0.2, color: '#7ad8ff', glow: true, life: 0.35, grav: 0, drag: 0, z: 0, vz: 0 });
      }
    }

    // BERU: rises when you get the relic, and again 20s after it falls
    if (p.relics.includes('beru') && p.state !== 'dead') {
      const me = g.authority ? null : g.coop!.net.selfId;
      if (this.beruOf(me)) { this.beruT = 0; this.beruEver = true; }
      else if ((this.beruT += dt) >= (this.beruEver ? 20 : 0.6)) {
        this.beruT = 0; this.beruEver = true;
        if (g.authority) this.raiseBeru(p.x, p.y, null);
        else g.coop!.push({ t: 'beru', x: Math.round(p.x), y: Math.round(p.y) });
      }
    }

    let n = 0;
    for (const v of this.vfxs) if ((v.t += dt) < v.dur) this.vfxs[n++] = v;
    this.vfxs.length = n;
  }

  /** A bullet slashed / nullified out of the air. */
  cutBullet(b: Bullet) {
    const g = this.g;
    b.life = 0;
    if (b.nid) g.coop?.push({ t: 'bk', id: b.nid });
    g.fx.burst(b.x, b.y, 5, { speed: 110, colors: ['#ffffff', b.color], glow: true, life: 0.18, grav: 0, size: 1 });
    g.sfx('reflect', b.x, 0.5);
  }

  /** Messages from coop.ts this module owns. */
  onNet(m: Wire, from: string) {
    const g = this.g;
    switch (m.t) {
      case 'ctl': if (g.authority) this.applyControl(m.k, m.x, m.y, m.a, m.arc, m.r, m.s); break;
      case 'dom': this.openDomain(m.x, m.y, false); break;
      case 'xsw': if (g.authority) { const e = g.enemies.find((x) => x.id === m.id); if (e) { e.x = m.x; e.y = m.y; } } break;
      case 'beru': if (g.authority && !this.beruOf(from)) this.raiseBeru(m.x, m.y, from); break;
      case 'wfx': {
        const v = m.v;
        if (v[0] === 'boom') this.boom(v[1], v[2], false);
        else this.vfx(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], false);
        break;
      }
    }
  }

  // ---- drawing

  private frames(name: string, color: string): Sprite[] {
    const key = name + color;
    let f = frameCache.get(key);
    if (!f) {
      const A = this.g.A, strip = (sheet: NinjaSheet, n: number, w: number, h: number) => Array.from({ length: n }, (_, i) => A.nt(sheet, i * w, 0, w, h, 1, true));
      const raw = name === 'boom' ? strip('FxExplosion', 9, 40, 40) : name === 'bolt' ? strip('FxThunder', 8, 20, 28)
        : name === 'cut' ? strip('FxCut', 4, 32, 32) : name === 'cutx' ? strip('FxCutX', 4, 32, 32) : strip('FxSlash', 4, 32, 32);
      f = color ? raw.map((s) => tinted(s, color, color === '#07060c' ? 1 : 0.6)) : raw;
      frameCache.set(key, f);
    }
    return f;
  }

  /** Domain floors, under everything. */
  drawGround(s: CanvasRenderingContext2D, cx: number, cy: number) {
    for (const d of this.domains) {
      const k = this.open(d), r = d.r * k, x = Math.round(d.x - cx), y = Math.round(d.y - cy);
      s.save();
      s.globalAlpha = 0.4 * k; s.fillStyle = '#1a0010';
      s.beginPath(); s.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2); s.fill();
      s.globalAlpha = 0.35 * k; s.strokeStyle = '#ff3355'; s.lineWidth = 1;
      s.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + d.t * 0.4;
        s.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.21); s.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7);
      }
      s.stroke();
      s.beginPath(); s.ellipse(x, y, r * 0.3, r * 0.21, 0, 0, Math.PI * 2); s.stroke();
      s.restore();
    }
  }

  /** Spears, swings, blasts, the bow's aim line, the domain's edge. */
  drawTop(s: CanvasRenderingContext2D, gl: CanvasRenderingContext2D, cx: number, cy: number) {
    const g = this.g, p = g.player;
    for (const d of this.domains) {
      const k = this.open(d), x = Math.round(d.x - cx), y = Math.round(d.y - cy), r = d.r * k;
      gl.globalAlpha = 0.9 * k; gl.strokeStyle = '#ff3355'; gl.lineWidth = 2;
      gl.beginPath(); gl.ellipse(x, y, r + Math.sin(d.t * 20) * 1.5, (r + Math.sin(d.t * 20) * 1.5) * 0.7, 0, 0, Math.PI * 2); gl.stroke();
      gl.globalAlpha = 0.5 * k; gl.strokeStyle = '#b26bff'; gl.lineWidth = 1;
      gl.beginPath(); gl.ellipse(x, y, r - 5, (r - 5) * 0.7, 0, 0, Math.PI * 2); gl.stroke();
    }
    gl.globalAlpha = 1;
    for (const sp of this.spears) {
      const img = g.A.nt('WLance2', 0, 0, 7, 21, 2), x = Math.round(sp.x - cx), y = Math.round(sp.y - cy);
      s.save(); s.translate(x, y); s.rotate(sp.a + Math.PI / 2); s.drawImage(img, -Math.round(img.width / 2), -12); s.restore();
      if (sp.fuse >= 0) {
        // the fuse: a red blink that quickens, and arcs of lightning on the shaft
        const blink = Math.floor(sp.fuse * (sp.fuse < 0.25 ? 30 : 14)) % 2 === 0;
        gl.fillStyle = blink ? '#ff3355' : '#ffd84a'; gl.fillRect(x - 1, y - 1, 3, 3);
        const bolt = this.frames('bolt', ''), fi = Math.floor(g.time * 20) % bolt.length;
        gl.globalAlpha = 0.8; gl.drawImage(bolt[fi], x - 10, y - 20); gl.globalAlpha = 1;
        g.fx.light(sp.x, sp.y, blink ? 50 : 30, '#ff3355', 0.8);
      } else g.fx.light(sp.x, sp.y, 30, '#ffb84a', 0.6);
    }
    for (const v of this.vfxs) this.drawVfx(v, s, gl, cx, cy);
    // greatbow: the aim line grows with the draw and turns gold at full
    if (p.ws.charge >= 0 && p.state !== 'dead') {
      const W = WEAPONS[p.weapon.key], k = Math.min(1, p.ws.charge / (W?.draw ?? 0.8)), a = Math.atan2(p.aimY - (p.y - Player.CHEST), p.aimX - p.x);
      const x0 = p.x - cx + Math.cos(a) * 16, y0 = p.y - Player.CHEST - cy + Math.sin(a) * 16, len = 30 + k * 150;
      gl.globalAlpha = 0.35 + 0.5 * k; gl.fillStyle = p.ws.full ? '#ffd84a' : '#e8dcff';
      for (let i = 0; i < len; i += 4) gl.fillRect(Math.round(x0 + Math.cos(a) * i), Math.round(y0 + Math.sin(a) * i), 1, 1);
      gl.globalAlpha = 1;
    }
    // ruler's pull: a cone of pale threads
    const r = this.ruler;
    if (r && (!r.hold || r.t >= 0.2)) {
      const a = Math.atan2(r.ay, r.ax), x = p.x - cx, y = p.y - Player.CHEST - cy;
      gl.globalAlpha = 0.35; gl.strokeStyle = '#7ad8ff'; gl.lineWidth = 1;
      gl.beginPath(); gl.moveTo(x, y); gl.lineTo(x + Math.cos(a - 0.55) * 200, y + Math.sin(a - 0.55) * 200);
      gl.moveTo(x, y); gl.lineTo(x + Math.cos(a + 0.55) * 200, y + Math.sin(a + 0.55) * 200); gl.stroke();
      gl.globalAlpha = 1;
    }
  }

  private drawVfx(v: Vfx, s: CanvasRenderingContext2D, gl: CanvasRenderingContext2D, cx: number, cy: number) {
    const k = v.t / v.dur, x = v.x - cx, y = v.y - cy;
    const sweep = Math.min(1, k / 0.35), e = 1 - (1 - sweep) * (1 - sweep) * (1 - sweep), fade = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
    switch (v.k) {
      case 'arc': {
        const a0 = v.a - v.dir * v.arc / 2, a1 = a0 + v.dir * v.arc * e, lo = Math.min(a0, a1), hi = Math.max(a0, a1);
        gl.globalAlpha = fade; gl.strokeStyle = v.color; gl.lineWidth = Math.max(1, v.w * fade);
        gl.beginPath(); gl.arc(x, y, v.r, lo, hi); gl.stroke();
        gl.globalAlpha = fade * 0.5; gl.lineWidth = 1;
        gl.beginPath(); gl.arc(x, y, Math.max(2, v.r - v.w - 2), lo, hi); gl.stroke();
        gl.globalAlpha = fade; gl.fillStyle = '#ffffff';
        gl.fillRect(Math.round(x + Math.cos(a1) * v.r) - 1, Math.round(y + Math.sin(a1) * v.r) - 1, 3, 3);
        break;
      }
      case 'chain': {
        // the links trail behind the tip; the tip's path stays as a faint arc
        const a0 = v.a - v.dir * v.arc / 2, a1 = a0 + v.dir * v.arc * e;
        gl.globalAlpha = fade * 0.4; gl.strokeStyle = v.color; gl.lineWidth = 1;
        gl.beginPath(); gl.arc(x, y, v.r, Math.min(a0, a1), Math.max(a0, a1)); gl.stroke();
        gl.globalAlpha = fade; gl.fillStyle = v.color;
        for (let i = 1; i <= 12; i++) {
          const f = i / 12, aa = a1 - v.dir * 0.5 * f * (1 - k), rr = v.r * f;
          gl.fillRect(Math.round(x + Math.cos(aa) * rr), Math.round(y + Math.sin(aa) * rr), 2, 2);
        }
        const ta = a1 - v.dir * 0.5 * (1 - k);
        gl.fillStyle = '#ffffff'; gl.fillRect(Math.round(x + Math.cos(ta) * v.r) - 1, Math.round(y + Math.sin(ta) * v.r) - 1, 3, 3);
        break;
      }
      case 'line': {
        const len = v.r * e, ux = Math.cos(v.a), uy = Math.sin(v.a);
        gl.globalAlpha = fade; gl.strokeStyle = v.color; gl.lineWidth = Math.max(1, v.w * fade);
        gl.beginPath(); gl.moveTo(x, y); gl.lineTo(x + ux * len, y + uy * len); gl.stroke();
        gl.strokeStyle = '#ffffff'; gl.lineWidth = 1;
        gl.beginPath(); gl.moveTo(x + ux * len * 0.3, y + uy * len * 0.3); gl.lineTo(x + ux * len, y + uy * len); gl.stroke();
        break;
      }
      case 'cone': {
        for (let i = 0; i < 3; i++) {
          const rr = v.r * Math.min(1, e * (1 - i * 0.18));
          gl.globalAlpha = (1 - k) * (1 - i * 0.25); gl.strokeStyle = v.color; gl.lineWidth = v.w;
          gl.beginPath(); gl.arc(x, y, Math.max(2, rr), v.a - v.arc / 2, v.a + v.arc / 2); gl.stroke();
        }
        break;
      }
      case 'anim': {
        const fr = this.frames(v.fr, v.color), img = fr[Math.min(fr.length - 1, Math.floor(k * fr.length))];
        const L = v.fr === 'boom' || v.color === '#07060c' ? s : gl;
        L.save(); L.translate(Math.round(x), Math.round(y)); L.rotate(v.a);
        if (v.dir < 0) L.scale(1, -1);
        L.scale(v.r, v.r);
        L.drawImage(img, -img.width / 2, -img.height / 2);
        L.restore();
        if (v.fr === 'boom' && k < 0.5) { gl.globalAlpha = 0.22 * (1 - k * 2); gl.drawImage(img, Math.round(x - img.width), Math.round(y - img.height), img.width * 2, img.height * 2); }
        break;
      }
    }
    gl.globalAlpha = 1;
  }

  /** The domain swallows the light outside it. */
  drawLight(li: CanvasRenderingContext2D, cx: number, cy: number, W: number, H: number) {
    if (!this.domains.length) return;
    let k = 0;
    for (const d of this.domains) k = Math.max(k, this.open(d));
    li.globalCompositeOperation = 'source-over';
    li.fillStyle = `rgba(6,0,12,${(0.82 * k).toFixed(3)})`;
    li.beginPath(); li.rect(0, 0, W + 2, H + 2);
    for (const d of this.domains) { const r = d.r * this.open(d); li.moveTo(d.x - cx + r, d.y - cy); li.ellipse(d.x - cx, d.y - cy, r, r * 0.7, 0, 0, Math.PI * 2); }
    li.fill('evenodd');
  }
}
