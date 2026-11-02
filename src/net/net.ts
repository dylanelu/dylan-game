// Serverless co-op over WebRTC. Trystero finds peers through public Nostr relays (no server of our own),
// then all game traffic goes peer-to-peer. Works from a static GitHub Pages site.
//
// Roles: the earliest joiner is the host and runs enemies, the boss and enemy bullets. Everyone simulates
// their own character locally (so controls and parry timing never wait on the network) and broadcasts it.

import { joinRoom, selfId } from 'trystero';

export const MAX_PLAYERS = 6;
const APP_ID = 'shadow-gate.dylanelu.v1';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Wire = any;   // plain JSON objects; shapes are documented where they're built in game.ts

interface Peer { id: string; joinedAt: number }

export class Net {
  readonly selfId = selfId;
  readonly joinedAt = Date.now() + Math.random();   // tiebreak for simultaneous joins
  readonly peers = new Map<string, Peer>();
  private room: ReturnType<typeof joinRoom>;
  private aHello; private aPlayer; private aSnap; private aEvt;

  onPeersChanged: () => void = () => {};
  onPlayer: (state: Wire, from: string) => void = () => {};
  onSnap: (snap: Wire, from: string) => void = () => {};
  onEvt: (evt: Wire, from: string) => void = () => {};
  onLeave: (id: string) => void = () => {};

  constructor(readonly roomId: string) {
    this.room = joinRoom({ appId: APP_ID }, roomId);
    this.aHello = this.room.makeAction<Wire>('hello');
    this.aPlayer = this.room.makeAction<Wire>('pl');
    this.aSnap = this.room.makeAction<Wire>('snap');
    this.aEvt = this.room.makeAction<Wire>('evt');
    this.room.onPeerJoin = (id) => { void this.aHello.send({ joinedAt: this.joinedAt }, { target: id }); };
    this.room.onPeerLeave = (id) => { this.peers.delete(id); this.onLeave(id); this.onPeersChanged(); };
    this.aHello.onMessage = (d, { peerId }) => { this.peers.set(peerId, { id: peerId, joinedAt: d.joinedAt }); this.onPeersChanged(); };
    this.aPlayer.onMessage = (d, { peerId }) => this.onPlayer(d, peerId);
    this.aSnap.onMessage = (d, { peerId }) => this.onSnap(d, peerId);
    this.aEvt.onMessage = (d, { peerId }) => this.onEvt(d, peerId);
  }

  /** Everyone in join order, self included. The same list on every machine once hellos are exchanged. */
  get order(): string[] {
    const all = [...this.peers.values(), { id: this.selfId, joinedAt: this.joinedAt }];
    all.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    return all.map((p) => p.id);
  }
  get hostId() { return this.order[0]; }
  get isHost() { return this.hostId === this.selfId; }
  /** Color / look slot for a peer: their position in join order. */
  slotOf(id: string) { return Math.min(MAX_PLAYERS - 1, Math.max(0, this.order.indexOf(id))); }
  get full() { return this.order.indexOf(this.selfId) >= MAX_PLAYERS; }

  sendPlayer(s: Wire) { void this.aPlayer.send(s); }
  sendSnap(s: Wire) { void this.aSnap.send(s); }
  sendEvt(e: Wire, target?: string) { void this.aEvt.send(e, target ? { target } : undefined); }
  leave() { void this.room.leave(); }
}

/** Short, readable room codes (no 0/O/1/I confusion). */
export function makeRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}
