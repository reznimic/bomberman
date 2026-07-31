'use strict';

// ---- geometry ----
const TS = 48;            // logical tile size in pixels (canvas is scaled to fit on the client)
const PR = 18;            // player collision radius

const EMPTY = 0, SOLID = 1, BRICK = 2;

// Board sizes (cols & rows are odd so the pillar grid stays symmetric).
const SIZES = {
  small: { cols: 15, rows: 11 },
  medium: { cols: 19, rows: 13 },
  large: { cols: 25, rows: 15 },
};

// ---- tuning ----
const BASE_SPEED = 118, SPEED_STEP = 20, SPEED_MAX = 210;
const FUSE = 2.4, FLAME = 0.48, KICK_SPEED = 300;
const MAX_BOMBS_CAP = 8, RANGE_CAP = 10;
// chance a destroyed brick reveals a power-up, by lobby setting:
const POWERUP_LEVELS = { low: 0.22, medium: 0.42, high: 0.68 };
const POWERUP_LIFE = 7;     // seconds a dropped power-up stays before vanishing
const HUNTER_SPEED_MULT = 1.33;   // sudden-death hunter is this much faster than the fastest survivor

// curse (skull) power-up
const CURSE_TIME = 8;
const CURSE_TYPES = ['reverse', 'fast', 'slow', 'mini', 'nobomb', 'autobomb'];
// gun (rare) power-up
const GUN_BULLETS = 6, BULLET_SPEED = 158, BULLET_LIFE = 2.4;
// bomb throw (glove) power-up
const THROW_DIST = 3, THROW_TIME = 0.32;
// multi-kill announce window (seconds)
const MULTIKILL_WINDOW = 2.2;

const TEAM_COLORS = ['#e6394a', '#2f9be0', '#37c26b', '#f2c026'];
const EMOTES = ['😂', '👍', '😢', '😡', '😎', '🥳', '🤣', '😱'];

// teleports
const TP_LIFE = 4.0;                 // seconds a portal stays on the board
const TP_INTERVAL_MIN = 6, TP_INTERVAL_MAX = 11;
const TP_MAX = 2;                    // max simultaneous portals

const PLAYER_COLORS = [
  '#e6394a', '#2f9be0', '#37c26b', '#f2c026',
  '#a259e6', '#ff8c1a', '#19c7c7', '#ec5fbd',
];

// Bonus avatars for specific accounts (lowercase name -> special id: 'pacman' | 'taz').
// Shown as an extra pick in that player's avatar picker (2nd slot) and used by default.
const SPECIAL_AVATARS = {
  tray: 'pacman',
  tracy: 'pacman',
  taz: 'taz',
};

// Avatar emoji — logged-in players pick one; guests/bots get a default by colour.
const AVATARS = [
  '🐱', '🐶', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🐰', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦗', '🦂', '🦀', '🐍', '🐢', '🐠', '🐟', '🐡', '🐬', '🐳', '🐋', '🦈', '🐙', '🦑', '🦐', '🦞', '🦕', '🦖', '🦎', '🐲', '🦓', '🦒', '🐘', '🦏', '🦛', '🐪', '🐫', '🦙', '🦘', '🦥', '🦦', '🦔', '🐇', '🐹', '🐭',
  '👾', '🤖', '👽', '👻', '💀', '🎃', '🤡', '👹', '👺', '🧟', '🧛', '🧙', '🧞',
  '🍔', '🍕', '🌭', '🍟', '🌮', '🍩', '🍪', '🧁', '🍰', '🍦', '🍭', '🍬', '🍫', '🍿', '🥐', '🍓', '🍉', '🍒', '🍑', '🥭', '🍌', '🍍', '🥥', '🥑', '🌽', '🥕', '🍄', '🥨', '🧀',
  '💩', '⭐', '🌟', '🔥', '⚡', '🌈', '🎈', '🎩', '👑', '💎', '🚀', '🛸', '🎮', '🎲', '🎯', '🏀', '⚽', '🎸', '🥁', '💣',
];

// Fun names for bots (picked randomly, unique per room).
const BOT_NAMES = [
  'Bombík', 'Dynamit', 'Rošťák', 'Prskavec', 'Rachejtle', 'Kanón', 'Petarda', 'Bumbác',
  'Blesk', 'Turbo', 'Šrapnel', 'Ježek', 'Vrták', 'Čmoud', 'Pancíř', 'Střelka', 'Raketa',
  'Kolík', 'Fíra', 'Bagr', 'Sopka', 'Hrom', 'Knedlík', 'Cvalík',
];

