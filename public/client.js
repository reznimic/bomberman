'use strict';

// ===================== state =====================
const S = {
  ws: null,
  myIds: [],           // player ids controlled from this device (1 or 2)
  locals: 1,
  code: '',
  round: 0,
  wins: {},
  static: null,        // {TS,COLS,ROWS,grid,players:[{id,name,color}]}
  meta: {},            // id -> {name,color}
  cur: null,           // latest snapshot (for bombs/flames/hud/etc.)
  buf: [],             // recent player snapshots {time, players} for interpolation
  grid: null,          // live grid (mutated by tile updates)
  result: null,        // {winnerId} while scoreboard shown
};
const INTERP_DELAY = 70;   // ms rendered in the past to smooth network jitter

const EMPTY = 0, SOLID = 1, BRICK = 2;

// avatar emoji (must match constants.js AVATARS exactly)
const AVATARS = [
  '🐱', '🐶', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🐰', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦗', '🦂', '🦀', '🐍', '🐢', '🐠', '🐟', '🐡', '🐬', '🐳', '🐋', '🦈', '🐙', '🦑', '🦐', '🦞', '🦕', '🦖', '🦎', '🐲', '🦓', '🦒', '🐘', '🦏', '🦛', '🐪', '🐫', '🦙', '🦘', '🦥', '🦦', '🦔', '🐇', '🐹', '🐭',
  '👾', '🤖', '👽', '👻', '💀', '🎃', '🤡', '👹', '👺', '🧟', '🧛', '🧙', '🧞',
  '🍔', '🍕', '🌭', '🍟', '🌮', '🍩', '🍪', '🧁', '🍰', '🍦', '🍭', '🍬', '🍫', '🍿', '🥐', '🍓', '🍉', '🍒', '🍑', '🥭', '🍌', '🍍', '🥥', '🥑', '🌽', '🥕', '🍄', '🥨', '🧀',
  '💩', '⭐', '🌟', '🔥', '⚡', '🌈', '🎈', '🎩', '👑', '💎', '🚀', '🛸', '🎮', '🎲', '🎯', '🏀', '⚽', '🎸', '🥁', '💣',
];

// map list (ids must match server constants.js)
const MAP_LIST = [
  { id: 'random', name: '🎲 Náhodná' },
  { id: 'meadow', name: 'Louka' },
  { id: 'dungeon', name: 'Hradní sklepení' },
  { id: 'lava', name: 'Ohnivá jeskyně' },
  { id: 'ice', name: 'Ledová pláň' },
  { id: 'forest', name: 'Kouzelný les' },
  { id: 'space', name: 'Vesmírná loď' },
  { id: 'desert', name: 'Pouštní ruiny' },
  { id: 'candy', name: 'Cukrové království' },
  { id: 'neon', name: 'Neonová aréna' },
  { id: 'jungle', name: 'Divoká džungle' },
  { id: 'temple', name: 'Ztracený chrám' },
];

// visual themes per map
const THEMES = {
  meadow: { floorA: '#12401f', floorB: '#0f381b', solid: '#5a5a72', solidTop: '#7b7b98', brick: '#8a4a2b', brickL: '#a55c34', style: 'crate' },
  dungeon: { floorA: '#2a2836', floorB: '#232130', solid: '#4b4658', solidTop: '#655e78', brick: '#6b5a44', brickL: '#87735a', style: 'stone' },
  lava: { floorA: '#2c1512', floorB: '#241010', solid: '#3a2320', solidTop: '#5a3a30', brick: '#7a2d1a', brickL: '#b4431f', style: 'rock', glow: '#ff6a1a' },
  ice: { floorA: '#1d3b52', floorB: '#183247', solid: '#6da8c8', solidTop: '#a9dcf2', brick: '#3f7fa6', brickL: '#5aa6cc', style: 'ice' },
  forest: { floorA: '#1c3d1a', floorB: '#173316', solid: '#4a3a28', solidTop: '#6b5238', brick: '#2f6b2a', brickL: '#3f8a36', style: 'bush' },
  space: { floorA: '#151a2e', floorB: '#111527', solid: '#39415e', solidTop: '#565f82', brick: '#404a6b', brickL: '#586690', style: 'tech', glow: '#4ad7ff' },
  desert: { floorA: '#5a4a2a', floorB: '#4f4126', solid: '#8a7248', solidTop: '#ad9160', brick: '#a5793f', brickL: '#c79a55', style: 'stone' },
  candy: { floorA: '#5a2a4a', floorB: '#4f2542', solid: '#c86aa0', solidTop: '#f2a9d0', brick: '#e05a8a', brickL: '#ff86b3', style: 'candy' },
  neon: { floorA: '#0d1424', floorB: '#0a1020', solid: '#1b2b4a', solidTop: '#2a4a7a', brick: '#16324f', brickL: '#1f4a72', style: 'tech', glow: '#3df0ff' },
  jungle: { floorA: '#1a3a12', floorB: '#15330f', solid: '#3a2a18', solidTop: '#5a4028', brick: '#256b1e', brickL: '#379a2a', style: 'bush' },
  temple: { floorA: '#4a4230', floorB: '#413a2a', solid: '#7a6a48', solidTop: '#9a8560', brick: '#8a7248', brickL: '#a88f5a', style: 'stone' },
};
function theme() { return THEMES[(S.static && S.static.map)] || THEMES.meadow; }

// ===================== screens =====================
const screens = {
  join: document.getElementById('screen-join'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
};
function show(name) {
  for (const k in screens) screens[k].classList.toggle('active', k === name);
}

// ===================== networking =====================
function connect(payload) {
  if (S.ws) { try { S.ws.onclose = null; S.ws.close(); } catch { /* ignore */ } }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  S.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', ...payload }));
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => showJoinError('Spojení se serverem se ztratilo. Načti stránku znovu.');
  ws.onerror = () => showJoinError('Nepodařilo se připojit k serveru.');
}
function send(msg) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

function handle(m) {
  switch (m.t) {
    case 'joined':
      S.myIds = m.ids; S.code = m.code;
      document.getElementById('lobby-code').textContent = m.code;
      renderLegend();
      show('lobby');
      break;
    case 'full':
      showJoinError('Místnost je plná (max 8 hráčů).');
      break;
    case 'lobby':
      S.wins = {}; m.players.forEach(p => { S.wins[p.id] = p.wins; });
      S.hostId = m.hostId;
      renderLobby(m.players);
      if (m.settings) applySettings(m.settings);
      if (m.state === 'lobby') { show('lobby'); S.result = null; }
      break;
    case 'round':
      startRound(m);
      break;
    case 'state':
      onState(m);
      break;
    case 'result':
      S.wins = m.wins; S.result = { winnerId: m.winnerId };
      showResult(m.winnerId);
      break;
    case 'countdown':
      showCountdown(m.n);
      break;
    case 'nameTaken':
      showJoinError(`Jméno „${m.name}" patří registrovanému hráči. Přihlas se, nebo zvol jiné.`);
      break;
    case 'wrongPassword':
      showJoinError('Špatné heslo místnosti.');
      break;
    case 'stats':
      account.name = m.name; account.stats = m.stats;
      if (!document.getElementById('stats-modal').hidden) renderStats(account.stats);
      break;
  }
}

// ===================== lobby =====================
const HOST_CTRLS = ['sel-map', 'sel-size', 'sel-time', 'chk-teleports', 'sel-powerups', 'sel-bot', 'sel-bot-count', 'add-bot'];
function renderLobby(players) {
  const amHost = S.myIds.includes(S.hostId);
  document.getElementById('lobby-num').textContent = players.length;
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    li.className = 'player-chip' + (p.bot ? ' bot' : '');
    const crown = p.id === S.hostId ? '👑 ' : '';
    li.innerHTML = `<span class="dot" style="background:${p.color};color:${p.color}"></span>
      <span class="pav">${p.avatar || ''}</span>
      <span class="pname">${crown}${escapeHtml(p.name)}</span>
      ${p.bot ? `<button class="premove" data-id="${p.id}" title="Odebrat bota" ${amHost ? '' : 'disabled'}>✕</button>`
              : `<span class="pwins">${p.wins}×</span>`}`;
    list.appendChild(li);
  }
  if (amHost) {
    list.querySelectorAll('.premove').forEach(b =>
      b.addEventListener('click', () => send({ t: 'removeBot', id: +b.dataset.id })));
  }
  // only the host controls settings + start
  for (const id of HOST_CTRLS) { const el = document.getElementById(id); if (el) el.disabled = !amHost; }
  const btn = document.getElementById('start-btn');
  const ok = players.length >= 2;
  if (!amHost) {
    btn.disabled = true;
    btn.textContent = 'Hru spustí host 👑';
  } else {
    btn.disabled = !ok;
    btn.textContent = ok ? 'Spustit hru' : 'Spustit hru (přidej hráče nebo bota)';
  }
}

