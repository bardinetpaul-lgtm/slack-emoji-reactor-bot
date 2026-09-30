// ═══════════════════════════════════════════════════════════
//  ⏱️ STATS — filtres et découpage du temps (heure de Paris)
// ═══════════════════════════════════════════════════════════

const TZ = 'Europe/Paris';
const DAY_MS = 24 * 3600 * 1000;
const MAX_RANGE_MS = 3 * 366 * DAY_MS;
const GRAINS = new Set(['day', 'week', 'month']);

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ });
const parisDay = (iso) => dayFmt.format(new Date(iso));

function bucketKey(iso, grain) {
  const day = parisDay(iso);
  if (grain === 'month') return day.slice(0, 7);
  if (grain === 'week') {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return day;
}

/** Clés de buckets couvrant [from, to], dans l'ordre. */
function bucketsBetween(from, to, grain) {
  const keys = [];
  const last = parisDay(to);
  const d = new Date(`${parisDay(from)}T12:00:00Z`);   // midi UTC = même jour à Paris
  for (;;) {
    const day = d.toISOString().slice(0, 10);
    if (day > last) break;
    const k = bucketKey(`${day}T12:00:00Z`, grain);
    if (keys[keys.length - 1] !== k) keys.push(k);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return keys;
}

function badFilter(message) {
  const e = new Error(message);
  e.code = 'BAD_FILTER';
  return e;
}

function toIso(value, name) {
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw badFilter(`${name} invalide`);
  return new Date(t).toISOString();
}

function normalizeFilters({ from, to, grain = 'day', user = null, source = null } = {}, now = Date.now()) {
  const toIsoV = to ? toIso(to, 'to') : new Date(now).toISOString();
  const fromIsoV = from ? toIso(from, 'from') : new Date(Date.parse(toIsoV) - 30 * DAY_MS).toISOString();
  if (fromIsoV > toIsoV) throw badFilter('from après to');
  if (Date.parse(toIsoV) - Date.parse(fromIsoV) > MAX_RANGE_MS) throw badFilter('période trop longue (3 ans max)');
  if (!GRAINS.has(grain)) throw badFilter('grain invalide');
  if (user && !/^[A-Z0-9]{2,32}$/.test(user)) throw badFilter('user invalide');
  if (source && !/^[a-z_]{1,32}$/.test(source)) throw badFilter('source invalide');
  return { from: fromIsoV, to: toIsoV, grain, user: user || null, source: source || null };
}

const sum = (values) => values.reduce((s, v) => s + v, 0);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Index de bucket d'une date (dernier bucket si hors bornes à cause d'arrondis). */
function indexer(keys, grain) {
  const idx = new Map(keys.map((k, i) => [k, i]));
  return (iso) => idx.get(bucketKey(iso, grain)) ?? keys.length - 1;
}

/** Minuit à Paris du jour 'YYYY-MM-DD', en ISO UTC (22 h ou 23 h UTC la veille). */
function parisMidnightIso(day) {
  const base = Date.parse(`${day}T00:00:00Z`);
  for (const h of [2, 1]) {
    const t = base - h * 3600 * 1000;
    if (parisDay(new Date(t).toISOString()) === day && parisDay(new Date(t - 1).toISOString()) !== day) return new Date(t).toISOString();
  }
  return new Date(base).toISOString();
}

/**
 * Buckets avec leurs bornes UTC : [{ key, start, end, last }].
 * Un mouvement appartient au bucket si start <= at < end (at <= end pour le dernier).
 * Sert aux agrégations SQL (GROUP BY par bucket, via l'index sur `at`).
 */
function bucketBounds(from, to, grain) {
  const keys = bucketsBetween(from, to, grain);
  const firstDay = (k) => (grain === 'month' ? `${k}-01` : k);
  const starts = keys.map((k, i) => (i === 0 ? from : parisMidnightIso(firstDay(k))));
  return keys.map((key, i) => ({ key, start: starts[i], end: i < keys.length - 1 ? starts[i + 1] : to, last: i === keys.length - 1 }));
}

module.exports = { TZ, DAY_MS, parisDay, bucketKey, bucketsBetween, bucketBounds, parisMidnightIso, normalizeFilters, sum, round, median, indexer };
