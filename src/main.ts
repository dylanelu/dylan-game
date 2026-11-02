import { Audio } from './engine/audio';
import { Input } from './engine/input';
import { Renderer } from './engine/renderer';
import { loadAssets } from './game/assets';
import { Game } from './game/game';
import { saveNight } from './game/save';
import { Menu } from './ui/menu';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input(canvas, renderer);
const audio = new Audio();
audio.init();   // start decoding clips right away; the first gesture resumes playback
input.onFirstGesture(() => audio.unlock());

const assets = await loadAssets();
const game = new Game(renderer, input, audio, assets);
// you land on the main menu; it starts solo nights, hosts and joins rooms (see src/ui/menu.ts)
const menu = new Menu(game, audio, assets);
(window as unknown as { game: Game; menu: Menu }).game = game;   // handy for debugging in the console
(window as unknown as { menu: Menu }).menu = menu;

// a refresh can pick a PvE night back up where you were (see src/game/save.ts)
setInterval(() => saveNight(game), 2000);
addEventListener('pagehide', () => saveNight(game));

// hidden tab or pane: open the pause menu (solo stops; with others the match goes on) and silence it
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { menu.openPause(); saveNight(game); }
  audio.setHidden(document.hidden);
});

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