// Lobby legend showing this device's actual (possibly custom) keys.
function renderLegend() {
  const grid = document.getElementById('legend-grid');
  if (!grid || !S.bindings) return;
  let html = '';
  for (let slot = 0; slot < S.locals; slot++) {
    const b = S.bindings[slot];
    html += `<div class="legend-card">
      <div class="legend-title">Hráč ${slot + 1}</div>
      <div class="keys">
        <kbd>${keyLabel(b.up)}</kbd><kbd>${keyLabel(b.left)}</kbd><kbd>${keyLabel(b.down)}</kbd><kbd>${keyLabel(b.right)}</kbd> pohyb
        · <kbd>${keyLabel(b.bomb)}</kbd> bomba · <kbd>${keyLabel(b.detonate)}</kbd> odpal
      </div></div>`;
  }
  grid.innerHTML = html;
}

// ===================== round setup =====================
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
// offscreen canvas caching the static background (floor + walls + bricks);
// re-rendered only when tiles change, so we don't redraw ~hundreds of tiles every frame
const bg = document.createElement('canvas');
const bgCtx = bg.getContext('2d');
let TS = 48, COLS = 17, ROWS = 13;

function startRound(m) {
  S.static = m;
  S.round = m.round;
  S.wins = m.wins;
  S.meta = {};
  m.players.forEach(p => { S.meta[p.id] = { name: p.name, color: p.color, avatar: p.avatar || '🙂' }; });
  TS = m.TS; COLS = m.COLS; ROWS = m.ROWS;
  S.grid = m.grid.map(row => row.slice());
  S.cur = null;
  S.buf = [];
  S.result = null;
  S.sdWalls = new Set();
  S.falling = [];
  canvas.width = COLS * TS;
  canvas.height = ROWS * TS;
  renderBackground();
  document.getElementById('overlay').hidden = true;
  show('game');
  // size the canvas only after the game screen is actually visible (has real dimensions)
  fitCanvas();
  requestAnimationFrame(fitCanvas);
}

function onState(m) {
  // apply tile updates (destroyed bricks -> empty, sudden-death walls -> solid)
  if (m.tiles) for (const u of m.tiles) {
    if (!S.grid) continue;
    S.grid[u.row][u.col] = u.v;
    if (u.v === SOLID) {
      S.sdWalls.add(u.col + ',' + u.row);
      S.falling.push({ col: u.col, row: u.row, t: 0 });
    }
    updateBgCell(u.col, u.row);
  }
  // sound events
  if (m.events) for (const e of m.events) onEvent(e);
  S.cur = m;
  // buffer player positions with arrival time so we can render slightly in the past,
  // which absorbs network jitter (a late packet no longer freezes/jumps the game)
  S.buf.push({ time: performance.now(), players: m.players, hunter: m.hunter || null });
  if (S.buf.length > 24) S.buf.shift();
}

