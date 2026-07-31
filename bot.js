'use strict';

const {
  TS, FUSE, EMPTY, SOLID, BRICK, tileCenter,
} = require('./constants');

// Difficulty presets.
const LEVELS = {
  1: { name: 'Nováček', reaction: 0.50, margin: 0.02, mistake: 0.35, aggression: 0.30 },
  2: { name: 'Zkušený', reaction: 0.26, margin: 0.06, mistake: 0.08, aggression: 0.70 },
  3: { name: 'Mistr', reaction: 0.13, margin: 0.12, mistake: 0.00, aggression: 1.00 },
};

function makeBot(level) {
  const cfg = LEVELS[level] || LEVELS[2];
  return { level, cfg, timer: Math.random() * cfg.reaction, path: [], plant: false };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function passable(game, c, r) {
  return game.inBounds(c, r) && game.grid[r][c] === EMPTY && !game.bombAt(c, r);
}

// Time (seconds) until each cell first becomes lethal; Infinity if safe.
function dangerMap(game) {
  const d = [];
  for (let r = 0; r < game.rows; r++) d.push(new Array(game.cols).fill(Infinity));
  for (const f of game.flames) d[f.row][f.col] = 0;
  for (const b of game.bombs) addBombDanger(game, d, b.col, b.row, b.range, Math.max(0, b.fuse));
  return d;
}
function addBombDanger(game, d, bc, br, range, t) {
  d[br][bc] = Math.min(d[br][bc], t);
  for (const [dx, dy] of DIRS) {
    for (let i = 1; i <= range; i++) {
      const c = bc + dx * i, r = br + dy * i;
      if (!game.inBounds(c, r) || game.grid[r][c] === SOLID) break;
      d[r][c] = Math.min(d[r][c], t);
      if (game.grid[r][c] === BRICK) break;
    }
  }
}

// BFS to the nearest cell that is never hit, reachable via cells still safe on arrival.
function findEscape(game, sc, sr, danger, speed, margin) {
  const tpt = TS / speed;
  const seen = new Set([sc + ',' + sr]);
  const parent = {};
  let q = [[sc, sr, 0]];
  while (q.length) {
    const next = [];
    for (const [c, r, step] of q) {
      if (danger[r][c] === Infinity) return rebuild(parent, sc, sr, c, r);
      for (const [dx, dy] of DIRS) {
        const nc = c + dx, nr = r + dy, key = nc + ',' + nr;
        if (seen.has(key) || !passable(game, nc, nr)) continue;
        const arrival = (step + 1) * tpt;
        if (danger[nr][nc] <= arrival + margin) continue; // would be caught here
        seen.add(key); parent[key] = [c, r];
        next.push([nc, nr, step + 1]);
      }
    }
    q = next;
  }
  return null;
}

// Plain BFS toward the nearest cell matching goalFn(c,r). Returns path of cells.
function findPath(game, sc, sr, danger, goalFn, avoidDanger) {
  const seen = new Set([sc + ',' + sr]);
  const parent = {};
  let q = [[sc, sr]];
  let depth = 0;
  const maxDepth = game.cols * game.rows;
  while (q.length && depth < maxDepth) {
    const next = [];
    for (const [c, r] of q) {
      if ((c !== sc || r !== sr) && goalFn(c, r)) return rebuild(parent, sc, sr, c, r);
      for (const [dx, dy] of DIRS) {
        const nc = c + dx, nr = r + dy, key = nc + ',' + nr;
        if (seen.has(key) || !passable(game, nc, nr)) continue;
        if (avoidDanger && danger[nr][nc] !== Infinity) continue; // never route through a pending blast
        seen.add(key); parent[key] = [c, r];
        next.push([nc, nr]);
      }
    }
    q = next; depth++;
  }
  return null;
}
function rebuild(parent, sc, sr, c, r) {
  const path = [];
  let cur = [c, r];
  while (cur[0] !== sc || cur[1] !== sr) {
    path.push({ col: cur[0], row: cur[1] });
    cur = parent[cur[0] + ',' + cur[1]];
    if (!cur) break;
  }
  path.reverse();
  return path;
}

// Would a bomb here reach a brick or an enemy? Returns 'enemy' | 'brick' | null.
function bombValue(game, self, c, r, range) {
  let hitsBrick = false;
  for (const [dx, dy] of DIRS) {
    for (let i = 1; i <= range; i++) {
      const nc = c + dx * i, nr = r + dy * i;
      if (!game.inBounds(nc, nr) || game.grid[nr][nc] === SOLID) break;
      for (const p of game.players) {
        if (p.alive && p.id !== self.id && p.col() === nc && p.row() === nr) return 'enemy';
      }
      if (game.grid[nr][nc] === BRICK) { hitsBrick = true; break; }
    }
  }
  return hitsBrick ? 'brick' : null;
}

function nearestEnemy(game, self) {
  let best = null, bd = Infinity;
  for (const p of game.players) {
    if (!p.alive || p.id === self.id) continue;
    const dist = Math.abs(p.col() - self.col()) + Math.abs(p.row() - self.row());
    if (dist < bd) { bd = dist; best = p; }
  }
  return best;
}

function plan(game, p) {
  const b = p.bot, cfg = b.cfg;
  const c = p.col(), r = p.row();
  const danger = dangerMap(game);
  b.plant = false;
  b.path = [];

  // 1) In danger? Flee (unless the bot "panics" and misfires).
  if (danger[r][c] !== Infinity) {
    if (Math.random() >= cfg.mistake * 0.5) {
      const esc = findEscape(game, c, r, danger, p.speed(), cfg.margin);
      if (esc && esc.length) { b.path = esc; return; }
    }
    // no escape found or a mistake: step toward the least-dangerous open neighbour
    const opts = DIRS.map(([dx, dy]) => ({ col: c + dx, row: r + dy }))
      .filter(o => passable(game, o.col, o.row));
    if (opts.length) {
      const dval = o => danger[o.row][o.col] === Infinity ? 1e9 : danger[o.row][o.col];
      opts.sort((a, b2) => dval(b2) - dval(a));
      b.path = [opts[0]];
    }
    return;
  }

  // 2) Safe. Occasionally the weakest bots just wander.
  if (Math.random() < cfg.mistake) { wander(game, p, danger); return; }

  // 3) Can we drop a useful bomb here AND still escape?
  if (p.bombsOut < p.maxBombs) {
    const val = bombValue(game, p, c, r, p.range);
    if (val) {
      const hypo = dangerMap(game);
      addBombDanger(game, hypo, c, r, p.range, FUSE);
      const esc = findEscape(game, c, r, hypo, p.speed(), cfg.margin);
      const wantsIt = val === 'enemy' || Math.random() < 0.6 + cfg.aggression * 0.4;
      if (esc && esc.length && wantsIt) { b.plant = true; b.path = esc; return; }
    }
  }

  // 4) Grab a nearby power-up if one is reachable by a safe path.
  if (game.powerups.length) {
    const puPath = findPath(game, c, r, danger,
      (gc, gr) => game.powerups.some(pu => pu.col === gc && pu.row === gr), true);
    if (puPath && puPath.length && puPath.length <= 12) { b.path = puPath; return; }
  }

  // 5) Otherwise head toward a target: chase enemies (aggression) or open bricks.
  const enemy = nearestEnemy(game, p);
  const goEnemy = enemy && Math.random() < cfg.aggression;
  let path = null;
  if (goEnemy) {
    path = findPath(game, c, r, danger,
      (gc, gr) => Math.abs(gc - enemy.col()) + Math.abs(gr - enemy.row()) <= 1, true);
  }
  if (!path) {
    path = findPath(game, c, r, danger, (gc, gr) => adjacentBrick(game, gc, gr), true);
  }
  if (path && path.length) { b.path = path.slice(0, 6); return; }
  wander(game, p, danger);
}

function adjacentBrick(game, c, r) {
  for (const [dx, dy] of DIRS) {
    const nc = c + dx, nr = r + dy;
    if (game.inBounds(nc, nr) && game.grid[nr][nc] === BRICK) return true;
  }
  return false;
}
function wander(game, p, danger) {
  const c = p.col(), r = p.row();
  let opts = DIRS.map(([dx, dy]) => ({ col: c + dx, row: r + dy }))
    .filter(o => passable(game, o.col, o.row));
  // never wander into a cell that has a pending blast; if none are safe, stay put
  if (danger) opts = opts.filter(o => danger[o.row][o.col] === Infinity);
  p.bot.path = opts.length ? [opts[(Math.random() * opts.length) | 0]] : [];
}

// Called every tick: refresh the plan on the reaction timer, then walk the path.
function stepBot(game, p, dt) {
  const b = p.bot;
  b.timer -= dt;
  let plantNow = false;
  if (b.timer <= 0) {
    b.timer = b.cfg.reaction * (0.8 + Math.random() * 0.4);
    plan(game, p);
    plantNow = b.plant; b.plant = false;
  }

  const input = { up: false, down: false, left: false, right: false, bomb: plantNow };

  if (b.path && b.path.length) {
    const wp = b.path[0];
    const tx = tileCenter(wp.col), ty = tileCenter(wp.row);
    if (Math.abs(p.x - tx) < 3 && Math.abs(p.y - ty) < 3) {
      b.path.shift();
    } else if (Math.abs(tx - p.x) > 2) {
      input[tx > p.x ? 'right' : 'left'] = true;
    } else {
      input[ty > p.y ? 'down' : 'up'] = true;
    }
  }
  p.input = input;
}

module.exports = { makeBot, stepBot, LEVELS };
