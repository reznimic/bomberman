'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const { Game, PLAYER_COLORS } = require('./game');
const { BOT_NAMES, AVATARS } = require('./constants');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const TICK_HZ = 60;
const SNAP_EVERY = 2;      // broadcast every 2nd tick -> 30 Hz
const RESULT_DELAY = 2;    // seconds of scoreboard before the countdown
const COUNTDOWN = 3;       // seconds of "3..2..1" before the next round

// ---------------- static file server ----------------
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
// --- simple per-IP rate limiter for the API (blunts auth brute-force / scrypt DoS) ---
const rlHits = new Map();
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];   // set by nginx when proxied
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
function rateLimited(ip) {
  const now = Date.now();
  if (rlHits.size > 5000) rlHits.clear();        // cap memory from unique IPs
  let e = rlHits.get(ip);
  if (!e || e.reset < now) { e = { count: 0, reset: now + 10000 }; rlHits.set(ip, e); }
  return ++e.count > 40;                          // >40 API calls / 10 s per IP
}

async function handleApi(req, res) {
  const send = (obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method !== 'POST') return send({ error: 'method' }, 405);
    if (rateLimited(clientIp(req))) return send({ error: 'Příliš mnoho požadavků, zkus to za chvíli.' }, 429);
    const body = await readBody(req);
    const p = req.url.split('?')[0];
    if (p === '/api/register') return send(await auth.register(body.name, body.pass));
    if (p === '/api/login') return send(await auth.login(body.name, body.pass));
    if (p === '/api/rooms') return send({ rooms: roomList() });
    if (p === '/api/avatar') return send(auth.setAvatar(body.token, body.avatar));
    if (p === '/api/logout') { auth.logout(body.token); return send({ ok: true }); }
    if (p === '/api/me') {
      const acc = auth.validate(body.token);
      return send(acc ? { ok: true, ...auth.publicStats(acc) } : { error: 'invalid' });
    }
    send({ error: 'unknown' }, 404);
  } catch {
    send({ error: 'server' }, 500);
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { handleApi(req, res); return; }
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(urlPath));
  // must stay strictly inside PUBLIC (the trailing separator prevents a "public-sibling" bypass)
  if (filePath !== PUBLIC && !filePath.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------- rooms ----------------
/** @type {Map<string, Room>} */
const rooms = new Map();

// restrict to a safe charset so a room code can never carry markup/HTML
function normalizeCode(code) {
  return String(code || 'HRA').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'HRA';
}
function getRoom(code) {
  code = normalizeCode(code);
  let room = rooms.get(code);
  if (!room) { room = new Room(code); rooms.set(code, room); }
  return room;
}

// public list of active rooms for the lobby browser
function roomList() {
  const out = [];
  for (const room of rooms.values()) {
    if (room.conns.size === 0) continue;   // only rooms with real people
    out.push({
      code: room.code,
      count: room.players.size,
      max: MAX_PLAYERS,
      players: [...room.players.values()].map(p => p.name),
      playing: room.state === 'playing',
      hasPassword: !!room.password,
    });
  }
  return out;
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();     // pid -> {id,name,color,connId,wins}
    this.conns = new Map();       // connId -> {ws, pids:[]}
    this.nextPid = 1;
    this.hostConn = null;   // connId of the host (first joiner); controls settings + start
    this.game = null;
    this.state = 'lobby';         // 'lobby' | 'playing'
    this.round = 0;
    this.resultSent = false;
    this.lastCount = 0;
    this.loop = null;
    this.lastTime = 0;
    this.tickCount = 0;
    this.password = null;   // null = public room; set = private (password required)
    this.settings = { map: 'random', timeLimit: 120, size: 'medium', teleports: true, powerups: 'medium' };
  }

  usedColors() { return new Set([...this.players.values()].map(p => p.color)); }
  freeColor() {
    const used = this.usedColors();
    return PLAYER_COLORS.find(c => !used.has(c)) || PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
  }
  defaultAvatar(color) {
    const i = PLAYER_COLORS.indexOf(color);
    return AVATARS[(i < 0 ? this.players.size : i) % AVATARS.length];
  }

  addConn(connId, ws, name, locals, names, account) {
    const conn = { ws, pids: [] };
    this.conns.set(connId, conn);
    if (this.hostConn === null) this.hostConn = connId;   // first joiner becomes host
    const count = Math.max(1, Math.min(2, locals | 0));
    for (let i = 0; i < count; i++) {
      if (this.players.size >= MAX_PLAYERS) break;
      const pid = this.nextPid++;
      const pname = i === 0 ? name : ((names && names[1]) || `${name} 2`);
      const color = this.freeColor();
      const acct = i === 0 ? (account || null) : null;
      const avatar = (acct && auth.avatarOf(acct)) || this.defaultAvatar(color);
      this.players.set(pid, {
        id: pid, name: String(pname).slice(0, 14), color, avatar,
        connId, wins: 0, bot: 0, account: acct,
      });
      conn.pids.push(pid);
    }
    return conn.pids;
  }

  botName() {
    const taken = new Set([...this.players.values()].map(p => p.name.replace(/^🤖 /, '')));
    const free = BOT_NAMES.filter(n => !taken.has(n));
    const pool = free.length ? free : BOT_NAMES;
    return '🤖 ' + pool[(Math.random() * pool.length) | 0];
  }

  addBot(level, count = 1) {
    level = Math.max(1, Math.min(3, level | 0));
    count = Math.max(1, Math.min(7, count | 0));
    let added = 0;
    for (let i = 0; i < count && this.players.size < MAX_PLAYERS; i++) {
      const pid = this.nextPid++;
      const color = this.freeColor();
      this.players.set(pid, { id: pid, name: this.botName(), color, avatar: this.defaultAvatar(color), connId: null, wins: 0, bot: level });
      added++;
    }
    if (added) this.broadcastLobby();
  }

  removeBot(id) {
    const p = this.players.get(id);
    if (p && p.bot) {
      this.players.delete(id);
      if (this.game) this.game.removePlayer(id);
      this.broadcastLobby();
    }
  }

  removeConn(connId) {
    const conn = this.conns.get(connId);
    if (!conn) return;
    for (const pid of conn.pids) {
      this.players.delete(pid);
      if (this.game) this.game.removePlayer(pid);
    }
    this.conns.delete(connId);
    if (this.conns.size === 0) { this.stop(); rooms.delete(this.code); return; }
    if (this.hostConn === connId) this.hostConn = this.conns.keys().next().value || null;  // pass host on
    if (this.state === 'playing' && this.players.size < 2) this.stop();
    this.broadcastLobby();
  }

  hostPid() {
    const conn = this.conns.get(this.hostConn);
    return conn && conn.pids.length ? conn.pids[0] : null;
  }

  roster() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, avatar: p.avatar }));
  }
  winsMap() {
    const m = {};
    for (const p of this.players.values()) m[p.id] = p.wins;
    return m;
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const conn of this.conns.values()) {
      if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(s);
    }
  }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby', code: this.code, state: this.state, settings: this.settings, private: !!this.password, hostId: this.hostPid(),
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, wins: p.wins, bot: p.bot, avatar: p.avatar })),
    });
  }

  startRound() {
    if (this.players.size < 2) return;
    this.round++;
    this.game = new Game(this.roster(), this.settings);
    this.state = 'playing';
    this.resultSent = false;
    const st = this.game.staticState();
    this.broadcast({ t: 'round', round: this.round, wins: this.winsMap(), ...st });
    if (!this.loop) {
      this.lastTime = Date.now();
      this.tickCount = 0;
      this.loop = setInterval(() => this.tick(), 1000 / TICK_HZ);
    }
  }

  tick() {
    const now = Date.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1;               // clamp after a stall
    const g = this.game;
    if (!g) return;

    g.update(dt);

    if (g.over && !this.resultSent) {
      this.resultSent = true;
      if (g.winnerId != null) {
        const w = this.players.get(g.winnerId);
        if (w) w.wins++;
      }
      this.broadcast({ t: 'result', winnerId: g.winnerId, wins: this.winsMap() });
      this.commitStats(g);
      this.lastCount = 0;
    }
    if (g.over && g.endTimer >= RESULT_DELAY) {
      const remain = Math.ceil((RESULT_DELAY + COUNTDOWN) - g.endTimer);   // 3, 2, 1
      if (remain > 0 && remain !== this.lastCount) {
        this.lastCount = remain;
        this.broadcast({ t: 'countdown', n: remain });
      }
      if (g.endTimer >= RESULT_DELAY + COUNTDOWN) { this.startRound(); return; }
    }

    if (this.tickCount++ % SNAP_EVERY === 0) this.broadcast(g.snapshot());
  }

  // Aggregate the round's stats into logged-in players' accounts, then push updates back.
  commitStats(g) {
    const pidName = {};
    for (const p of this.players.values()) pidName[p.id] = p.name;
    for (const gp of g.players) {
      const pl = this.players.get(gp.id);
      if (!pl || !pl.account) continue;
      const gs = g.stats[gp.id] || { kills: 0, deaths: 0, bonuses: 0, vs: {} };
      const vs = {};
      for (const [op, kv] of Object.entries(gs.vs)) vs[pidName[+op] || ('Hráč ' + op)] = kv;
      auth.recordGame(pl.account, {
        games: 1, win: g.winnerId === gp.id ? 1 : 0,
        kills: gs.kills, deaths: gs.deaths, bonuses: gs.bonuses, vs,
      });
    }
    // send each logged-in device its fresh stats
    for (const conn of this.conns.values()) {
      const pl = [...this.players.values()].find(p => p.connId != null && conn.pids.includes(p.id) && p.account);
      if (pl) { const s = auth.statsOf(pl.account); if (s && conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify({ t: 'stats', ...s })); }
    }
  }

  stop() {
    if (this.loop) { clearInterval(this.loop); this.loop = null; }
    this.game = null;
    this.state = 'lobby';
    this.broadcastLobby();
  }
}