// ===================== key bindings =====================
const ACTS = [['up', 'Nahoru', '↑'], ['left', 'Vlevo', '←'], ['down', 'Dolů', '↓'], ['right', 'Vpravo', '→'], ['bomb', 'Bomba', '💣'], ['detonate', 'Odpal', '💥']];
const KEYLABELS = {
  Space: 'Mezerník', Enter: 'Enter', Tab: 'Tab',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: '⇧ L', ShiftRight: '⇧ R', ControlLeft: 'Ctrl L', ControlRight: 'Ctrl R',
  AltLeft: 'Alt L', AltRight: 'Alt R', Backquote: '`', Comma: ',', Period: '.', Slash: '/',
};
function keyLabel(code) {
  if (!code) return '—';
  if (KEYLABELS[code]) return KEYLABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
function defaultBindings(locals) {
  if (locals === 2) {
    return {
      0: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', bomb: 'Space', detonate: 'KeyQ' },
      1: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', bomb: 'Enter', detonate: 'ShiftRight' },
    };
  }
  // single player on this computer -> arrows by default
  return { 0: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', bomb: 'Space', detonate: 'Enter' } };
}

let keyStore = { 1: defaultBindings(1), 2: defaultBindings(2) };
try {
  const saved = JSON.parse(localStorage.getItem('bmb-keys'));
  if (saved && saved[1] && saved[2]) keyStore = saved;
} catch { /* ignore */ }
function saveKeys() { try { localStorage.setItem('bmb-keys', JSON.stringify(keyStore)); } catch { /* ignore */ } }

const pressed = new Set();
const lastSent = [{}, {}];
let ALL_CODES = new Set();

function recomputeCodes() {
  ALL_CODES = new Set();
  if (!S.bindings) return;
  for (const slot of Object.keys(S.bindings)) for (const c of Object.values(S.bindings[slot])) ALL_CODES.add(c);
}
function readInput(slot) {
  const km = S.bindings[slot];
  return {
    up: pressed.has(km.up), down: pressed.has(km.down),
    left: pressed.has(km.left), right: pressed.has(km.right),
    bomb: pressed.has(km.bomb), detonate: pressed.has(km.detonate),
  };
}
function pushInputs() {
  for (let slot = 0; slot < S.locals; slot++) {
    const inp = readInput(slot);
    const last = lastSent[slot];
    if (inp.up !== last.up || inp.down !== last.down || inp.left !== last.left ||
        inp.right !== last.right || inp.bomb !== last.bomb || inp.detonate !== last.detonate) {
      lastSent[slot] = inp;
      send({ t: 'input', slot, input: inp });
    }
  }
}

function typingInField() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// rebind state
let rebind = null; // {slot, act, btn}

window.addEventListener('keydown', (e) => {
  // 1) capturing a key for rebinding
  if (rebind) {
    e.preventDefault();
    if (e.code !== 'Escape') {
      keyStore[selectedLocals()][rebind.slot][rebind.act] = e.code;
      saveKeys();
    }
    const btn = rebind.btn; rebind = null;
    btn.classList.remove('listening');
    renderKeysConfig();
    return;
  }
  // 2) game input only while playing and not typing into a field
  if (!screens.game.classList.contains('active') || typingInField()) return;
  if (ALL_CODES.has(e.code)) {
    e.preventDefault();
    if (!pressed.has(e.code)) { pressed.add(e.code); pushInputs(); }
  }
});
window.addEventListener('keyup', (e) => {
  if (pressed.delete(e.code)) pushInputs();
});
window.addEventListener('blur', () => { pressed.clear(); pushInputs(); });

// ---- key config UI (join screen) ----
function selectedLocals() {
  const el = document.querySelector('input[name=locals]:checked');
  return el ? +el.value : 1;
}
function renderKeysConfig() {
  const wrap = document.getElementById('keys-config');
  if (!wrap) return;
  const locals = selectedLocals();
  const binds = keyStore[locals];
  let html = '';
  for (let slot = 0; slot < locals; slot++) {
    html += `<div class="kb-slot"><div class="kb-title">Hráč ${slot + 1} — klikni a stiskni klávesu</div><div class="kb-keys">`;
    for (const [act, label] of ACTS) {
      html += `<button type="button" class="kb" data-slot="${slot}" data-act="${act}">
        <small>${label}</small><b>${keyLabel(binds[slot][act])}</b></button>`;
    }
    html += `</div></div>`;
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll('.kb').forEach(btn => btn.addEventListener('click', () => {
    if (rebind) { rebind.btn.classList.remove('listening'); }
    rebind = { slot: +btn.dataset.slot, act: btn.dataset.act, btn };
    btn.classList.add('listening');
    btn.querySelector('b').textContent = '…';
  }));
}


// ===================== touch controls (mobile / tablet) =====================
// The play area is split by an X into 4 zones; tap/hold a zone to move that way.
// A quick double-tap drops a bomb, a triple-tap detonates (remote). Controls player 0.
function setupTouch() {
  if (!('ontouchstart' in window)) return;
  const stage = document.getElementById('stage');
  const cross = document.getElementById('touch-cross');
  if (cross) cross.hidden = false;
  let curDir = null, downT = 0, downX = 0, downY = 0, moved = false, taps = 0, tapTimer = null;
  const km = () => (S.bindings && S.bindings[0]);

  function regionDir(t) {
    const rect = stage.getBoundingClientRect();
    const dx = t.clientX - (rect.left + rect.width / 2);
    const dy = t.clientY - (rect.top + rect.height / 2);
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
  function press(dir) {
    const b = km(); if (!b || dir === curDir) return;
    if (curDir) pressed.delete(b[curDir]);
    curDir = dir; pressed.add(b[dir]); pushInputs();
  }
  function releaseDir() {
    const b = km();
    if (curDir && b) { pressed.delete(b[curDir]); pushInputs(); }
    curDir = null;
  }
  function tapAction(act) {
    const b = km(); if (!b) return;
    pressed.add(b[act]); pushInputs();
    setTimeout(() => { if (pressed.delete(b[act])) pushInputs(); }, 80);
  }
  stage.addEventListener('touchstart', (e) => {
    if (!S.static) return;
    e.preventDefault();
    const t = e.touches[0];
    downT = performance.now(); downX = t.clientX; downY = t.clientY; moved = false;
    press(regionDir(t));
  }, { passive: false });
  stage.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (Math.abs(t.clientX - downX) > 16 || Math.abs(t.clientY - downY) > 16) moved = true;
    press(regionDir(t));
  }, { passive: false });
  stage.addEventListener('touchend', (e) => {
    e.preventDefault();
    releaseDir();
    if (performance.now() - downT < 250 && !moved) {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        if (taps >= 3) tapAction('detonate');
        else if (taps === 2) tapAction('bomb');
        taps = 0;
      }, 260);
    } else taps = 0;
  }, { passive: false });
  stage.addEventListener('touchcancel', () => { releaseDir(); taps = 0; }, { passive: false });
}

// ===================== canvas sizing =====================
function fitCanvas() {
  const stage = document.getElementById('stage');
  const availW = stage.clientWidth;
  const availH = stage.clientHeight;
  if (availW <= 0 || availH <= 0 || !canvas.width || !canvas.height) return;
  const scale = Math.min(availW / canvas.width, availH / canvas.height);
  canvas.style.width = Math.floor(canvas.width * scale) + 'px';
  canvas.style.height = Math.floor(canvas.height * scale) + 'px';
}
window.addEventListener('resize', () => { if (S.static) fitCanvas(); });

// ===================== rendering =====================
function lerp(a, b, t) { return a + (b - a) * t; }

function interpPlayers() {
  const buf = S.buf;
  if (!buf || !buf.length) return S.cur ? S.cur.players : [];
  const target = performance.now() - INTERP_DELAY;
  // find the newest buffered snapshot at or before the render target
  let i = buf.length - 1;
  while (i > 0 && buf[i].time > target) i--;
  const older = buf[i];
  const newer = buf[i + 1] || older;
  const span = newer.time - older.time || 1;
  const t = Math.max(0, Math.min((target - older.time) / span, 1));
  const olderById = {};
  for (const p of older.players) olderById[p.id] = p;
  return newer.players.map(p => {
    const op = olderById[p.id];
    return { ...p, x: op ? lerp(op.x, p.x, t) : p.x, y: op ? lerp(op.y, p.y, t) : p.y };
  });
}

function interpHunter() {
  const buf = S.buf;
  if (!buf || !buf.length) return S.cur ? S.cur.hunter : null;
  const target = performance.now() - INTERP_DELAY;
  let i = buf.length - 1;
  while (i > 0 && buf[i].time > target) i--;
  const older = buf[i], newer = buf[i + 1] || older;
  if (!newer.hunter) return null;
  if (!older.hunter) return newer.hunter;
  const span = newer.time - older.time || 1;
  const t = Math.max(0, Math.min((target - older.time) / span, 1));
  return { x: lerp(older.hunter.x, newer.hunter.x, t), y: lerp(older.hunter.y, newer.hunter.y, t), dir: newer.hunter.dir };
}

function draw(now) {
  requestAnimationFrame(draw);
  if (!S.static || !S.grid) return;

  if (bg.width) ctx.drawImage(bg, 0, 0);
  else ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (S.cur) {
    if (S.cur.teleports) for (const tp of S.cur.teleports) drawTeleport(tp, now);
    for (const pu of S.cur.powerups) drawPowerup(pu);
    for (const b of S.cur.bombs) drawBomb(b, now);
    const players = interpPlayers();
    // draw by y so lower players overlap correctly
    players.sort((A, B) => A.y - B.y);
    for (const p of players) drawPlayer(p, now);
    for (const f of S.cur.flames) drawFlame(f, now);
    const hunt = interpHunter();
    if (hunt) drawHunter(hunt, now);
  }
  drawFalling(now);
  renderHud();
}

