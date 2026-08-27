'use strict';

const { CODES, codeFor } = require('./error-codes');
const { suggestFor } = require('./suggestions');

const DOC_BASE = 'https://ata-validator.com/e/';

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
    try {
      const s = JSON.stringify(v);
      if (s.length <= 60) return s;
      return `[object, ~${(s.length / 1024).toFixed(1)}KB]`;
    } catch {
      return '[object, unserializable]';
    }
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

function pickReceived (err, data) {
  if (!data && data !== 0 && data !== false) return undefined;
  // Walk JSON pointer to extract the actual offending value. This runs for
  // every error on every rejected payload, so the walk reads segments straight
  // out of the pointer: no leading-slash regex, no parts array, and no unescape
  // pass on the segments that carry no `~`.
  const p = err.instancePath || err.path || '';
  if (!p) return reprValue(data);
  const len = p.length;
  let cur = data;
  let i = p.charCodeAt(0) === 47 ? 1 : 0; // 47 is '/'
  for (;;) {
    let j = p.indexOf('/', i);
    if (j === -1) j = len;
    let seg = p.slice(i, j);
    if (seg.indexOf('~') !== -1) seg = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur == null) return undefined;
    cur = cur[seg];
    if (j === len) break;
    i = j + 1;
  }
  return reprValue(cur);
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
  const keyword = rawErr.keyword;
  const format = rawErr.params && rawErr.params.format;
  // Prefer a code the codegen already attached (e.g. branch-collapse emits
  // ATA4001/4002/4003 distinguishing zero/multi/anyOf failure modes). The
  // keyword-derived lookup only finds the first match for `keyword: 'oneOf'`.
  const code = rawErr.code || codeFor(keyword, format) || 'ATA9001';
  const meta = CODES[code];
  const path = rawErr.instancePath != null ? rawErr.instancePath : (rawErr.path || '');

  const out = {
    code,
    message: rawErr.message || (meta && meta.headline) || 'validation failed',
    keyword,
    path,
    expected: expectedFor(rawErr),
    received: data !== undefined ? pickReceived(rawErr, data) : undefined,
    schemaPath: rawErr.schemaPath,
    docUrl: DOC_BASE + code,
    // Back-compat aliases (additive, present in both rich and legacy paths)
    instancePath: path,
    dataPath: path,
    params: rawErr.params,
    parentSchema: rawErr.parentSchema,
  };

  // oneOf/anyOf collapse: preserve the nested branch errors so the pretty
  // renderer can surface the closest variant's diagnostics.
  if (rawErr.branchErrors) out.branchErrors = rawErr.branchErrors;

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
  const sugg = suggestFor(out, opts && opts.data);
  if (sugg) out.suggestion = sugg;

  const detail = detailFor(rawErr, out);
  if (detail !== undefined) out.detail = detail;
  out.rank = rankFor(keyword);

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
