// ═══════════════════════════════════════════════════════════
//  🃏 « Mon deck » — éditeur de deck hors combat
//    GET  api/deck?t=  → { name, catalogue, decks, active }
//    POST api/deck?t=  { decks, active }   (enregistrement auto)
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const token = new URLSearchParams(location.search).get('t') || '';
  const api = `api/deck?t=${encodeURIComponent(token)}`;
  const status = document.getElementById('status');

  fetch(api, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'Lien invalide.' : 'Erreur'))))
    .then((data) => {
      status.hidden = true;
      if (data.name) document.getElementById('title').textContent = `Les decks de ${data.name}`;
      DeckEditor.mount(document.getElementById('editor'), {
        catalogue: data.catalogue,
        decks: data.decks,
        active: data.active,
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