// Render the whole static background into the offscreen canvas (once per round + on tile change).
function renderBackground() {
  if (!S.grid) return;
  bg.width = canvas.width;
  bg.height = canvas.height;
  const th = theme();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) paintCell(c, r, th);
  }
}
// Repaint one cell of the background (floor + whatever tile sits on it).
function updateBgCell(c, r) {
  if (S.grid) paintCell(c, r, theme());
}
function paintCell(c, r, th) {
  bgCtx.fillStyle = (r + c) % 2 === 0 ? th.floorA : th.floorB;
  bgCtx.fillRect(c * TS, r * TS, TS, TS);
  const v = S.grid[r][c];
  if (v === SOLID) drawSolid(bgCtx, c, r, th, S.sdWalls && S.sdWalls.has(c + ',' + r));
  else if (v === BRICK) drawBrick(bgCtx, c, r, th);
}

function drawSolid(g, c, r, th, isWall) {
  const x = c * TS, y = r * TS;
  if (isWall) {
    g.fillStyle = '#b6241a'; g.fillRect(x, y, TS, TS);
    g.fillStyle = '#e6394a'; g.fillRect(x + 3, y + 3, TS - 6, TS - 10);
    g.fillStyle = '#7a140d'; g.fillRect(x + 3, y + TS - 8, TS - 6, 5);
    g.strokeStyle = '#ffd94d'; g.lineWidth = 2; g.strokeRect(x + 4, y + 4, TS - 8, TS - 8);
    g.fillStyle = '#ffd94d'; g.font = `${Math.floor(TS * 0.5)}px serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('☠', x + TS / 2, y + TS / 2 + 1);
    return;
  }
  g.fillStyle = th.solid; g.fillRect(x, y, TS, TS);
  g.fillStyle = th.solidTop; g.fillRect(x + 3, y + 3, TS - 6, TS - 10);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + 3, y + TS - 8, TS - 6, 5);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, TS - 2, TS - 2);
  if (th.glow) { g.strokeStyle = th.glow; g.globalAlpha = .5; g.strokeRect(x + 5, y + 5, TS - 10, TS - 14); g.globalAlpha = 1; }
}

function drawBrick(g, c, r, th) {
  const x = c * TS, y = r * TS;
  g.fillStyle = th.brick; roundRectFill(g, x + 1, y + 1, TS - 2, TS - 2, 4);
  g.fillStyle = th.brickL;
  const s = th.style;
  if (s === 'crate' || s === 'stone') {
    const bh = (TS - 8) / 3;
    for (let i = 0; i < 3; i++) {
      const off = i % 2 ? TS / 2 : 0;
      g.fillRect(x + 4 - (i % 2 ? TS / 2 - 4 : 0) + off, y + 3 + i * (bh + 1), TS / 2 - 5, bh);
      g.fillRect(x + 3 + (i % 2 ? TS / 2 : TS / 2 - 1), y + 3 + i * (bh + 1), TS / 2 - 5, bh);
    }
  } else if (s === 'bush') {
    for (const [dx, dy] of [[0.3, 0.35], [0.7, 0.35], [0.5, 0.6], [0.3, 0.7], [0.7, 0.7]]) {
      g.beginPath(); g.arc(x + TS * dx, y + TS * dy, TS * 0.16, 0, 7); g.fill();
    }
  } else if (s === 'candy') {
    for (let i = 0; i < 4; i++) g.fillRect(x + 4 + i * 11, y + 2, 6, TS - 4);   // stripes kept inside the tile
  } else if (s === 'ice') {
    g.globalAlpha = .6; g.beginPath(); g.moveTo(x + 6, y + 4); g.lineTo(x + TS - 6, y + 10); g.lineTo(x + TS - 10, y + TS - 6); g.lineTo(x + 8, y + TS - 10); g.closePath(); g.fill(); g.globalAlpha = 1;
  } else if (s === 'tech') {
    g.fillRect(x + 5, y + 8, TS - 10, 3); g.fillRect(x + 5, y + TS - 12, TS - 10, 3);
    g.fillStyle = th.glow || '#4ad7ff'; g.fillRect(x + TS / 2 - 2, y + 6, 4, TS - 12);
  } else if (s === 'rock') {
    g.beginPath(); g.arc(x + TS / 2, y + TS / 2, TS * 0.28, 0, 7); g.fill();
    if (th.glow) { g.strokeStyle = th.glow; g.lineWidth = 2; g.globalAlpha = .55; g.beginPath(); g.moveTo(x + 8, y + TS - 10); g.lineTo(x + TS / 2, y + 12); g.stroke(); g.globalAlpha = 1; }
  }
  g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(x + 2, y + 2, TS - 4, 3);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 2, y + TS - 4, TS - 4, 3);
}

function drawFalling(now) {
  if (!S.falling || !S.falling.length) return;
  const th = theme();
  S.falling = S.falling.filter(f => f.t < 1);
  for (const f of S.falling) {
    f.t += 0.08;
    const drop = (1 - Math.min(f.t, 1)) * TS * 3;
    const x = f.col * TS, y = f.row * TS - drop;
    ctx.save(); ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#e6394a'; ctx.fillRect(x + 2, y + 2, TS - 4, TS - 4);
    ctx.restore();
  }
}

function drawBomb(b, now) {
  const pulse = 1 + 0.12 * Math.sin(now / 90) * (b.fuse < 1 ? 2 : 1);
  const rad = (TS * 0.34) * pulse;
  const x = b.x, y = b.y;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(x, y + TS * 0.28, rad * 0.9, rad * 0.4, 0, 0, 7); ctx.fill();
  // body
  const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.4, rad * 0.2, x, y, rad);
  g.addColorStop(0, '#5a5a6b'); g.addColorStop(0.4, '#1c1c26'); g.addColorStop(1, '#050509');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.beginPath(); ctx.arc(x - rad * 0.35, y - rad * 0.4, rad * 0.18, 0, 7); ctx.fill();
  if (b.remote) {
    // remote-controlled bomb: straight antenna + steady blinking light
    ctx.strokeStyle = '#8a8aa0'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y - rad * 0.6); ctx.lineTo(x, y - rad * 1.7); ctx.stroke();
    const on = Math.floor(now / 300) % 2 === 0;
    ctx.fillStyle = on ? '#ff4d4d' : '#7a1414';
    ctx.beginPath(); ctx.arc(x, y - rad * 1.75, 4, 0, 7); ctx.fill();
    if (on) { ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(x, y - rad * 1.75, 8, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  } else {
    // fuse + spark
    ctx.strokeStyle = '#caa06a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + rad * 0.4, y - rad * 0.7); ctx.quadraticCurveTo(x + rad, y - rad * 1.3, x + rad * 0.7, y - rad * 1.6); ctx.stroke();
    const sparkOn = Math.floor(now / 80) % 2 === 0;
    ctx.fillStyle = sparkOn ? '#ffe14d' : '#ff7a1a';
    ctx.beginPath(); ctx.arc(x + rad * 0.7, y - rad * 1.6, sparkOn ? 4 : 3, 0, 7); ctx.fill();
  }
}

function drawFlame(f, now) {
  const cx = f.col * TS + TS / 2, cy = f.row * TS + TS / 2;
  const k = Math.min(f.life / 0.48, 1);          // 1 -> fresh, 0 -> gone
  const grow = f.life > 0.4 ? (0.48 - f.life) / 0.08 : 1;
  const half = (TS / 2) * Math.min(grow, 1) * (0.75 + 0.25 * k);
  const horiz = f.type === 'h' || f.type === 'tipL' || f.type === 'tipR' || f.type === 'center';
  const vert = f.type === 'v' || f.type === 'tipU' || f.type === 'tipD' || f.type === 'center';
  ctx.save();
  ctx.globalAlpha = 0.85 * (0.4 + 0.6 * k);
  const layers = [
    { col: '#ff5a1a', w: half * 2 },
    { col: '#ffb020', w: half * 1.5 },
    { col: '#ffef8f', w: half * 0.9 },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.col;
    if (horiz) roundRectFill(ctx, cx - half, cy - L.w / 2, half * 2, L.w, L.w / 2);
    if (vert) roundRectFill(ctx, cx - L.w / 2, cy - half, L.w, half * 2, L.w / 2);
  }
  ctx.restore();
}
function roundRectFill(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.fill();
}

function drawTeleport(tp, now) {
  const cx = tp.col * TS + TS / 2, cy = tp.row * TS + TS / 2;
  const blink = tp.life < 1 ? (Math.floor(now / 120) % 2 === 0 ? 0.35 : 1) : 1;
  const rot = now / 300;
  ctx.save();
  ctx.globalAlpha = blink;
  // glowing disc
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, TS * 0.42);
  g.addColorStop(0, 'rgba(180,120,255,.9)');
  g.addColorStop(0.6, 'rgba(90,60,220,.5)');
  g.addColorStop(1, 'rgba(40,20,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, TS * 0.42, 0, 7); ctx.fill();
  // swirling arms
  ctx.strokeStyle = '#d9b3ff'; ctx.lineWidth = Math.max(2, TS * 0.05);
  for (let a = 0; a < 3; a++) {
    ctx.beginPath();
    for (let t = 0; t < 1; t += 0.1) {
      const ang = rot + a * (Math.PI * 2 / 3) + t * 4;
      const rr = t * TS * 0.34;
      const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
      if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, TS * 0.06, 0, 7); ctx.fill();
  ctx.restore();
}

function drawHunter(h, now) {
  const x = h.x, y = h.y, r = TS * 0.46;
  const face = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[h.dir] || 0;
  const mouth = 0.06 + 0.33 * Math.abs(Math.sin(now / 70)); // chomp
  ctx.save();
  // menacing glow
  ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 16;
  // body
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
  g.addColorStop(0, '#ffe14d'); g.addColorStop(1, '#f0a800');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, face + mouth * Math.PI, face + (2 - mouth) * Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(120,60,0,.6)'; ctx.lineWidth = 2; ctx.stroke();
  // angry eye (offset perpendicular to facing)
  const ex = x + Math.cos(face - Math.PI / 2) * r * 0.35;
  const ey = y + Math.sin(face - Math.PI / 2) * r * 0.35 - r * 0.15;
  ctx.fillStyle = '#1a1030';
  ctx.beginPath(); ctx.arc(ex, ey, r * 0.13, 0, 7); ctx.fill();
  ctx.restore();
}

const PU_ICON = { bomb: '💣', fire: '🔥', speed: '⚡', kick: '🦶', remote: '🎮' };
const PU_TINT = { bomb: '#ff5a3c', fire: '#ff8c1a', speed: '#2f9be0', kick: '#37c26b', remote: '#a259e6' };
function drawPowerup(pu) {
  const cx = pu.col * TS + TS / 2;
  const cy = pu.row * TS + TS / 2 + Math.sin(performance.now() / 350 + pu.col + pu.row) * 2;
  const r = TS * 0.38;
  // pulsing glow so it clearly reads as a pickup
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250 + pu.col);
  ctx.save();
  // blink faster as it is about to vanish
  if (pu.life != null && pu.life < 2 && Math.floor(performance.now() / (pu.life < 1 ? 120 : 240)) % 2 === 0) {
    ctx.restore();
    return;
  }
  ctx.globalAlpha = 0.5 * pulse;
  ctx.fillStyle = PU_TINT[pu.type] || '#ffd94d';
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.35, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
  // solid golden badge
  const g = ctx.createRadialGradient(cx, cy - r * 0.4, 2, cx, cy, r);
  g.addColorStop(0, '#fff6cf'); g.addColorStop(1, '#eaa413');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.lineWidth = Math.max(2, TS * 0.06); ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.lineWidth = Math.max(1, TS * 0.03); ctx.strokeStyle = '#a5540b';
  ctx.beginPath(); ctx.arc(cx, cy, r + ctx.lineWidth, 0, 7); ctx.stroke();
  // icon (solid fill so it shows even where emoji render monochrome)
  ctx.fillStyle = '#3a0d06';
  ctx.font = `${Math.floor(TS * 0.5)}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(PU_ICON[pu.type] || '?', cx, cy + 1);
  ctx.restore();
}

function drawPlayer(p, now) {
  const meta = S.meta[p.id] || { color: '#fff', name: '?', avatar: '🙂' };
  if (!p.alive) { drawGhost(p, meta); return; }
  const x = p.x, y = p.y;
  const bob = p.moving ? Math.sin(now / 70) * 2 : 0;
  const bodyR = TS * 0.32;
  const cy = y + bob;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(x, y + TS * 0.32, bodyR * 0.95, bodyR * 0.4, 0, 0, 7); ctx.fill();
  // feet (walk animation)
  ctx.fillStyle = shade(meta.color, -0.35);
  const fw = bodyR * 0.5, spread = p.moving ? Math.sin(now / 70) * 3 : 0;
  ctx.fillRect(x - fw - 1 + spread, y + TS * 0.16, fw, bodyR * 0.5);
  ctx.fillRect(x + 1 - spread, y + TS * 0.16, fw, bodyR * 0.5);
  // coloured disc = player identity
  const g = ctx.createRadialGradient(x - bodyR * 0.3, cy - bodyR * 0.4, bodyR * 0.2, x, cy, bodyR * 1.2);
  g.addColorStop(0, shade(meta.color, 0.4)); g.addColorStop(1, meta.color);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, cy, bodyR, 0, 7); ctx.fill();
  ctx.strokeStyle = shade(meta.color, -0.4); ctx.lineWidth = 2.5; ctx.stroke();
  // avatar emoji on top (skip for the plain/default avatar).
  // Use an emoji-capable font + a solid fill: on some platforms a canvas emoji is
  // drawn as a monochrome glyph that would otherwise inherit the disc gradient and vanish.
  if (meta.avatar) {
    ctx.font = `${Math.floor(bodyR * 1.55)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#181022';
    ctx.fillText(meta.avatar, x, cy + 1);
  }
  // name tag, above the head so it never covers the avatar
  ctx.font = `bold ${Math.floor(TS * 0.24)}px ${getFont()}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const tw = ctx.measureText(meta.name).width;
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  roundRectFill(ctx, x - tw / 2 - 5, y - TS * 0.78, tw + 10, TS * 0.28, 5);
  ctx.fillStyle = '#fff';
  ctx.fillText(meta.name, x, y - TS * 0.54);
}

function drawTopper(shape, x, cy, r, color) {
  const top = cy - r;                 // top of the head
  const dark = shade(color, -0.4);
  ctx.save();
  ctx.lineJoin = 'round';
  if (shape === 0) {                  // antenna + bobble
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.beginPath(); ctx.moveTo(x, top + 2); ctx.lineTo(x, top - r * 0.5); ctx.stroke();
    ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(x, top - r * 0.55, r * 0.2, 0, 7); ctx.fill();
  } else if (shape === 1) {           // cat ears
    ctx.fillStyle = dark;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + s * r * 0.5, top + r * 0.25); ctx.lineTo(x + s * r * 0.78, top - r * 0.45); ctx.lineTo(x + s * r * 0.12, top - r * 0.02); ctx.closePath(); ctx.fill(); }
  } else if (shape === 2) {           // mohawk
    ctx.fillStyle = dark;
    for (let i = -2; i <= 2; i++) { const sx = x + i * r * 0.24, h = r * (0.55 - Math.abs(i) * 0.08); ctx.beginPath(); ctx.moveTo(sx - r * 0.1, top + 2); ctx.lineTo(sx, top - h); ctx.lineTo(sx + r * 0.1, top + 2); ctx.closePath(); ctx.fill(); }
  } else if (shape === 3) {           // horns
    ctx.fillStyle = '#f3ede0';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + s * r * 0.55, top + r * 0.1); ctx.quadraticCurveTo(x + s * r * 0.95, top - r * 0.3, x + s * r * 0.6, top - r * 0.62); ctx.quadraticCurveTo(x + s * r * 0.72, top - r * 0.2, x + s * r * 0.35, top + r * 0.05); ctx.closePath(); ctx.fill(); }
  } else if (shape === 4) {           // crown
    ctx.fillStyle = '#ffd94d'; ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, top + r * 0.18); ctx.lineTo(x - r * 0.6, top - r * 0.15); ctx.lineTo(x - r * 0.3, top + r * 0.05);
    ctx.lineTo(x, top - r * 0.4); ctx.lineTo(x + r * 0.3, top + r * 0.05); ctx.lineTo(x + r * 0.6, top - r * 0.15); ctx.lineTo(x + r * 0.6, top + r * 0.18);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (shape === 5) {           // cap
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(x, top + r * 0.2, r * 0.7, Math.PI, 2 * Math.PI); ctx.fill();
    ctx.fillRect(x - r * 0.05, top + r * 0.12, r * 0.95, r * 0.16);
  } else if (shape === 6) {           // bow
    ctx.fillStyle = '#ec5fbd';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + s * r * 0.55, top - r * 0.3); ctx.lineTo(x + s * r * 0.55, top + r * 0.3); ctx.closePath(); ctx.fill(); }
    ctx.beginPath(); ctx.arc(x, top, r * 0.15, 0, 7); ctx.fill();
  } else {                            // halo
    ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.beginPath(); ctx.ellipse(x, top - r * 0.35, r * 0.5, r * 0.2, 0, 0, 7); ctx.stroke();
  }
  ctx.restore();
}

