'use strict';

/* ============================== config ============================== */

const COLS = 8, ROWS = 10;
const START = { money: 20, pop: 120, co2: 410, temp: 1.1 };
const WIN_POP = 1500, WIN_TEMP = 1.6;
const LOSE_TEMP = 2.6;
const POP_PER_TOWN = 300;

const TOOLS = {
  town:   { icon: '🏠', name: 'Town',   cost: 8,  desc: 'Needs 1 ⚡ and 1 🍞 each turn. Happy towns pay taxes and grow.' },
  farm:   { icon: '🌾', name: 'Farm',   cost: 4,  desc: 'Feeds 2 towns. Dislikes hot, dry years.' },
  coal:   { icon: '🏭', name: 'Coal',   cost: 6,  desc: 'Powers 3 towns. Cheap. The sky keeps the receipts.' },
  wind:   { icon: '🌬️', name: 'Wind',  cost: 8,  desc: 'Powers 2 towns. Coast or hills only.' },
  solar:  { icon: '☀️', name: 'Solar', cost: 10, desc: 'Powers 2 towns. Clean, pricey, works anywhere sunny.' },
  forest: { icon: '🌲', name: 'Forest', cost: 3,  desc: 'Breathes in carbon every turn. Burns in hot years.' },
  demo:   { icon: '🔨', name: 'Clear',  cost: 2,  desc: 'Remove any building — even the ones that seemed like a good idea.' },
};

const SIM = {
  drift0: 2.2, driftRamp: 0.03, driftMax: 3.2,   // the rest of the world's emissions, rising slowly
  coalCO2: 2.5, forestAbs: 0.25,
  oceanBase: 2.0, oceanZero: 2.35, oceanSpan: 1.25, // ocean sink weakens as it warms
  tempPerPpm: 1 / 95, tempLag: 0.18,               // temperature chases CO2 with delay
  incomeBase: 1, incomeTown: 4,
  farmFood: 2, coalPow: 3, windPow: 2, solarPow: 2,
  popGrow: 12, popShrink: 20,
  co2Min: 350, co2Max: 999, tempMin: 0.9, tempMax: 3.2,
};

const TERRAIN_COLORS = {
  ocean: '#14507a', ocean2: '#155580',
  coast: '#d9c58b', grass: '#6a994e', forest: '#386641', hill: '#7d8597',
};

/* ============================== state ============================== */

let map = [], state = null;
let selectedTool = null, hover = null;
let tilePx = 48, dpr = 1;

const $ = id => document.getElementById(id);
const canvas = $('board'), ctx = canvas.getContext('2d');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tileAt = (c, r) => map[r * COLS + c];

/* ============================== map generation ============================== */

function genMap() {
  let m = [];
  for (let tries = 0; tries < 300; tries++) {
    m = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const dx = (c - (COLS - 1) / 2) / 4.3;
        const dy = (r - (ROWS - 1) / 2) / 5.4;
        const v = Math.hypot(dx, dy) + Math.random() * 0.30;
        let t, elev;
        if (v < 0.33) { t = 'hill'; elev = 3; }
        else if (v < 0.62) { t = 'grass'; elev = v < 0.47 ? 2 : 1; }
        else if (v < 0.84) { t = 'coast'; elev = 0; }
        else { t = 'ocean'; elev = -1; }
        if (t === 'grass' && Math.random() < 0.22) t = 'forest';
        m.push({ t, elev, b: null, c, r });
      }
    }
    const land = m.filter(x => x.t !== 'ocean').length;
    const hills = m.filter(x => x.t === 'hill').length;
    const coast = m.filter(x => x.t === 'coast').length;
    if (land >= 34 && land <= 58 && hills >= 2 && coast >= 8) break;
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

function newGame() {
  map = genMap();
  state = {
    money: START.money, pop: START.pop, co2: START.co2, temp: START.temp,
    turn: 1, floodStage: 0, coalBuilt: 0, peakTemp: START.temp,
    over: false, won: false, log: [],
  };
  selectedTool = null;
  const t1 = nearestTile(t => t.t === 'grass' && !t.b); if (t1) t1.b = 'town';
  const t2 = nearestTile(t => t.t === 'grass' && !t.b); if (t2) t2.b = 'farm';
  const t3 = nearestTile(t => (t.t === 'coast' || t.t === 'hill') && !t.b); if (t3) t3.b = 'wind';
  $('end').classList.add('hidden');
  say('A small island. A warm, patient sea.');
  refresh();
}

