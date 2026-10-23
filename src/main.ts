/**
 * Entry point: start the physics engine, then the game.
 */
import { Game } from './game/session.js';
import { initPhysics } from './sim/race.js';
import { autoFullscreen } from './ui/fullscreen.js';
import { startAnalytics } from './ui/analytics.js';
import './ui/style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const loading = document.querySelector<HTMLElement>('#loading');

await initPhysics();
new Game(canvas, overlay);
autoFullscreen();
startAnalytics(); // visitor counts on the Vercel copy only
loading?.remove();