function drawFace(x, cy, r, dir) {
  ctx.fillStyle = '#f3f0ff';
  if (dir === 'left' || dir === 'right') {
    const dx = dir === 'right' ? 1 : -1;
    ctx.beginPath(); ctx.arc(x + dx * r * 0.35, cy + r * 0.05, r * 0.24, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a1030';
    ctx.beginPath(); ctx.arc(x + dx * r * 0.45, cy + r * 0.05, r * 0.11, 0, 7); ctx.fill();
  } else if (dir === 'up') {
    ctx.fillStyle = shade('#f3f0ff', -0.1);
    ctx.beginPath(); ctx.arc(x, cy - r * 0.1, r * 0.5, Math.PI, 2 * Math.PI); ctx.fill();
  } else {
    // down (default)
    for (const dx of [-1, 1]) {
      ctx.fillStyle = '#f3f0ff';
      ctx.beginPath(); ctx.arc(x + dx * r * 0.35, cy + r * 0.05, r * 0.22, 0, 7); ctx.fill();
      ctx.fillStyle = '#1a1030';
      ctx.beginPath(); ctx.arc(x + dx * r * 0.35, cy + r * 0.1, r * 0.1, 0, 7); ctx.fill();
    }
  }
}

function drawGhost(p, meta) {
  const t = performance.now() / 300;
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.1 * Math.sin(t);
  ctx.fillStyle = meta.color;
  const x = p.x, y = p.y - 4 + Math.sin(t) * 3, r = TS * 0.28;
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, 2 * Math.PI);
  ctx.lineTo(x + r, y + r);
  for (let i = 0; i < 4; i++) ctx.lineTo(x + r - (i + 0.5) * (r / 2), y + r + (i % 2 ? -4 : 4));
  ctx.lineTo(x - r, y + r);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1030';
  ctx.beginPath(); ctx.arc(x - r * 0.35, y, r * 0.12, 0, 7); ctx.arc(x + r * 0.35, y, r * 0.12, 0, 7); ctx.fill();
  ctx.restore();
}

