// ═══════════════════════════════════════════════════════════
//  🔎 MODULE ANALYSE DE PHOTO (Arène) — Claude Haiku 4.5
//  Lit le CONTENU d'une photo de carte pour que son personnage la
//  reproduise : couvre-chef, coupe de cheveux, lunettes, moustache,
//  pipe / chaîne / cravate…, couleurs, arme adaptée au rôle.
//
//  • Actif si une clé est configurée (sinon les looks se replient sur
//    les couleurs lues dans les pixels, voir looks.js) :
//      – Microsoft Foundry (Azure) : ANTHROPIC_FOUNDRY_API_KEY +
//        ANTHROPIC_FOUNDRY_RESOURCE (ex. « openai-dalle3-dimsi »)
//        ou ANTHROPIC_FOUNDRY_BASE_URL ;
//      – ou l'API Anthropic directe : ANTHROPIC_API_KEY.
//  • La photo est réduite (≤ 640 px, JPEG) avant l'envoi : ~600 tokens,
//    environ 0,2 centime par carte.
//  • Réponse contrainte par un schéma JSON (structured outputs), puis
//    revalidée ici : une valeur hors liste est remplacée, jamais crue.
// ═══════════════════════════════════════════════════════════

const MODEL = 'claude-haiku-4-5';
const MAX_SIDE = 640;

const VOCAB = {
  head: ['none', 'chauve', 'casquette', 'bonnet', 'chapeau', 'couronne', 'casque', 'capuche', 'bandeau', 'cornes', 'pointu', 'beret', 'oreilles', 'aureole'],
  hairStyle: ['court', 'long', 'bol', 'crete', 'boucles', 'chauve', 'queue', 'meches'],
  glasses: ['none', 'lunettes', 'soleil'],
  facial: ['none', 'moustache', 'guidon', 'barbe', 'bouc'],
  accessories: ['pipe', 'cigare', 'chaine', 'cravate', 'noeud_papillon', 'echarpe', 'casque_audio', 'boucle_oreille', 'medaille'],
  weapon: ['epee', 'hache', 'lance', 'dagues', 'masse', 'marteau', 'poings'],
};
const COLOR_KEYS = ['skin', 'hair', 'hatColor', 'outfit', 'outfit2', 'accent'];
const ROLE_LABELS = { tank: 'Tank (un char d’assaut conduit par le personnage)', guerrier: 'Guerrier (combat au corps à corps)', tireur: 'Archer (arc et flèches)', essaim: 'Essaim (petites créatures volantes à son image)', sort: 'Sort (un disque magique)', pompe: 'Pompe (un petit bâtiment)' };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['head', 'hairStyle', 'glasses', 'facial', 'accessories', 'weapon', ...COLOR_KEYS, 'prop', 'vibe'],
  properties: {
    head: { type: 'string', enum: VOCAB.head, description: 'Couvre-chef porté (none si tête nue).' },
    hairStyle: { type: 'string', enum: VOCAB.hairStyle, description: 'Coupe de cheveux visible (chauve si crâne rasé).' },
    glasses: { type: 'string', enum: VOCAB.glasses },
    facial: { type: 'string', enum: VOCAB.facial, description: 'Pilosité du visage. guidon = moustache en guidon de vélo.' },
    accessories: { type: 'array', items: { type: 'string', enum: VOCAB.accessories }, description: 'Accessoires visibles sur le personnage (0 à 3).' },
    weapon: { type: 'string', enum: VOCAB.weapon, description: 'Arme de mêlée la plus fidèle à l’objet tenu ou à l’ambiance.' },
    skin: { type: 'string', description: 'Teinte de peau du visage, #RRGGBB.' },
    hair: { type: 'string', description: 'Couleur des cheveux, #RRGGBB.' },
    hatColor: { type: 'string', description: 'Couleur du couvre-chef (sinon des cheveux), #RRGGBB.' },
    outfit: { type: 'string', description: 'Couleur dominante de la tenue, #RRGGBB.' },
    outfit2: { type: 'string', description: 'Couleur secondaire de la tenue, différente, #RRGGBB.' },
    accent: { type: 'string', description: 'Couleur la plus marquante de la photo, #RRGGBB.' },
    prop: { type: 'string', description: 'Objet notable, un mot français en minuscules (ou none).' },
    vibe: { type: 'string', description: '2 à 4 mots français résumant le costume ou la scène.' },
  },
};

const viaFoundry = () => Boolean(process.env.ANTHROPIC_FOUNDRY_API_KEY);
let disabled = false;   // clé refusée : plus d'appel jusqu'au prochain lancement
const enabled = () => !disabled && (viaFoundry() || Boolean(process.env.ANTHROPIC_API_KEY));

