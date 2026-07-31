'use strict';

const C = require('./constants');
const { stepBot, makeBot } = require('./bot');

const {
  TS, PR, EMPTY, SOLID, BRICK, SIZES,
  BASE_SPEED, SPEED_STEP, SPEED_MAX, FUSE, FLAME, KICK_SPEED,
  MAX_BOMBS_CAP, RANGE_CAP, POWERUP_LEVELS, POWERUP_LIFE, HUNTER_SPEED_MULT,
  TP_LIFE, TP_INTERVAL_MIN, TP_INTERVAL_MAX, TP_MAX,
  PLAYER_COLORS, MAPS, MAP_BY_ID,
  tileCenter, cellOf, clamp, approach, pillarAt, spawnsFor,
} = C;

const POWERUPS = [['bomb', 30], ['fire', 30], ['speed', 22], ['kick', 10], ['remote', 10]];

function rollPowerup(chance) {
  if (Math.random() > chance) return null;
  let total = 0;
  for (const [, w] of POWERUPS) total += w;
  let x = Math.random() * total;
  for (const [type, w] of POWERUPS) { if ((x -= w) <= 0) return type; }
  return 'bomb';
}

class Player {
  constructor(id, name, color) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.x = 0; this.y = 0;
    this.dir = 'down';
    this.moving = false;
    this.alive = true;
    this.removed = false;
    this.bot = null;
    this.input = { up: false, down: false, left: false, right: false, bomb: false, detonate: false };
    this.bombHeld = false;
    this.detonateHeld = false;
    this.maxBombs = 1;
    this.range = 2;
    this.speedLevel = 0;
    this.kick = false;
    this.remote = false;
    this.bombsOut = 0;
  }
  speed() { return Math.min(BASE_SPEED + this.speedLevel * SPEED_STEP, SPEED_MAX); }
  col() { return cellOf(this.x); }
  row() { return cellOf(this.y); }
}

class Game {
  // roster: [{id, name, color, bot?:level}]; settings: {map, timeLimit, size, teleports}
  constructor(roster, settings = {}) {
    const dim = SIZES[settings.size] || SIZES.medium;
    this.cols = dim.cols;
    this.rows = dim.rows;

    this.grid = [];
    this.players = [];
    this.bombs = [];
    this.flames = [];
    this.powerups = [];
    this.teleports = [];
    this.tileChanges = [];
    this.events = [];
    this.stats = {};        // pid -> { kills, deaths, bonuses, vs:{oppPid:{k,d}} }
    this.over = false;
    this.winnerId = null;
    this.endTimer = 0;

    this.time = 0;
    this.timeLimit = settings.timeLimit || 0;
    this.sd = false;
    this.hunter = null;   // sudden-death Pac-Man that hunts survivors

    this.teleportsOn = settings.teleports !== false;
    this.tpTimer = TP_INTERVAL_MIN;
    this.powerupChance = POWERUP_LEVELS[settings.powerups] || POWERUP_LEVELS.medium;

    let mapId = settings.map;
    if (!mapId || mapId === 'random' || !MAP_BY_ID[mapId]) {
      mapId = MAPS[(Math.random() * MAPS.length) | 0].id;
    }
    this.map = MAP_BY_ID[mapId];

    this._generateMap();

    const spawns = spawnsFor(this.cols, this.rows);
    // shuffle so players don't always start in the same corner each round
    for (let i = spawns.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
    }
    roster.forEach((entry, i) => {
      const pl = new Player(entry.id, entry.name, entry.color);
      pl.avatar = entry.avatar || '🙂';
      if (entry.bot) pl.bot = makeBot(entry.bot);
      const [sc, sr] = spawns[i % spawns.length];
      pl.x = tileCenter(sc);
      pl.y = tileCenter(sr);
      this.players.push(pl);
    });
  }

  inBounds(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }

  _generateMap() {
    const variant = this.map.pillars;
    const fill = this.map.brickFill;
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        if (r === 0 || c === 0 || r === this.rows - 1 || c === this.cols - 1) row.push(SOLID);
        else if (pillarAt(variant, c, r, this.cols, this.rows)) row.push(SOLID);
        else row.push(Math.random() < fill ? BRICK : EMPTY);
      }
      this.grid.push(row);
    }
    for (const [sc, sr] of spawnsFor(this.cols, this.rows)) {
      const cells = [[sc, sr], [sc + 1, sr], [sc - 1, sr], [sc, sr + 1], [sc, sr - 1]];
      for (const [c, r] of cells) {
        if (this.inBounds(c, r) && this.grid[r][c] === BRICK) this.grid[r][c] = EMPTY;
      }
    }
  }

  playerById(id) { return this.players.find(p => p.id === id); }
  setInput(id, input) { const p = this.playerById(id); if (p && !p.bot) p.input = input; }
  removePlayer(id) { const p = this.playerById(id); if (p) { p.alive = false; p.removed = true; } }

  bombAt(c, r) { return this.bombs.find(b => b.col === c && b.row === r && !b.exploded); }
  cellFreeForBomb(c, r) { return this.inBounds(c, r) && this.grid[r][c] === EMPTY && !this.bombAt(c, r); }

  walkable(p, c, r) {
    if (!this.inBounds(c, r)) return false;
    if (this.grid[r][c] !== EMPTY) return false;
    const b = this.bombAt(c, r);
    if (b && !b.passSet.has(p.id)) return false;
    return true;
  }

  update(dt) {
    this.time += dt;
    for (const p of this.players) if (p.alive && p.bot) stepBot(this, p, dt);
    this._updateBombPassSets();
    for (const p of this.players) if (p.alive) this._movePlayer(p, dt);
    for (const p of this.players) if (p.alive) this._tryBomb(p);
    this._detonations();
    this._updateKickedBombs(dt);
    this._updateFuses(dt);
    this._updateFlames(dt);
    this._suddenDeath(dt);
    this._teleports(dt);
    this._agePowerups(dt);
    this._pickups();
    this._deaths();
    this._checkRoundEnd(dt);
  }

  _updateBombPassSets() {
    for (const b of this.bombs) {
      if (b.passSet.size === 0) continue;
      const bx0 = b.col * TS, by0 = b.row * TS;
      for (const id of [...b.passSet]) {
        const p = this.playerById(id);
        // stay passable until the player's body has fully stepped off the bomb tile
        // (using the center cell here caused players to get stuck while still overlapping)
        const off = !p || p.x + PR <= bx0 || p.x - PR >= bx0 + TS || p.y + PR <= by0 || p.y - PR >= by0 + TS;
        if (off) b.passSet.delete(id);
      }
    }
  }

  _movePlayer(p, dt) {
    const inp = p.input;
    const ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    p.moving = false;
    if (ix === 0 && iy === 0) return;
    if (ix !== 0 && this._moveAxis(p, ix, 0, dt)) return;
    if (iy !== 0 && this._moveAxis(p, 0, iy, dt)) return;
    if (ix !== 0) this._moveAxis(p, ix, 0, dt);
    else if (iy !== 0) this._moveAxis(p, 0, iy, dt);
  }

  _moveAxis(p, dx, dy, dt) {
    const step = p.speed() * dt;
    if (dx !== 0) {
      p.y = approach(p.y, tileCenter(Math.round((p.y - TS / 2) / TS)), step);
      const nx = p.x + dx * step;
      if (this._freeX(p, nx, dx)) { p.x = nx; p.dir = dx > 0 ? 'right' : 'left'; p.moving = true; return true; }
      this._maybeKick(p, dx, 0);
      return false;
    } else {
      p.x = approach(p.x, tileCenter(Math.round((p.x - TS / 2) / TS)), step);
      const ny = p.y + dy * step;
      if (this._freeY(p, ny, dy)) { p.y = ny; p.dir = dy > 0 ? 'down' : 'up'; p.moving = true; return true; }
      this._maybeKick(p, 0, dy);
      return false;
    }
  }

  _freeX(p, nx, dir) {
    const c = cellOf(nx + dir * PR);
    return this.walkable(p, c, cellOf(p.y - PR + 2)) && this.walkable(p, c, cellOf(p.y + PR - 2));
  }
  _freeY(p, ny, dir) {
    const r = cellOf(ny + dir * PR);
    return this.walkable(p, cellOf(p.x - PR + 2), r) && this.walkable(p, cellOf(p.x + PR - 2), r);
  }

  _maybeKick(p, dx, dy) {
    if (!p.kick) return;
    const fc = p.col() + dx, fr = p.row() + dy;
    const b = this.bombAt(fc, fr);
    if (b && !b.moving && !b.passSet.has(p.id) && this.cellFreeForBomb(fc + dx, fr + dy)) {
      b.moving = true; b.kdx = dx; b.kdy = dy;
    }
  }

  _tryBomb(p) {
    const pressed = p.input.bomb && !p.bombHeld;
    p.bombHeld = p.input.bomb;
    if (!pressed || p.bombsOut >= p.maxBombs) return;
    const c = p.col(), r = p.row();
    if (this.grid[r][c] !== EMPTY || this.bombAt(c, r)) return;
    const passSet = new Set();
    for (const o of this.players) if (o.alive && o.col() === c && o.row() === r) passSet.add(o.id);
    this.bombs.push({
      col: c, row: r, px: tileCenter(c), py: tileCenter(r),
      owner: p.id, range: p.range, fuse: FUSE, passSet,
      moving: false, kdx: 0, kdy: 0, exploded: false,
      remote: !!p.remote && !p.bot,   // bots always use timed bombs (they don't detonate)
    });
    p.bombsOut++;
  }

  // Manual detonation: a player with the remote power-up blows their bombs on command.
  _detonations() {
    for (const p of this.players) {
      const pressed = p.input.detonate && !p.detonateHeld;
      p.detonateHeld = p.input.detonate;
      if (!pressed || !p.alive) continue;
      for (const b of this.bombs.filter(b => b.owner === p.id && b.remote && !b.exploded)) {
        this.explode(b);
      }
    }
  }

  _updateKickedBombs(dt) {
    for (const b of this.bombs) {
      if (!b.moving || b.exploded) continue;
      b.px += b.kdx * KICK_SPEED * dt;
      b.py += b.kdy * KICK_SPEED * dt;
      const nc = cellOf(b.px), nr = cellOf(b.py);
      if (nc !== b.col || nr !== b.row) {
        if (!this.cellFreeForBomb(nc, nr)) {
          b.px = tileCenter(b.col); b.py = tileCenter(b.row); b.moving = false;
        } else { b.col = nc; b.row = nr; b.passSet.clear(); }
      }
    }
  }

  _updateFuses(dt) {
    for (const b of [...this.bombs]) {
      if (b.exploded) continue;
      if (b.remote) {
        const owner = this.playerById(b.owner);
        if (owner && owner.alive) continue;   // held by a living owner -> waits for detonate
      }
      b.fuse -= dt;
      if (b.fuse <= 0) this.explode(b);
    }
  }

  explode(b) {
    if (b.exploded) return;
    b.exploded = true;
    const idx = this.bombs.indexOf(b);
    if (idx >= 0) this.bombs.splice(idx, 1);
    const owner = this.playerById(b.owner);
    if (owner) owner.bombsOut = Math.max(0, owner.bombsOut - 1);

    const own = b.owner;
    this.events.push({ e: 'boom', col: b.col, row: b.row });
    this.flames.push({ col: b.col, row: b.row, type: 'center', life: FLAME, owner: own });

    const dirs = [[1, 0, 'h', 'tipR'], [-1, 0, 'h', 'tipL'], [0, 1, 'v', 'tipD'], [0, -1, 'v', 'tipU']];
    for (const [dx, dy, mid, tip] of dirs) {
      for (let i = 1; i <= b.range; i++) {
        const c = b.col + dx * i, r = b.row + dy * i;
        if (!this.inBounds(c, r) || this.grid[r][c] === SOLID) break;
        const chain = this.bombAt(c, r);
        if (chain && !chain.exploded) {
          this.flames.push({ col: c, row: r, type: i === b.range ? tip : mid, life: FLAME, owner: own });
          this.explode(chain);
          break;
        }
        this._removePowerupAt(c, r);
        if (this.grid[r][c] === BRICK) {
          this.flames.push({ col: c, row: r, type: tip, life: FLAME, owner: own });
          this._destroyBrick(c, r);
          break;
        }
        this.flames.push({ col: c, row: r, type: i === b.range ? tip : mid, life: FLAME, owner: own });
      }
    }
  }

  _destroyBrick(c, r) {
    this.grid[r][c] = EMPTY;
    this.tileChanges.push({ col: c, row: r, v: EMPTY });
    const type = rollPowerup(this.powerupChance);
    if (type) this.powerups.push({ col: c, row: r, type, life: POWERUP_LIFE });
  }
  _removePowerupAt(c, r) {
    const i = this.powerups.findIndex(pu => pu.col === c && pu.row === r);
    if (i >= 0) this.powerups.splice(i, 1);
  }

  _updateFlames(dt) {
    for (const f of this.flames) f.life -= dt;
    this.flames = this.flames.filter(f => f.life > 0);
  }

  _suddenDeath(dt) {
    if (this.timeLimit <= 0) return;
    if (!this.sd && this.time >= this.timeLimit) {
      this.sd = true;
      this._spawnHunter();
      this.events.push({ e: 'sd' });
    }
    if (this.sd && this.hunter) this._moveHunter(dt);
  }

  _spawnHunter() {
    // spawn on the survivor-free-est cell so it actually has to chase
    const alive = this.players.filter(p => p.alive);
    let best = null, bestD = -1;
    for (let r = 1; r < this.rows - 1; r++) {
      for (let c = 1; c < this.cols - 1; c++) {
        if (this.grid[r][c] === SOLID) continue;
        let d = 1e9;
        for (const p of alive) d = Math.min(d, Math.abs(p.col() - c) + Math.abs(p.row() - r));
        if (d > bestD) { bestD = d; best = [c, r]; }
      }
    }
    if (!best) best = [(this.cols - 1) >> 1, (this.rows - 1) >> 1];
    this.hunter = { px: tileCenter(best[0]), py: tileCenter(best[1]), dir: 'left', path: [], repath: 0 };
  }

  _moveHunter(dt) {
    const h = this.hunter;
    const alive = this.players.filter(p => p.alive);
    if (!alive.length) return;
    const speed = Math.max(...alive.map(p => p.speed())) * HUNTER_SPEED_MULT;

    const hc = cellOf(h.px), hr = cellOf(h.py);
    h.repath -= dt;
    if (h.repath <= 0 || !h.path.length) {
      h.repath = 0.2;
      let target = alive[0], td = 1e18;
      for (const p of alive) { const d = (p.x - h.px) ** 2 + (p.y - h.py) ** 2; if (d < td) { td = d; target = p; } }
      h.path = this._huntPath(hc, hr, target.col(), target.row());
    }

    let step = speed * dt;
    while (step > 0 && h.path.length) {
      const [wc, wr] = h.path[0];
      const tx = tileCenter(wc), ty = tileCenter(wr);
      const dx = tx - h.px, dy = ty - h.py;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < 0.5) { h.px = tx; h.py = ty; h.path.shift(); continue; }
      const move = Math.min(step, d);
      if (Math.abs(dx) > 0.5) { h.px += Math.sign(dx) * Math.min(move, Math.abs(dx)); h.dir = dx > 0 ? 'right' : 'left'; }
      else { h.py += Math.sign(dy) * Math.min(move, Math.abs(dy)); h.dir = dy > 0 ? 'down' : 'up'; }
      step -= move;
    }

    // eat the brick it sits on so the maze opens up as it chases
    const bc = cellOf(h.px), br = cellOf(h.py);
    if (this.grid[br][bc] === BRICK) {
      this.grid[br][bc] = EMPTY;
      this.tileChanges.push({ col: bc, row: br, v: EMPTY });
      this._removePowerupAt(bc, br);
    }
    // devour any survivor it touches
    for (const p of alive) {
      if (Math.abs(p.x - h.px) < TS * 0.55 && Math.abs(p.y - h.py) < TS * 0.55) {
        p.alive = false;
        this.events.push({ e: 'death', id: p.id, col: p.col(), row: p.row(), by: null });
        this._recordDeath(p.id, null);
        this.events.push({ e: 'eat', col: cellOf(h.px), row: cellOf(h.py) });
      }
    }
  }

  _huntPath(sc, sr, tc, tr) {
    if (sc === tc && sr === tr) return [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const seen = new Set([sc + ',' + sr]);
    const parent = {};
    let q = [[sc, sr]];
    while (q.length) {
      const nx = [];
      for (const [c, r] of q) {
        if (c === tc && r === tr) {
          const path = [];
          let cur = [tc, tr];
          while (cur[0] !== sc || cur[1] !== sr) { path.push(cur); cur = parent[cur[0] + ',' + cur[1]]; if (!cur) break; }
          return path.reverse();
        }
        for (const [dx, dy] of dirs) {
          const nc = c + dx, nr = r + dy, k = nc + ',' + nr;
          if (!this.inBounds(nc, nr) || this.grid[nr][nc] === SOLID || seen.has(k)) continue;
          seen.add(k); parent[k] = [c, r]; nx.push([nc, nr]);
        }
      }
      q = nx;
    }
    return [];
  }

  _teleports(dt) {
    if (!this.teleportsOn) return;
    for (const tp of this.teleports) tp.life -= dt;
    this.teleports = this.teleports.filter(tp => tp.life > 0);

    this.tpTimer -= dt;
    if (this.tpTimer <= 0) {
      this.tpTimer = TP_INTERVAL_MIN + Math.random() * (TP_INTERVAL_MAX - TP_INTERVAL_MIN);
      if (this.teleports.length < TP_MAX && !this.sd) {
        const cell = this._randomEmptyCell(false);
        if (cell) this.teleports.push({ col: cell[0], row: cell[1], life: TP_LIFE });
      }
    }

    for (const p of this.players) {
      if (!p.alive) continue;
      const i = this.teleports.findIndex(tp => tp.col === p.col() && tp.row === p.row());
      if (i >= 0) {
        this.teleports.splice(i, 1);
        this._warp(p);
      }
    }
  }

  _randomEmptyCell(avoidPlayers) {
    for (let tries = 0; tries < 80; tries++) {
      const c = 1 + ((Math.random() * (this.cols - 2)) | 0);
      const r = 1 + ((Math.random() * (this.rows - 2)) | 0);
      if (this.grid[r][c] !== EMPTY) continue;
      if (this.bombAt(c, r)) continue;
      if (this.flames.some(f => f.col === c && f.row === r)) continue;
      if (this.powerups.some(pu => pu.col === c && pu.row === r)) continue;
      if (this.teleports.some(tp => tp.col === c && tp.row === r)) continue;
      if (avoidPlayers && this.players.some(p => p.alive && p.col() === c && p.row() === r)) continue;
      return [c, r];
    }
    return null;
  }
  _warp(p) {
    const cell = this._randomEmptyCell(true);
    if (!cell) return;
    p.x = tileCenter(cell[0]);
    p.y = tileCenter(cell[1]);
    this.events.push({ e: 'teleport', col: cell[0], row: cell[1] });
  }

  _agePowerups(dt) {
    if (!this.powerups.length) return;
    for (const pu of this.powerups) pu.life -= dt;
    this.powerups = this.powerups.filter(pu => pu.life > 0);
  }

  _pickups() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const i = this.powerups.findIndex(pu => pu.col === p.col() && pu.row === p.row());
      if (i < 0) continue;
      const pu = this.powerups[i];
      this.powerups.splice(i, 1);
      this._applyPowerup(p, pu.type);
      this._stat(p.id).bonuses++;
      this.events.push({ e: 'pickup', col: pu.col, row: pu.row, type: pu.type });
    }
  }
  _applyPowerup(p, type) {
    if (type === 'bomb') p.maxBombs = Math.min(p.maxBombs + 1, MAX_BOMBS_CAP);
    else if (type === 'fire') p.range = Math.min(p.range + 1, RANGE_CAP);
    else if (type === 'speed') p.speedLevel++;
    else if (type === 'kick') p.kick = true;
    else if (type === 'remote') p.remote = !p.remote;   // re-picking toggles it off/on
  }

  _stat(pid) {
    return this.stats[pid] || (this.stats[pid] = { kills: 0, deaths: 0, bonuses: 0, vs: {} });
  }
  _recordDeath(victim, killer) {
    this._stat(victim).deaths++;
    if (killer != null && killer !== victim) {
      const ks = this._stat(killer);
      ks.kills++;
      (ks.vs[victim] || (ks.vs[victim] = { k: 0, d: 0 })).k++;
      const vsv = this._stat(victim);
      (vsv.vs[killer] || (vsv.vs[killer] = { k: 0, d: 0 })).d++;
    }
  }

  _deaths() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const c = p.col(), r = p.row();
      const f = this.flames.find(fl => fl.col === c && fl.row === r);
      if (f) {
        p.alive = false;
        const by = f.owner != null ? f.owner : null;
        this.events.push({ e: 'death', id: p.id, col: c, row: r, by });
        this._recordDeath(p.id, by);
      }
    }
  }

  aliveCount() { return this.players.filter(p => p.alive).length; }

  _checkRoundEnd(dt) {
    if (this.over) { this.endTimer += dt; return; }
    const contenders = this.players.filter(p => !p.removed).length;
    if (contenders < 2) return;
    const alive = this.players.filter(p => p.alive);
    if (alive.length <= 1) {
      this.over = true;
      this.winnerId = alive.length === 1 ? alive[0].id : null;
      this.endTimer = 0;
    }
  }

  staticState() {
    return {
      TS, COLS: this.cols, ROWS: this.rows, FUSE, FLAME,
      map: this.map.id, mapName: this.map.name,
      timeLimit: this.timeLimit,
      grid: this.grid.map(row => row.slice()),
      players: this.players.map(p => ({
        id: p.id, name: p.name, color: p.color, bot: p.bot ? p.bot.level : 0, avatar: p.avatar,
      })),
    };
  }

  snapshot() {
    const snap = {
      t: 'state',
      time: +this.time.toFixed(2),
      timeLimit: this.timeLimit,
      sd: this.sd,
      players: this.players.map(p => ({
        id: p.id, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir,
        moving: p.moving, alive: p.alive,
        bombs: p.maxBombs, range: p.range, speed: p.speedLevel, kick: p.kick, remote: p.remote,
      })),
      bombs: this.bombs.map(b => ({ x: Math.round(b.px), y: Math.round(b.py), fuse: +b.fuse.toFixed(2), moving: b.moving, remote: !!b.remote })),
      flames: this.flames.map(f => ({ col: f.col, row: f.row, type: f.type, life: +f.life.toFixed(2) })),
      powerups: this.powerups.map(pu => ({ col: pu.col, row: pu.row, type: pu.type, life: +pu.life.toFixed(2) })),
      teleports: this.teleports.map(tp => ({ col: tp.col, row: tp.row, life: +tp.life.toFixed(2) })),
      hunter: this.hunter ? { x: Math.round(this.hunter.px), y: Math.round(this.hunter.py), dir: this.hunter.dir } : null,
      tiles: this.tileChanges,
      events: this.events,
      over: this.over,
      winnerId: this.winnerId,
    };
    this.tileChanges = [];
    this.events = [];
    return snap;
  }
}

module.exports = { Game, PLAYER_COLORS, MAPS };
