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

module.exports = {
  isValidEmail, required, maxLen, oneOf, intInRange,
  POSITIONS, SCOUT_ROLES, BIRTH_YEAR_MIN, BIRTH_YEAR_MAX
};
