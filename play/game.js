'use strict';

/* ============================== config ============================== */

let COLS = 8, ROWS = 10;
const START = { money: 20, pop: 120, co2: 410, temp: 1.1 };
const WIN_TEMP = 1.6, LOSE_TEMP = 2.6, POP_PER_TOWN = 300;

// paste real URLs when live (Ko-fi, App Store, itch.io) — empty = hidden
const LINKS = { tip: '', ios: '', itch: '' };

const TOOLS = {
  town:   { icon: '🏠', name: 'Town',    cost: 8,  desc: 'Needs 1 ⚡ and 1 🍞 each turn. Happy towns pay taxes and grow.' },
  farm:   { icon: '🌾', name: 'Farm',    cost: 4,  desc: 'Feeds 2 towns. Dislikes hot, dry years.' },
  coal:   { icon: '🏭', name: 'Coal',    cost: 6,  pow: 3, desc: 'Powers 3 towns. Cheap. The sky keeps the receipts.' },
  wind:   { icon: '🌬️', name: 'Wind',   cost: 8,  pow: 2, desc: 'Powers 2 towns. Coast or hills only.' },
  solar:  { icon: '☀️', name: 'Solar',  cost: 10, pow: 2, desc: 'Powers 2 towns. Clean — and it gets cheaper every few years.' },
  nuke:   { icon: '☢️', name: 'Nuclear', cost: 20, pow: 6, desc: 'Powers 6 towns, zero carbon. Costly to build, priceless to keep.' },
  forest: { icon: '🌲', name: 'Forest',  cost: 3,  desc: 'Breathes in carbon every turn. Burns in hot years.' },
  wall:   { icon: '🧱', name: 'Seawall', cost: 6,  desc: 'Holds back one stage of rising sea. Adaptation, not a cure.' },
  demo:   { icon: '🔨', name: 'Clear',   cost: 2,  desc: 'Remove a building or seawall — even ones that seemed like a good idea.' },
};

const MODES = {
  simple: {
    key: 'simple', title: '🏝 ISLAND', blurb: 'The essentials. Coal is cheap and the sea is patient — for a while.',
    cols: 8, rows: 10, winPop: 1500, minGrassy: 15,
    tools: ['town', 'farm', 'coal', 'wind', 'solar', 'forest', 'demo'],
    incomeBase: 1, storms: false, acid: false, solarLearning: false,
  },
  complex: {
    key: 'complex', title: '🌀 ARCHIPELAGO', blurb: 'Storms, seawalls, nuclear power, souring seas. The full machine.',
    cols: 9, rows: 12, winPop: 2500, minGrassy: 26,
    tools: ['town', 'farm', 'coal', 'wind', 'solar', 'nuke', 'forest', 'wall', 'demo'],
    incomeBase: 3, storms: true, acid: true, solarLearning: true,
  },
};

const SIM = {
  drift0: 2.2, driftRamp: 0.03, driftMax: 3.2,   // the rest of the world's emissions, rising slowly
  coalCO2: 2.5, forestAbs: 0.25,
  oceanBase: 2.0, oceanZero: 2.35, oceanSpan: 1.25, // ocean sink weakens as it warms
  tempPerPpm: 1 / 95, tempLag: 0.18,               // temperature chases CO2 with delay
  incomeTown: 4,
  farmFood: 2,
  popGrow: 12, popShrink: 20,
  stormTemp: 1.7, stormP: 0.12,
  co2Min: 350, co2Max: 999, tempMin: 0.9, tempMax: 3.2,
};

/* ============================== state ============================== */

let map = [], state = null, mode = null;
let selectedTool = null, hover = null;
let tilePx = 48, dpr = 1;
let effects = [];

const $ = id => document.getElementById(id);
const canvas = $('board'), ctx = canvas.getContext('2d');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tileAt = (c, r) => map[r * COLS + c];
const effElev = t => t.elev + (t.wall ? 1 : 0);

/* ============================== map generation ============================== */

