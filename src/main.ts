import { Audio } from './engine/audio';
import { Input } from './engine/input';
import { Renderer } from './engine/renderer';
import { loadAssets } from './game/assets';
import { Game } from './game/game';
import { restoreNight, saveNight } from './game/save';
import { Coop } from './net/coop';
import { makeRoomCode } from './net/net';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input(canvas, renderer);
const audio = new Audio();
audio.init();
if (new URLSearchParams(location.search).has('mute')) audio.muted = true;   // ?mute: silent dev / test sessions   // start decoding clips right away; the first gesture resumes playback
input.onFirstGesture(() => audio.unlock());

const game = new Game(renderer, input, audio, await loadAssets());
(window as unknown as { game: Game }).game = game;   // handy for debugging in the console

// a refresh picks the night back up where you were (see src/game/save.ts)
if (restoreNight(game)) game.banner('NIGHT RESUMED', '#b26bff', 2);
setInterval(() => saveNight(game), 2000);
addEventListener('pagehide', () => saveNight(game));

// sandbox panel
const panel = document.getElementById('panel')!;
const sync = () => {
  panel.querySelector('[data-act="god"]')!.classList.toggle('on', game.god);
  panel.querySelector('[data-act="hitbox"]')!.classList.toggle('on', game.showHitbox);
  panel.querySelector('[data-act="pause"]')!.classList.toggle('on', game.paused);
};
panel.addEventListener('pointerdown', (e) => e.stopPropagation());
panel.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).dataset.act;
  if (!act) return;
  audio.unlock();
  if (act === 'toggle') panel.classList.toggle('collapsed');
  else if (act === 'pause') game.setPaused(!game.paused);
  else if (act === 'coop') {
    if (!game.coop) joinRoom(makeRoomCode());
    void navigator.clipboard?.writeText(game.coop!.link).catch(() => {});
    game.banner(`ROOM ${game.coop!.roomId}  LINK COPIED`, '#b26bff', 2.4);
  }
  else game.sandbox(act);
  sync();
});
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') game.setPaused(!game.paused);
  setTimeout(sync);
});
// hidden tab or pane: pause and silence it, so a game you can't see never keeps playing
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { game.setPaused(true); saveNight(game); }
  audio.setHidden(document.hidden);
});
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || innerWidth < 700) panel.classList.add('collapsed');

// co-op: a #room=CODE link joins that room (serverless WebRTC, see src/net)
function joinRoom(code: string) {
  game.coop = new Coop(game, code);
  if (location.hash !== `#room=${code}`) history.replaceState(null, '', `#room=${code}`);
}
const m = location.hash.match(/room=([A-Z0-9]{3,12})/i);
if (m) { joinRoom(m[1].toUpperCase()); game.banner(`JOINING ${m[1].toUpperCase()}`, '#b26bff', 2); }

// Simulate exactly the time that passed since the last display frame, in substeps of at most 1/120 s.
// A fixed step with no interpolation judders on 144 Hz screens (alternating 0 and 1 steps per frame);
// this stays even at any refresh rate.
const MAX_STEP = 1 / 120;
let last = performance.now();
function frame(now: number) {
  // schedule first: an exception in one frame shouldn't stop the game for good
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6));
  for (let i = 0; i < n; i++) game.update(dt / n);
  game.renderDt = dt;
  game.render();
}
requestAnimationFrame(frame);