// ---------------- websocket wiring ----------------
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });   // our messages are tiny; block huge frames
let nextConnId = 1;

wss.on('connection', (ws) => {
  const connId = nextConnId++;
  let room = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join') {
      if (room) return;
      // resolve account from token; logged-in name is the account name and is reserved
      let account = null;
      if (msg.token) { const acc = auth.validate(msg.token); if (acc) account = acc.name; }
      let name = String(msg.name || 'Hráč').trim() || 'Hráč';
      if (account) name = account;
      else if (auth.isNameTaken(name)) { ws.send(JSON.stringify({ t: 'nameTaken', name })); return; }
      const code = normalizeCode(msg.room);
      const existed = rooms.has(code);
      const r = getRoom(code);
      // the person who first enters a room defines whether it's public or private
      if (!existed) r.password = (msg.private && msg.password) ? String(msg.password).slice(0, 64) : null;
      // private rooms require the matching password to join
      if (r.password && String(msg.password || '') !== r.password) {
        ws.send(JSON.stringify({ t: 'wrongPassword' }));
        if (!existed) rooms.delete(code);
        return;
      }
      if (r.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); if (!existed) rooms.delete(code); return; }
      room = r;
      const pids = room.addConn(connId, ws, name, msg.locals, msg.names, account);
      ws.send(JSON.stringify({ t: 'joined', ids: pids, code: room.code, max: MAX_PLAYERS, name }));
      room.broadcastLobby();
      if (room.state === 'playing' && room.game) {
        ws.send(JSON.stringify({ t: 'round', round: room.round, wins: room.winsMap(), ...room.game.staticState() }));
      }
      return;
    }
    if (!room) return;

    if (msg.t === 'input') {
      const conn = room.conns.get(connId);
      if (!conn || !room.game) return;
      const pid = conn.pids[msg.slot | 0];
      if (pid != null) room.game.setInput(pid, sanitizeInput(msg.input));
      return;
    }
    // only the host may change settings, add/remove bots, and start
    const isHost = room.hostConn === connId;
    if (msg.t === 'start') {
      if (isHost && room.state !== 'playing') room.startRound();
      return;
    }
    if (msg.t === 'addBot') { if (isHost) room.addBot(msg.level, msg.count); return; }
    if (msg.t === 'removeBot') { if (isHost) room.removeBot(msg.id | 0); return; }
    if (msg.t === 'settings') {
      if (!isHost) return;
      if (msg.map !== undefined) room.settings.map = String(msg.map).slice(0, 12);
      if (msg.timeLimit !== undefined) room.settings.timeLimit = Math.max(0, Math.min(600, msg.timeLimit | 0));
      if (msg.size !== undefined && ['small', 'medium', 'large'].includes(msg.size)) room.settings.size = msg.size;
      if (msg.teleports !== undefined) room.settings.teleports = !!msg.teleports;
      if (msg.powerups !== undefined && ['low', 'medium', 'high'].includes(msg.powerups)) room.settings.powerups = msg.powerups;
      room.broadcastLobby();
      return;
    }
  });

  ws.on('close', () => { if (room) room.removeConn(connId); });
  ws.on('error', () => {});
});

function sanitizeInput(i) {
  i = i || {};
  return {
    up: !!i.up, down: !!i.down, left: !!i.left, right: !!i.right, bomb: !!i.bomb, detonate: !!i.detonate,
  };
}

// ---------------- boot ----------------
server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  console.log('\n💣  BOMBERMAN LAN server běží!\n');
  console.log(`   Na tomto počítači:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`   Pro ostatní na wifi: http://${ip}:${PORT}`);
  console.log('\n   (Ukončíš stiskem Ctrl+C)\n');
});
