import type { Game } from './game';
import type { Item } from './items';
import { Player } from './player';

// The night in progress survives a refresh: your hunter (position, level, gear, items) and, when this machine runs it, the night
// itself (clock, cleared camps and bosses, chests, loot on the ground). Enemies aren't saved: a camp you were
// fighting wakes again when you come back. A co-op client saves only its hunter; the host owns the night.

const KEY = 'dylans-game.night.v1';
const MAX_AGE = 2 * 60 * 60 * 1000;

interface PlayerSave {
  x: number; y: number; hp: number; maxHp: number; mana: number; level: number; xp: number;
  weapon: { key: string; rarity: number }; passives: { key: string; rarity: number }[];
  actives: (string | null)[]; relics: string[];
}
export interface NightSave {
  t: number; cleared: number[]; activeMb: number[]; bossSpawned: boolean; revives: number; said: string[];
  chests: { id: number; x: number; y: number }[];
  drops: { x: number; y: number; item: Item }[];
  bosses?: [number, string][]; finalBoss?: string; seed?: number;
}
interface Save { at: number; player: PlayerSave; night: NightSave | null; room?: string }

export function saveNight(g: Game) {
  const p = g.player, n = g.night;
  // only a PvE night in progress is worth resuming (a battle royale can't be rejoined mid-fight)
  if (g.menu || g.mode !== 'pve') return;
  try {
    if (n.ended || p.state === 'dead') { localStorage.removeItem(KEY); return; }
    const s: Save = {
      at: Date.now(),
      player: {
        x: Math.round(p.x), y: Math.round(p.y), hp: Math.max(1, Math.round(p.hp)), maxHp: p.maxHp, mana: Math.round(p.mana),
        level: p.level, xp: p.xp, weapon: p.weapon, passives: p.passives, actives: p.actives, relics: p.relics,
      },
      night: g.authority ? n.save() : null,   // a co-op client doesn't own the night
      room: g.coop?.roomId,
    };
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* private mode / storage full: the night just won't survive a refresh */ }
}

export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

function read(): Save | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Save;
    if (!s.player || Date.now() - s.at > MAX_AGE) { localStorage.removeItem(KEY); return null; }
    return s;
  } catch { return null; }
}

/** Is there a night to resume: solo (no room), or in this room? */
export function hasSave(room?: string) { const s = read(); return !!s && (s.room ?? '') === (room ?? '') && (!!s.night || !!room); }

/** Put back a saved night, if there's a recent one from the same room (or solo). */
export function restoreNight(g: Game, room?: string): boolean {
  const s = read();
  if (!s || (s.room ?? '') !== (room ?? '')) return false;
  const sp = s.player, slot = g.player.slot, name = g.player.name, team = g.player.team;
  if (s.night) g.night.load(s.night);
  const p = new Player(sp.x, sp.y);
  Object.assign(p, {
    slot, name, team, hp: sp.hp, maxHp: sp.maxHp, mana: sp.mana, level: sp.level, xp: sp.xp,
    weapon: sp.weapon, passives: sp.passives, actives: sp.actives, relics: sp.relics,
  });
  p.invuln = 2;   // a moment to get your bearings
  g.level.collide(p, p.r);
  g.player = p;
  g.cam.x = p.x - g.r.w / 2; g.cam.y = p.y - g.r.h / 2;
  return true;
}