function genMap() {
  let m = [];
  for (let tries = 0; tries < 300; tries++) {
    m = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const dx = (c - (COLS - 1) / 2) / (COLS * 0.54);
        const dy = (r - (ROWS - 1) / 2) / (ROWS * 0.54);
        const v = Math.hypot(dx, dy) + Math.random() * 0.30;
        const gBand = mode.minGrassy > 20 ? 0.67 : 0.62; // Archipelago needs more buildable land
        let t, elev;
        if (v < 0.31) { t = 'hill'; elev = 3; }
        else if (v < gBand) { t = 'grass'; elev = v < 0.47 ? 2 : 1; }
        else if (v < 0.85) { t = 'coast'; elev = 0; }
        else { t = 'ocean'; elev = -1; }
        if (t === 'grass' && Math.random() < 0.22) t = 'forest';
        m.push({ t, elev, b: null, wall: false, c, r });
      }
    }
    const n = COLS * ROWS;
    const land = m.filter(x => x.t !== 'ocean').length;
    const hills = m.filter(x => x.t === 'hill').length;
    const coast = m.filter(x => x.t === 'coast').length;
    const grassy = m.filter(x => x.t === 'grass' || x.t === 'forest').length;
    if (land >= n * 0.42 && land <= n * 0.72 && hills >= 2 && coast >= COLS
        && grassy >= mode.minGrassy) break;
  }
  return m;
}