/* ============================== bookkeeping ============================== */

function counts() {
  const k = { towns: 0, farms: 0, coal: 0, wind: 0, solar: 0, planted: 0, natForest: 0, land: 0 };
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

function rates() {
  const k = counts();
  const power = k.coal * SIM.coalPow + k.wind * SIM.windPow + k.solar * SIM.solarPow;
  const food = k.farms * SIM.farmFood;
  const happy = Math.min(k.towns, power, food);
  const drift = Math.min(SIM.driftMax, SIM.drift0 + SIM.driftRamp * (state.turn - 1));
  const emit = drift + k.coal * SIM.coalCO2;
  const sinks = (k.natForest + k.planted) * SIM.forestAbs + oceanAbs(state.temp);
  return { k, power, food, happy, emit, sinks, net: emit - sinks };
}

/* ============================== turn simulation ============================== */

function endTurn() {
  if (state.over) return;
  const r = rates(), k = r.k;

  // economy & population
  state.money += SIM.incomeBase + r.happy * SIM.incomeTown;
  const unhappy = k.towns - r.happy;
  state.pop += r.happy * SIM.popGrow - unhappy * SIM.popShrink;
  state.pop = clamp(state.pop, 0, k.towns * POP_PER_TOWN);
  if (unhappy > 0) {
    const lack = r.power < k.towns ? 'power' : 'food';
    say(`⚠️ ${unhappy} town${unhappy > 1 ? 's' : ''} went dark — not enough ${lack}.`);
  }

  // carbon: emissions minus sinks, temperature chases with a lag
  state.co2 = clamp(state.co2 + r.net, SIM.co2Min, SIM.co2Max);
  const target = 1.1 + (state.co2 - 410) * SIM.tempPerPpm;
  state.temp = clamp(state.temp + (target - state.temp) * SIM.tempLag, SIM.tempMin, SIM.tempMax);
  state.peakTemp = Math.max(state.peakTemp, state.temp);

  droughts();
  wildfires();
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
      say('🔥 Wildfire — a forest burned, its carbon back in the sky.');
    }
  }
}

function floods() {
  const stage = Math.floor(Math.max(0, state.temp - 1.55) / 0.35);
  if (stage <= state.floodStage) return;
  let drowned = 0;
  for (const t of map) {
    if (t.elev >= 0 && t.elev < stage) {
      t.t = 'ocean'; t.elev = -1; t.b = null; drowned++;
    }
  }
  state.floodStage = stage;
  if (drowned > 0) say(`🌊 The sea rose. ${drowned} tile${drowned > 1 ? 's' : ''} drowned.`);
}

