'use strict';

const { CODES, codeFor, fromNative } = require('./error-codes');
const { suggestFor } = require('./suggestions');
const { resolvePointer } = require('./pointer');

// A pointer that walked out of the document: no value to report, not even the
// word 'undefined', which is what an absent key reports.
const MISSING = Symbol('ata.received.missing');

const DOC_BASE = 'https://ata-validator.com/e/';

// The number of characters JSON.stringify would emit for `v`, or -1 as soon as
// that passes `budget` or the value holds something a plain walk cannot size.
// The point is the bound: `reprValue` only ever shows a body of 60 characters,
// so sizing one never needs to read further than that, and a `required` error
// on a large document used to serialise the whole container to find out it was
// too big. Keys are counted unescaped, which makes the result a lower bound,
// and the caller rechecks the real length on the string it ends up building.
function jsonSizeWithin (v, budget) {
  if (budget < 0) return -1;
  if (v === null) return 4;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? String(v).length : 4;
  if (t === 'boolean') return v ? 4 : 5;
  if (t === 'string') return v.length + 2 > budget ? -1 : v.length + 2;
  if (t !== 'object') return -1;
  // A value with its own toJSON serialises to something only that method can
  // say. Sizing it exactly would mean running it, and a Date's toJSON alone
  // costs more than serialising the object around it, so this returns the
  // smallest thing it could produce. Undershooting is safe: the caller only
  // uses the estimate to decide whether to try, and rechecks the real length.
  if (typeof v.toJSON === 'function') return 2;
  if (Array.isArray(v)) {
    let n = 2;
    for (let i = 0; i < v.length; i++) {
      n += i === 0 ? 0 : 1;
      if (n > budget) return -1;
      const c = jsonSizeWithin(v[i], budget - n);
      if (c < 0) return -1;
      n += c;
      if (n > budget) return -1;
    }
    return n;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return -1;
  let n = 2;
  let first = true;
  // for-in rather than Object.keys: the prototype is checked above, so there
  // is nothing inherited to enumerate, and this walk runs per error.
  for (const k in v) {
    const val = v[k];
    // Keys JSON drops cost nothing, but they also cost nothing to skip.
    if (val === undefined || typeof val === 'function' || typeof val === 'symbol') continue;
    // Charge the key before reading the value, so a budget already spent
    // returns without descending into it.
    n += k.length + 3 + (first ? 0 : 1);
    if (n > budget) return -1;
    first = false;
    const c = jsonSizeWithin(val, budget - n);
    if (c < 0) return -1;
    n += c;
    if (n > budget) return -1;
  }
  return n;
}

function reprValue (v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + '..."' : s;
  }
  if (t === 'number' || t === 'boolean') return String(v);
  if (Array.isArray(v)) return `[array, ${v.length} items]`;
  if (t === 'object') {
    if (jsonSizeWithin(v, 60) >= 0) {
      try {
        const s = JSON.stringify(v);
        if (s !== undefined && s.length <= 60) return s;
      } catch {
        return '[object, unserializable]';
      }
    }
    let n;
    try {
      n = Object.keys(v).length;
    } catch {
      return '[object, unserializable]';
    }
    return `[object, ${n} ${n === 1 ? 'key' : 'keys'}]`;
  }
  return `[${t}]`;
}

function expectedFor (err) {
  switch (err.keyword) {
    case 'type': return err.params && err.params.type ? String(err.params.type) : undefined;
    case 'minLength': return err.params && err.params.limit != null ? `string with ≥${err.params.limit} chars` : undefined;
    case 'maxLength': return err.params && err.params.limit != null ? `string with ≤${err.params.limit} chars` : undefined;
    case 'minimum': return err.params && err.params.limit != null ? `≥${err.params.limit}` : undefined;
    case 'maximum': return err.params && err.params.limit != null ? `≤${err.params.limit}` : undefined;
    case 'format': return err.params && err.params.format ? `format '${err.params.format}'` : undefined;
    case 'pattern': return err.params && err.params.pattern ? `string matching /${err.params.pattern}/` : undefined;
    case 'enum': return err.params && err.params.allowedValues
      ? `one of [${err.params.allowedValues.map(reprValue).join(', ')}]`
      : undefined;
    case 'const': return err.params && 'allowedValue' in err.params ? reprValue(err.params.allowedValue) : undefined;
    case 'required': return err.params && err.params.missingProperty ? `property '${err.params.missingProperty}'` : undefined;
    default: return undefined;
  }
}

