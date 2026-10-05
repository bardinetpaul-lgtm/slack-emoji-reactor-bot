#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de la série de combats (src/game/dailyStreak.js)
//
//  Récompenses jour 1 → 6, une fois par jour, week-end neutre,
//  jour ouvré manqué, retour au jour 1 après le jour 6, heure de Paris.
//
//  Usage : node scripts/test-daily-streak.js
// ═══════════════════════════════════════════════════════════
const path = require('path');
const streak = require(path.join(__dirname, '..', 'src', 'game', 'dailyStreak.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// Midi à Paris (10 h UTC en heure d'été) ; 2026-10-05 = lundi
const at = (day, hour = 12) => Date.parse(`${day}T${String(hour - 2).padStart(2, '0')}:00:00Z`);

/** Joue un combat par jour listé → récompenses obtenues */
function play(days, state = null) {
  const got = [];
  for (const d of days) {
    const r = streak.advance(state, at(d));
    state = r.state;
    got.push(r.reward);
  }
  return { state, got };
}

// ─── Les 6 jours, du lundi au lundi suivant (week-end au milieu) ───
const week = play(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12']);
check('jour 1 → 1 JP$', week.got[0].credits === 1);
check('jour 2 → 2 JP$', week.got[1].credits === 2);
check('jour 3 → 4 JP$', week.got[2].credits === 4);
check('jour 4 → 10 JP$', week.got[3].credits === 10);
check('jour 5 → 20 JP$', week.got[4].credits === 20);
check('jour 6 (lundi, après le week-end) → booster Rare', week.got[5].booster === 'rare' && !week.got[5].credits);
check('après le jour 6 : la série repart au jour 1', streak.advance(week.state, at('2026-10-13')).step === 1);

// ─── Une seule récompense par jour ───
const first = streak.advance(null, at('2026-10-05', 9));
const second = streak.advance(first.state, at('2026-10-05', 18));
check('2e combat du même jour : rien de plus', second.reward === null && second.step === 1);

// ─── Jour ouvré manqué ───
const gap = play(['2026-10-05', '2026-10-06', '2026-10-08']);
check('mardi puis jeudi (mercredi manqué) : retour au jour 1', gap.got[2].credits === 1 && gap.state.step === 1);

// ─── Week-end ───
check('vendredi → lundi : la série continue', play(['2026-10-09', '2026-10-12']).state.step === 2);
check('vendredi → samedi → lundi : la série continue', play(['2026-10-09', '2026-10-10', '2026-10-12']).state.step === 3);
check('jeudi → lundi (vendredi manqué) : retour au jour 1', play(['2026-10-08', '2026-10-12']).state.step === 1);

// ─── Heure de Paris : 23 h 30 et 00 h 30 sont deux jours différents ───
const late = streak.advance(null, Date.parse('2026-10-05T21:30:00Z'));       // lundi 23 h 30 à Paris
const early = streak.advance(late.state, Date.parse('2026-10-05T22:30:00Z')); // mardi 00 h 30 à Paris
check('minuit à Paris : nouveau jour de série', late.state.day === '2026-10-05' && early.state.day === '2026-10-06' && early.step === 2);

// ─── Jour ouvré précédent ───
check('jour ouvré avant un lundi = vendredi', streak.previousBusinessDay('2026-10-12') === '2026-10-09');
check('jour ouvré avant un dimanche = vendredi', streak.previousBusinessDay('2026-10-11') === '2026-10-09');
check('jour ouvré avant un mercredi = mardi', streak.previousBusinessDay('2026-10-07') === '2026-10-06');

// ─── Aperçu (Accueil) ───
const none = streak.preview(null, at('2026-10-05'));
check('aperçu sans série : jour 0, prochain = jour 1 (1 JP$)', none.step === 0 && !none.doneToday && none.next.step === 1 && none.next.reward.credits === 1);
const done = streak.preview({ day: '2026-10-07', step: 3 }, at('2026-10-07'));
check('aperçu, déjà joué : jour 3 ✅, prochain = jour 4 (10 JP$)', done.doneToday && done.step === 3 && done.next.reward.credits === 10);
const pending = streak.preview({ day: '2026-10-07', step: 3 }, at('2026-10-08'));
check('aperçu le lendemain : jour 3, à jouer = jour 4', !pending.doneToday && pending.step === 3 && pending.next.step === 4);
const broken = streak.preview({ day: '2026-10-05', step: 4 }, at('2026-10-08'));
check('aperçu, série cassée : jour 0, prochain = jour 1', broken.step === 0 && broken.next.step === 1);
const full = streak.preview({ day: '2026-10-07', step: 6 }, at('2026-10-07'));
check('aperçu après le jour 6 : prochain = jour 1', full.step === 6 && full.next.step === 1);
check('texte : 1 booster Rare / 4 JP$', streak.rewardText({ booster: 'rare' }) === '1 booster Rare' && streak.rewardText({ credits: 4 }) === '4 JP$');

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
