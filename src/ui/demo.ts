/**
 * Preview/test harness for GameUI + Tutorial. Not part of the game build.
 * Drive it with a `state` URL param, e.g. demo.html?state=combo
 *
 * States: idle, combo, complete, planetcomplete, failed, settings, unlock,
 * tutorial-tap, tutorial-drag, titlebeat, logo
 */
import { GameUI } from './gameui';
import { Tutorial } from './tutorial';
import type { PowerButtonState, PowerId, Settings } from './types';

const root = document.getElementById('ui-root')!;
const params = new URLSearchParams(location.search);
const state = params.get('state') ?? 'idle';

const settings: Settings = { sound: true, music: true, haptics: true };

const ui = new GameUI(root, {
  onPower: (id: PowerId) => ui.showToast(`Power: ${id}`),
  onSwap: () => ui.showToast('Swapped probe'),
  onSettingsChanged: (s) => Object.assign(settings, s),
  onReplayIntro: () => ui.showToast('Replay intro'),
});

ui.setSettings(settings);
ui.setStardust(1280, false);
ui.setPlanetBadge('Earth', 42, 0.63);
ui.setProbeDock({ color: 0x1d5fc4, count: 7 }, { color: 0x4cb050 });
if (state !== 'loading') {
  const loadingEl = root.querySelector('[data-loading]') as HTMLElement;
  if (loadingEl) loadingEl.style.display = 'none';
}

const mixedPowers: PowerButtonState[] = [
  { id: 'meteor', charges: 2, locked: false },
  { id: 'prism', charges: 0, locked: false, price: 80 },
  { id: 'solarFlare', charges: 1, locked: false, active: true },
  { id: 'comet', charges: 0, locked: true, unlockLevel: 60 },
];
ui.setPowers(mixedPowers);

document.body.dataset.state = state;

async function run() {
  switch (state) {
    case 'idle':
      break;

    case 'loading':
      ui.showLoading('Earth');
      break;

    case 'combo':
      ui.showCombo(84);
      ui.showToast('+3 stardust');
      break;

    case 'complete':
      void ui.showLevelComplete({
        stars: 3,
        stardustEarned: 46,
        factTitle: 'Did you know?',
        factText: 'Earth is the only planet not named after a Greek or Roman deity.',
      });
      break;

    case 'complete-end':
      void ui.showLevelComplete({
        stars: 2,
        stardustEarned: 46,
        factTitle: 'Did you know?',
        factText: 'Earth is the only planet not named after a Greek or Roman deity.',
      });
      break;

    case 'planetcomplete':
      void ui.showLevelComplete({
        stars: 3,
        stardustEarned: 120,
        factTitle: 'Did you know?',
        factText: 'The Moon is slowly drifting away from Earth at about 3.8 cm per year.',
        nextPlanetName: 'Moon',
      });
      break;

    case 'failed':
      void ui.showLevelFailed({ beadsLeft: 213, retryCost: 100, continueCost: 500, canAffordContinue: true });
      break;

    case 'settings':
      (document.querySelector('[data-gear]') as HTMLButtonElement)?.click();
      break;

    case 'unlock':
      void ui.showUnlock({
        icon: 'meteor',
        name: 'Meteor Unlocked',
        description: 'Pops every bead within a radius of the impact point, any color.',
      });
      break;

    case 'titlebeat':
      ui.setHudVisible(false);
      void ui.showTitleBeat('4.5 billion years in the making.', 4000);
      break;

    case 'logo':
      ui.setHudVisible(false);
      void ui.showLogo();
      break;

    case 'tutorial-tap': {
      const target = document.querySelector('[data-swap]') as HTMLElement;
      const tut = new Tutorial(root);
      let resolveStep: () => void = () => {};
      const until = new Promise<void>((r) => (resolveStep = r));
      target.addEventListener('click', () => resolveStep(), { once: true });
      void tut.run([{ caption: 'Tap the swap button to switch probes.', target, gesture: 'tap', until }]);
      // Expose a marker so Playwright can confirm the button beneath is reachable.
      (window as any).__tutorialTarget = target;
      break;
    }

    case 'tutorial-drag': {
      const globe = document.getElementById('globe')!;
      const tut = new Tutorial(root);
      const until = new Promise<void>(() => {}); // never resolves: static screenshot only
      void tut.run([
        {
          caption: 'Drag the globe to rotate it.',
          target: () => {
            const r = globe.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
          },
          gesture: 'drag',
          until,
        },
      ]);
      break;
    }

    case 'tutorial-block-test': {
      // A plain button behind the tutorial spotlight, used by the Playwright pointer-passthrough test.
      const decoy = document.createElement('button');
      decoy.id = 'decoy-outside';
      decoy.textContent = 'outside';
      decoy.style.cssText = 'position:absolute;left:16px;top:16px;width:60px;height:44px;pointer-events:auto;';
      decoy.dataset.clicks = '0';
      decoy.addEventListener('click', () => (decoy.dataset.clicks = String(Number(decoy.dataset.clicks) + 1)));
      root.appendChild(decoy);

      const insideTarget = document.querySelector('[data-swap]') as HTMLButtonElement;
      insideTarget.dataset.clicks = '0';
      insideTarget.addEventListener('click', () => (insideTarget.dataset.clicks = String(Number(insideTarget.dataset.clicks) + 1)));

      const tut = new Tutorial(root);
      const until = new Promise<void>(() => {});
      void tut.run([{ caption: 'Tap the swap button.', target: insideTarget, gesture: 'tap', until }]);
      break;
    }

    default:
      break;
  }
}

void run();