// ===================== HUD =====================
function renderHud() {
  const hud = document.getElementById('hud');
  const byId = {};
  if (S.cur) for (const p of S.cur.players) byId[p.id] = p;
  let html = '';
  const ids = S.static.players.map(p => p.id);
  for (const id of ids) {
    const meta = S.meta[id]; const st = byId[id];
    const dead = st && !st.alive;
    html += `<div class="hud-card${dead ? ' dead' : ''}">
      <span class="dot" style="background:${meta.color};color:${meta.color}"></span>
      <span class="hname">${escapeHtml(meta.name)}</span>
      <span class="hwins">🏆 ${S.wins[id] || 0}</span>
      ${st && st.alive ? `<span class="hstats">💣${st.bombs} 🔥${st.range}${st.kick ? ' 🦶' : ''}${st.remote ? ' 🎮' : ''}</span>`
        : (dead ? '<span class="hstats">☠</span>' : '')}
    </div>`;
  }
  html += `<div class="hud-card"><span class="hstats">Kolo ${S.round} · ${escapeHtml(S.code)}</span></div>`;
  // timer / sudden death
  if (S.cur && S.cur.timeLimit > 0) {
    if (S.cur.sd) {
      html += `<div class="hud-card sd">👾 LOVEC!</div>`;
    } else {
      const left = Math.max(0, Math.ceil(S.cur.timeLimit - S.cur.time));
      const mm = Math.floor(left / 60), ss = left % 60;
      html += `<div class="hud-card timer${left <= 15 ? ' low' : ''}">⏱ ${mm}:${String(ss).padStart(2, '0')}</div>`;
    }
  }
  hud.innerHTML = html;
}

function showResult(winnerId) {
  const ov = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const sub = document.getElementById('overlay-sub');
  if (winnerId != null && S.meta[winnerId]) {
    title.textContent = `${S.meta[winnerId].name} vyhrává!`;
    title.style.color = S.meta[winnerId].color;
  } else {
    title.textContent = 'Remíza!';
    title.style.color = '';
  }
  sub.textContent = 'Další kolo za chvíli…';
  ov.hidden = false;
}

function showCountdown(n) {
  const ov = document.getElementById('overlay');
  ov.hidden = false;
  document.getElementById('overlay-sub').innerHTML = `Další kolo za <span class="cd">${n}</span>`;
  Sound.tick();
}

