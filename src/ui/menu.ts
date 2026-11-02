// The front end: main menu, join list, lobby, pause and end screens. Plain DOM over the game canvas, so text
// is crisp, inputs are real inputs and every button is a proper ≥44px touch target; labels are drawn with the
// game's own 3×5 pixel font into tiny canvases scaled up with nearest-neighbour, so it still looks like the game.
//
// One obvious next action per screen: PLAY SOLO, START, RESUME, PLAY AGAIN.

import type { Audio } from '../engine/audio';
import type { Assets } from '../game/assets';
import { HERO_LOOKS } from '../game/assets';
import { drawText, textWidth } from '../game/font';
import type { Game } from '../game/game';
import { hasSave, restoreNight } from '../game/save';
import { Coop } from '../net/coop';
import { Discovery, TEAM_WORDS, moveTeam, teamColor, type LobbyAd, type Mode } from '../net/lobby';
import { CODE_CHARS, MAX_PLAYERS, makeRoomCode, type Me } from '../net/net';

type Screen = 'main' | 'join' | 'lobby' | 'game' | 'pause' | 'leave' | 'end';

const ME_KEY = 'dylans-game.me.v1';
const NAME_OK = /[^A-Z0-9 -]/g;

/** Pixel-font label: the game's font at 1x in a canvas, scaled up crisp. */
export function pix(text: string, scale = 3, color = '#e8e4f0', outline: string | null = '#07060c') {
  const s = text.toUpperCase(), c = document.createElement('canvas');
  c.width = Math.max(1, textWidth(s) + 3); c.height = 8;
  drawText(c.getContext('2d')!, s, 1, 1, color, 1, outline);
  c.className = 'pix';
  c.style.width = `${c.width * scale}px`; c.style.height = `${c.height * scale}px`;
  return c;
}

/** Tiny DOM builder: h('div.cls', {on: ...}, ...children). */
function h(sel: string, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null | false)[]) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

/** A chunky button with a pixel label. */
function btn(label: string, cls: string, onClick: () => void, scale = 3, disabled = false) {
  const b = h(`button.b.${cls}`, { type: 'button', disabled, 'aria-label': label }, pix(label, scale, '#ffffff'));
  b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.hasAttribute('disabled')) onClick(); });
  return b;
}

