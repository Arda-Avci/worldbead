import './base.css';
import { Game } from './game/Game';
import { LANG } from './ui/strings';

document.documentElement.lang = LANG;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
new Game(canvas, hud);
