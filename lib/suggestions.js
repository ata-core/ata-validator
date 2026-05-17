'use strict';

const { levenshtein } = require('./levenshtein');

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

function suggestRequiredTypo (missing, presentKeys) {
  if (!missing || !Array.isArray(presentKeys)) return null;
  for (const k of presentKeys) {
    if (typeof k !== 'string') continue;
    const d = levenshtein(missing, k, 2);
    if (d <= 2 && d > 0) {
      return { text: `did you mean \`${missing}\` instead of \`${k}\`?`, kind: 'similar-key' };
    }
  }
  return null;
}

function suggestFormat (format, received) {
  const fn = FORMAT_HINTS[format];
  if (!fn) return null;
  // received is repr-truncated string like '"foo"'; unwrap for testing
  let raw = received;
  if (typeof raw === 'string' && raw.startsWith('"') && raw.endsWith('"')) {
    try { raw = JSON.parse(raw); } catch {}
  }
  const text = fn(raw);
  return text ? { text, kind: 'format' } : null;
}

function suggestCoercion (expectedType, received) {
  if (typeof received !== 'string' || !received.startsWith('"') || !received.endsWith('"')) return null;
  let raw;
  try { raw = JSON.parse(received); } catch { return null; }
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
 */
function suggestFor (err, data) {
  if (err.keyword === 'enum') {
    return suggestEnumTypo(parseReceived(err.received), err.params && err.params.allowedValues);
  }
  if (err.keyword === 'required') {
    const missing = err.params && err.params.missingProperty;
    let parentPath = err.path || '';
    if (parentPath.endsWith('/' + missing)) parentPath = parentPath.slice(0, -missing.length - 1);
    const parent = walk(data, parentPath);
    if (parent && typeof parent === 'object') {
      return suggestRequiredTypo(missing, Object.keys(parent));
    }
    return null;
  }
  if (err.keyword === 'format') {
    return suggestFormat(err.params && err.params.format, err.received);
  }
  if (err.keyword === 'type') {
    return suggestCoercion(err.params && err.params.type, err.received);
  }
  return null;
}

function parseReceived (r) {
  if (typeof r !== 'string') return r;
  if (r.startsWith('"') && r.endsWith('"')) { try { return JSON.parse(r); } catch { return r; } }
  return r;
}

function walk (data, pointer) {
  if (!pointer) return data;
  const parts = pointer.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = data;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

module.exports = { suggestFor, suggestEnumTypo, suggestRequiredTypo, suggestFormat, suggestCoercion };