/** Segmented choice (PUBLIC | PRIVATE, ...). */
function seg<T>(opts: [T, string][], cur: T, onPick: ((v: T) => void) | null) {
  return h('div.seg', {}, ...opts.map(([v, label]) => {
    const b = h(`button.s${v === cur ? '.on' : ''}`, { type: 'button', disabled: !onPick && v !== cur, 'aria-label': label, 'aria-pressed': String(v === cur) }, pix(label, 2, v === cur ? '#ffffff' : '#a89cc8'));
    if (onPick) b.addEventListener('click', () => { if (v !== cur) onPick(v); });
    return b;
  }));
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Menu {
  screen: Screen = 'main';
  me: Me;
  private root = document.getElementById('ui')!;
  private pauseBtn = document.getElementById('pauseBtn')!;
  private disco: Discovery | null = null;
  private discoWant: 'host' | 'listen' | null = null;
  private joinedAt = 0;            // when we entered the current room (for "connecting...")
  private creating = false;        // we made this room (no need to wait for a host)
  private endShown = false;        // the end screen for this match was shown (and maybe dismissed to spectate)
  private autoStart: Mode | null = null;
  private toastT = 0;

  constructor(private g: Game, private audio: Audio, private A: Assets) {
    this.me = Menu.loadMe();
    g.player.name = this.me.name; g.player.slot = this.me.look;
    this.pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.pauseBtn.addEventListener('click', () => this.openPause());
    this.root.addEventListener('pointerdown', () => this.audio.unlock());
    addEventListener('keydown', (e) => this.key(e));
    addEventListener('hashchange', () => this.fromHash());
    window.setInterval(() => this.tick(), 250);
    if (!this.fromHash()) this.show('main');
  }

  private static loadMe(): Me {
    try {
      const m = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null');
      if (m && typeof m.name === 'string') return { name: m.name.toUpperCase().replace(NAME_OK, '').slice(0, 10) || 'HUNTER', look: (m.look | 0) % HERO_LOOKS.length };
    } catch { /* ignore */ }
    return { name: `HUNTER${10 + Math.floor(Math.random() * 90)}`, look: 0 };
  }
  private saveMe() {
    try { localStorage.setItem(ME_KEY, JSON.stringify(this.me)); } catch { /* ignore */ }
    this.g.player.name = this.me.name; this.g.player.slot = this.me.look;
  }

  /** #room=CODE links drop straight into that lobby (&auto=pve|br: dev/coop.html starts as soon as two are in). */
  private fromHash() {
    const m = location.hash.match(/room=([A-Z0-9]{3,12})/i);
    if (!m) return false;
    const code = m[1].toUpperCase();
    if (this.g.coop?.roomId === code) return true;
    const a = location.hash.match(/auto=(pve|br)/);
    this.autoStart = a ? a[1] as Mode : null;
    this.openRoom(code, false);
    return true;
  }

  // ------------------------------------------------------------------ flow

  show(s: Screen) {
    this.screen = s;
    const inGame = s === 'game';
    this.pauseBtn.hidden = !inGame;
    this.g.overlay = !inGame;
    document.body.classList.toggle('menu-open', !inGame);
    this.root.replaceChildren();
    this.root.className = `scr-${s}`;
    if (inGame) return;
    const view = s === 'main' ? this.mainView() : s === 'join' ? this.joinView() : s === 'lobby' ? this.lobbyView()
      : s === 'pause' ? this.pauseView() : s === 'leave' ? this.leaveView() : this.endView();
    this.root.append(view);
    this.syncDiscovery();
  }

  private playSolo(resume = false) {
    this.leaveRoom();
    this.g.startMatch('pve', {}, null);
    if (resume && restoreNight(this.g)) this.g.banner('NIGHT RESUMED', '#b26bff', 2);
    this.endShown = false;
    this.show('game');
  }

  /** Join (or create) a room. Creating: we're its host straight away. */
  private async openRoom(code: string, creating: boolean) {
    this.leaveRoom();
    // leave the lobby list's room before joining the game's, so we don't stay linked to every other browser
    if (this.disco) { this.discoWant = null; this.disco.close(); this.disco = null; }
    this.creating = creating;
    this.root.replaceChildren(h('div.col', {}, h('div.empty', {}, pix(`JOINING ${code}...`, 3, '#8a7ab8'))));
    await Discovery.settled();
    if (this.g.coop) return;
    const coop = this.g.coop = new Coop(this.g, code, this.me);
    this.joinedAt = performance.now();
    coop.onLobby = () => this.onLobby();
    coop.onStart = (dr) => this.onStart(dr);
    if (location.hash.slice(1) !== `room=${code}` && !this.autoStart) history.replaceState(null, '', `#room=${code}`);
    this.show('lobby');
  }

  /** Drop the room (if any) and anything advertising it. The world resets to the menu backdrop. */
  private leaveRoom() {
    this.g.toMenu();
    this.autoStartedRound = -1;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  private goMain() { this.leaveRoom(); this.show('main'); }

  /** Lobby changed (settings, players, host). Also: late joins and the host calling everyone back. */
  private onLobby() {
    const c = this.g.coop;
    if (!c) return;
    if (c.net.full) { this.goMain(); this.toast('ROOM FULL'); return; }
    const l = c.lobby;
    if (this.screen === 'lobby') {
      if (l.started && c.synced && !c.isHost) {
        // a match is under way: PvE drops you in beside the host, battle royale lets you watch
        if (l.mode === 'pve') {
          this.g.startMatch('pve', l.teams, null);
          if (restoreNight(this.g, c.roomId)) this.g.banner('WELCOME BACK', '#b26bff', 2);
          else this.g.banner('JOINING THE NIGHT', '#b26bff', 2);
        } else { this.g.spectateOnly(l.teams); this.g.banner('MATCH IN PROGRESS', '#b26bff', 2.4); }
        this.endShown = false;
        this.show('game');
        return;
      }
      this.show('lobby');
    } else if (!l.started && !this.g.menu && this.screen !== 'main') {
      // the host called everyone back for another round
      this.g.toLobby();
      this.show('lobby');
    }
    this.syncDiscovery();
  }

  private onStart(dr: [number, number][]) {
    const c = this.g.coop!, l = c.lobby;
    const team = l.teams[c.selfId] ?? 0, d = dr[l.mode === 'br' ? team : 0] ?? dr[0];
    this.g.startMatch(l.mode, l.teams, { x: d[0], y: d[1] });
    this.g.banner(l.mode === 'br' ? 'LAST TEAM STANDING WINS' : 'NIGHT FALLS', l.mode === 'br' ? '#ffd84a' : '#b26bff', 2.6);
    this.endShown = false;
    this.show('game');
  }

  openPause() {
    if (this.screen !== 'game') return;
    // solo stops the world; with others it goes on behind the menu (only our inputs stop)
    this.g.setPaused(true);
    this.show('pause');
  }
  private resume() { this.g.setPaused(false); this.show('game'); }

  /** Esc: pause in a match, back out of submenus. */
  private key(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement && e.code !== 'Escape' && e.code !== 'Enter') return;
    if (e.code === 'Escape' || (e.code === 'KeyP' && this.screen === 'game')) {
      if (this.screen === 'game') this.openPause();
      else if (this.screen === 'pause') this.resume();
      else if (this.screen === 'leave') this.show('pause');
      else if (this.screen === 'join') this.show('main');
      else if (this.screen === 'lobby') this.goMain();
    } else if (e.code === 'Enter' && this.screen === 'main' && !(e.target instanceof HTMLInputElement)) this.playSolo();
  }

  /** Real-time housekeeping: end-of-match screen, lobby "connecting", toasts. */
  private autoStartedRound = -1;
  private doneAt = 0;
  private tick() {
    const g = this.g, c = g.coop;
    if ((this.screen === 'game' || this.screen === 'pause') && !this.endShown) {
      // let the last moment play out (the fall, the victory slow-mo) before the screen comes up
      const done = g.mode === 'br' ? !!g.match?.result : !!g.night.ended;
      if (!done) this.doneAt = 0;
      else if (!this.doneAt) this.doneAt = performance.now();
      else if (performance.now() - this.doneAt > 2200) { this.endShown = true; g.setPaused(false); this.show('end'); }
    }
    if (this.screen === 'end' && g.match?.over && this.root.dataset.over !== '1') this.show('end');
    if (this.screen === 'lobby' && c && (this.root.dataset.ready !== (this.lobbyReady() ? '1' : '0') || this.root.dataset.n !== String(c.count))) this.show('lobby');
    // dev/coop.html: the first player in hosts and starts the moment a second arrives
    if (this.autoStart && c?.isHost && this.screen === 'lobby' && c.count >= 2 && !c.lobby.started && this.autoStartedRound !== c.lobby.round) {
      this.autoStartedRound = c.lobby.round;
      if (c.lobby.mode !== this.autoStart) c.setLobby({ mode: this.autoStart, ts: 1 });
      c.start();
    }
    if (this.toastT && performance.now() > this.toastT) { document.getElementById('toast')?.remove(); this.toastT = 0; }
  }

  private lobbyReady() {
    const c = this.g.coop;
    return !!c && (this.creating || (c.synced && c.net.peers.size > 0) || performance.now() - this.joinedAt > 7000);
  }

  toast(text: string) {
    document.getElementById('toast')?.remove();
    document.body.append(h('div', { id: 'toast' }, pix(text, 3)));
    this.toastT = performance.now() + 2200;
  }

  /** Public lobbies: the host advertises while the room is public; the Join screen listens. */
  private syncDiscovery() {
    const c = this.g.coop;
    const want = this.screen === 'join' ? 'listen'
      : c && c.isHost && c.lobby.pub && c.count < MAX_PLAYERS && !(c.lobby.started && c.lobby.mode === 'br') ? 'host' : null;
    if (want !== this.discoWant) {
      this.discoWant = want;
      this.disco?.close(); this.disco = null;
      if (want) void Discovery.open(want === 'host').then((d) => {
        if (this.discoWant !== want) { d.close(); return; }
        this.disco = d;
        d.onChange = () => { if (this.screen === 'join') this.renderList(); };
        this.syncDiscovery();
      });
    }
    if (want === 'host' && this.disco && c) {
      const l = c.lobby;
      this.disco.advertise({ code: c.roomId, name: l.name, mode: l.mode, ts: l.ts, players: c.count, started: l.started });
    }
  }

  // ------------------------------------------------------------------ views

  private mainView() {
    const title = pix("DYLAN'S GAME", Math.max(4, Math.min(8, Math.floor((Math.min(innerWidth, 520) - 40) / 48))), '#e8dcff');
    // hero preview: idle animation in the chosen color
    const hero = h('canvas.hero') as HTMLCanvasElement;
    hero.width = 32; hero.height = 56;
    const drawHero = () => {
      const f = this.A.heroes[this.me.look].idle.normal[Math.floor(performance.now() / 140) % 4], x = hero.getContext('2d')!;
      x.clearRect(0, 0, 32, 56); x.drawImage(f, 0, 0);
      if (hero.isConnected) requestAnimationFrame(drawHero);
    };
    requestAnimationFrame(drawHero);
    const swatches = h('div.swatches', {}, ...HERO_LOOKS.map((L, i) => {
      const b = h(`button.sw${i === this.me.look ? '.on' : ''}`, { type: 'button', 'aria-label': L.name, style: `--c:${L.trim};--d:${L.coat}` });
      b.addEventListener('click', () => { this.me.look = i; this.saveMe(); this.show('main'); });
      return b;
    }));
    const name = h('input.name', { value: this.me.name, maxlength: 10, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Name' }) as HTMLInputElement;
    name.addEventListener('input', () => {
      const v = name.value.toUpperCase().replace(NAME_OK, '').slice(0, 10);
      if (v !== name.value) name.value = v;
      this.me.name = v.trim() || 'HUNTER'; this.saveMe();
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    const resume = hasSave();
    return h('div.col.main', {},
      h('div.title', {}, title),
      h('div.who', {},
        h('div.stage', {}, hero),
        h('div.whoctl', {}, pix('NAME', 2, '#8a7ab8'), name, swatches)),
      h('div.actions', {},
        resume ? btn('CONTINUE NIGHT', 'sec', () => this.playSolo(true)) : null,
        btn('PLAY SOLO', 'pri big', () => this.playSolo(), 4),
        h('div.row', {}, btn('HOST', 'sec', () => this.openRoom(makeRoomCode(), true)), btn('JOIN', 'sec', () => this.show('join')))),
    );
  }

  private joinView() {
    const code = h('input.code', { maxlength: 5, placeholder: 'CODE', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Room code' }) as HTMLInputElement;
    const go = btn('JOIN', 'pri', () => { if (code.value.length >= 4) this.openRoom(code.value, false); }, 3, true);
    code.addEventListener('input', () => {
      const ok = new RegExp(`[^${CODE_CHARS}]`, 'g');
      code.value = code.value.toUpperCase().replace(ok, '').slice(0, 5);
      go.toggleAttribute('disabled', code.value.length < 4);
    });
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter' && code.value.length >= 4) this.openRoom(code.value, false); });
    this.listOpenedAt = performance.now();
    return h('div.col.join', {},
      this.topBar('JOIN', () => this.show('main')),
      h('div.coderow', {}, code, go),
      h('div.label', {}, pix('PUBLIC GAMES', 2, '#8a7ab8')),
      h('div.list', { id: 'list' }, ...this.listItems()),
    );
  }
  private listOpenedAt = 0;

  private listItems(): Node[] {
    const ads = [...(this.disco?.ads.values() ?? [])].sort((a, b) => Number(a.started) - Number(b.started) || b.players - a.players);
    if (!ads.length) {
      const waited = performance.now() - this.listOpenedAt > 9000;
      return [h('div.empty', {},
        pix(waited ? 'NO PUBLIC GAMES YET' : 'LOOKING FOR GAMES...', 2, '#8a7ab8'),
        waited ? btn('HOST ONE', 'sec', () => this.openRoom(makeRoomCode(), true)) : null)];
    }
    return ads.map((a) => this.adRow(a));
  }

  private adRow(a: LobbyAd) {
    const full = a.players >= a.max, locked = full || (a.started && a.mode === 'br');
    const mode = a.mode === 'br' ? TEAM_WORDS[a.ts - 1] : 'PVE';
    const status = full ? 'FULL' : a.started ? (a.mode === 'br' ? 'IN GAME' : 'JOIN IN') : `${a.players}/${a.max}`;
    const row = h(`button.ad${locked ? '.locked' : ''}`, { type: 'button', disabled: locked, 'aria-label': `${a.name} ${mode} ${status}` },
      pix(a.name, 3), h('span.tag', {}, pix(mode, 2, a.mode === 'br' ? '#ffd84a' : '#9ad0ff')), h('span.n', {}, pix(status, 2, locked ? '#5a5070' : '#e8e4f0')));
    row.addEventListener('click', () => { if (!locked) this.openRoom(a.code, false); });
    return row;
  }

  private renderList() {
    const list = document.getElementById('list');
    if (list) list.replaceChildren(...this.listItems());
  }

  private topBar(title: string, back: () => void) {
    const b = h('button.back', { type: 'button', 'aria-label': 'Back' }, pix('BACK', 2));
    b.addEventListener('click', back);
    return h('div.top', {}, b, pix(title, 4, '#e8dcff'), h('span'));
  }

  private lobbyView() {
    const c = this.g.coop!, l = c.lobby, host = c.isHost;
    this.root.dataset.n = String(c.count);
    this.root.dataset.ready = this.lobbyReady() ? '1' : '0';
    if (!this.lobbyReady()) {
      return h('div.col.lobby', {}, this.topBar('LOBBY', () => this.goMain()),
        h('div.empty', {}, pix(`CONNECTING TO ${c.roomId}...`, 3, '#8a7ab8')));
    }
    const copy = btn('COPY INVITE LINK', 'sec', () => {
      void navigator.clipboard?.writeText(c.link).then(() => this.toast('LINK COPIED'), () => this.toast(c.link.replace(/^https?:\/\//, '')));
    }, 2);
    const set = host ? (p: Parameters<Coop['setLobby']>[0]) => c.setLobby(p) : null;
    const settings = h('div.settings', {},
      seg<boolean>([[false, 'PRIVATE'], [true, 'PUBLIC']], l.pub, set && ((v) => set({ pub: v }))),
      seg<Mode>([['pve', 'PVE'], ['br', 'BATTLE ROYALE']], l.mode, set && ((v) => set({ mode: v }))),
      l.mode === 'br' ? seg<number>([[1, 'SOLO'], [2, 'DUOS'], [3, 'TRIOS'], [4, 'SQUADS']], l.ts, set && ((v) => set({ ts: v }))) : null,
    );
    // players, grouped by team in battle royale; the host taps someone to move them
    const order = c.net.order, nTeams = Math.max(1, ...order.map((id) => (l.teams[id] ?? 0) + 1));
    const groups: Node[] = [];
    for (let t = 0; t < (l.mode === 'br' ? nTeams : 1); t++) {
      const ids = order.filter((id) => l.mode !== 'br' || (l.teams[id] ?? 0) === t);
      if (!ids.length) continue;
      const rows = ids.map((id) => {
        const look = HERO_LOOKS[c.net.lookOf(id)], you = id === c.selfId;
        const tags = [id === c.net.hostId ? 'HOST' : '', you ? 'YOU' : ''].filter(Boolean).join(' ');
        const row = h(`button.pl${host && l.mode === 'br' ? '' : '.static'}`, { type: 'button', style: `--c:${look.trim}`, 'aria-label': `${c.net.nameOf(id)} ${tags}`.trim() },
          h('span.dot'), pix(c.net.nameOf(id), 3), tags ? h('span.tag', {}, pix(tags, 2, '#8a7ab8')) : null);
        if (host && l.mode === 'br') row.addEventListener('click', () => { moveTeam(l, id, order); c.setLobby({}); });
        return row;
      });
      groups.push(h('div.team', { style: `--t:${l.mode === 'br' ? teamColor(t) : '#4a3a7a'}` },
        l.mode === 'br' ? pix(`TEAM ${t + 1}`, 2, teamColor(t)) : null, ...rows));
    }
    const teamsReady = l.mode !== 'br' || nTeams >= 2;
    const start = host
      ? btn(teamsReady ? 'START' : 'NEED 2 TEAMS', 'pri big', () => c.start(), 4, !teamsReady)
      : h('div.wait', {}, pix(l.started ? 'MATCH IN PROGRESS' : 'WAITING FOR HOST', 3, '#8a7ab8'));
    return h('div.col.lobby', {},
      this.topBar('LOBBY', () => this.goMain()),
      h('div.code', {}, pix('ROOM', 2, '#8a7ab8'), pix(c.roomId, 6, '#ffd84a'), copy),
      settings,
      h('div.label', {}, pix(`PLAYERS ${c.count}/${MAX_PLAYERS}`, 2, '#8a7ab8'), host && l.mode === 'br' ? pix('TAP TO SWAP TEAMS', 2, '#5a5070') : null),
      h('div.players', {}, ...groups),
      h('div.foot', {}, start),
    );
  }

  private pauseView() {
    const multi = !!this.g.coop;
    return h('div.col.pause', {},
      pix(multi ? 'MENU' : 'PAUSED', 6, '#e8dcff'),
      multi ? pix('THE MATCH GOES ON', 2, '#8a7ab8') : null,
      h('div.actions', {},
        btn('RESUME', 'pri big', () => this.resume(), 4),
        btn('LEAVE TO MAIN MENU', 'sec', () => this.show('leave'))),
      h('div.help', {}, ...(this.g.input.device === 'touch'
        ? ['DRAG LEFT: MOVE', 'LET GO: PARRY', 'TAP RIGHT: SHOOT', 'FLICK: ROLL', 'TAP MAP: FULL MAP']
        : ['WASD: MOVE', 'CLICK: SHOOT', 'RIGHT CLICK: PARRY', 'SPACE: ROLL', 'Q E: ITEMS', 'M: MAP']).map((t) => pix(t, 2, '#8a7ab8'))),
    );
  }

  private leaveView() {
    const multi = !!this.g.coop;
    return h('div.col.pause', {},
      pix(multi ? 'LEAVE THE MATCH?' : 'QUIT THIS NIGHT?', 4, '#ff6680'),
      multi ? null : pix('YOUR PROGRESS IS LOST', 2, '#8a7ab8'),
      h('div.actions', {},
        btn('STAY', 'pri big', () => this.show('pause'), 4),
        btn('LEAVE', 'danger', () => this.goMain())),
    );
  }

  private endView() {
    const g = this.g, c = g.coop, m = g.match, br = g.mode === 'br' && m;
    const won = br ? !!m.result?.won : g.night.ended === 'won';
    const over = !br || m.over;
    this.root.dataset.over = over ? '1' : '0';
    const sub = br ? `#${m.result?.place ?? '?'} OF ${m.nTeams} ${m.nTeams === m.teams.size ? 'PLAYERS' : 'TEAMS'}` : won ? 'GATE CLEARED' : 'THE NIGHT CLAIMS YOU';
    const t = g.night.t;
    const stats = h('div.stats', {},
      ...([['KILLS', String(br ? g.pvpKills : g.kills)], ...(br ? [['MONSTERS', String(g.kills)]] : []), ['TIME', fmt(t)], ['LEVEL', String(g.player.level)]] as [string, string][])
        .map(([k, v]) => h('div.stat', {}, pix(v, 4, '#ffffff'), pix(k, 2, '#8a7ab8'))));
    const again = () => {
      if (!c) { this.playSolo(); return; }
      if (c.isHost) c.backToLobby();
      else { g.toLobby(); this.show('lobby'); }
    };
    const actions: (Node | null)[] = [];
    if (!over) {
      actions.push(btn('SPECTATE', 'pri big', () => this.show('game'), 4));
    } else if (c && !c.isHost) {
      actions.push(btn('BACK TO LOBBY', 'pri big', again, 4));
    } else actions.push(btn('PLAY AGAIN', 'pri big', again, 4));
    actions.push(btn('MAIN MENU', 'sec', () => this.goMain()));
    return h(`div.col.end.${won ? 'won' : 'lost'}`, {},
      pix(won ? 'VICTORY' : 'DEFEAT', Math.max(6, Math.min(12, Math.floor((Math.min(innerWidth, 600) - 40) / 30))), won ? '#ffd84a' : '#ff3355'),
      pix(sub, 3, won ? '#fff2b0' : '#e8dcff'),
      stats,
      !over ? pix('THE MATCH GOES ON', 2, '#8a7ab8') : null,
      h('div.actions', {}, ...actions),
    );
  }
}
