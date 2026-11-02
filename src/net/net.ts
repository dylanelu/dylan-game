// Serverless multiplayer over WebRTC. Trystero finds peers through public Nostr relays (no server of our own),
// then all game traffic goes peer-to-peer. Works from a static GitHub Pages site.
//
// Roles: the earliest joiner is the host and runs enemies, the boss and enemy bullets. Everyone simulates
// their own character locally (so controls and parry timing never wait on the network) and broadcasts it.

import { joinRoom, selfId } from 'trystero';

export const MAX_PLAYERS = 12;
export const APP_ID = 'dylans-game.dylanelu.v1';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Wire = any;   // plain JSON objects; shapes are documented where they're built in game.ts

/** Who you are to everyone else: picked on the main menu, sent once in the hello. */
export interface Me { name: string; look: number }
export interface Peer extends Me { id: string; joinedAt: number }

export class Net {
  readonly selfId = selfId;
  readonly joinedAt = Date.now() + Math.random();   // tiebreak for simultaneous joins
  readonly peers = new Map<string, Peer>();
  private room: ReturnType<typeof joinRoom>;
  private aHello; private aPlayer; private aSnap; private aEvt;
  private left = false;

  onPeersChanged: () => void = () => {};
  onPlayer: (state: Wire, from: string) => void = () => {};
  onSnap: (snap: Wire, from: string) => void = () => {};
  onEvt: (evt: Wire, from: string) => void = () => {};
  onLeave: (id: string) => void = () => {};

  constructor(readonly roomId: string, readonly me: Me) {
    this.room = joinRoom({ appId: APP_ID }, roomId);
    this.aHello = this.room.makeAction<Wire>('hello');
    this.aPlayer = this.room.makeAction<Wire>('pl');
    this.aSnap = this.room.makeAction<Wire>('snap');
    this.aEvt = this.room.makeAction<Wire>('evt');
    this.room.onPeerJoin = (id) => { void this.aHello.send({ joinedAt: this.joinedAt, name: me.name, look: me.look }, { target: id }); };
    this.room.onPeerLeave = (id) => { if (!this.peers.delete(id)) return; this.onLeave(id); this.onPeersChanged(); };
    this.aHello.onMessage = (d, { peerId }) => {
      this.peers.set(peerId, { id: peerId, joinedAt: d.joinedAt, name: String(d.name ?? '').slice(0, 12), look: (d.look | 0) % 6 });
      this.onPeersChanged();
    };
    this.aPlayer.onMessage = (d, { peerId }) => { if (this.peers.has(peerId)) this.onPlayer(d, peerId); };
    this.aSnap.onMessage = (d, { peerId }) => this.onSnap(d, peerId);
    this.aEvt.onMessage = (d, { peerId }) => { if (this.peers.has(peerId)) this.onEvt(d, peerId); };
  }

  /** Everyone in join order, self included. The same list on every machine once hellos are exchanged. */
  get order(): string[] {
    const all = [...this.peers.values(), { id: this.selfId, joinedAt: this.joinedAt }];
    all.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    return all.map((p) => p.id);
  }
  get hostId() { return this.order[0]; }
  get isHost() { return this.hostId === this.selfId; }
  /** Display name for a peer id (self included). */
  nameOf(id: string) { return id === this.selfId ? this.me.name : this.peers.get(id)?.name ?? '?'; }
  lookOf(id: string) { return id === this.selfId ? this.me.look : this.peers.get(id)?.look ?? 0; }
  /** Past the cap: the 13th joiner (in join order) sits out. */
  get full() { return this.order.indexOf(this.selfId) >= MAX_PLAYERS; }

  sendPlayer(s: Wire) { if (!this.left) void this.aPlayer.send(s); }
  sendSnap(s: Wire) { if (!this.left) void this.aSnap.send(s); }
  sendEvt(e: Wire, target?: string) { if (!this.left) void this.aEvt.send(e, target ? { target } : undefined); }
  /** Leave for good: stop reacting to anything still in flight, then close every connection. */
  leave() {
    if (this.left) return;
    this.left = true;
    this.onPeersChanged = this.onLeave = () => {};
    this.onPlayer = this.onSnap = this.onEvt = () => {};
    this.peers.clear();
    void this.room.leave();
  }
}

/** Short, readable room codes (no 0/O/1/I confusion). */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode() {
  return Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}
