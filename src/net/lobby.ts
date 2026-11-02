// Lobbies: the host-owned settings every player in a room shares, and serverless discovery of public ones.
//
// Discovery is one well-known Trystero room, 'lobbies' (lowercase, so no room code can collide), under the game's
// own appId: Trystero picks its relays once per page from the first room's appId, so a second appId would put a
// host (already in its game room) and a browser on different relays, and they'd never meet. Hosts of public
// lobbies shout a tiny ad every 2 s (and straight away to anyone new); the Join screen listens. Entries not heard
// from for 10 s drop off the list.
//
// Browsers join as regular peers, so they also link to each other while the Join screen is open. Trystero's
// passive mode would avoid that, but a passive peer only wakes on a host's announce, which Nostr spaces up to a
// minute apart: far too slow for a lobby list.

import { joinRoom } from 'trystero';
import { APP_ID, MAX_PLAYERS, type Wire } from './net';

export type Mode = 'pve' | 'br';

/** The room's settings. The host owns it and broadcasts it whole on every change (it's tiny). */
export interface LobbyState {
  name: string;          // shown in the public list: the host's name
  pub: boolean;
  mode: Mode;
  ts: number;            // battle royale team size, 1-4
  teams: Record<string, number>;   // peer id -> team index
  started: boolean;
  round: number;         // bumps on every START, so a stale start can't restart a newer match
}

export const defaultLobby = (name: string): LobbyState => ({ name, pub: false, mode: 'pve', ts: 1, teams: {}, started: false, round: 0 });

/** Team colors, readable on the dark map and distinct from the purple storm. */
export const TEAM_COLORS = ['#3ab0ff', '#ff4a5a', '#4aff8a', '#ffc83a', '#ff6ad8', '#ff9a3a', '#7af0e8', '#e8e4f0', '#a8d84a', '#c08aff', '#ff8a8a', '#8a9ab8'];
export const teamColor = (t: number) => TEAM_COLORS[((t % TEAM_COLORS.length) + TEAM_COLORS.length) % TEAM_COLORS.length];
export const TEAM_WORDS = ['SOLO', 'DUOS', 'TRIOS', 'SQUADS'];

/** Host: give everyone in `order` a team. Keeps existing picks that still fit, fills the smallest team first,
 *  and opens a new one only when every team is full. PvE is one big team. */
export function balance(l: LobbyState, order: string[]) {
  const out: Record<string, number> = {};
  if (l.mode === 'pve') { for (const id of order) out[id] = 0; l.teams = out; return; }
  const size = new Map<number, number>();
  for (const id of order) {
    const t = l.teams[id];
    if (t !== undefined && (size.get(t) ?? 0) < l.ts) { out[id] = t; size.set(t, (size.get(t) ?? 0) + 1); }
  }
  for (const id of order) {
    if (out[id] !== undefined) continue;
    let best = -1;
    for (const [t, n] of size) if (n < l.ts && (best < 0 || n < size.get(best)!)) best = t;
    if (best < 0) { best = 0; while (size.has(best)) best++; }
    out[id] = best; size.set(best, (size.get(best) ?? 0) + 1);
  }
  // renumber so teams read 1, 2, 3... with no gaps
  const ids = [...new Set(order.map((id) => out[id]))].sort((a, b) => a - b);
  for (const id of order) out[id] = ids.indexOf(out[id]);
  l.teams = out;
}

/** Host: move a player to the next team with room (or a fresh one). */
export function moveTeam(l: LobbyState, id: string, order: string[]) {
  const n = Math.max(1, ...Object.values(l.teams).map((t) => t + 1));
  const count = (t: number) => order.filter((o) => o !== id && l.teams[o] === t).length;
  const cur = l.teams[id] ?? 0;
  for (let k = 1; k <= n + 1; k++) {
    const t = (cur + k) % (n + 1);
    if (t !== cur && count(t) < l.ts) { l.teams[id] = t; break; }
  }
  balance(l, order);
}

export interface LobbyAd { code: string; name: string; mode: Mode; ts: number; players: number; max: number; started: boolean; seen: number }

const AD_EVERY = 2000, AD_TTL = 10000;
/** the last discovery room's leave(): rejoining the same room before it finishes would hand back the old one */
let closing: Promise<unknown> = Promise.resolve();

export class Discovery {
  private room: ReturnType<typeof joinRoom>;
  private aAd;
  private timer: number;
  private mine: LobbyAd | null = null;
  readonly ads = new Map<string, LobbyAd>();
  onChange: () => void = () => {};

  /** `hosting`: we advertise. Otherwise we only listen. */
  static async open(hosting: boolean) { await closing; return new Discovery(hosting); }
  /** Resolves once the last discovery room has fully left (see openRoom in menu.ts). */
  static settled() { return closing; }

  private constructor(readonly hosting: boolean) {
    this.room = joinRoom({ appId: APP_ID }, 'lobbies');
    this.aAd = this.room.makeAction<Wire>('ad');
    this.aAd.onMessage = (d) => this.heard(d);
    this.room.onPeerJoin = (id) => { if (this.mine) void this.aAd.send(this.wire(this.mine), { target: id }); };
    this.timer = window.setInterval(() => this.tick(), AD_EVERY);
  }

  /** Host: what to tell browsers about our lobby (null: stop listing it). */
  advertise(ad: Omit<LobbyAd, 'seen' | 'max'> | null) {
    const was = this.mine;
    this.mine = ad ? { ...ad, max: MAX_PLAYERS, seen: 0 } : null;
    if (!ad && was) void this.aAd.send({ c: was.code, g: 1 });
    else if (ad && (!was || JSON.stringify(this.wire(was)) !== JSON.stringify(this.wire(this.mine!)))) void this.aAd.send(this.wire(this.mine!));
  }

  private wire(a: LobbyAd) { return { c: a.code, n: a.name, m: a.mode, ts: a.ts, p: a.players, x: a.max, s: a.started ? 1 : 0 }; }

  private heard(d: Wire) {
    if (typeof d?.c !== 'string' || !/^[A-Z0-9]{3,12}$/.test(d.c)) return;
    if (d.g) { if (this.ads.delete(d.c)) this.onChange(); return; }
    this.ads.set(d.c, {
      code: d.c, name: String(d.n ?? '').slice(0, 12), mode: d.m === 'br' ? 'br' : 'pve', ts: Math.max(1, Math.min(4, d.ts | 0)),
      players: d.p | 0, max: d.x | 0 || MAX_PLAYERS, started: !!d.s, seen: Date.now(),
    });
    this.onChange();
  }

  private tick() {
    if (this.mine) void this.aAd.send(this.wire(this.mine));
    const now = Date.now();
    let changed = false;
    for (const [k, a] of this.ads) if (now - a.seen > AD_TTL) { this.ads.delete(k); changed = true; }
    if (changed) this.onChange();
  }

  close() {
    clearInterval(this.timer);
    this.onChange = () => {};
    this.aAd.onMessage = null;
    // let the goodbye go out before the connections close (rejoining before leave() would hand back this room)
    const bye = this.mine ? this.aAd.send({ c: this.mine.code, g: 1 }).catch(() => {}) : Promise.resolve();
    this.mine = null;
    closing = bye.then(() => this.room.leave()).catch(() => {});
  }
}