function nearestTile(pred) {
  const cc = (COLS - 1) / 2, cr = (ROWS - 1) / 2;
  let best = null, bd = Infinity;
  for (const t of map) {
    if (!pred(t)) continue;
    const d = Math.hypot(t.c - cc, t.r - cr);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/* ============================== game setup ============================== */

function startGame(key) {
  mode = MODES[key];
  COLS = mode.cols; ROWS = mode.rows;
  sizeCanvas();
  buildPalette();
  newGame();
  $('title').classList.add('hidden');
  if (!localStorage.getItem('tpSeenHelp')) $('help').classList.remove('hidden');
}

function newGame() {
  map = genMap();
  effects = [];
  state = {
    money: START.money, pop: START.pop, co2: START.co2, temp: START.temp,
    turn: 1, floodStage: 0, coalBuilt: 0, peakTemp: START.temp,
    over: false, won: false, acidWarned: false, log: [],
  };
  selectedTool = null;
  const t1 = nearestTile(t => t.t === 'grass' && !t.b); if (t1) t1.b = 'town';
  const t2 = nearestTile(t => t.t === 'grass' && !t.b); if (t2) t2.b = 'farm';
  const t3 = nearestTile(t => (t.t === 'coast' || t.t === 'hill') && !t.b); if (t3) t3.b = 'wind';
  $('end').classList.add('hidden');
  say('A small island. A warm, patient sea.');
  refresh();
}

function showTitle() {
  state = null;
  $('end').classList.add('hidden');
  $('best-simple').textContent = bestFor('simple');
  $('best-complex').textContent = bestFor('complex');
  $('title').classList.remove('hidden');
}

function bestFor(key) {
  const v = localStorage.getItem('tpBest_' + key);
  return v ? `★ best: won in ${v} turns` : 'not yet won';
}

/* ============================== bookkeeping ============================== */

function counts() {
  const k = { towns: 0, farms: 0, coal: 0, wind: 0, solar: 0, nuke: 0, planted: 0, natForest: 0, land: 0 };
  for (const t of map) {
    if (t.t !== 'ocean') k.land++;
    if (t.t === 'forest') k.natForest++;
    if (t.b) k[t.b === 'town' ? 'towns' : t.b === 'farm' ? 'farms' : t.b === 'forest' ? 'planted' : t.b]++;
  }
  return k;
}

function oceanAbs(temp) {
  return SIM.oceanBase * clamp((SIM.oceanZero - temp) / SIM.oceanSpan, 0, 1);
}

function baseIncome() {
  // in Archipelago the fishing economy sours with the sea
  if (mode.acid) return mode.incomeBase * clamp((520 - state.co2) / 110, 0, 1);
  return mode.incomeBase;
}

function getCost(tool) {
  if (tool === 'solar' && mode.solarLearning && state) {
    return Math.max(6, TOOLS.solar.cost - Math.floor((state.turn - 1) / 6));
  }
  return TOOLS[tool].cost;
}

function rates() {
  const k = counts();
  const power = k.coal * TOOLS.coal.pow + k.wind * TOOLS.wind.pow + k.solar * TOOLS.solar.pow + k.nuke * TOOLS.nuke.pow;
  const food = k.farms * SIM.farmFood;
  const happy = Math.min(k.towns, power, food);
  const drift = Math.min(SIM.driftMax, SIM.drift0 + SIM.driftRamp * (state.turn - 1));
  const emit = drift + k.coal * SIM.coalCO2;
  const sinks = (k.natForest + k.planted) * SIM.forestAbs + oceanAbs(state.temp);
  return { k, power, food, happy, emit, sinks, net: emit - sinks };
}

/* ============================== turn simulation ============================== */

function endTurn() {
  if (!state || state.over) return;
  const r = rates(), k = r.k;

  // economy & population
  const base = baseIncome();
  state.money += Math.round(base + r.happy * SIM.incomeTown);
  const unhappy = k.towns - r.happy;
  state.pop += r.happy * SIM.popGrow - unhappy * SIM.popShrink;
  state.pop = clamp(state.pop, 0, k.towns * POP_PER_TOWN);
  if (unhappy > 0) {
    const lack = r.power < k.towns ? 'power' : 'food';
    say(`⚠️ ${unhappy} town${unhappy > 1 ? 's' : ''} went dark — not enough ${lack}.`);
  }
  if (mode.acid && !state.acidWarned && base < mode.incomeBase * 0.55) {
    state.acidWarned = true;
    say('🐟 The reefs are quieter. Fishing brings in less than it used to.');
  }

  // carbon: emissions minus sinks, temperature chases with a lag
  state.co2 = clamp(state.co2 + r.net, SIM.co2Min, SIM.co2Max);
  const target = 1.1 + (state.co2 - 410) * SIM.tempPerPpm;
  state.temp = clamp(state.temp + (target - state.temp) * SIM.tempLag, SIM.tempMin, SIM.tempMax);
  state.peakTemp = Math.max(state.peakTemp, state.temp);

  droughts();
  wildfires();
  storms();
  floods();

  state.turn++;
  checkEnd();
  refresh();
}

function droughts() {
  const p = clamp(0.15 * (state.temp - 1.45), 0, 0.5);
  if (p <= 0) return;
  for (const t of map) {
    if (t.b === 'farm' && Math.random() < p) {
      t.b = null;
      addFx('fire', t.c, t.r);
      say('🥀 A farm withered in the heat.');
    }
  }
}

function wildfires() {
  const p = clamp(0.13 * (state.temp - 1.65), 0, 0.5);
  if (p <= 0) return;
  for (const t of map) {
    if ((t.t === 'forest' || t.b === 'forest') && Math.random() < p) {
      if (t.b === 'forest') t.b = null; else t.t = 'grass';
      state.co2 = clamp(state.co2 + 3, SIM.co2Min, SIM.co2Max);
      addFx('fire', t.c, t.r);
      say('🔥 Wildfire — a forest burned, its carbon back in the sky.');
    }
  }
}

function storms() {
  if (!mode.storms || state.temp < SIM.stormTemp) return;
  if (Math.random() >= SIM.stormP * (state.temp - 1.6)) return;
  const low = map.filter(t => t.t !== 'ocean' && t.elev <= 1);
  if (!low.length) return;
  const c0 = low[Math.floor(Math.random() * low.length)];
  let hit = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = c0.c + dc, r = c0.r + dr;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      const t = tileAt(c, r);
      if (t.t === 'ocean') continue;
      addFx('storm', c, r);
      if (t.b && Math.random() < 0.6) { t.b = null; hit++; }
    }
  }
  say(hit > 0
    ? `🌀 A storm tore through the lowlands — ${hit} building${hit > 1 ? 's' : ''} lost.`
    : '🌀 A storm raked the coast. This time, it spared you.');
  shake();
}

