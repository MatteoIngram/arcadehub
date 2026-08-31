// Shared name blocklist — imported unchanged by the client (for instant
// feedback before ever hitting the network) and the Edge Function (the
// actual enforcement point, since client-side checks alone are trivially
// bypassed by calling the API directly). Matching is deliberately simple:
// lowercase, strip everything but letters/digits, then substring-match. Full
// words rather than short fragments (e.g. "asshole" not "ass") to avoid
// flagging innocuous names that happen to contain a common short substring.
const BANNED_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dickhead', 'piss',
  'cunt', 'whore', 'slut', 'faggot', 'retard', 'nigger', 'nigga',
  'chink', 'spic', 'kike', 'tranny', 'rape', 'nazi', 'hitler',
];

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function containsBannedWord(text) {
  const normalized = normalize(text);
  return BANNED_WORDS.some((word) => normalized.includes(word));
}