// The value the error's pointer resolves to, or MISSING when the pointer walks
// out of the document. Resolved once per error and handed to both the
// `received` repr and the suggestion sources, which used to walk it each.
function resolveAt (err, data) {
  if (!data && data !== 0 && data !== false) return MISSING;
  const p = err.instancePath || err.path || '';
  if (!p) return data;
  return resolvePointer(data, p, MISSING);
}

/**
 * Enrich a raw codegen error with code/path/expected/received/docUrl.
 * Pure: returns a new object. Source frames and suggestions are added by
 * other helpers later in the pipeline.
 */
// Observation-first wording. `message` stays as it is for parity, so this is a
// separate field a consumer opts into.
function detailFor (err, out) {
  const p = err.params || {};
  switch (err.keyword) {
    case 'type':
      return `expected ${p.type}, found ${typeNameOf(out.received)}`;
    case 'required':
      return `missing required property "${p.missingProperty}"`;
    case 'additionalProperties':
      return `unknown property "${p.additionalProperty}"`;
    case 'unevaluatedProperties':
      return `unevaluated property "${p.unevaluatedProperty}"`;
    case 'enum':
      return out.expected ? `expected ${out.expected}, found ${out.received}` : undefined;
    case 'const':
      return out.expected ? `expected ${out.expected}, found ${out.received}` : undefined;
    case 'format':
      return `not a valid ${p.format}: ${out.received}`;
    case 'minimum': case 'maximum': case 'exclusiveMinimum': case 'exclusiveMaximum':
      return `expected ${out.expected}, found ${out.received}`;
    case 'minLength': case 'maxLength':
      return `expected ${out.expected}, found ${out.received}`;
    default:
      return out.expected ? `expected ${out.expected}, found ${out.received}` : undefined;
  }
}

// Derived from the repr in `received`, which is already a JSON-ish string.
function typeNameOf (received) {
  if (received === undefined) return 'nothing';
  if (received === 'null') return 'null';
  if (received === 'true' || received === 'false') return 'boolean';
  if (received.startsWith('"')) return 'string';
  if (received.startsWith('[array')) return 'array';
  if (received.startsWith('{') || received.startsWith('[object')) return 'object';
  if (/^-?\d/.test(received)) return 'number';
  return 'value';
}

// Cause before effect, applied only as a tie-break within one container.
// Ordering across the document is by position, done in the renderer.
const RANK = {
  required: 0, additionalProperties: 0, unevaluatedProperties: 0,
  unevaluatedItems: 0, dependentRequired: 0, propertyNames: 0,
  type: 1,
  oneOf: 3, anyOf: 3, allOf: 3, not: 3,
};
function rankFor (keyword) {
  const r = RANK[keyword];
  return r === undefined ? 2 : r;
}