function floods() {
  const stage = Math.floor(Math.max(0, state.temp - 1.55) / 0.35);
  if (stage <= state.floodStage) return;
  let drowned = 0, held = 0;
  for (const t of map) {
    if (t.elev < 0) continue;
    if (effElev(t) < stage) {
      addFx('ripple', t.c, t.r);
      t.t = 'ocean'; t.elev = -1; t.b = null; t.wall = false; drowned++;
    } else if (t.wall && t.elev < stage) {
      held++;
    }
  }
  state.floodStage = stage;
  if (drowned > 0) say(`🌊 The sea rose. ${drowned} tile${drowned > 1 ? 's' : ''} drowned.`);
  if (held > 0) say(`🧱 ${held} seawall${held > 1 ? 's' : ''} held the line.`);
  if (drowned > 0) shake();
}

function checkEnd() {
  const k = counts();
  if (!state.won && state.pop >= mode.winPop && state.temp <= WIN_TEMP) {
    state.won = true;
    showEnd(true);
    return;
  }
  if (state.temp >= LOSE_TEMP) showEnd(false, 'runaway');
  else if (state.pop <= 0 && state.turn > 3) showEnd(false, 'exodus');
  else if (k.land <= 8) showEnd(false, 'drowned');
}

/* ============================== building ============================== */

function canPlace(tool, t) {
  if (t.t === 'ocean') return false;
  if (tool === 'demo') return !!t.b || t.wall;
  if (tool === 'wall') return !t.wall && t.elev <= 2;
  if (t.b) return false;
  switch (tool) {
    case 'wind': return t.t === 'coast' || t.t === 'hill';
    case 'solar': return t.t === 'grass' || t.t === 'coast' || t.t === 'forest';
    case 'nuke': return t.t === 'grass' || t.t === 'coast' || t.t === 'forest';
    case 'forest': return t.t === 'grass';
    default: return t.t === 'grass' || t.t === 'forest'; // town, farm, coal
  }
}

function place(tool, t) {
  if (!canPlace(tool, t)) { say('✋ Can’t build that here.'); refresh(); return; }
  const cost = getCost(tool);
  if (state.money < cost) { say('💰 Not enough money.'); refresh(); return; }
  state.money -= cost;
  if (tool === 'demo') {
    if (t.b) t.b = null; else t.wall = false;
    say('🔨 Cleared.');
  } else if (tool === 'wall') {
    t.wall = true;
  } else {
    if (t.t === 'forest') {
      t.t = 'grass';
      state.co2 = clamp(state.co2 + 2, SIM.co2Min, SIM.co2Max);
      say('🪓 Old forest cleared — its carbon didn’t stay put.');
    }
    t.b = tool;
    if (tool === 'coal') state.coalBuilt++;
  }
  addFx('pop', t.c, t.r);
  refresh();
}

/* ============================== rendering ============================== */

