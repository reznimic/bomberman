'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AVATARS } = require('./constants');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'users.json');
const TOKEN_DAYS = 90;               // "remember me" lifetime
const NAME_RE = /^[\p{L}\p{N} _.\-]{3,14}$/u;

let accounts = {};                   // key: name.toLowerCase()

function load() {
  try {
    accounts = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { accounts = {}; }
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(accounts));
    } catch (e) { console.error('users.json save failed:', e.message); }
  }, 800);
}
load();

// async so the (deliberately slow) scrypt never blocks the game's event loop
function hash(pass, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pass, salt, 64, (err, key) => err ? reject(err) : resolve(key.toString('hex')));
  });
}
function newToken(acc) {
  const token = crypto.randomBytes(24).toString('hex');
  acc.tokens[token] = Date.now() + TOKEN_DAYS * 864e5;
  return token;
}
function publicStats(acc) {
  return {
    name: acc.name,
    avatar: acc.avatar || AVATARS[0],
    stats: acc.stats,
  };
}

function isNameTaken(name) {
  return !!accounts[String(name).toLowerCase()];
}

async function register(name, pass) {
  name = String(name || '').trim();
  pass = String(pass || '');
  if (!NAME_RE.test(name)) return { error: 'Jméno: 3–14 znaků (písmena, čísla, mezera, _ . -).' };
  if (pass.length < 4 || pass.length > 200) return { error: 'Heslo musí mít 4–200 znaků.' };
  const key = name.toLowerCase();
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return { error: 'Toto jméno nelze použít.' };
  if (accounts[key]) return { error: 'Toto jméno už je zabrané.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const acc = {
    name, salt, hash: await hash(pass, salt), created: Date.now(), tokens: {},
    avatar: AVATARS[(Math.random() * AVATARS.length) | 0],
    stats: { games: 0, wins: 0, kills: 0, deaths: 0, bonuses: 0, vs: {} },
  };
  accounts[key] = acc;
  const token = newToken(acc);
  save();
  return { ok: true, token, ...publicStats(acc) };
}

async function login(name, pass) {
  const acc = accounts[String(name || '').trim().toLowerCase()];
  if (!acc) return { error: 'Účet neexistuje.' };
  const h = await hash(String(pass || ''), acc.salt);
  const ok = h.length === acc.hash.length &&
    crypto.timingSafeEqual(Buffer.from(h), Buffer.from(acc.hash));
  if (!ok) return { error: 'Špatné heslo.' };
  const token = newToken(acc);
  save();
  return { ok: true, token, ...publicStats(acc) };
}

function validate(token) {
  if (!token) return null;
  for (const key of Object.keys(accounts)) {
    const acc = accounts[key];
    const exp = acc.tokens && acc.tokens[token];
    if (exp) {
      if (exp < Date.now()) { delete acc.tokens[token]; save(); return null; }
      return acc;
    }
  }
  return null;
}

function logout(token) {
  const acc = validate(token);
  if (acc) { delete acc.tokens[token]; save(); }
}

// delta: { win, games, kills, deaths, bonuses, vs:{oppName:{k,d}} }
function recordGame(name, delta) {
  const acc = accounts[String(name || '').toLowerCase()];
  if (!acc) return;
  const s = acc.stats;
  s.games += delta.games || 0;
  s.wins += delta.win || 0;
  s.kills += delta.kills || 0;
  s.deaths += delta.deaths || 0;
  s.bonuses += delta.bonuses || 0;
  const has = Object.prototype.hasOwnProperty;
  for (const [opp, kv] of Object.entries(delta.vs || {})) {
    // never let an opponent name touch the prototype chain (e.g. a player named __proto__)
    if (opp === '__proto__' || opp === 'constructor' || opp === 'prototype') continue;
    const v = has.call(s.vs, opp) ? s.vs[opp] : (s.vs[opp] = { k: 0, d: 0 });
    v.k += kv.k || 0;
    v.d += kv.d || 0;
  }
  save();
}

function statsOf(name) {
  const acc = accounts[String(name || '').toLowerCase()];
  return acc ? publicStats(acc) : null;
}
function avatarOf(name) {
  const acc = accounts[String(name || '').toLowerCase()];
  return acc ? (acc.avatar || AVATARS[0]) : null;
}
function setAvatar(token, avatar) {
  const acc = validate(token);
  if (!acc) return { error: 'invalid' };
  if (!AVATARS.includes(avatar)) return { error: 'Neplatný avatar.' };
  acc.avatar = avatar;
  save();
  return { ok: true, avatar };
}

module.exports = { register, login, validate, logout, isNameTaken, recordGame, publicStats, statsOf, avatarOf, setAvatar };
