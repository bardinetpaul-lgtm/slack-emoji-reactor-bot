// ═══════════════════════════════════════════════════════════
//  🃏 « Mon deck » — éditeur de deck hors combat
//    GET  api/deck?t=  → { name, catalogue, decks, active }
//    POST api/deck?t=  { decks, active }   (enregistrement auto)
//                      { tutorial: true }   (🎓 tuto vu : plus montré d'office)
//                      { tvOptOut: bool }   (📺 ne pas me diffuser sur JP TV)
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const token = new URLSearchParams(location.search).get('t') || '';
  const api = `api/deck?t=${encodeURIComponent(token)}`;
  const status = document.getElementById('status');

  // 🎓 Tuto : d'office à la première ouverture, puis via « ❓ Tuto »
  const markSeen = () => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tutorial: true }) }).catch(() => {});
  const openTutorial = () => ArenaTutorial.open({ onDone: (completed) => { if (completed) markSeen(); } });
  document.getElementById('tuto-btn').addEventListener('click', openTutorial);
  // 🏆 Classement : relu à chaque ouverture
  document.getElementById('ranking-btn').addEventListener('click', () => ArenaRanking.open(`api/deck/ranking?t=${encodeURIComponent(token)}`));

  fetch(api, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'Lien invalide.' : 'Erreur'))))
    .then((data) => {
      status.hidden = true;
      // 📺 JP TV : refus de diffusion en direct (enregistré tout de suite)
      const tvOpt = document.getElementById('tv-opt');
      tvOpt.checked = Boolean(data.tvOptOut);
      tvOpt.addEventListener('change', () => fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tvOptOut: tvOpt.checked }),
      }).catch(() => { status.hidden = false; status.textContent = 'Enregistrement impossible, vérifie ta connexion.'; }));
      if (data.tutorialSeen === false) openTutorial();
      if (data.name) document.getElementById('title').textContent = `Les decks de ${data.name}`;
      DeckEditor.mount(document.getElementById('editor'), {
        catalogue: data.catalogue,
        decks: data.decks,
        active: data.active,
        captains: data.captains,
        specialties: data.specialties,
        mode: 'standalone',
        onSave: (value) => fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        }).catch(() => { status.hidden = false; status.textContent = 'Enregistrement impossible, vérifie ta connexion.'; }),
      });
    })
    .catch((e) => { status.textContent = e.message === 'Lien invalide.' ? 'Ce lien n’est pas valide. Rouvre « Mon deck » depuis Slack.' : 'Impossible de charger ta collection.'; });
}());
