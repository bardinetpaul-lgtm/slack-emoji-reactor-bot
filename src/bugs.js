// ═══════════════════════════════════════════════════════════
//  🐛 MODULE BUGS SIGNALÉS (v2.2.1)
//  Un joueur signale un bug (description + captures facultatives).
//  Un admin le valide (→ +10 JP$ pour l'auteur) ou le refuse, puis
//  le marque « corrigé » depuis l'Accueil (→ DM à l'auteur).
//
//  Statuts : pending → validated | refused ; validated → fixed.
//  Chaque passage n'a lieu qu'UNE fois (premier admin qui clique) :
//  les 10 JP$ ne peuvent jamais être versés deux fois.
//
//  DB = fichier JSON local (data/bugs.json)
//    { nextId, bugs: [{ id, reporter, text, files: [{ id, name, mimetype }], at,
//                       status, decidedBy, decidedAt, fixedBy, fixedAt,
//                       adminMessages: [{ adminId, channel, ts }] }] }
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');

const BUGS_PATH = path.join(__dirname, '..', 'data', 'bugs.json');

const REWARD = 10;              // JP$ pour un bug validé
const TEXT_MAX = 2000;          // longueur max d'une description
const MAX_FILES = 3;            // captures par signalement

function load() {
  try {
    const data = readJson(BUGS_PATH, {}) || {};
    return { nextId: Number(data.nextId) || 1, bugs: Array.isArray(data.bugs) ? data.bugs : [] };
  } catch {
    return { nextId: 1, bugs: [] };
  }
}

function save(data) {
  try {
    writeJsonAtomic(BUGS_PATH, data);
  } catch (e) {
    console.error('[bugs] écriture:', e.message);
  }
}

/** Nouveau signalement → le bug créé. */
function create(reporter, text, files = [], now = Date.now()) {
  const data = load();
  const bug = {
    id: data.nextId,
    reporter,
    text: String(text || '').trim().slice(0, TEXT_MAX),
    files: files.slice(0, MAX_FILES).map((f) => ({ id: f.id, name: f.name || null, mimetype: f.mimetype || null })),
    at: new Date(now).toISOString(),
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    fixedBy: null,
    fixedAt: null,
    adminMessages: [],
  };
  data.nextId += 1;
  data.bugs.push(bug);
  save(data);
  return bug;
}

function get(id) {
  return load().bugs.find((b) => b.id === Number(id)) || null;
}

/** Change le statut si le bug est bien dans `from` → { ok, bug } ou { ok: false, reason, bug } */
function transition(id, from, to, fields) {
  const data = load();
  const bug = data.bugs.find((b) => b.id === Number(id));
  if (!bug) return { ok: false, reason: 'not_found', bug: null };
  if (bug.status !== from) return { ok: false, reason: 'already', bug };
  Object.assign(bug, fields, { status: to });
  save(data);
  return { ok: true, bug };
}

/** Admin : ✅ valider (true) ou ✖️ refuser (false) un bug en attente. */
function decide(id, adminId, accept, now = Date.now()) {
  return transition(id, 'pending', accept ? 'validated' : 'refused', { decidedBy: adminId, decidedAt: new Date(now).toISOString() });
}

/** Admin : 🛠️ bug validé → corrigé. */
function markFixed(id, adminId, now = Date.now()) {
  return transition(id, 'validated', 'fixed', { fixedBy: adminId, fixedAt: new Date(now).toISOString() });
}

/** Mémorise les DM envoyés aux admins (pour les mettre à jour après décision). */
function setAdminMessages(id, refs) {
  const data = load();
  const bug = data.bugs.find((b) => b.id === Number(id));
  if (!bug) return;
  bug.adminMessages = refs.filter(Boolean);
  save(data);
}

/** Bugs d'un statut, du plus ancien au plus récent. */
function list(status) {
  return load().bugs.filter((b) => !status || b.status === status);
}

/** → { pending, validated, refused, fixed } */
function counts() {
  const out = { pending: 0, validated: 0, refused: 0, fixed: 0 };
  for (const b of load().bugs) out[b.status] = (out[b.status] || 0) + 1;
  return out;
}

module.exports = { REWARD, TEXT_MAX, MAX_FILES, create, get, decide, markFixed, setAdminMessages, list, counts };