function checkEnd() {
  const k = counts();
  if (!state.won && state.pop >= WIN_POP && state.temp <= WIN_TEMP) {
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
  if (tool === 'demo') return !!t.b;
  if (t.b) return false;
  switch (tool) {
    case 'wind': return t.t === 'coast' || t.t === 'hill';
    case 'solar': return t.t === 'grass' || t.t === 'coast' || t.t === 'forest';
    case 'forest': return t.t === 'grass';
    default: return t.t === 'grass' || t.t === 'forest'; // town, farm, coal
  }
}

function place(tool, t) {
  if (!canPlace(tool, t)) { say('✋ Can’t build that here.'); refresh(); return; }
  const cost = TOOLS[tool].cost;
  if (state.money < cost) { say('💰 Not enough money.'); refresh(); return; }
  state.money -= cost;
  if (tool === 'demo') {
    t.b = null;
    say('🔨 Cleared.');
  } else {
    if (t.t === 'forest') {
      t.t = 'grass';
      state.co2 = clamp(state.co2 + 2, SIM.co2Min, SIM.co2Max);
      say('🪓 Old forest cleared — its carbon didn’t stay put.');
    }
    t.b = tool;
    if (tool === 'coal') state.coalBuilt++;
  }
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

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gap = 2, rad = 4;
  const nextStageTemp = 1.55 + 0.35 * (state.floodStage + 1);
  const atRisk = state.temp > nextStageTemp - 0.15;

  for (const t of map) {
    const x = t.c * tilePx + gap / 2, y = t.r * tilePx + gap / 2;
    const s = tilePx - gap;
    let color = t.t === 'ocean'
      ? ((t.c + t.r) % 2 ? TERRAIN_COLORS.ocean : TERRAIN_COLORS.ocean2)
      : TERRAIN_COLORS[t.t];
    ctx.fillStyle = color;
    rrect(x, y, s, s, rad);
    ctx.fill();

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
    if (t.t === 'forest' && !t.b) {
      ctx.font = `${Math.round(s * 0.5)}px serif`;
      ctx.fillText('🌲', x + s / 2, y + s / 2 + 1);
    }
    if (t.b) {
      ctx.font = `${Math.round(s * 0.6)}px serif`;
      ctx.fillText(TOOLS[t.b].icon, x + s / 2, y + s / 2 + 1);
    }

    // flood warning: low tiles shimmer when the next surge is near
    if (atRisk && t.elev >= 0 && t.elev < state.floodStage + 1) {
      ctx.strokeStyle = 'rgba(100,182,231,.85)';
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
  const r = rates();
  const tempEl = $('temp');
  tempEl.textContent = `+${state.temp.toFixed(2)}°`;
  tempEl.className = state.temp < 1.5 ? 'ok' : state.temp < 1.9 ? 'warn' : 'bad';
  $('tempfill').style.width = `${((state.temp - SIM.tempMin) / (SIM.tempMax - SIM.tempMin)) * 100}%`;

  $('co2').textContent = Math.round(state.co2);
  const net = r.net;
  const netEl = $('co2net');
  netEl.textContent = `${net >= 0 ? '+' : ''}${net.toFixed(1)}/turn`;
  netEl.className = 'sub ' + (net > 0 ? 'up' : 'down');

  $('money').textContent = state.money;
  $('pop').textContent = state.pop;
  $('turn').textContent = state.turn;

  $('power').textContent = `${r.power}/${r.k.towns}`;
  $('chip-power').classList.toggle('deficit', r.power < r.k.towns);
  $('food').textContent = `${r.food}/${r.k.towns}`;
  $('chip-food').classList.toggle('deficit', r.food < r.k.towns);

  for (const [key, tool] of Object.entries(TOOLS)) {
    const btn = $(`tool-${key}`);
    btn.disabled = state.money < tool.cost;
    btn.classList.toggle('sel', selectedTool === key);
  }
}

function refresh() {
  render();
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
    `Turns: ${state.turn} · Peak temp: +${state.peakTemp.toFixed(2)}° · Coal plants built: ${state.coalBuilt}`;
  $('endcontinue').classList.toggle('hidden', !won);
  $('end').classList.remove('hidden');

  if (won) {
    const best = Number(localStorage.getItem('tpBestTurns') || 0);
    if (!best || state.turn < best) localStorage.setItem('tpBestTurns', String(state.turn));
  }
}

/* ============================== input ============================== */

function buildPalette() {
  const pal = $('palette');
  pal.innerHTML = '';
  for (const [key, tool] of Object.entries(TOOLS)) {
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
  if (state.over) return;
  const t = tileFromEvent(e);
  if (!t) return;
  if (selectedTool) {
    place(selectedTool, t);
  } else if (t.t !== 'ocean') {
    const what = t.b ? TOOLS[t.b].name : t.t === 'forest' ? 'Wild forest' : t.t[0].toUpperCase() + t.t.slice(1);
    const heights = ['shore-level', 'low ground', 'high ground', 'hilltop'];
    say(`${what} — ${heights[t.elev]}.`);
    refresh();
  }
});

canvas.addEventListener('mousemove', e => {
  const t = tileFromEvent(e);
  if (t !== hover) { hover = t; render(); }
});
canvas.addEventListener('mouseleave', () => { hover = null; render(); });

$('endturn').addEventListener('click', endTurn);
$('restartbtn').addEventListener('click', newGame);
$('helpbtn').addEventListener('click', () => $('help').classList.remove('hidden'));
$('helpclose').addEventListener('click', () => {
  $('help').classList.add('hidden');
  localStorage.setItem('tpSeenHelp', '1');
});
$('endrestart').addEventListener('click', newGame);
$('endcontinue').addEventListener('click', () => $('end').classList.add('hidden'));

window.addEventListener('resize', () => { sizeCanvas(); render(); });

/* ============================== init ============================== */

sizeCanvas();
buildPalette();
newGame();
if (!localStorage.getItem('tpSeenHelp')) $('help').classList.remove('hidden');
