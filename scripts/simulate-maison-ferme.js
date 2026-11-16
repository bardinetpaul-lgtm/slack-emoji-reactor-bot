#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  📊 Simulation de l'économie de la ferme à Jeanpips (v4.4)
//  Utilise le VRAI moteur (src/maison.js) dans une COPIE temporaire :
//  achat de la ferme, puis récoltes aux heures choisies, sur 4 semaines
//  (week-ends compris, où rien ne pousse).
//  Compare aux chiffres de prod relevés le 2026-11-16 (28 jours, agrégats
//  sans identifiants). Usage : node scripts/simulate-maison-ferme.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Prod, relevé du 2026-11-16 (fenêtre 28 jours, 19 jours ouvrés avec activité) ──
const PROD = {
  workdays: 19,
  activePlayers: 16,
  balances: { p25: 12, mediane: 65.5, p75: 178, p90: 385.5, max: 758, total: 3403 },
  // échanges (trade_hold / trade_refund / trade_sale) exclus : ce sont des transferts entre joueurs
  created: { reaction: 5142, resale: 1599, scratch: 1325, weekly_gift: 845, admin_gift: 376, arena_reward: 300, media_author: 120, bug_bounty: 100, arena_streak: 88 },
  destroyed: { booster: 5805, scratch: 2590, raid: 260 },
  perPlayer28d: { p25: 485, mediane: 667.5, p75: 1088, p90: 1482 },
  perActiveDay: { mediane: 45, p90: 78 },
};

// ── Rythmes de récolte (heures de Paris, jours ouvrés) ──
const PROFILES = [
  { id: '1 visite/jour (9h)', hours: [9] },
  { id: '2 visites (9h, 14h)', hours: [9, 14] },
  { id: '3 visites (9h, 13h, 17h)', hours: [9, 13, 17] },
  { id: 'Acharné (toutes les heures 9h-18h)', hours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18] },
];

// ── Réglages comparés ──
const SCENARIOS = {
  'A - proposition actuelle': [
    { level: 1, name: 'Potager', price: 200, hours: 4, perHour: 1, silo: 8 },
    { level: 2, name: 'Serre', price: 400, hours: 24, perHour: 2, silo: 16 },
    { level: 3, name: 'Ferme', price: 800, hours: 72, perHour: 3, silo: 24 },
  ],
  'C - intermédiaire (A/B)': [
    { level: 1, name: 'Potager', price: 220, hours: 4, perHour: 0.75, silo: 6 },
    { level: 2, name: 'Serre', price: 450, hours: 24, perHour: 1.5, silo: 12 },
    { level: 3, name: 'Ferme', price: 900, hours: 72, perHour: 2.25, silo: 18 },
  ],
  'B - recommandée': [
    { level: 1, name: 'Potager', price: 250, hours: 4, perHour: 0.5, silo: 4 },
    { level: 2, name: 'Serre', price: 500, hours: 24, perHour: 1, silo: 8 },
    { level: 3, name: 'Ferme', price: 1000, hours: 72, perHour: 1.5, silo: 12 },
  ],
};

const START = Date.parse('2026-11-23T08:00:00+01:00'); // lundi 8h, la ferme est déjà construite
const WEEKS = 4;
const WORKDAYS = WEEKS * 5;

function freshEngine() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-simu-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
  fs.mkdirSync(path.join(TMP, 'data'));
  fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));
  const log = console.log; console.log = () => {};
  const maison = require(path.join(TMP, 'src', 'maison.js'));
  const credits = require(path.join(TMP, 'src', 'credits.js'));
  console.log = log;
  return { TMP, maison, credits };
}

const { TMP, maison, credits } = freshEngine();
const r1 = (x) => Math.round(x * 10) / 10;

/** JP$ récoltés en 4 semaines par un joueur au niveau `lvl` qui suit `profile`. */
function run(table, lvl, profile, userId) {
  maison.FARM_LEVELS.splice(1, 3, ...table.map((t) => ({ ...t, name: t.name })));
  credits.setBalance(userId, 100000);
  // chantiers faits avant le début (ils prennent des heures, puis des jours), silo vidé au départ
  let t = START - 7 * 86400e3; // lundi précédent : aucun achat ne tombe un week-end
  for (let l = 1; l <= lvl; l += 1) {
    const r = maison.upgradeFarm(userId, l, t);
    if (!r.ok) throw new Error(`achat refusé : ${r.reason}`);
    t = r.endsAt;
  }
  maison.collect(userId, START);
  let total = 0;
  for (let d = 0; d < WEEKS * 7; d += 1) {
    const dayStart = START - 8 * 3600e3 + d * 86400e3;
    const wd = new Date(dayStart + 12 * 3600e3).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (const h of profile.hours) {
      const r = maison.collect(userId, dayStart + h * 3600e3);
      if (r.ok) total += r.amount;
    }
  }
  return total;
}

const created = Object.values(PROD.created).reduce((a, b) => a + b, 0);
const destroyed = Object.values(PROD.destroyed).reduce((a, b) => a + b, 0);
console.log('=== Prod (28 j, échanges exclus) ===');
console.log(`JP$ créés : ${created} (${r1(created / PROD.workdays)}/jour ouvré) · détruits : ${destroyed} (${r1(destroyed / PROD.workdays)}/jour ouvré)`);
console.log(`Solde net : +${created - destroyed} JP$ en 28 j, soit +${Math.round((100 * (created - destroyed)) / PROD.balances.total)} % de la masse en circulation (${PROD.balances.total})`);
console.log(`Gain médian d'un joueur actif : ${PROD.perActiveDay.mediane} JP$/jour (p90 : ${PROD.perActiveDay.p90})`);

let u = 0;
for (const [name, table] of Object.entries(SCENARIOS)) {
  console.log(`\n=== ${name} ===`);
  console.log(table.map((t) => `${t.name} ${t.price} JP$ (${t.perHour}/h, silo ${t.silo})`).join(' · '));
  const rows = [];
  for (const p of PROFILES) {
    const row = { rythme: p.id };
    let cost = 0; let prevDaily = 0;
    table.forEach((t, i) => {
      cost += t.price;
      const daily = run(table, i + 1, p, `S${(u += 1)}`) / WORKDAYS;
      const extra = daily - prevDaily;
      row[`${t.name} JP$/j`] = r1(daily);
      row[`${t.name} % gain médian`] = Math.round((100 * daily) / PROD.perActiveDay.mediane);
      row[`${t.name} rembourse (j ouvrés)`] = extra > 0 ? Math.ceil(t.price / extra) : '∞';
      prevDaily = daily;
    });
    rows.push(row);
  }
  console.table(rows);
  // Effet global : la moitié des actifs au 1er niveau, 2 visites/jour
  const potager = rows[1][`${table[0].name} JP$/j`];
  const n = Math.round(PROD.activePlayers / 2);
  console.log(`Si ${n} joueurs ont le ${table[0].name} (2 visites) : +${r1(n * potager)} JP$/jour ouvré créés, soit +${Math.round((100 * n * potager) / (created / PROD.workdays))} % de la création actuelle`);
  const top = rows[1][`${table[2].name} JP$/j`];
  console.log(`Si les 2 plus gros joueurs ont la ${table[2].name} (2 visites) : +${r1(2 * top)} JP$/jour ouvré, soit +${Math.round((100 * 2 * top) / (created / PROD.workdays))} %`);
}

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* */ }
fs.rmSync(TMP, { recursive: true, force: true });