function sizeCanvas() {
  const w = Math.min($('app').clientWidth - 24, 430);
  tilePx = Math.floor(w / COLS);
  const cssW = tilePx * COLS, cssH = tilePx * ROWS;
  dpr = window.devicePixelRatio || 1;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexLerp(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = sh => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function palette() {
  // the island visibly dries out as it warms
  const heat = state ? clamp((state.temp - 1.1) / 1.5, 0, 1) : 0;
  return {
    ocean:  hexLerp('#14507a', '#123c5c', heat * 0.6),
    ocean2: hexLerp('#155580', '#134163', heat * 0.6),
    coast:  hexLerp('#d9c58b', '#e3cf96', heat * 0.4),
    grass:  hexLerp('#6a994e', '#ad9d51', heat),
    forest: hexLerp('#386641', '#6e6f3c', heat),
    hill:   hexLerp('#7d8597', '#8d8d85', heat * 0.5),
  };
}

function render(ts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state) return;
  const gap = 2, rad = 4;
  const P = palette();
  const nextStageTemp = 1.55 + 0.35 * (state.floodStage + 1);
  const atRisk = state.temp > nextStageTemp - 0.15;

  for (const t of map) {
    const x = t.c * tilePx + gap / 2, y = t.r * tilePx + gap / 2;
    const s = tilePx - gap;
    const isOcean = t.t === 'ocean';
    ctx.fillStyle = isOcean ? ((t.c + t.r) % 2 ? P.ocean : P.ocean2) : P[t.t];
    rrect(x, y, s, s, rad);
    ctx.fill();

    if (isOcean) {
      // slow shimmer
      const a = 0.02 + 0.03 * (0.5 + 0.5 * Math.sin(ts / 900 + t.c * 7 + t.r * 13));
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      rrect(x, y, s, s, rad);
      ctx.fill();
    } else {
      // subtle depth: light top edge
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      rrect(x, y, s, s * 0.28, rad);
      ctx.fill();
    }

    if (t.t === 'hill') {
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.22);
      ctx.lineTo(x + s * 0.78, y + s * 0.72);
      ctx.lineTo(x + s * 0.22, y + s * 0.72);
      ctx.closePath();
      ctx.fill();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000'; // opaque — Chromium applies fillStyle alpha to color emoji
    if (t.t === 'forest' && !t.b) {
      ctx.font = `${Math.round(s * 0.5)}px serif`;
      ctx.fillText('🌲', x + s / 2, y + s / 2 + 1);
    }
    if (t.b) {
      ctx.font = `${Math.round(s * 0.6)}px serif`;
      ctx.fillText(TOOLS[t.b].icon, x + s / 2, y + s / 2 + 1);
    }

    // coal smoke drifting upward
    if (t.b === 'coal') {
      for (let i = 0; i < 2; i++) {
        const ph = (ts / 1800 + i * 0.5 + (t.c * 3 + t.r * 5) * 0.13) % 1;
        const sx = x + s * 0.5 + Math.sin(ts / 700 + i * 2 + t.c) * s * 0.07;
        const sy = y + s * 0.18 - ph * s * 0.45;
        ctx.fillStyle = `rgba(200,208,218,${0.28 * (1 - ph)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, s * 0.07 * (1 + ph * 1.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (t.wall) {
      ctx.strokeStyle = '#d9c58b';
      ctx.lineWidth = 3;
      rrect(x + 2, y + 2, s - 4, s - 4, rad);
      ctx.stroke();
    }

    // flood warning: low tiles outlined when the next surge is near
    if (atRisk && t.elev >= 0 && effElev(t) < state.floodStage + 1) {
      const a = 0.5 + 0.35 * Math.sin(ts / 300);
      ctx.strokeStyle = `rgba(100,182,231,${a})`;
      ctx.lineWidth = 2;
      rrect(x + 1, y + 1, s - 2, s - 2, rad);
      ctx.stroke();
    }

    if (hover && hover === t && selectedTool) {
      ctx.strokeStyle = canPlace(selectedTool, t) ? '#7cc46e' : '#ef6461';
      ctx.lineWidth = 2.5;
      rrect(x + 1, y + 1, s - 2, s - 2, rad);
      ctx.stroke();
    }
  }

  // transient effects
  const now = performance.now();
  effects = effects.filter(f => now - f.t0 < 1200);
  for (const f of effects) {
    const age = now - f.t0;
    const x = f.c * tilePx, y = f.r * tilePx, s = tilePx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    if (f.type === 'fire') {
      ctx.globalAlpha = Math.max(0, 1 - age / 1200);
      ctx.font = `${Math.round(s * 0.7)}px serif`;
      ctx.fillText('🔥', x + s / 2, y + s / 2 - (age / 1200) * s * 0.3);
    } else if (f.type === 'storm') {
      ctx.globalAlpha = Math.max(0, 1 - age / 1000);
      ctx.font = `${Math.round(s * 0.7)}px serif`;
      ctx.fillText('🌀', x + s / 2, y + s / 2);
    } else if (f.type === 'ripple') {
      ctx.globalAlpha = Math.max(0, 1 - age / 1000);
      ctx.strokeStyle = '#64b6e7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, (age / 1000) * s * 0.8 + 2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.type === 'pop') {
      ctx.globalAlpha = Math.max(0, 0.5 * (1 - age / 250));
      ctx.fillStyle = '#ffffff';
      rrect(x + 1, y + 1, s - 2, s - 2, 4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function addFx(type, c, r) { effects.push({ type, c, r, t0: performance.now() }); }

function shake() {
  canvas.classList.remove('shake');
  void canvas.offsetWidth;
  canvas.classList.add('shake');
}

function loop(ts) {
  render(ts);
  requestAnimationFrame(loop);
}

/* ============================== HUD & log ============================== */

function say(msg) {
  state.log.unshift(msg);
  state.log = state.log.slice(0, 4);
}

function renderLog() {
  $('log').innerHTML = state.log
    .map((m, i) => `<div class="l${i}">${m}</div>`)
    .join('');
}

function updateHUD() {
  if (!state) return;
  const r = rates();
  const tempEl = $('temp');
  tempEl.textContent = `+${state.temp.toFixed(2)}°`;
  tempEl.className = state.temp < 1.5 ? 'ok' : state.temp < 1.9 ? 'warn' : 'bad';
  $('tempfill').style.width = `${((state.temp - SIM.tempMin) / (SIM.tempMax - SIM.tempMin)) * 100}%`;

  $('co2').textContent = Math.round(state.co2);
  const netEl = $('co2net');
  netEl.textContent = `${r.net >= 0 ? '+' : ''}${r.net.toFixed(1)}/turn`;
  netEl.className = 'sub ' + (r.net > 0 ? 'up' : 'down');

  $('money').textContent = state.money;
  $('pop').textContent = state.pop;
  $('popgoal').textContent = `/${mode.winPop}`;
  $('turn').textContent = state.turn;

  $('power').textContent = `${r.power}/${r.k.towns}`;
  $('chip-power').classList.toggle('deficit', r.power < r.k.towns);
  $('food').textContent = `${r.food}/${r.k.towns}`;
  $('chip-food').classList.toggle('deficit', r.food < r.k.towns);

  for (const key of mode.tools) {
    const btn = $(`tool-${key}`);
    const cost = getCost(key);
    btn.querySelector('.cost').textContent = `$${cost}`;
    btn.disabled = state.money < cost;
    btn.classList.toggle('sel', selectedTool === key);
  }
}

function refresh() {
  renderLog();
  updateHUD();
}

/* ============================== end screens ============================== */

function showEnd(won, why) {
  state.over = !won;
  const title = $('endtitle'), text = $('endtext');
  if (won) {
    title.textContent = '🌍 The Island Thrives';
    text.textContent = state.coalBuilt === 0
      ? `${state.pop.toLocaleString()} islanders, +${state.temp.toFixed(2)}° and holding — and they never once burned coal.`
      : `${state.pop.toLocaleString()} islanders, +${state.temp.toFixed(2)}° and holding. They burned, they learned, they planted.`;
  } else if (why === 'runaway') {
    title.textContent = '🔥 Runaway';
    text.textContent = 'Past +2.6°, the island’s systems fed on themselves — fires fed the heat, the heat fed the sea. Nothing you built could outrun it.';
  } else if (why === 'exodus') {
    title.textContent = '⛵ Exodus';
    text.textContent = 'The last islanders sailed away, looking for somewhere cooler.';
  } else {
    title.textContent = '🌊 Undertow';
    text.textContent = 'The sea took the island back, one patient tile at a time.';
  }
  $('endstats').textContent =
    `${mode.title.slice(2)} · Turns: ${state.turn} · Peak temp: +${state.peakTemp.toFixed(2)}° · Coal plants built: ${state.coalBuilt}`;
  $('endcontinue').classList.toggle('hidden', !won);

  const links = [];
  if (LINKS.ios) links.push(`<a href="${LINKS.ios}" target="_blank" rel="noopener">📱 Get it on iOS</a>`);
  if (LINKS.itch) links.push(`<a href="${LINKS.itch}" target="_blank" rel="noopener">🎮 On itch.io</a>`);
  if (LINKS.tip) links.push(`<a href="${LINKS.tip}" target="_blank" rel="noopener">☕ Tip the developer</a>`);
  $('endlinks').innerHTML = links.join(' · ');
  $('endlinks').classList.toggle('hidden', links.length === 0);

  $('end').classList.remove('hidden');

  if (won) {
    const key = 'tpBest_' + mode.key;
    const best = Number(localStorage.getItem(key) || 0);
    if (!best || state.turn < best) localStorage.setItem(key, String(state.turn));
  }
}

/* ============================== input ============================== */

function buildPalette() {
  const pal = $('palette');
  pal.innerHTML = '';
  pal.style.gridTemplateColumns = `repeat(${mode.tools.length > 7 ? 5 : 4}, 1fr)`;
  for (const key of mode.tools) {
    const tool = TOOLS[key];
    const btn = document.createElement('button');
    btn.id = `tool-${key}`;
    btn.innerHTML = `<span class="ic">${tool.icon}</span>${tool.name}<span class="cost">$${tool.cost}</span>`;
    btn.addEventListener('click', () => {
      if (selectedTool === key) {
        selectedTool = null;
      } else {
        selectedTool = key;
        say(`${tool.icon} ${tool.desc}`);
      }
      refresh();
    });
    pal.appendChild(btn);
  }
}

function tileFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left) / tilePx);
  const r = Math.floor((e.clientY - rect.top) / tilePx);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return tileAt(c, r);
}

canvas.addEventListener('click', e => {
  if (!state || state.over) return;
  const t = tileFromEvent(e);
  if (!t) return;
  if (selectedTool) {
    place(selectedTool, t);
  } else if (t.t !== 'ocean') {
    const what = t.b ? TOOLS[t.b].name : t.t === 'forest' ? 'Wild forest' : t.t[0].toUpperCase() + t.t.slice(1);
    const heights = ['shore-level', 'low ground', 'high ground', 'hilltop'];
    say(`${what} — ${heights[t.elev]}${t.wall ? ', walled' : ''}.`);
    refresh();
  }
});

canvas.addEventListener('mousemove', e => {
  if (!state) return;
  hover = tileFromEvent(e);
});
canvas.addEventListener('mouseleave', () => { hover = null; });

$('endturn').addEventListener('click', endTurn);
$('restartbtn').addEventListener('click', () => { if (mode) newGame(); });
$('menubtn').addEventListener('click', showTitle);
$('helpbtn').addEventListener('click', () => $('help').classList.remove('hidden'));
$('titlehelp').addEventListener('click', () => $('help').classList.remove('hidden'));
$('helpclose').addEventListener('click', () => {
  $('help').classList.add('hidden');
  localStorage.setItem('tpSeenHelp', '1');
});
$('endrestart').addEventListener('click', newGame);
$('endmenu').addEventListener('click', showTitle);
$('endcontinue').addEventListener('click', () => $('end').classList.add('hidden'));
$('mode-simple').addEventListener('click', () => startGame('simple'));
$('mode-complex').addEventListener('click', () => startGame('complex'));

window.addEventListener('resize', () => { if (mode) sizeCanvas(); });

/* ============================== init ============================== */

sizeCanvas();
showTitle();
requestAnimationFrame(loop);