function enrich (rawErr, opts) {
  const data = opts && opts.data;
  const positions = opts && opts.positions;
  // A literal the generated code shares between calls carries a slot for the
  // fields that depend on nothing but the literal: worked out on the first
  // read, taken from the slot after that.
  let st = rawErr._t;
  if (st === undefined || st.code === undefined) {
    const format = rawErr.params && rawErr.params.format;
    // The native engine reports its own enum as a number. Translate it to the
    // keyword and public code the JavaScript engines use, so an error means the
    // same thing whichever engine produced it.
    const fromAddon = typeof rawErr.code === 'number' ? fromNative(rawErr.code, format) : null;
    const keyword = rawErr.keyword || (fromAddon && fromAddon.keyword);
    // Prefer a code the codegen already attached (e.g. branch-collapse emits
    // ATA4001/4002/4003 distinguishing zero/multi/anyOf failure modes). The
    // keyword-derived lookup only finds the first match for `keyword: 'oneOf'`.
    // A property that dependentRequired asks for is reported with the keyword
    // `required`, and its documented code is ATA7005, not required's ATA7001.
    // The error generator stamped 7005 and the other engines left it to the
    // keyword here, so the same failure carried either code depending on which
    // generator answered.
    const dependent = keyword === 'required' && typeof rawErr.schemaPath === 'string' && rawErr.schemaPath.endsWith('/dependentRequired');
    const code = (fromAddon && fromAddon.code) ||
      (typeof rawErr.code === 'string' && rawErr.code) ||
      (dependent && 'ATA7005') ||
      codeFor(keyword, format) ||
      'ATA9001';
    const meta = CODES[code];
    const fixed = {
      code,
      message: rawErr.message || (meta && meta.headline) || 'validation failed',
      keyword,
      path: rawErr.instancePath != null ? rawErr.instancePath : (rawErr.path || ''),
      expected: expectedFor(rawErr),
      docUrl: DOC_BASE + code,
      rank: rankFor(keyword),
    };
    if (st !== undefined && !fromAddon) Object.assign(st, fixed);
    st = fixed;
  }
  const path = st.path;
  const at = data !== undefined ? resolveAt(rawErr, data) : MISSING;

  const out = {
    code: st.code,
    message: st.message,
    keyword: st.keyword,
    path,
    expected: st.expected,
    received: at === MISSING ? undefined : reprValue(at),
    schemaPath: rawErr.schemaPath,
    docUrl: st.docUrl,
    // Back-compat aliases (additive, present in both rich and legacy paths)
    instancePath: path,
    dataPath: path,
    params: rawErr.params,
    parentSchema: rawErr.parentSchema,
  };

  // Verbose mode's two other fields. Carried only when the raw error has them,
  // so the default error shape does not grow two undefined keys for everyone
  // who never asked for verbose.
  if ('data' in rawErr) out.data = rawErr.data;
  if ('schema' in rawErr) out.schema = rawErr.schema;

  // oneOf/anyOf collapse: preserve the nested branch errors so the pretty
  // renderer can surface the closest variant's diagnostics. They are enriched
  // like any other error: passed through raw, they carried whatever the engine
  // that answered wrote, the generator's internal ordering key included.
  if (rawErr.branchErrors) out.branchErrors = rawErr.branchErrors.map((b) => enrich(b, data !== undefined ? { data } : null));

  if (positions && positions[path]) {
    const p = positions[path];
    out.dataFrame = { byteOffset: p.byteOffset, length: p.length, line: p.line, col: p.col, text: p.text };
  }

  // Attach schema source frame when the validator was constructed with a
  // `source` option. schemaPath looks like "#/properties/email/format" — strip
  // the leading "#" before lookup. Fall back to the `#key` variant which the
  // position scanner stores for the keyword name itself.
  if (opts && opts.schemaPositions && rawErr.schemaPath) {
    const sp = rawErr.schemaPath;
    const ptr = sp.startsWith('#') ? sp.slice(1) : sp;
    const hit = opts.schemaPositions[ptr] || opts.schemaPositions[ptr + '#key'];
    if (hit) {
      out.schemaSource = { file: opts.schemaFile, line: hit.line, col: hit.col, text: hit.text };
    }
  }

  // Suggestion attachment runs last so it can read `received`, `params`, and
  // `keyword` from the enriched shape. `data` is the full input object so the
  // required-typo source can scan sibling keys.
  const sugg = suggestFor(out, data, at === MISSING ? undefined : at);
  if (sugg) out.suggestion = sugg;

  const detail = detailFor(rawErr, out);
  if (detail !== undefined) out.detail = detail;
  out.rank = st.rank;

  // Token-level anchor. `dataFrame` already carries the value span; `anchor`
  // adds the key span so a caret can sit on the property that is wrong rather
  // than on the object containing it.
  if (opts && opts.positions) {
    const named = (rawErr.params && (rawErr.params.additionalProperty || rawErr.params.unevaluatedProperty)) || null;
    const own = opts.positions[path];
    const child = named ? opts.positions[(path === '' ? '' : path) + '/' + named] : null;
    const src = child || own;
    if (src) {
      out.anchor = { line: src.line, col: src.col, length: src.length };
      if (src.keyOffset !== undefined) {
        out.anchor.keyLine = src.keyLine;
        out.anchor.keyCol = src.keyCol;
        out.anchor.keyLength = src.keyLength;
      }
    }
  }

  return out;
}

module.exports = { enrich, reprValue, expectedFor };
