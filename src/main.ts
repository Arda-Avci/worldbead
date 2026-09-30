import './base.css';
import { Game } from './game/Game';
import { LANG, S } from './ui/strings';

document.documentElement.lang = LANG;

/**
 * Last-resort fatal overlay (production review item #11): with no global error
 * handling, a field failure on a phone was a silent dead screen. Any uncaught
 * error or unhandled rejection shows a localized "something went wrong —
 * restart" card. Progress lives in localStorage, so a restart is safe.
 * Standalone DOM with inline styles on purpose: it must work even if the UI
 * module graph (and its CSS) is what failed to load.
 */
let fatalShown = false;
function showFatalError(): void {
  if (fatalShown) return;
  fatalShown = true;
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(4,6,14,0.94);color:#eef2ff;font-family:system-ui,sans-serif;text-align:center;padding:24px;';
  const card = document.createElement('div');
  card.style.cssText = 'max-width:320px;display:flex;flex-direction:column;align-items:center;gap:10px;';
  const title = document.createElement('div');
  title.textContent = S.fatalTitle;
  title.style.cssText = 'font-size:18px;font-weight:700;';
  const body = document.createElement('div');
  body.textContent = S.fatalBody;
  body.style.cssText = 'font-size:13px;opacity:0.7;line-height:1.45;';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = S.restart;
  btn.style.cssText =
    'margin-top:8px;padding:12px 28px;border:none;border-radius:999px;font-size:14px;font-weight:700;color:#06101f;background:linear-gradient(135deg,#6ad2ff,#b98bff);cursor:pointer;min-height:44px;';
  btn.addEventListener('click', () => location.reload());
  card.append(title, body, btn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

window.addEventListener('error', () => showFatalError());
window.addEventListener('unhandledrejection', () => showFatalError());

const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');
if (!(canvas instanceof HTMLCanvasElement) || !hud) {
  showFatalError();
  throw new Error('WorldBead: required DOM roots (#scene canvas, #hud) are missing');
}

new Game(canvas, hud);
