'use strict';

const { levenshtein } = require('./levenshtein');
const { resolvePointer: walk, UNRESOLVED } = require('./pointer');

// Hand-coded format hints. Keep <=60 chars per text.
const FORMAT_HINTS = {
  email: (val) => {
    if (typeof val !== 'string') return null;
    if (!val.includes('@')) return "missing '@' and domain part";
    if (val.split('@').length > 2) return "multiple '@' characters";
    const [, dom] = val.split('@');
    if (!dom || !dom.includes('.')) return 'domain part missing dot';
    return null;
  },
  date: (val) => {
    if (typeof val !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
    if (!m) return 'expected YYYY-MM-DD layout';
    const mo = +m[2]; if (mo < 1 || mo > 12) return 'month must be 01-12';
    const d = +m[3]; if (d < 1 || d > 31) return 'day must be 01-31';
    return null;
  },
  uuid: (val) => {
    if (typeof val !== 'string') return null;
    if (!/^[0-9a-fA-F-]+$/.test(val)) return 'expected hex digits and dashes';
    return 'expected 8-4-4-4-12 hex layout';
  },
  ipv4: (val) => typeof val === 'string' ? 'expected four 0-255 octets separated by dots' : null,
};

function suggestEnumTypo (received, enumValues) {
  if (typeof received !== 'string') return null;
  if (!Array.isArray(enumValues) || enumValues.length === 0 || enumValues.length > 30) return null;
  let best = null;
  let bestDist = Infinity;
  let tied = false;
  for (const v of enumValues) {
    if (typeof v !== 'string') continue;
    const d = levenshtein(received, v, 2);
    if (d < bestDist) { best = v; bestDist = d; tied = false; }
    else if (d === bestDist) tied = true;
  }
  if (best && bestDist <= 2 && !tied) {
    return { text: `did you mean \`${best}\`?`, kind: 'typo' };
  }
  return null;
}

// The widest container a typo hint is offered on. `suggestEnumTypo` caps its
// candidate list for the same two reasons: past a certain width the nearest
// key stops being evidence of a typo, and the scan is a distance computation
// per key on a value the caller has already rejected.
const MAX_TYPO_CANDIDATES = 64;

function suggestRequiredTypo (missing, presentKeys) {
  if (!missing || !Array.isArray(presentKeys)) return null;
  if (presentKeys.length > MAX_TYPO_CANDIDATES) return null;
  for (const k of presentKeys) {
    if (typeof k !== 'string') continue;
    const d = levenshtein(missing, k, 2);
    if (d <= 2 && d > 0) {
      return { text: `did you mean \`${missing}\` instead of \`${k}\`?`, kind: 'similar-key' };
    }
  }
  return null;
}

function suggestFormat (format, raw) {
  const fn = FORMAT_HINTS[format];
  if (!fn) return null;
  const text = fn(raw);
  return text ? { text, kind: 'format' } : null;
}

function suggestCoercion (expectedType, raw) {
  if (typeof raw !== 'string') return null;
  if (expectedType === 'integer' && /^-?\d+$/.test(raw)) {
    return { text: 'value would coerce; enable `coerceTypes` or pass an integer', kind: 'coercion' };
  }
  if (expectedType === 'number' && /^-?\d+(\.\d+)?$/.test(raw)) {
    return { text: 'value would coerce; enable `coerceTypes` or pass a number', kind: 'coercion' };
  }
  if (expectedType === 'boolean' && (raw === 'true' || raw === 'false')) {
    return { text: 'value would coerce; enable `coerceTypes` or pass a boolean', kind: 'coercion' };
  }
  return null;
}

/**
 * Apply suggestion sources in priority order. Returns the first hit, or null.
 * @param err Enriched ValidationError (with `received`, `params`, `keyword`)
 * @param data The full input data (for required-typo)
 * @param at The value at `err.path`, already resolved by the caller, or
 *   UNRESOLVED when the caller has none to offer
 */
function suggestFor (err, data, at = UNRESOLVED) {
  // The offending value itself. The caller resolves it once per error and
  // passes it here rather than having each source walk the document again.
  // A caller that passes only an enriched error falls back to un-quoting the
  // repr, which is what every source used to read.
  const raw = at !== UNRESOLVED ? at : parseReceived(err.received);
  if (err.keyword === 'enum') {
    return suggestEnumTypo(raw, err.params && err.params.allowedValues);
  }
  if (err.keyword === 'required') {
    const missing = err.params && err.params.missingProperty;
    const path = err.path || '';
    let parentPath = path;
    if (parentPath.endsWith('/' + missing)) parentPath = parentPath.slice(0, -missing.length - 1);
    // A `required` error usually names the container it failed on, so the
    // value the caller already resolved is the parent. Only the spelling that
    // points at the missing key itself needs a second walk.
    const parent = (parentPath === path && at !== UNRESOLVED) ? at : walk(data, parentPath);
    if (parent && typeof parent === 'object') {
      return suggestRequiredTypo(missing, Object.keys(parent));
    }
    return null;
  }
  if (err.keyword === 'format') {
    return suggestFormat(err.params && err.params.format, raw);
  }
  if (err.keyword === 'type') {
    return suggestCoercion(err.params && err.params.type, raw);
  }
  return null;
}

function parseReceived (r) {
  if (typeof r !== 'string') return r;
  if (r.startsWith('"') && r.endsWith('"')) { try { return JSON.parse(r); } catch { return r; } }
  return r;
}

module.exports = { suggestFor, suggestEnumTypo, suggestRequiredTypo, suggestFormat, suggestCoercion };
