// Lightweight profanity filter for usernames
// Checks exact matches and substring matches against common English profanity
const BLOCKED = [
  'fuck','shit','ass','bitch','cunt','dick','cock','pussy','bastard',
  'damn','hell','whore','slut','fag','faggot','nigger','nigga','retard',
  'wank','twat','bollocks','piss','crap','douche','dildo','jizz',
  'tits','boob','anus','penis','vagina','scrotum','cum','semen',
  'homo','dyke','tranny','chink','spic','wetback','kike','gook',
  'pedo','rape','molest','nazi','hitler',
];

// Also block leet-speak variants: @ for a, 0 for o, 1 for i/l, 3 for e, $ for s, 5 for s
function normalize(str) {
  return str.toLowerCase()
    .replace(/@/g, 'a')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/[_\-.\s]/g, ''); // strip separators used to bypass filters
}

export function isProfane(username) {
  const norm = normalize(username);
  return BLOCKED.some(word => norm.includes(word));
}

export function validateUsername(username) {
  if (!username || !username.trim()) return 'Username is required';
  const trimmed = username.trim();
  if (trimmed.length < 3) return 'Must be at least 3 characters';
  if (trimmed.length > 20) return 'Must be 20 characters or less';
  if (!/^[a-zA-Z0-9_.\-]+$/.test(trimmed)) return 'Only letters, numbers, _ . - allowed';
  if (isProfane(trimmed)) return 'That username is not allowed';
  return null; // valid
}