// ===================== sound =====================
const Sound = (() => {
  let ac = null, muted = false;
  function ctx() { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); return ac; }
  function tone(freq, dur, type, vol) {
    if (muted) return;
    const a = ctx(); const o = a.createOscillator(); const g = a.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  function noise(dur, vol) {
    if (muted) return;
    const a = ctx(); const n = a.sampleRate * dur;
    const buf = a.createBuffer(1, n, a.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource(); src.buffer = buf;
    const g = a.createGain(); g.gain.value = vol || 0.3;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
  }
  return {
    boom() { noise(0.4, 0.35); tone(70, 0.3, 'sawtooth', 0.2); },
    pickup() { tone(880, 0.08, 'square', 0.12); setTimeout(() => tone(1320, 0.1, 'square', 0.12), 70); },
    death() { tone(400, 0.15, 'sawtooth', 0.2); setTimeout(() => tone(180, 0.3, 'sawtooth', 0.2), 120); },
    wall() { noise(0.12, 0.25); tone(120, 0.08, 'square', 0.12); },
    alarm() { tone(660, 0.12, 'square', 0.18); setTimeout(() => tone(660, 0.12, 'square', 0.18), 200); },
    warp() { tone(500, 0.12, 'sine', 0.15); setTimeout(() => tone(1000, 0.14, 'sine', 0.15), 60); setTimeout(() => tone(1600, 0.1, 'sine', 0.12), 130); },
    chomp() { tone(300, 0.09, 'square', 0.2); setTimeout(() => tone(180, 0.12, 'square', 0.2), 90); },
    tick() { tone(880, 0.08, 'sine', 0.14); },
    toggle() { muted = !muted; return muted; },
    resume() { try { ctx().resume(); } catch {} },
  };
})();

function onEvent(e) {
  if (e.e === 'boom') Sound.boom();
  else if (e.e === 'pickup') Sound.pickup();
  else if (e.e === 'death') Sound.death();
  else if (e.e === 'wall') Sound.wall();
  else if (e.e === 'sd') Sound.alarm();
  else if (e.e === 'teleport') Sound.warp();
  else if (e.e === 'eat') Sound.chomp();
}

document.getElementById('mute-btn').addEventListener('click', (ev) => {
  const muted = Sound.toggle();
  ev.currentTarget.textContent = muted ? '🔇' : '🔊';
});

// fullscreen: show only the game (no browser chrome). Robust across vendors.
function currentFsEl() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
}
function reqFullscreen(el) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  return fn ? fn.call(el) : null;   // null => this browser can't fullscreen an element (iOS Safari)
}
function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (fn) fn.call(document);
}
function toggleFullscreen() {
  if (currentFsEl()) { try { exitFullscreen(); } catch { /* ignore */ } return; }
  let p = null;
  try { p = reqFullscreen(document.getElementById('screen-game')); } catch { p = null; }
  if (p === null) {
    toast('Tenhle prohlížeč celou obrazovku nepovolí. Na iPadu/iPhonu dej Sdílet → „Přidat na plochu" a hru spusť odtud — poběží bez lišty.');
    return;
  }
  Promise.resolve(p).catch(() => { try { reqFullscreen(document.documentElement); } catch { /* ignore */ } });
}
document.getElementById('fs-btn').addEventListener('click', toggleFullscreen);
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(ev, () => { if (S.static) setTimeout(fitCanvas, 60); });
}

// leave the room / round and return to the main menu
function leaveRoom() {
  if (S.ws) { try { S.ws.onclose = null; S.ws.close(); } catch { /* ignore */ } S.ws = null; }
  if (currentFsEl()) { try { exitFullscreen(); } catch { /* ignore */ } }
  S.static = null; S.grid = null; S.cur = null; S.buf = [];
  document.getElementById('overlay').hidden = true;
  show('join');
  refreshRooms();
}
document.getElementById('leave-btn').addEventListener('click', leaveRoom);
document.getElementById('leave-lobby').addEventListener('click', leaveRoom);

// ===================== helpers =====================
let toastTimer = null;
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function getFont() { return "'Trebuchet MS', system-ui, sans-serif"; }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255; const p = Math.abs(amt);
  r = Math.round(lerp(r, f, p)); g = Math.round(lerp(g, f, p)); b = Math.round(lerp(b, f, p));
  return `rgb(${r},${g},${b})`;
}

// ===================== account / stats =====================
const account = { token: null, name: null, stats: null, avatar: null };
try { account.token = localStorage.getItem('bmb-token') || null; } catch { /* ignore */ }

async function api(path, body) {
  try {
    const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return await r.json();
  } catch { return { error: 'Server je nedostupný.' }; }
}
function setToken(t) {
  account.token = t;
  try { t ? localStorage.setItem('bmb-token', t) : localStorage.removeItem('bmb-token'); } catch { /* ignore */ }
}
function renderAccount() {
  const logged = !!account.name;
  document.getElementById('acc-login').hidden = logged;
  document.getElementById('acc-info').hidden = !logged;
  document.getElementById('game-stats-btn').hidden = !logged;
  const nameInput = document.getElementById('f-name');
  if (logged) {
    document.getElementById('acc-who').textContent = account.name;
    nameInput.value = account.name;
    nameInput.disabled = true;
    renderAvatarPicker();
  } else {
    nameInput.disabled = false;
  }
}
function renderAvatarPicker() {
  const wrap = document.getElementById('avatar-picker');
  if (!wrap) return;
  wrap.innerHTML = '';
  const cur = account.avatar || '';
  for (const a of ['', ...AVATARS]) {   // '' = default (just the coloured disc)
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'av-opt' + (a === cur ? ' sel' : '') + (a === '' ? ' av-none' : '');
    b.textContent = a === '' ? '—' : a;
    b.title = a === '' ? 'Bez avatara (jen barva)' : a;
    b.addEventListener('click', () => chooseAvatar(a));
    wrap.appendChild(b);
  }
}
async function chooseAvatar(a) {
  const res = await api('avatar', { token: account.token, avatar: a });
  if (res && res.ok) { account.avatar = res.avatar; renderAvatarPicker(); }
}
function accError(msg) {
  const el = document.getElementById('acc-error');
  if (!msg) { el.hidden = true; return; }
  el.textContent = msg; el.hidden = false;
}
async function doAuth(kind) {
  const name = document.getElementById('acc-name').value.trim();
  const pass = document.getElementById('acc-pass').value;
  accError('');
  const res = await api(kind, { name, pass });
  if (res.error) { accError(res.error); return; }
  setToken(res.token);
  account.name = res.name; account.stats = res.stats; account.avatar = res.avatar;
  document.getElementById('acc-pass').value = '';
  renderAccount();
}
async function doLogout() {
  await api('logout', { token: account.token });
  setToken(null); account.name = null; account.stats = null;
  document.getElementById('f-name').value = '';
  renderAccount();
}
function openStats() {
  renderStats(account.stats);
  document.getElementById('stats-modal').hidden = false;
}
function renderStats(stats) {
  document.getElementById('stats-title').textContent = 'Statistiky — ' + (account.name || '');
  const body = document.getElementById('stats-body');
  if (!stats) { body.innerHTML = '<p class="stats-empty">Zatím žádná data.</p>'; return; }
  const kd = stats.deaths ? (stats.kills / stats.deaths).toFixed(2) : (stats.kills ? '∞' : '0');
  const tiles = [['🏆', stats.wins, 'Výher'], ['🎮', stats.games, 'Her'], ['💥', stats.kills, 'Odpálil'],
    ['💀', stats.deaths, 'Zemřel'], ['⚔️', kd, 'K/D'], ['✨', stats.bonuses, 'Bonusů']];
  let html = '<div class="stat-grid">' + tiles.map(t =>
    `<div class="stat-tile"><div class="v">${t[1]}</div><div class="l">${t[0]} ${t[2]}</div></div>`).join('') + '</div>';
  const vs = Object.entries(stats.vs || {}).sort((a, b) => (b[1].k + b[1].d) - (a[1].k + a[1].d));
  if (vs.length) {
    html += '<table class="vs"><thead><tr><th>Soupeř</th><th class="num">Odpálil jsem</th><th class="num">Odpálil mě</th></tr></thead><tbody>';
    for (const [opp, kv] of vs) html += `<tr><td>${escapeHtml(opp)}</td><td class="num">${kv.k}</td><td class="num">${kv.d}</td></tr>`;
    html += '</tbody></table>';
  } else {
    html += '<p class="stats-empty">Zatím jsi s nikým nezměřil síly.</p>';
  }
  body.innerHTML = html;
}
document.getElementById('acc-login-btn').addEventListener('click', () => doAuth('login'));
document.getElementById('acc-register-btn').addEventListener('click', () => doAuth('register'));
document.getElementById('acc-logout-btn').addEventListener('click', doLogout);
document.getElementById('acc-stats-btn').addEventListener('click', openStats);
document.getElementById('game-stats-btn').addEventListener('click', openStats);
document.getElementById('stats-close').addEventListener('click', () => { document.getElementById('stats-modal').hidden = true; });
document.getElementById('acc-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('login'); });
if (account.token) {
  api('me', { token: account.token }).then(res => {
    if (res && res.ok) { account.name = res.name; account.stats = res.stats; account.avatar = res.avatar; renderAccount(); }
    else setToken(null);
  });
}
renderAccount();

// ===================== wiring =====================
document.getElementById('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  Sound.resume();
  const name = account.name || (document.getElementById('f-name').value.trim() || 'Hráč');
  const room = document.getElementById('f-room').value.trim() || 'HRA';
  const isPrivate = document.querySelector('input[name=vis]:checked').value === 'private';
  const password = document.getElementById('f-pass').value;
  if (isPrivate && !password) { showJoinError('Zadej heslo pro soukromou místnost.'); return; }
  S.locals = selectedLocals();
  S.bindings = keyStore[S.locals];
  recomputeCodes();
  const names = S.locals === 2 ? [name, name + ' 2'] : [name];
  connect({ name, room, locals: S.locals, names, token: account.token || undefined, private: isPrivate, password: password || undefined });
});

