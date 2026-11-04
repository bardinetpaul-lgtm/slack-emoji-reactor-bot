// ═══════════════════════════════════════════════════════════
//  🏙️ Jeton personnel de la ville Jeanpip (v4.0)
//  Un seul jeton pour la ville, la Boutique et la Banque :
//    t = <userId>.<hmac>   avec hmac = HMAC-SHA256(secret, « ville|<userId> »)
//  Le « | » évite toute confusion avec les autres liens signés du bot.
//  configure({ getSecret }) est appelé par src/web.js.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

let getSecret = null;

function configure(context) {
  getSecret = context.getSecret;
}

const villeMsg = (userId) => `ville|${userId}`;

/** → hmac hex (64 caractères) du joueur. */
function sign(userId) {
  return crypto.createHmac('sha256', getSecret()).update(villeMsg(userId)).digest('hex');
}

/** → userId si le jeton est valide, sinon null. */
function read(token) {
  const m = /^([A-Z0-9_-]+)\.([a-f0-9]{64})$/i.exec(token || '');
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]), 'hex');
  const given = Buffer.from(m[2], 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? m[1] : null;
}

/** → « t=<jeton encodé> » à coller derrière une route (ville, boutique, banque). */
function query(userId) {
  return `t=${encodeURIComponent(`${userId}.${sign(userId)}`)}`;
}

module.exports = { configure, sign, read, query };
