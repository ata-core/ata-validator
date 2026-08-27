'use strict';

const { correlateTypos } = require('./correlate');
const { buildDataPositionMap } = require('./data-positions');
const { pathToDotted } = require('./render-shared');

const MAX_SYNTHESIZED_BYTES = 256 * 1024;

/**
 * Turn a validation error array into presentation-ready diagnostics.
 *
 * Pure: no I/O, no ANSI, no terminal width, deterministic for a given input.
 * That is deliberate. The merge below is the one place in this library that
 * can present two problems as one, so it has to be provable as data rather
 * than by grepping terminal output.
 *
 * @param {Array} errors validation errors, enriched or raw
 * @param {{text?: string, data?: any, positions?: object, schema?: object, mutatesInput?: boolean}} [source]
 * @returns {Array} diagnostics
 */
function toDiagnostics (errors, source) {
  if (!Array.isArray(errors) || errors.length === 0) return [];
  const src = source || {};

  const resolved = resolveFrames(src);
  const pairs = correlateTypos(errors);

  const diagnostics = [];
  const consumed = new Set();

  for (let i = 0; i < errors.length; i++) {
    if (consumed.has(i)) continue;
    const e = errors[i];
    if (!e) continue;

    const partner = pairs.get(i);
    if (partner !== undefined && !consumed.has(partner)) {
      consumed.add(i);
      consumed.add(partner);
      diagnostics.push(mergedDiagnostic(errors, i, partner, resolved, src));
      continue;
    }

    diagnostics.push(singleDiagnostic(e, i, resolved, src));
  }

  diagnostics.sort((a, b) => {
    if (a.sortPos !== b.sortPos) return a.sortPos - b.sortPos;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : 0;
  });

  for (const d of diagnostics) delete d.sortPos;
  return diagnostics;
}

// Resolve one position map for the whole call, not one per error.
function resolveFrames (src) {
  const none = { positions: null, synthesized: false, refusal: null };
  if (src.positions) return { positions: src.positions, synthesized: false, refusal: null };

  if (src.text != null) {
    try {
      return { positions: buildDataPositionMap(src.text), synthesized: false, refusal: null };
    } catch {
      return none;
    }
  }

  if (src.data === undefined) return none;

  if (src.mutatesInput) {
    // The object in hand is not what the caller sent. Drawing a caret under a
    // coerced value or an injected default would be output that is wrong and
    // draws no complaint, which is the failure mode this library treats as the
    // worst one. Say why instead.
    return {
      positions: null,
      synthesized: false,
      refusal: 'no frame; the value was modified in place before validation (coerceTypes, useDefaults or removeAdditional)',
    };
  }

  let text;
  try {
    text = JSON.stringify(src.data, null, 2);
  } catch {
    return none;
  }
  if (typeof text !== 'string') return none;
  if (text.length > MAX_SYNTHESIZED_BYTES) {
    // The string cannot be measured without being built. It is built, measured
    // and dropped; there is no way to skip the allocation and still know.
    return { positions: null, synthesized: false, refusal: 'no frame; the value is larger than 256 KB' };
  }
  try {
    return { positions: buildDataPositionMap(text), synthesized: true, refusal: null };
  } catch {
    return none;
  }
}

function frameFor (err, resolved) {
  if (!resolved.positions) return null;
  const path = err.instancePath != null ? err.instancePath : (err.path || '');
  const named = (err.params && (err.params.additionalProperty || err.params.unevaluatedProperty)) || null;
  const hit = (named && resolved.positions[path + '/' + named]) || resolved.positions[path];
  if (!hit) return null;

  // A caret on the key token when the error names a property, on the value
  // otherwise. Never wider than the line it is drawn under.
  const useKey = named != null && hit.keyOffset !== undefined;
  const col = useKey ? hit.keyCol : hit.col;
  const rawLen = useKey ? hit.keyLength : hit.length;
  const lineLen = (hit.text || '').length;
  const length = Math.max(1, Math.min(rawLen || 1, Math.max(1, lineLen - col + 1)));

  return {
    line: useKey ? hit.keyLine : hit.line,
    col,
    length,
    text: hit.text,
    spans: rawLen > length,
    synthesized: resolved.synthesized,
  };
}

