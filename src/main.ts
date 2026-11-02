import { Audio } from './engine/audio';
import { Input } from './engine/input';
import { Renderer } from './engine/renderer';
import { loadAssets } from './game/assets';
import { Game } from './game/game';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input(canvas, renderer);
const audio = new Audio();
input.onFirstGesture(() => audio.unlock());

const game = new Game(renderer, input, audio, await loadAssets());
(window as unknown as { game: Game }).game = game;   // handy for debugging in the console

// sandbox panel
const panel = document.getElementById('panel')!;
const sync = () => {
  panel.querySelector('[data-act="god"]')!.classList.toggle('on', game.god);
  panel.querySelector('[data-act="hitbox"]')!.classList.toggle('on', game.showHitbox);
};
panel.addEventListener('pointerdown', (e) => e.stopPropagation());
panel.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).dataset.act;
  if (!act) return;
  audio.unlock();
  if (act === 'toggle') panel.classList.toggle('collapsed');
  else game.sandbox(act);
  sync();
});
addEventListener('keydown', () => setTimeout(sync));
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || innerWidth < 700) panel.classList.add('collapsed');

// fixed 120 Hz simulation, render every animation frame
const STEP = 1 / 120;
let last = performance.now(), acc = 0;
function frame(now: number) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  let n = 0;
  while (acc >= STEP && n++ < 12) { game.update(STEP); acc -= STEP; }
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