let client = null;
function getClient() {
  if (!client) {
    if (viaFoundry()) {
      const Foundry = require('@anthropic-ai/foundry-sdk');
      client = new (Foundry.default || Foundry.AnthropicFoundry || Foundry)({ maxRetries: 6 });   // lit ANTHROPIC_FOUNDRY_* ; patient face au quota (429)
    } else {
      const Anthropic = require('@anthropic-ai/sdk');
      client = new (Anthropic.default || Anthropic)({ maxRetries: 6 });
    }
  }
  return client;
}

// ─────────────────────────────────────────────
// 🖼️ Réduction de la photo (≤ 640 px) → JPEG
// ─────────────────────────────────────────────

function shrink(pixels) {
  const { width: W, height: H, data } = pixels;
  const k = Math.min(1, MAX_SIDE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const out = Buffer.alloc(w * h * 4);
  // moyenne des pixels source couverts (réduction propre, sans crénelage)
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor(y / k);
    const y1 = Math.min(H, Math.max(y0 + 1, Math.floor((y + 1) / k)));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor(x / k);
      const x1 = Math.min(W, Math.max(x0 + 1, Math.floor((x + 1) / k)));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * W + sx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return require('jpeg-js').encode({ width: w, height: h, data: out }, 85).data;
}

// ─────────────────────────────────────────────
// ✅ Revalidation (on ne croit jamais une valeur hors liste)
// ─────────────────────────────────────────────

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function sanitize(raw, fallback = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (key) => (VOCAB[key].includes(raw[key]) ? raw[key] : VOCAB[key][0]);
  const out = {
    head: pick('head'),
    hairStyle: pick('hairStyle'),
    glasses: pick('glasses'),
    facial: pick('facial'),
    weapon: pick('weapon'),
    accessories: Array.isArray(raw.accessories) ? [...new Set(raw.accessories.filter((a) => VOCAB.accessories.includes(a)))].slice(0, 3) : [],
    prop: typeof raw.prop === 'string' ? raw.prop.toLowerCase().slice(0, 24) : 'none',
    vibe: typeof raw.vibe === 'string' ? raw.vibe.toLowerCase().slice(0, 60) : '',
  };
  for (const k of COLOR_KEYS) out[k] = isHex(raw[k]) ? raw[k].toLowerCase() : (fallback[k] || '#888888');
  return out;
}

// ─────────────────────────────────────────────
// 🔎 Analyse d'une photo → traits (ou null si indisponible / refus)
//    pixels : { width, height, data RGBA } · role : archétype de la carte
// ─────────────────────────────────────────────

async function analyze(pixels, { role = 'guerrier', title = '', logger = console, fallbackColors = {} } = {}) {
  if (!enabled() || !pixels) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  const API = Anthropic.default || Anthropic;
  const image = shrink(pixels).toString('base64');
  const prompt = [
    'Tu décris une carte à collectionner pour dessiner un petit personnage cartoon qui lui ressemble.',
    `Dans le jeu, cette carte est : ${ROLE_LABELS[role] || role}.`,
    title ? `Titre de la carte : « ${title} ».` : '',
    'Décris le personnage PRINCIPAL de la photo (le plus visible) : couvre-chef, coupe de cheveux, lunettes, pilosité, accessoires portés, couleurs réelles (hex lus sur la photo), l’objet notable, et l’arme de mêlée qui colle le mieux à la scène.',
    'Ne décris que ce qui est visible. Pour une valeur incertaine, choisis la plus proche dans la liste.',
  ].filter(Boolean).join('\n');

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: prompt },
        ],
      }],
    });
    if (response.stop_reason === 'refusal') {
      logger.warn(`[lookAnalyzer] refus (${(response.stop_details && response.stop_details.category) || 'sans catégorie'}) : ${title}`);
      return null;
    }
    if (response.stop_reason === 'max_tokens') {
      logger.warn(`[lookAnalyzer] réponse tronquée : ${title}`);
      return null;
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return sanitize(JSON.parse(text), fallbackColors);
  } catch (e) {
    if (e instanceof API.AuthenticationError) logger.error('[lookAnalyzer] ANTHROPIC_API_KEY refusée : analyse désactivée pour ce lancement');
    else if (e instanceof API.RateLimitError) logger.warn(`[lookAnalyzer] limite de débit atteinte (${title}) : réessaie plus tard`);
    else if (e instanceof API.APIError) logger.warn(`[lookAnalyzer] API ${e.status} (${title}) : ${e.message}`);
    else if (e instanceof SyntaxError) logger.warn(`[lookAnalyzer] JSON illisible (${title})`);
    else logger.warn(`[lookAnalyzer] ${title} : ${e.message}`);
    if (e instanceof API.AuthenticationError) disabled = true;
    return null;
  }
}

module.exports = { MODEL, VOCAB, SCHEMA, enabled, analyze, sanitize, shrink };
