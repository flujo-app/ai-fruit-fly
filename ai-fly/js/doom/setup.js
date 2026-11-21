// A desk's setup: how the screen and the game controller are connected to the fly.
//
// The fly's brain is never changed. What the Doom gym tunes is the desk: how big the screen looks to
// the fly, how strongly the picture drives its eye cells, and how the movements it tries to make are
// turned into game input. Real fly labs have the same knobs on their virtual-reality rigs (the fly
// walks on a floating ball in front of a screen; how far the ball's turning turns the world, and even
// in which direction, is a setting of the rig).
//
// The fly "presses keys" with its own output cells:
//   turning      DNa01 and DNa02, left side minus right side (the fly's steering cells)
//   walking      DNg100 and DNg97 (drive forward walking), minus the moonwalker cells MDN (walk backwards)
//   the trigger  DNp01, the giant fibre: the cell that makes a fly jump away when something rushes at it
// Which cell stands for which key is hand-made. The cells themselves and everything before them are not.

export const SETUP = [
  // key, plain name, lowest, highest, default, what it does
  { key: 'screen', name: 'screen size', unit: '° of the fly\'s view', min: 70, max: 160, def: 120, text: 'how wide the screen looks to the fly' },
  { key: 'gMotion', name: 'motion signal', unit: '', min: 300, max: 4000, def: 1500, log: true, text: 'how strongly movement on the screen drives the motion cells (T4, T5)' },
  { key: 'gContrast', name: 'flicker signal', unit: '', min: 80, max: 1500, def: 400, log: true, text: 'how strongly brightening and darkening drives the ON and OFF cells (Tm1-Tm4)' },
  { key: 'gObject', name: 'small-object signal', unit: '', min: 100, max: 2500, def: 600, log: true, text: 'how strongly small changing spots drive the object cells (T2, T3)' },
  { key: 'gDark', name: 'darkness signal', unit: '', min: 0, max: 200, def: 40, text: 'how strongly dark areas drive the steady "dark" cells (Tm9)' },
  { key: 'gBlue', name: 'blue-light signal', unit: '', min: 0, max: 600, def: 0, text: 'how strongly blue light on the screen drives the cells that feed the learning centre (aMe12); 0 = off' },
  { key: 'turn', name: 'ball: turning', unit: '°/s per impulse/s', min: -10, max: 10, def: 3, text: 'how fast the view turns when the left and right steering cells disagree. Negative = the ball is read the other way round' },
  { key: 'trim', name: 'ball: trim', unit: 'impulses/s', min: -25, max: 25, def: 0, text: 'takes out a constant pull to one side, like trimming a joystick that drifts (in this brain the right steering cells are a little busier than the left ones)' },
  { key: 'walk', name: 'ball: walking', unit: '', min: 0, max: 0.8, def: 0.25, text: 'how fast the player walks when the walking cells fire' },
  { key: 'back', name: 'ball: backing up', unit: '', min: 0, max: 2, def: 0.5, text: 'how fast the player backs up when the moonwalker cells fire' },
  { key: 'trigger', name: 'trigger', unit: 'jump impulses in 0.1 s', min: 1, max: 30, def: 6, text: 'how many impulses of the jump neuron (giant fibre) within a tenth of a second pull the trigger' },
];
export const NSETUP = SETUP.length;
// the blue-light knob of the standard desk when the learning centre is switched on (the knob's own default is 0 = off)
export const BLUE_STANDARD = 300;
export const KEY = Object.fromEntries(SETUP.map((s, i) => [s.key, i]));

export function defaultSetup() { return Float32Array.from(SETUP.map((s) => s.def)); }

// small repeatable random numbers (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (rand) => (rand() + rand() + rand() + rand() - 2) * 1.73;

// a random setup: every knob somewhere in its range
export function randomSetup(rand) {
  return Float32Array.from(SETUP.map((s) => s.log ? s.min * Math.pow(s.max / s.min, rand()) : s.min + (s.max - s.min) * rand()));
}

// a copy of a setup with small random changes (`amount` = typical change as a share of the knob's range)
export function mutateSetup(setup, rand, amount = 0.08) {
  const out = Float32Array.from(setup);
  for (let i = 0; i < NSETUP; i++) {
    if (rand() > 0.5) continue;
    const s = SETUP[i];
    if (s.log) out[i] = Math.min(s.max, Math.max(s.min, out[i] * Math.exp(gauss(rand) * amount * Math.log(s.max / s.min))));
    else out[i] = Math.min(s.max, Math.max(s.min, out[i] + gauss(rand) * amount * (s.max - s.min)));
  }
  return out;
}

// a setup in words, for the page
export function describeSetup(setup) {
  return SETUP.map((s, i) => ({ key: s.key, name: s.name, value: setup[i], unit: s.unit, text: s.text, min: s.min, max: s.max, def: s.def,
    shown: Math.abs(setup[i]) >= 100 ? setup[i].toFixed(0) : Math.abs(setup[i]) >= 10 ? setup[i].toFixed(1) : setup[i].toFixed(2) }));
}