function headlineFor (err, src) {
  const p = err.params || {};
  switch (err.keyword) {
    case 'additionalProperties':
      return `unknown property "${p.additionalProperty}"`;
    case 'unevaluatedProperties':
      return `unevaluated property "${p.unevaluatedProperty}"`;
    case 'required':
      return `missing required property "${p.missingProperty}"`;
    case 'oneOf': case 'anyOf': {
      const disc = discriminatorFor(err, src);
      if (disc) return `no variant matches ${disc.key} ${JSON.stringify(disc.value)}`;
      return err.detail || err.message || 'no variant matched';
    }
    default:
      return err.detail || err.message || 'validation failed';
  }
}

// A discriminator is a property every branch pins with `const`, with distinct
// values. Anything looser and the code does not guess.
function discriminatorFor (err, src) {
  const schema = src.schema;
  const data = src.data;
  if (!schema || !data || typeof data !== 'object') return null;
  const branches = branchesAt(schema, err.schemaPath, err.keyword);
  if (!Array.isArray(branches) || branches.length < 2) return null;

  const first = branches[0] && branches[0].properties;
  if (!first) return null;
  for (const key of Object.keys(first)) {
    const values = [];
    let ok = true;
    for (const b of branches) {
      const prop = b && b.properties && b.properties[key];
      if (!prop || prop.const === undefined) { ok = false; break; }
      if (values.includes(prop.const)) { ok = false; break; }
      values.push(prop.const);
    }
    if (!ok) continue;
    const actual = data[key];
    if (actual === undefined) continue;
    return { key, value: actual };
  }
  return null;
}

// Walk `#/a/b/anyOf` down to the branch array it names.
function branchesAt (schema, schemaPath, keyword) {
  if (typeof schemaPath !== 'string' || !schemaPath.startsWith('#')) {
    return schema[keyword];
  }
  const parts = schemaPath.slice(1).split('/').filter(Boolean).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = schema;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[part];
  }
  return Array.isArray(cur) ? cur : null;
}

function singleDiagnostic (e, index, resolved, src) {
  const pointer = e.instancePath != null ? e.instancePath : (e.path || '');
  const frame = frameFor(e, resolved);
  const notes = [];
  if (frame && frame.synthesized) notes.push('frame reconstructed from the value, not from your input text');
  if (!frame && resolved.refusal) notes.push(resolved.refusal);
  if (frame && frame.spans) notes.push('value continues past the end of this line');
  if (e.docUrl) notes.push('see ' + e.docUrl);

  return {
    code: e.code,
    headline: headlineFor(e, src),
    pointer,
    dotted: pathToDotted(pointer),
    frame,
    help: e.suggestion ? e.suggestion.text : null,
    notes,
    branchErrors: e.branchErrors || null,
    mergedFrom: [e],
    rank: typeof e.rank === 'number' ? e.rank : 2,
    sortPos: frame ? frame.line * 100000 + frame.col : index,
  };
}

function mergedDiagnostic (errors, i, j, resolved, src) {
  const a = errors[i];
  const b = errors[j];
  const missing = a.keyword === 'required' ? a : b;
  const extra = a.keyword === 'required' ? b : a;
  const missingName = missing.params.missingProperty;
  const extraName = extra.params.additionalProperty;

  // Anchor on the extra key: that token is the thing the reader edits. The
  // missing half has no token to point at.
  const frame = frameFor(extra, resolved);
  const notes = [];
  if (frame && frame.synthesized) notes.push('frame reconstructed from the value, not from your input text');
  if (!frame && resolved.refusal) notes.push(resolved.refusal);
  const docUrl = missing.docUrl || extra.docUrl;
  if (docUrl) notes.push('see ' + docUrl);

  const pointer = missing.instancePath != null ? missing.instancePath : (missing.path || '');
  return {
    code: missing.code,
    headline: `unknown property "${extraName}", did you mean "${missingName}"?`,
    pointer,
    dotted: pathToDotted(pointer),
    frame,
    help: null,
    notes,
    branchErrors: null,
    mergedFrom: [missing, extra],
    rank: 0,
    sortPos: frame ? frame.line * 100000 + frame.col : Math.min(i, j),
  };
}

module.exports = { toDiagnostics };
