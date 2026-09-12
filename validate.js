// Small server-side validation helpers. Client-side `required`/`type=`
// attributes on <input> are trivially bypassed by anyone POSTing directly,
// so every one of these checks is enforced again here before data reaches
// db.js — this is the actual boundary, not the HTML form.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(s) {
  return typeof s === 'string' && EMAIL_RE.test(s.trim());
}

function required(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

function maxLen(s, n) {
  return typeof s !== 'string' || s.length <= n;
}

function oneOf(s, allowed) {
  return allowed.includes(s);
}

// Parses a string as an integer within [min, max]; returns null if it isn't
// (covers empty, non-numeric, decimal, out-of-range, and negative-when-
// unwanted in one check).
function intInRange(s, min, max) {
  if (typeof s !== 'string' || s.trim() === '') return null;
  if (!/^-?\d+$/.test(s.trim())) return null;
  const n = parseInt(s, 10);
  if (n < min || n > max) return null;
  return n;
}

const POSITIONS = ['GK', 'LB', 'CB', 'RB', 'CDM', 'CM', 'LM', 'RM', 'CAM', 'ST', 'RW', 'LW'];
const SCOUT_ROLES = ['Scout', 'Academy director', 'Agent'];
const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEAR_MIN = 1930;
const BIRTH_YEAR_MAX = CURRENT_YEAR;

// The three federation sites a season's source link can be checked against —
// researched directly (robots.txt + real player pages opened), not assumed.
// Latvia (lff.lv) has no individual player pages at all, just name-only
// top-scorer lists. Lithuania (lietuvosfutbolas.lt) and Estonia (jalgpall.ee)
// both have real per-player pages with a stable numeric ID; Estonia's also
// pre-aggregates season/competition stats, Lithuania's doesn't.
const FEDERATIONS = {
  LV: { domain: 'lff.lv' },
  LT: { domain: 'lietuvosfutbolas.lt' },
  EE: { domain: 'jalgpall.ee' }
};

// A season's source_url must actually point at the player's own federation's
// site — otherwise a Latvian-registered player could submit an Estonian
// stats link (or anything else) and there'd be nothing for admin to check
// against. Domain match only (not full URL validation, since links here are
// pasted without a protocol, e.g. "lff.lv/spelotajs/...").
function isValidSourceUrl(url, federation) {
  const domain = FEDERATIONS[federation] && FEDERATIONS[federation].domain;
  if (!domain || typeof url !== 'string') return false;
  const bare = url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return bare.toLowerCase().startsWith(domain);
}

module.exports = {
  isValidEmail, required, maxLen, oneOf, intInRange,
  POSITIONS, SCOUT_ROLES, BIRTH_YEAR_MIN, BIRTH_YEAR_MAX,
  FEDERATIONS, isValidSourceUrl
};