const MAPS = [
  { id: 'meadow', name: 'Louka', brickFill: 0.75, pillars: 'full' },
  { id: 'dungeon', name: 'Hradní sklepení', brickFill: 0.78, pillars: 'full' },
  { id: 'lava', name: 'Ohnivá jeskyně', brickFill: 0.72, pillars: 'sparse' },
  { id: 'ice', name: 'Ledová pláň', brickFill: 0.70, pillars: 'open' },
  { id: 'forest', name: 'Kouzelný les', brickFill: 0.80, pillars: 'full' },
  { id: 'space', name: 'Vesmírná loď', brickFill: 0.68, pillars: 'sparse' },
  { id: 'desert', name: 'Pouštní ruiny', brickFill: 0.74, pillars: 'open' },
  { id: 'candy', name: 'Cukrové království', brickFill: 0.82, pillars: 'full' },
  { id: 'neon', name: 'Neonová aréna', brickFill: 0.70, pillars: 'columns' },
  { id: 'jungle', name: 'Divoká džungle', brickFill: 0.80, pillars: 'diag' },
  { id: 'temple', name: 'Ztracený chrám', brickFill: 0.74, pillars: 'rings' },
];
const MAP_BY_ID = Object.fromEntries(MAPS.map(m => [m.id, m]));

function inBounds(c, r, cols, rows) { return c >= 0 && r >= 0 && c < cols && r < rows; }
function tileCenter(i) { return i * TS + TS / 2; }
function cellOf(px) { return Math.floor(px / TS); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function approach(v, target, maxDelta) {
  if (v < target) return Math.min(v + maxDelta, target);
  if (v > target) return Math.max(v - maxDelta, target);
  return v;
}

// Indestructible pillar at an interior even/even cell for this variant?
function pillarAt(variant, c, r, cols, rows) {
  if (c % 2 !== 0 || r % 2 !== 0) return false;   // pillars only ever on even/even -> corridors always open
  const ci = c / 2, ri = r / 2;
  if (variant === 'sparse') return ((ci + ri) % 2) === 0;
  if (variant === 'columns') return ci % 2 === 0;                 // vertical pillar lanes
  if (variant === 'diag') return ((ci + ri) % 3) === 0;           // sparse diagonal lines
  if (variant === 'rings') {
    const ring = Math.min(ci, ri, ((cols - 1) >> 1) - ci, ((rows - 1) >> 1) - ri);
    return ring % 2 === 0;                                        // concentric squares
  }
  if (variant === 'open') {
    const mc = (cols - 1) / 2, mr = (rows - 1) / 2;
    if (Math.abs(c - mc) <= 2 && Math.abs(r - mr) <= 2) return false;
    return true;
  }
  return true; // 'full'
}

// Up to 8 spawn points: 2 -> opposite corners, 4 -> corners, then mid-edges.
function spawnsFor(cols, rows) {
  const mc = (cols - 1) / 2, mr = (rows - 1) / 2;
  return [
    [1, 1], [cols - 2, rows - 2], [cols - 2, 1], [1, rows - 2],
    [mc, 1], [mc, rows - 2], [1, mr], [cols - 2, mr],
  ];
}

// Interior cells in inward clockwise spiral order (for sudden-death walls).
function spiralOrder(cols, rows) {
  const res = [];
  let top = 1, bottom = rows - 2, left = 1, right = cols - 2;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) res.push([c, top]);
    for (let r = top + 1; r <= bottom; r++) res.push([right, r]);
    if (top < bottom) for (let c = right - 1; c >= left; c--) res.push([c, bottom]);
    if (left < right) for (let r = bottom - 1; r >= top + 1; r--) res.push([left, r]);
    top++; bottom--; left++; right--;
  }
  return res;
}

module.exports = {
  TS, PR, EMPTY, SOLID, BRICK, SIZES,
  BASE_SPEED, SPEED_STEP, SPEED_MAX, FUSE, FLAME, KICK_SPEED,
  MAX_BOMBS_CAP, RANGE_CAP, POWERUP_LEVELS, POWERUP_LIFE, HUNTER_SPEED_MULT,
  CURSE_TIME, CURSE_TYPES, GUN_BULLETS, BULLET_SPEED, BULLET_LIFE, THROW_DIST, THROW_TIME,
  MULTIKILL_WINDOW, TEAM_COLORS, EMOTES,
  TP_LIFE, TP_INTERVAL_MIN, TP_INTERVAL_MAX, TP_MAX,
  PLAYER_COLORS, BOT_NAMES, AVATARS, SPECIAL_AVATARS, MAPS, MAP_BY_ID,
  inBounds, tileCenter, cellOf, clamp, approach, pillarAt, spawnsFor, spiralOrder,
};
