// ═══════════════════════════════════════════════════════════
//  🚨 MODULE CARTES ANTI-SPAM
//  Les 10 photos troll envoyées en rafale à un spammeur. Elles ne
//  sont PAS dans la banque de médias (jamais tirées au hasard) mais
//  entrent dans la collection de celui qui les reçoit : intercalaire
//  « Hors série » du classeur, hors pourcentage de complétion.
//
//  Numéros FIXES #62 → #71 (« Surprise #N ») : ne jamais les modifier
//  (réservés dans src/media.js, RESERVED_NUMBER_MAX).
// ═══════════════════════════════════════════════════════════

const SPAM_PHOTO_START = 62;

const SPAM_PHOTO_URLS = [
  'https://slack-files.com/T6EFSEHCN-F0BDBMU8CTS-77c6932553',
  'https://slack-files.com/T6EFSEHCN-F0BCE3SGC7P-941026d6a8',
  'https://slack-files.com/T6EFSEHCN-F0BC21YHVAB-83455d1ed8',
  'https://slack-files.com/T6EFSEHCN-F0BDBQLPEF2-af87fefb2a',
  'https://slack-files.com/T6EFSEHCN-F0BCE55GUBX-07592141a1',
  'https://slack-files.com/T6EFSEHCN-F0BCE5J6URK-53abe5b196',
  'https://slack-files.com/T6EFSEHCN-F0BC23V6JKH-e490b68a5e',
  'https://slack-files.com/T6EFSEHCN-F0BCB7W1FH9-737f44b887',
  'https://slack-files.com/T6EFSEHCN-F0BCFG6PKFY-7090b859e8',
  'https://slack-files.com/T6EFSEHCN-F0BCM8HH7FE-514efee20f',
];

// Cartes dans l'ordre d'envoi : { type, url, title: '🚨 Surprise #N', rarity, number }
const SPAM_CARDS = SPAM_PHOTO_URLS.map((url, i) => ({
  type: 'image',
  url,
  title: `🚨 Surprise #${SPAM_PHOTO_START + i}`,
  rarity: 'spam',
  number: SPAM_PHOTO_START + i,
}));

module.exports = { SPAM_CARDS, SPAM_PHOTO_START };
