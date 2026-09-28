// ═══════════════════════════════════════════════════════════
//  📦 ENVOI DIFFÉRENTIEL DES ÉTATS DE COMBAT (serveur + navigateur)
//
//  10 états par seconde et par joueur : on n'envoie que ce qui bouge.
//    • unité : décrite UNE fois à son apparition (camp,
//      archétype, PV max, place dans le groupe…), puis
//      [id, x, y, pv, états] (états = gelée / ralentie / bouclier / retraite),
//      + [.., cibleY, cibleX] quand elle frappe (flèches, coups) ;
//    • bâtiment : décrit une fois, puis [id, pv, debout, protégé] ;
//    • main + carte suivante, Capitaine : seulement quand ils changent ;
//    • le reste (chrono, élixir, poses, événements) tel quel.
//  Un encodeur par flux (serveur), un décodeur par page (navigateur) :
//  decode(encode(vue)) redonne exactement la vue.
//  Les phases hors combat passent telles quelles.
//
//  Node : require('public/arena-wire.js') · Navigateur : window.ArenaWire
// ═══════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaWire = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const UNIT_LIVE = ['x', 'y', 'lane', 'hp', 'frozen', 'slowed', 'shield', 'recalling', 'atk', 'atkX'];
  const BUILDING_LIVE = ['hp', 'alive', 'shielded'];
  // états d'une unité ⇄ masque de bits
  const FLAGS = ['frozen', 'slowed', 'shield', 'recalling'];
  const toMask = (u) => FLAGS.reduce((m, f, i) => (u[f] ? m | (1 << i) : m), 0);
  const fromMask = (m) => Object.fromEntries(FLAGS.map((f, i) => [f, Boolean(m & (1 << i))]));

  const without = (obj, keys) => {
    const out = {};
    for (const k of Object.keys(obj)) if (!keys.includes(k) && obj[k] !== undefined) out[k] = obj[k];
    return out;
  };

  function createEncoder() {
    let units = new Set();
    let buildings = new Set();
    let handKey = null;
    let userIds = {};
    let captainKeys = {};

    function reset() {
      units = new Set();
      buildings = new Set();
      handKey = null;
      userIds = {};
      captainKeys = {};
    }

    function encode(view) {
      if (!view || view.phase !== 'running') return view;
      const { players, units: us, buildings: bs, ...rest } = view;
      const out = { ...rest, _d: 1, u: [], b: [] };

      out.p = {};
      for (const side of Object.keys(players)) {
        const { hand, next, userId, captain, ...live } = players[side];
        const p = { ...live };
        if (userIds[side] !== userId) { p.userId = userId; userIds[side] = userId; }
        const capKey = JSON.stringify(captain === undefined ? null : captain);
        if (captainKeys[side] !== capKey) { p.captain = captain === undefined ? null : captain; captainKeys[side] = capKey; }
        if (hand) {
          const key = JSON.stringify([hand, next]);
          if (key !== handKey) { p.hand = hand; p.next = next; handKey = key; }
        }
        out.p[side] = p;
      }

      for (const u of us) {
        if (!units.has(u.id)) {
          units.add(u.id);
          (out.un = out.un || []).push(without(u, UNIT_LIVE));
        }
        const row = [u.id, u.x, u.y, u.hp, toMask(u)];
        if (typeof u.atk === 'number') row.push(u.atk, u.atkX);   // ⚔️ en train de frapper
        out.u.push(row);
      }
      units = new Set(us.map((u) => u.id));   // les morts sont oubliés

      for (const b of bs) {
        if (!buildings.has(b.id)) {
          buildings.add(b.id);
          (out.bn = out.bn || []).push(without(b, BUILDING_LIVE));
        }
        out.b.push([b.id, b.hp, b.alive ? 1 : 0, b.shielded ? 1 : 0]);
      }
      return out;
    }

    return { encode, reset };
  }

  function createDecoder() {
    let unitInfo = new Map();
    let buildingInfo = new Map();
    let hands = {};
    let userIds = {};
    let captains = {};

    function reset() {
      unitInfo = new Map();
      buildingInfo = new Map();
      hands = {};
      userIds = {};
      captains = {};
    }

    function decode(packet) {
      if (!packet || !packet._d) return packet;
      const { _d, u, un, b, bn, p, ...rest } = packet;
      for (const info of un || []) unitInfo.set(info.id, info);
      for (const info of bn || []) buildingInfo.set(info.id, info);

      const players = {};
      for (const side of Object.keys(p)) {
        const { hand, next, userId, captain, ...live } = p[side];
        if (userId !== undefined) userIds[side] = userId;
        if (captain !== undefined) captains[side] = captain;
        if (hand) hands[side] = { hand, next };
        players[side] = { userId: userIds[side], captain: captains[side] === undefined ? null : captains[side], ...live };
        if (side === rest.you && hands[side]) {
          players[side].hand = hands[side].hand;
          players[side].next = hands[side].next;
        }
      }

      const units = u.map(([id, x, y, hp, mask, atk, atkX]) => ({
        ...unitInfo.get(id), x, y, hp, ...fromMask(mask),
        lane: x < 33.5 ? 0 : x > 66.5 ? 2 : 1,
        atk: typeof atk === 'number' ? atk : null, atkX: typeof atkX === 'number' ? atkX : null,
      }));
      const alive = new Set(u.map(([id]) => id));
      for (const id of unitInfo.keys()) if (!alive.has(id)) unitInfo.delete(id);

      const buildings = b.map(([id, hp, up, sh]) => ({ ...buildingInfo.get(id), hp, alive: up === 1, shielded: sh === 1 }));
      return { ...rest, players, units, buildings };
    }

    return { decode, reset };
  }

  return { createEncoder, createDecoder };
}));
