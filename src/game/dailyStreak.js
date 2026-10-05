// ═══════════════════════════════════════════════════════════
//  📅 MODULE SÉRIE DE COMBATS (v2.2, remplace l'idée de « flamme »)
//  Le premier combat allé au bout de la journée (victoire, défaite
//  ou nul ; un combat annulé ne compte pas) fait avancer la série
//  d'un jour et rapporte la récompense de ce jour :
//    jour 1 → 1 JP$ · 2 → 2 · 3 → 4 · 4 → 10 · 5 → 20 · 6 → booster Rare
//  Après le jour 6, la série repart au jour 1.
//
//  Jours ouvrés : le week-end ne casse rien. Un jour ouvré sans combat
//  renvoie au jour 1. Jours comptés à l'heure de Paris.
//
//  Calcul PUR (testé par scripts/test-daily-streak.js) ; l'état
//  { day: 'AAAA-MM-JJ', step: 1…6 } est rangé par src/game/arenaStore.js.
// ═══════════════════════════════════════════════════════════

const { parisDay } = require('../octobreRose');

const REWARDS = [
  { credits: 1 },
  { credits: 2 },
  { credits: 4 },
  { credits: 10 },
  { credits: 20 },
  { booster: 'rare' },
];
const LENGTH = REWARDS.length;

const DAY_MS = 24 * 3600 * 1000;

// « AAAA-MM-JJ » ↔ date à midi UTC (jamais de souci d'heure d'été)
const noon = (day) => Date.parse(`${day}T12:00:00Z`);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const isWeekend = (day) => [0, 6].includes(new Date(noon(day)).getUTCDay());

/** Dernier jour ouvré AVANT `day` (le vendredi pour un lundi). */
function previousBusinessDay(day) {
  let d = dayOf(noon(day) - DAY_MS);
  while (isWeekend(d)) d = dayOf(noon(d) - DAY_MS);
  return d;
}

/** La série de `state` tient-elle encore le jour `today` ? */
function isAlive(state, today) {
  return Boolean(state && state.day && state.step) && state.day >= previousBusinessDay(today);
}

/** Jour de série que rapporterait un combat le jour `today` (1…6). */
function stepFor(state, today) {
  return isAlive(state, today) && state.step < LENGTH ? state.step + 1 : 1;
}

/**
 * Un combat allé au bout le jour `now`.
 * → { state, step, reward } ; `reward` = null si la journée est déjà comptée.
 */
function advance(state, now = Date.now()) {
  const today = parisDay(now);
  if (state && state.day === today) return { state, step: state.step, reward: null };
  const step = stepFor(state, today);
  return { state: { day: today, step }, step, reward: REWARDS[step - 1] };
}

/**
 * Pour l'affichage (Accueil) :
 * → { doneToday, step, next: { step, reward } }
 *   step = jour atteint (0 si pas de série en cours) ;
 *   next = prochain jour à gagner (aujourd'hui, ou au prochain jour joué).
 */
function preview(state, now = Date.now()) {
  const today = parisDay(now);
  const doneToday = Boolean(state && state.day === today);
  const step = doneToday || isAlive(state, today) ? state.step : 0;
  const nextStep = doneToday ? (step < LENGTH ? step + 1 : 1) : stepFor(state, today);
  return { doneToday, step, next: { step: nextStep, reward: REWARDS[nextStep - 1] } };
}

/** « 4 JP$ », « 1 booster Rare » */
function rewardText(reward) {
  if (!reward) return '';
  return reward.booster ? '1 booster Rare' : `${reward.credits} JP$`;
}

module.exports = { REWARDS, LENGTH, previousBusinessDay, isAlive, advance, preview, rewardText };
