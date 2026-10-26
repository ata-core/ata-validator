'use strict';

// Standard Schema V1 for a validator: the `~standard` member a form library,
// a router or an RPC layer reads instead of ata's own API. One module, so the
// runtime Validator (lib/validator-core.js) and the wrapper around a module
// written ahead of time (lib/compiled.js) hand out the same object built the
// same way, and a validator the build compiled away still works where the
// runtime one did.

// Paths repeat across rejections of the same shape, so the parsed segment
// list is cached per path string. Entries are frozen: the same array is
// handed to every issue that names the path.
//
// The cache is bucketed by length and searched with ===, not keyed in a Map.
// A path with an array index in it is concatenated afresh by every rejection,
// and a Map has to hash each such string from scratch before it can look
// anything up; that hashing was 30% of a Standard Schema rejection with
// sixteen issues. Comparing against the few paths of the same length costs
// less. Both levels are bounded so a stream of array indexes cannot grow it
// without limit: a full bucket stops caching, too many lengths clear it.
const _pathBuckets = new Map();
const PATH_BUCKET_MAX = 32;
const PATH_LENGTHS_MAX = 256;
const EMPTY_PATH = Object.freeze([]);
function parsePointerPath(path) {
  if (!path) return EMPTY_PATH;
  const n = path.length;
  let bucket = _pathBuckets.get(n);
  if (bucket !== undefined) {
    for (let i = 0; i < bucket.length; i += 2) if (bucket[i] === path) return bucket[i + 1];
  } else {
    if (_pathBuckets.size >= PATH_LENGTHS_MAX) _pathBuckets.clear();
    bucket = [];
    _pathBuckets.set(n, bucket);
  }
  const segs = Object.freeze(parsePointerPathUncached(path));
  if (bucket.length < PATH_BUCKET_MAX * 2) bucket.push(path, segs);
  return segs;
}

function parsePointerPathUncached(path) {
  // One pass, no intermediate arrays. Per Standard Schema V1 an array index
  // is emitted as a number and an object key as a string; a segment is an
  // index when it is all digits with no leading zero.
  const out = [];
  const n = path.length;
  let start = 1;
  for (let i = 1; i <= n; i++) {
    if (i !== n && path.charCodeAt(i) !== 47) continue;
    if (i > start) {
      let seg = path.slice(start, i);
      if (seg.indexOf('~') >= 0) seg = seg.replace(/~1/g, '/').replace(/~0/g, '~');
      const c0 = seg.charCodeAt(0);
      let numeric = c0 >= 48 && c0 <= 57 && (seg.length === 1 || c0 !== 48);
      if (numeric) {
        for (let k = 1; k < seg.length; k++) {
          const c = seg.charCodeAt(k);
          if (c < 48 || c > 57) { numeric = false; break; }
        }
      }
      out.push({ key: numeric ? Number(seg) : seg });
    }
    start = i + 1;
  }
  return out;
}

// Standard JSON Schema, the `jsonSchema` member of `~standard`: what a consumer
// such as the MCP SDK reads to publish a schema, from `input({ target })`.
// ata validates the JSON Schema it was given and does not transform values, so
// input and output are the same document, handed back as a copy when the
// target is the schema's dialect: draft-07 when it declares draft-07, 2020-12
// when it declares 2020-12 or nothing, as ata reads it. Any other target
// throws, as the specification asks, rather than returning a document that
// would mean something else there.
function standardJsonSchema(getSchema) {
  const convert = (options) => {
    const target = options && options.target;
    const schema = getSchema();
    if (schema === true) return {};
    if (schema === false) return { not: {} };
    const declared = typeof schema.$schema === 'string' ? schema.$schema : '';
    const dialect = declared === '' || declared.includes('draft/2020-12/schema') ? 'draft-2020-12'
      : declared.includes('draft-07/schema') ? 'draft-07' : declared;
    if (target !== dialect) {
      throw new TypeError(`ata-validator cannot provide a ${dialect} schema as ${String(target)}; it does not convert between dialects`);
    }
    return JSON.parse(JSON.stringify(schema));
  };
  return Object.freeze({ input: convert, output: convert });
}

// The `~standard` object for `self`, a validator whose validate(value)
// answers as ata's does: `getSchema(self)` returns the schema as the caller
// wrote it, `validate(self, value)` is called each time, so an extension
// installed later counts.
function standardSchemaFor(self, getSchema, validate) {
  return Object.freeze({
    version: 1,
    vendor: 'ata-validator',
    jsonSchema: standardJsonSchema(() => getSchema(self)),
    validate(value) {
      const result = validate(self, value);
      if (result.valid) {
        return { value };
      }
      // An issue carries a message and a path and nothing else, so the
      // suggestion and source-frame work the rich error path does would be
      // thrown away here. Take the raw, schema-ordered list when the result
      // offers one; fall back to the public list otherwise.
      const raw = typeof result._ataRaw === 'function' ? result._ataRaw() : result.errors;
      const issues = new Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        const err = raw[i];
        const path = err.instancePath != null ? err.instancePath : (err.path || '');
        let message = err.message;
        if (!message) {
          // The native engine reports numeric codes without a message; the
          // enrich pass knows how to word those. Rare, so required lazily.
          message = require('./native-message')(err);
        }
        issues[i] = { message, path: parsePointerPath(path) };
      }
      return { issues };
    },
  });
}

// Installs `~standard` on `target` (an instance, or a prototype) as a lazy
// accessor: built on first read for the object it is read from, then pinned
// to that object as a plain, non-enumerable value, so a validator nobody asks
// never builds it.
function installStandard(target, getSchema, validate) {
  Object.defineProperty(target, '~standard', {
    configurable: true,
    enumerable: false,
    get() {
      const std = standardSchemaFor(this, getSchema, validate);
      Object.defineProperty(this, '~standard', { value: std, writable: false, enumerable: false, configurable: false });
      return std;
    },
  });
}

module.exports = { parsePointerPath, standardJsonSchema, standardSchemaFor, installStandard };
