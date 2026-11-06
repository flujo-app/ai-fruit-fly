// Hard mode: the fly types a three.js program one token at a time (keywords, names, numbers,
// symbols). An "autocomplete" only offers tokens that are legal at the cursor, like an editor
// would. Where only one token is legal it is typed automatically; everywhere else the fly decides.
//
// What the fly "smells" at each decision is where it is in the code plus the token it considers.
// "Where" is the object it is describing (m1, m2, ...) for everything about an object, and the
// line number for what to write next.

export const MAX_LINES = 14;
export const MAX_MESHES = 6;

export const COLORS = {
  '0x8b4513': 'brown', '0xf5deb3': 'wheat', '0xff5500': 'orange', '0xffffff': 'white',
  '0x3366ff': 'blue', '0x33aa44': 'green', '0x222222': 'black', '0xc0c6cc': 'steel',
};
const HEX = Object.keys(COLORS);
const IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
const SIZES = ['0.05', '0.2', '0.5', '1', '1.5', '2', '3', '4'];
// a cylinder may get a 4th number: how many corners it has around (3 = a triangle, like a Fladenbrot)
const CORNERS = ['3', '4', '6', '8'];
const POS = ['0', '0.5', '1', '1.5', '2', '-0.5', '-1', '-1.5', '-2', '-2.5', '-3'];
const INTENSITY = ['0.2', '0.5', '1', '2', '3'];
const SPEEDS = ['0.1', '0.5', '1', '2', '5', '20'];
const GEOS = { BoxGeometry: ['box1', 'box2', 'box3'], CylinderGeometry: ['cyl1', 'cyl2', 'cyl3'], SphereGeometry: ['sph1'] };
const LIGHTS = ['DirectionalLight', 'AmbientLight', 'PointLight'];
export const NEWLINE = '↵';

// decisions that depend on the line (what to write next)
export const LINE_STATES = {
  start: ['END', 'const', 'scene', 'knife', 'spin', ...IDS],
  addArg: ['new', ...IDS],
  lightType: LIGHTS, lightColor: HEX, lightNum: INTENSITY,
  knifeId: IDS, spinId: IDS,
};
// decisions about one object
export const OBJECT_STATES = {
  geo: Object.keys(GEOS),
  box1: SIZES, box2: SIZES, box3: SIZES, cyl1: SIZES, cyl2: SIZES, cyl3: SIZES, sph1: SIZES,
  cylEnd: [')', ','], corners: CORNERS,
  color: HEX, matEnd: ['}', ','], emissive: HEX, addNow: ['scene', NEWLINE],
  posX: POS, posY: POS, posZ: POS,
  axis: ['x', 'y', 'z'], spinNum: SPEEDS,
};

export const comboKey = (ctx, state, token) => `${ctx}|${state}|${token}`;
export function allCombos() {
  const out = [];
  for (let line = 1; line <= MAX_LINES; line++) for (const [s, toks] of Object.entries(LINE_STATES)) for (const t of toks) out.push(comboKey(`L${line}`, s, t));
  for (const id of IDS) for (const [s, toks] of Object.entries(OBJECT_STATES)) for (const t of toks) out.push(comboKey(id, s, t));
  return out;
}

// Write one program. `choose(ctx, state, options)` returns the index of the token to type.
export function writeProgram(choose) {
  const tokens = [];      // { t, d } where d = true if the fly decided this token
  const decisions = [];   // [ctx, state, token] for every real decision
  const declared = [];
  const emit = (...ts) => { for (const t of ts) tokens.push({ t, d: false }); };
  const pick = (ctx, state, opts) => {
    if (opts.length === 1) { emit(opts[0]); return opts[0]; }
    const t = opts[choose(ctx, state, opts)];
    decisions.push([ctx, state, t]);
    tokens.push({ t, d: true });
    return t;
  };

  for (let line = 1; line <= MAX_LINES; line++) {
    const L = `L${line}`;
    const starts = ['END', 'scene'];
    if (declared.length < MAX_MESHES) starts.push('const');
    if (declared.length) starts.push('knife', 'spin', ...declared);
    const s = pick(L, 'start', starts);
    if (s === 'END') break;
    if (s === 'const') {
      const id = IDS[declared.length];
      emit(id, '=', 'new', 'THREE', '.', 'Mesh', '(', 'new', 'THREE', '.');
      const geo = pick(id, 'geo', Object.keys(GEOS));
      emit('(');
      GEOS[geo].forEach((st, i) => { if (i) emit(','); pick(id, st, SIZES); });
      if (geo !== 'CylinderGeometry') emit(')');
      else if (pick(id, 'cylEnd', [')', ',']) === ',') { pick(id, 'corners', CORNERS); emit(')'); }
      emit(',', 'new', 'THREE', '.', 'MeshStandardMaterial', '(', '{', 'color', ':');
      pick(id, 'color', HEX);
      if (pick(id, 'matEnd', ['}', ',']) === ',') {
        emit('emissive', ':');
        pick(id, 'emissive', HEX);
        emit('}');
      }
      emit(')', ')', ';');
      declared.push(id);
      if (pick(id, 'addNow', ['scene', NEWLINE]) === 'scene') emit('.', 'add', '(', id, ')', ';');
    } else if (s === 'scene') {
      emit('.', 'add', '(');
      if (pick(L, 'addArg', ['new', ...declared]) === 'new') {
        emit('THREE', '.');
        pick(L, 'lightType', LIGHTS);
        emit('(');
        pick(L, 'lightColor', HEX);
        emit(',');
        pick(L, 'lightNum', INTENSITY);
        emit(')');
      }
      emit(')', ';');
    } else if (s === 'knife') {
      emit('(');
      pick(L, 'knifeId', declared);
      emit(')', ';');
    } else if (s === 'spin') {
      emit('=', '(', 'dt', ')', '=>', '{');
      const id = pick(L, 'spinId', declared);
      emit('.', 'rotation', '.');
      pick(id, 'axis', ['x', 'y', 'z']);
      emit('+=', 'dt', '*');
      pick(id, 'spinNum', SPEEDS);
      emit(';', '}', ';');
    } else {   // an existing object: move it
      const id = s;
      emit('.', 'position', '.', 'set', '(');
      pick(id, 'posX', POS); emit(',');
      pick(id, 'posY', POS); emit(',');
      pick(id, 'posZ', POS);
      emit(')', ';');
    }
    tokens.push({ t: '\n', d: false });
  }
  return { tokens, decisions, code: formatTokens(tokens) };
}

const WORD = /^[A-Za-z_$][\w$]*$/;
const NO_SPACE_BEFORE = new Set(['.', ')', ',', ';', ':']);
export function formatTokens(tokens) {
  let out = '', prev = '\n';
  for (const { t } of tokens) {
    if (t === 'END' || t === NEWLINE) continue;   // decisions, not code
    if (t === '\n') { out += '\n'; prev = '\n'; continue; }
    const tight = prev === '\n' || NO_SPACE_BEFORE.has(t) || prev === '.' || prev === '(' || (t === '(' && WORD.test(prev));
    out += (tight ? '' : ' ') + t;
    prev = t;
  }
  return out.trim();
}
