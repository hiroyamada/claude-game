import './ui/style.css';
import { Game } from './Game';
import { assets } from './engine/Assets';
import { audio } from './engine/Audio';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas);
  (window as any).game = game;
  const progress = game_progress();
  try {
    await assets.loadAll((f) => progress(f * 0.5, 'Summoning heroes…'));
    await game.init(progress);
  } catch (e) {
    console.error(e);
    progress(0, 'Failed to load: ' + (e as Error).message);
    return;
  }
  // unlock audio on first gesture
  const unlock = () => { audio.unlock(); };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
  window.addEventListener('gamepadconnected', unlock);
  game.start();
  (window as any).__ready = true;
}

function game_progress() {
  const l = document.createElement('div');
  l.id = 'loading';
  l.innerHTML = `<h1>WILDREACH</h1><div class="bar"><i></i></div><p>Loading…</p>`;
  document.body.appendChild(l);
  return (f: number, msg?: string) => {
    (l.querySelector('i') as HTMLElement).style.width = `${f * 100}%`;
    if (msg) (l.querySelector('p') as HTMLElement).textContent = msg;
    if (f >= 1) setTimeout(() => l.remove(), 250);
  };
}

boot();