// ---- room browser (list of open games) ----
function renderRooms(list) {
  const ul = document.getElementById('room-list');
  if (!list || !list.length) {
    ul.innerHTML = '<li class="rb-empty">Zatím žádné otevřené hry — založ si vlastní níže.</li>';
    return;
  }
  ul.innerHTML = '';
  for (const r of list) {
    const full = r.count >= r.max;
    const li = document.createElement('li');
    li.className = 'room-row';
    li.innerHTML = `
      <div class="rr-main">
        <span class="rr-code">${r.hasPassword ? '🔒 ' : ''}${escapeHtml(r.code)}</span>
        <span class="rr-players">${r.players.map(escapeHtml).join(', ') || '—'}</span>
      </div>
      <div class="rr-side">
        <span class="rr-count">${r.count}/${r.max}${r.playing ? ' · hraje' : ''}</span>
        <button type="button" class="btn small rr-join" ${full ? 'disabled' : ''}>${full ? 'Plno' : 'Připojit'}</button>
      </div>`;
    if (!full) li.querySelector('.rr-join').addEventListener('click', () => joinRoom(r));
    ul.appendChild(li);
  }
}
function joinRoom(r) {
  document.getElementById('f-room').value = r.code;
  if (r.hasPassword) {
    const pw = prompt(`Heslo místnosti „${r.code}":`);
    if (pw === null) return;
    document.getElementById('f-pass').value = pw;
  } else {
    document.getElementById('f-pass').value = '';
  }
  document.getElementById('join-form').requestSubmit();
}
async function refreshRooms() {
  if (!screens.join.classList.contains('active')) return;
  const res = await api('rooms', {});
  if (res && res.rooms) renderRooms(res.rooms);
}
document.getElementById('rb-refresh').addEventListener('click', refreshRooms);
document.querySelectorAll('input[name=vis]').forEach(el => el.addEventListener('change', () => {
  document.getElementById('pw-wrap').hidden = document.querySelector('input[name=vis]:checked').value !== 'private';
}));
setInterval(refreshRooms, 4000);
refreshRooms();
document.getElementById('start-btn').addEventListener('click', () => { Sound.resume(); send({ t: 'start' }); });

// re-render the key config when switching 1<->2 players
document.querySelectorAll('input[name=locals]').forEach(r =>
  r.addEventListener('change', renderKeysConfig));
renderKeysConfig();

// map + size + time + teleports + bot controls
const selMap = document.getElementById('sel-map');
const selSize = document.getElementById('sel-size');
const selTime = document.getElementById('sel-time');
const chkTele = document.getElementById('chk-teleports');
const selPow = document.getElementById('sel-powerups');
for (const m of MAP_LIST) {
  const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; selMap.appendChild(o);
}
selMap.addEventListener('change', () => send({ t: 'settings', map: selMap.value }));
selSize.addEventListener('change', () => send({ t: 'settings', size: selSize.value }));
selTime.addEventListener('change', () => send({ t: 'settings', timeLimit: +selTime.value }));
chkTele.addEventListener('change', () => send({ t: 'settings', teleports: chkTele.checked }));
selPow.addEventListener('change', () => send({ t: 'settings', powerups: selPow.value }));
document.getElementById('add-bot').addEventListener('click', () =>
  send({
    t: 'addBot',
    level: +document.getElementById('sel-bot').value,
    count: +document.getElementById('sel-bot-count').value,
  }));

function applySettings(s) {
  const active = document.activeElement;
  // don't yank a control the user is actively changing
  if (active !== selMap && s.map != null) selMap.value = s.map;
  if (active !== selSize && s.size != null) selSize.value = s.size;
  if (active !== selTime && s.timeLimit != null) selTime.value = String(s.timeLimit);
  if (active !== chkTele && s.teleports != null) chkTele.checked = !!s.teleports;
  if (active !== selPow && s.powerups != null) selPow.value = s.powerups;
}

function showJoinError(msg) {
  const el = document.getElementById('join-error');
  el.textContent = msg; el.hidden = false;
  show('join');
}

setupTouch();

// one-time hint for iPhone/iPad: add to home screen for a chrome-less fullscreen
(function iosHint() {
  const iOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = ('standalone' in navigator ? navigator.standalone : false) || matchMedia('(display-mode: standalone)').matches;
  if (!iOS || standalone) return;
  try { if (localStorage.getItem('bmb-a2hs')) return; localStorage.setItem('bmb-a2hs', '1'); } catch { /* ignore */ }
  setTimeout(() => toast('📱 Tip: Sdílet → „Přidat na plochu" a hraj hru na celou obrazovku bez lišty.'), 1800);
})();

requestAnimationFrame(draw);
