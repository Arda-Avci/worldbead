// Manual test page for src/audio. Not used by the game itself.
import { AudioEngine } from './AudioEngine';
import type { PlanetId, SfxName } from './types';

const engine = new AudioEngine();
let unlocked = false;

const SFX_NAMES: SfxName[] = [
  'fire',
  'pop',
  'bigPop',
  'miss',
  'swap',
  'powerMeteor',
  'powerPrism',
  'powerFlare',
  'powerComet',
  'unlock',
  'uiTap',
  'starGain',
  'win',
  'lose',
  'warp',
];

const PLANETS: PlanetId[] = ['earth', 'moon', 'venus', 'mars'];

function ensureUnlocked(): void {
  engine.unlock();
  unlocked = true;
  const status = document.getElementById('status');
  if (status) status.textContent = 'Audio unlocked.';
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (!unlocked) ensureUnlocked();
    onClick();
  });
  return btn;
}

function build(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const sfxSection = document.createElement('section');
  sfxSection.innerHTML = '<h2>SFX</h2>';
  const sfxRow = document.createElement('div');
  sfxRow.className = 'row';
  for (const name of SFX_NAMES) {
    sfxRow.appendChild(makeButton(name, () => engine.play(name, { intensity: Math.random() })));
  }
  sfxSection.appendChild(sfxRow);
  app.appendChild(sfxSection);

  const musicSection = document.createElement('section');
  musicSection.innerHTML = '<h2>Music</h2>';
  const musicRow = document.createElement('div');
  musicRow.className = 'row';
  for (const planet of PLANETS) {
    musicRow.appendChild(makeButton(`start ${planet}`, () => engine.startMusic(planet)));
  }
  musicRow.appendChild(makeButton('stop music', () => engine.stopMusic()));
  musicSection.appendChild(musicRow);
  app.appendChild(musicSection);

  const toggleSection = document.createElement('section');
  toggleSection.innerHTML = '<h2>Toggles</h2>';
  const toggleRow = document.createElement('div');
  toggleRow.className = 'row';
  let sfxOn = true;
  let musicOn = true;
  toggleRow.appendChild(
    makeButton('toggle sfx', () => {
      sfxOn = !sfxOn;
      engine.setSfxEnabled(sfxOn);
    }),
  );
  toggleRow.appendChild(
    makeButton('toggle music', () => {
      musicOn = !musicOn;
      engine.setMusicEnabled(musicOn);
    }),
  );
  toggleSection.appendChild(toggleRow);
  app.appendChild(toggleSection);
}

build();
