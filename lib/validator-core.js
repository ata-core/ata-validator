// Native addon: optional. Core validate() uses JS codegen and works without it.
// Buffer APIs (isValid, countValid, isValidParallel) require native.
// Loading is delegated to lib/native-load.js so this file stays free of
// platform probing and `path` (the browser entry must not pull those in).
const native = require("./native-load")();
const { normalizeKeywords, schemaUsesKeywords } = require('./keywords');
// The code generator (lib/js-compiler and what builds on it: the scanner, the
// parse() copy, the ahead-of-time emitters) is registered by the entry that
// wants it, not required here. index.js registers it; lite.js does not, so a
// bundle built from lite.js never contains it. Until something registers, the
// core behaves exactly as it does where `new Function` is blocked: every
// schema runs on the interpreted engine, which passes the same test suite.
let _codegen = null;
let compileToJS, compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined;
function _registerCodegen(engine) {
  _codegen = engine;
  ({ compileToJS, compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined } = engine.jsCompiler);
}
const { normalizeDraft7, normalizeNullable, normalizeExclusiveBounds, stripFormatAssertions } = require("./draft7");
const { enabledKeywords, stripDisabledKeywords } = require("./vocabularies");
const { needsNormalization } = require("./schema-scan");
const { isV1Dialect } = require("./dialect");
const { classify } = require("./shape-classifier");
const { buildTier0Plan, tier0Validate } = require("./tier0");

// Extract default values from a schema tree. Returns a function that applies
// defaults to an object in-place (mutates), or null if no defaults exist.
function buildDefaultsApplier(schema) {
  if (typeof schema !== "object" || schema === null) return null;
  const actions = [];
  collectDefaults(schema, actions);
  if (actions.length === 0) return null;
  return (data) => {
    for (let i = 0; i < actions.length; i++) actions[i](data);
  };
}

// Write an own property. Plain assignment of a key named `__proto__` does
// not create a property at all: it hits the Object.prototype setter and
// rewrites the object's prototype, which is how a schema could reach
// Object.prototype itself. defineProperty has no such special case.
function setOwn(obj, key, val) {
  if (key === "__proto__") {
    Object.defineProperty(obj, key, {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    obj[key] = val;
  }
}

function collectDefaults(schema, actions, path) {
  if (typeof schema !== "object" || schema === null) return;
  const props = schema.properties;
  if (!props) return;
  for (const [key, prop] of Object.entries(props)) {
    if (prop && typeof prop === "object" && prop.default !== undefined) {
      const defaultVal = prop.default;
      if (!path) {
        actions.push((data) => {
          if (typeof data === "object" && data !== null && !Object.hasOwn(data, key)) {
            setOwn(data,
              key,
              typeof defaultVal === "object" && defaultVal !== null
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal);
          }
        });
      } else {
        const parentPath = path;
        actions.push((data) => {
          let target = data;
          for (let j = 0; j < parentPath.length; j++) {
            if (typeof target !== "object" || target === null) return;
            // Own keys only. `target[key]` for an inherited name walks the
            // prototype chain: a parent named `__proto__` that the instance
            // does not carry resolved to Object.prototype, and the child
            // defaults were written onto it, for every object in the realm.
            if (!Object.hasOwn(target, parentPath[j])) return;
            target = target[parentPath[j]];
          }
          if (
            typeof target === "object" &&
            target !== null &&
            !Object.hasOwn(target, key)
          ) {
            setOwn(target,
              key,
              typeof defaultVal === "object" && defaultVal !== null
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal);
          }
        });
      }
    }
    // Recurse into nested object schemas
    if (prop && typeof prop === "object" && prop.properties) {
      collectDefaults(prop, actions, (path || []).concat(key));
    }
  }
}

// Build a function that coerces property values to match schema types in-place.
// Handles string→number, string→integer, string→boolean, number→string, boolean→string.
function buildCoercer(schema) {
  if (typeof schema !== "object" || schema === null) return null;
  const actions = [];
  collectCoercions(schema, actions);
  if (actions.length === 0) return null;
  return (data) => {
    for (let i = 0; i < actions.length; i++) actions[i](data);
  };
}

function collectCoercions(schema, actions, path) {
  if (typeof schema !== "object" || schema === null) return;
  const props = schema.properties;
  if (!props) return;
  for (const [key, prop] of Object.entries(props)) {
    if (!prop || typeof prop !== "object" || !prop.type) continue;
    const targetType = Array.isArray(prop.type) ? null : prop.type;
    if (!targetType) continue;

    const coerce = buildSingleCoercion(targetType);
    if (!coerce) continue;

    if (!path) {
      actions.push((data) => {
        if (typeof data === "object" && data !== null && key in data) {
          const coerced = coerce(data[key]);
          if (coerced !== undefined) data[key] = coerced;
        }
      });
    } else {
      const parentPath = path;
      actions.push((data) => {
        let target = data;
        for (let j = 0; j < parentPath.length; j++) {
          if (typeof target !== "object" || target === null) return;
          target = target[parentPath[j]];
        }
        if (typeof target === "object" && target !== null && key in target) {
          const coerced = coerce(target[key]);
          if (coerced !== undefined) target[key] = coerced;
        }
      });
    }

    // Recurse into nested object properties
    if (prop.properties) {
      collectCoercions(prop, actions, (path || []).concat(key));
    }
  }
}

function buildSingleCoercion(targetType) {
  switch (targetType) {
    case "number":
      return (v) => {
        if (typeof v === "string") {
          const n = Number(v);
          if (v !== "" && !isNaN(n)) return n;
        }
        if (typeof v === "boolean") return v ? 1 : 0;
      };
    case "integer":
      return (v) => {
        if (typeof v === "string") {
          const n = Number(v);
          if (v !== "" && Number.isInteger(n)) return n;
        }
        if (typeof v === "boolean") return v ? 1 : 0;
      };
    case "string":
      return (v) => {
        if (typeof v === "number" || typeof v === "boolean") return String(v);
      };
    case "boolean":
      return (v) => {
        if (v === "true" || v === "1") return true;
        if (v === "false" || v === "0") return false;
      };
    default:
      return null;
  }
}

// Build a function that removes properties not defined in schema.properties.
// Walks nested objects recursively.
function buildRemover(schema) {
  if (typeof schema !== "object" || schema === null) return null;
  const actions = [];
  collectRemovals(schema, actions);
  if (actions.length === 0) return null;
  return (data) => {
    for (let i = 0; i < actions.length; i++) actions[i](data);
  };
}

function collectRemovals(schema, actions, path) {
  if (typeof schema !== "object" || schema === null || !schema.properties)
    return;

  // If this level has additionalProperties: false, add a removal action
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties));
    if (!path) {
      actions.push((data) => {
        if (typeof data !== "object" || data === null || Array.isArray(data))
          return;
        const keys = Object.keys(data);
        for (let i = 0; i < keys.length; i++) {
          if (!allowed.has(keys[i])) delete data[keys[i]];
        }
      });
    } else {
      const parentPath = path;
      actions.push((data) => {
        let target = data;
        for (let j = 0; j < parentPath.length; j++) {
          if (typeof target !== "object" || target === null) return;
          target = target[parentPath[j]];
        }
        if (
          typeof target !== "object" ||
          target === null ||
          Array.isArray(target)
        )
          return;
        const keys = Object.keys(target);
        for (let i = 0; i < keys.length; i++) {
          if (!allowed.has(keys[i])) delete target[keys[i]];
        }
      });
    }
  }

  // Always recurse into nested properties (they may have their own additionalProperties: false)
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop && typeof prop === "object" && prop.properties) {
      collectRemovals(prop, actions, (path || []).concat(key));
    }
  }
}

// Cloudflare Workers, Deno Deploy and pages under a strict Content-Security-
// Policy refuse `new Function`. Probed once, lazily, because the answer cannot
// change within a realm and the probe itself is a code generation attempt.
let _codegenAvailable = null;
function codegenAvailable() {
  if (_codegen === null) return false;
  if (_codegenAvailable === null) {
    try {
      _codegenAvailable = new Function('return 1')() === 1;
    } catch {
      _codegenAvailable = false;
    }
  }
  return _codegenAvailable;
}

// Schema compilation cache: same schema string -> reuse compiled functions
const _compileCache = new Map();

// Object identity cache: same schema object reference -> reuse entire compiled state
// Skips JSON.stringify, cache lookup, and all setup. Near-zero cost for repeated schemas.
const _identityCache = new WeakMap();

const SIMDJSON_PADDING = 64;
const VALID_RESULT = Object.freeze({ valid: true, errors: Object.freeze([]) });
// How many calls a validator answers through its verdict function before its
// validate() and validateJSON() compile the single-function hybrid.
const HYBRID_TIER_CALLS = 64;
const ABORT_EARLY_RESULT = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({
    code: 'ATA9000',
    message: 'validation failed',
    keyword: '__abort_early__',
    path: '',
  })]),
});

// `_CP_LEN_SOURCE`, the safe-regex embed, and the AOT helpers that consume them
// now live in `lib/aot.js` — keeping this file free of `fs`/`path`/`__dirname`
// references so a default import never touches disk. The static AOT methods
// further down lazily require `./lib/aot`, so they pay nothing until a user
// calls `bundleStandalone`/`bundle`/etc.

// Above this size, simdjson On Demand (selective field access) beats JSON.parse
// (which must materialize the full JS object tree). Buffer.from + NAPI ~2x faster.

// Rejection result with errors materialized on first read. The accessor
// lives on the prototype so constructing one is a plain allocation; an
// object-literal getter would create a closure and define an accessor
// property on every rejection, which showed up as the single largest cost
// on the rejection path. `toJSON` keeps JSON.stringify output identical to
// the eager shape. Note for tests: deepStrictEqual against a plain object
// compares prototypes; read `.errors` and compare that.
class LazyRejection {
  constructor(build, data, buildRaw) {
    this.valid = false;
    this._build = build;
    this._data = data;
    this._errors = null;
    this._buildRaw = buildRaw;
  }
  toJSON() {
    return { valid: false, errors: this.errors };
  }
  // Raw shape for consumers that carry only message and path, such as the
  // Standard Schema bridge: schema order, no enrichment. Reading `errors`
  // afterwards still enriches through its own build.
  _ataRaw() {
    return this._buildRaw ? this._buildRaw(this._data) : this.errors;
  }
}
Object.defineProperty(LazyRejection.prototype, 'errors', {
  enumerable: true,
  configurable: true,
  get() {
    if (this._errors === null) this._errors = this._build(this._data);
    return this._errors;
  },
});

const SIMDJSON_THRESHOLD = 8192;

// Resolve a JSON Schema path like "#/properties/name/type" to the schema object
// that *contains* the failing keyword. Used by verbose mode to populate
// `parentSchema` on validation errors. Returns undefined if the path can't be
// walked (malformed pointer or missing intermediate node).
function resolveSchemaByPath(rootSchema, schemaPath) {
  if (!schemaPath || typeof schemaPath !== 'string' || !schemaPath.startsWith('#')) {
    return undefined;
  }
  const stripped = schemaPath.slice(1);
  if (!stripped || stripped === '/') return rootSchema;
  const parts = stripped.split('/').filter(Boolean).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  // The last segment is the keyword that failed (e.g. "type"); parentSchema is
  // the schema object that owns that keyword, so walk all but the last segment.
  let target = rootSchema;
  for (let i = 0; i < parts.length - 1; i++) {
    if (target == null || typeof target !== 'object') return undefined;
    target = target[parts[i]];
  }
  return target;
}

// Rank an error by walking its schemaPath through the schema object: at each
// level the segment's index among the node's declared keys. Comparing ranks
// lexicographically orders errors by keyword declaration order, which is the
// order AJV emits and what schema authors read top to bottom. Segments that
// cannot be resolved (cross-schema refs, normalized keys) end the walk; the
// stable sort then keeps such errors in engine emission order.
// The rank of a `schemaPath` under a given root is fixed: the schema does not
// change between validations, so neither does the answer. It was recomputed for
// every error of every failing document, and computing it is not cheap. Two
// caches, both keyed on things that do not change:
//
//   rootSchema -> schemaPath -> rank, so a path is walked once ever
//   node       -> key -> its index, so the walk stops calling Object.keys and
//                        scanning the result for a string
//
// A failing route sees the same handful of schemaPaths over and over, which is
// what makes the first one worth having.
const { ordinalFor: schemaOrdinal } = require('./schema-order');

// Text that does not parse, reported the same way on every path and platform:
// ATA9001 with the parser's own message. The native addon used to say only
// "invalid JSON document", and the pure-JS paths used a keyword of their own.
function _jsonSyntaxRejection(e) {
  return { valid: false, errors: [{ keyword: '__parse__', instancePath: '', schemaPath: '', params: {}, message: 'invalid JSON: ' + e.message }] };
}

let _enrichFn = null;
function _enrichLazy(e, opts) {
  if (_enrichFn === null) _enrichFn = require('./enrich-error').enrich;
  return _enrichFn(e, opts);
}

// The rejection the rich-errors wrapper returns. `errors` is built on first
// read and cached; `_ataRaw()` is the raw, schema-ordered list for consumers
// that carry only message and path, such as the Standard Schema bridge.
// Prototype accessors, not per-instance ones: see LazyRejection.
class RichRejection {
  // `rawInput` is the JSON text validateJSON was given, or null for validate(data).
  // The position map it implies is built in the `errors` getter, not here: it is
  // a full walk of the document, it is only ever read through an error's
  // dataFrame, and building it on every rejection cost a caller that reads
  // `.valid` about 460 microseconds on a 50 KB document. Holding the text rather
  // than reading `self._lastRawInput` later also keeps the result independent of
  // what the instance does after this call returns.
  constructor(result, data, rawInput, self, root, enrich) {
    this.valid = false;
    this._result = result;
    this._data = data;
    this._rawInput = rawInput;
    this._self = self;
    this._root = root;
    this._enrich = enrich;
    this._cached = null;
  }
  toJSON() {
    return { valid: false, errors: this.errors };
  }
  _ataRaw() {
    let raw = this._result.errors || [];
    if (raw.length > 1) raw = sortErrorsBySchemaOrder(this._root, raw);
    return raw;
  }
}
Object.defineProperty(RichRejection.prototype, 'errors', {
  enumerable: true,
  configurable: true,
  get() {
    if (this._cached === null) {
      const self = this._self;
      const enrich = this._enrich;
      let raw = this._result.errors || [];
      if (raw.length > 1) raw = sortErrorsBySchemaOrder(this._root, raw);
      // The position map, resolved now that an error is actually being read.
      let positions = null;
      if (enrich && raw.length && this._rawInput != null) {
        positions = self._pos().targeted(this._rawInput, wantedPointersFor(raw));
        if (positions) self._posCache.reset();
      }
      // One options object for the whole list, not one per error.
      const opts = enrich && raw.length
        ? {
            data: this._data,
            positions,
            schemaPositions: self._schemaPositions,
            schemaFile: self._source ? self._source.path : undefined,
          }
        : null;
      const cached = opts
        ? raw.map((e) => enrich(e, opts))
        // The v0.14 shape is a fixed key set; the ordering key the
        // generated code carries is dropped from it here.
        : raw.map(stripOrdinal);
      // Correlation is published, never applied. Both halves of a typo pair
      // stay in the array; `related` only says they are one mistake, so a
      // wrong pairing costs a sentence rather than a hidden violation.
      if (enrich && cached.length > 1) attachRelated(cached);
      // No diagnostic payload here. validate(data) is the library hot path,
      // and attaching one cost about 100 ns per rejection for a consumer
      // that never renders. The text path attaches it, and a renderer given
      // `{ data }` builds frames for object input on request.
      this._cached = cached;
    }
    return this._cached;
  },
});

// The rejection validateJSON returns. Everything the text path adds over
// validate(data), the value tree enrichment needs, the position map, the
// diagnostic payload, happens on first access to `.errors`. Reading `.valid`
// touches none of it. The JSON text is held here rather than read back off the
// validator, so the result does not depend on what the instance does next.
class LazyJsonRejection {
  constructor(result, jsonStr, self, enrich) {
    this.valid = false;
    this._result = result;
    this._jsonStr = jsonStr;
    this._self = self;
    this._enrich = enrich;
    this._cached = null;
  }
  toJSON() {
    return { valid: false, errors: this.errors };
  }
}
Object.defineProperty(LazyJsonRejection.prototype, 'errors', {
  enumerable: true,
  configurable: true,
  get() {
    if (this._cached !== null) return this._cached;
    const self = this._self;
    const enrich = this._enrich;
    const jsonStr = this._jsonStr;
    // Reading the inner errors realizes the inner lazy layer, if there was one.
    const raw = this._result.errors || [];
    if (!raw.length) { this._cached = raw; return raw; }

    // The enrich pass plucks `received` from the value tree and the suggestion
    // engine (required-typo, format hints, coercion nudges) walks it too.
    let parsedData;
    try { parsedData = JSON.parse(jsonStr); } catch { parsedData = undefined; }
    // What was checked is the document after defaults, coercion and removal,
    // so `received` has to come from that, as it does for validate(). A
    // default that failed its own schema has no value in the text at all.
    if (parsedData !== undefined && self._preprocess) self._preprocess(parsedData);

    // Errors the inner path already enriched carry a `received` key: enrich()
    // always sets one, even when there is no value to show. `code` is not a
    // safe signal, because branch-collapse attaches codes to raw errors, and
    // `docUrl` is not either, because the generated error functions stamp it
    // on raw errors; taking it as the signal left those errors without
    // `received` or a suggestion on the text path while validate() had both.
    if (!raw[0] || !('received' in raw[0])) {
      const positions = self._pos().targeted(jsonStr, wantedPointersFor(raw));
      // Declaration order, as validate() applies it; the text path used to
      // enrich in emission order.
      const ordered = raw.length > 1 ? sortErrorsBySchemaOrder(self._schemaObj, raw) : raw;
      const enrichOpts = {
        data: parsedData,
        positions,
        schemaPositions: self._schemaPositions,
        schemaFile: self._source ? self._source.path : undefined,
      };
      const enriched = ordered.map((e) => enrich(e, enrichOpts));
      if (enriched.length > 1) attachRelated(enriched);
      attachDiagnosticSource(enriched, {
        data: parsedData,
        text: jsonStr,
        positions,
        schema: self._schemaObj,
        mutatesInput: self._mutatesInput === true,
      });
      if (positions) self._posCache.reset();
      this._cached = enriched;
      return enriched;
    }

    // Already enriched, so the frames are usually attached too. Only a gap in
    // them is worth another walk of the document: resolving the map to discover
    // there was nothing to fill cost a second full walk on every rejection.
    if (raw.some((e) => e && !e.dataFrame)) {
      const positions = self._pos().targeted(jsonStr, wantedPointersFor(raw.filter((e) => e && !e.dataFrame)));
      if (positions) {
        for (const e of raw) {
          if (e && !e.dataFrame) {
            const path = e.path != null ? e.path : (e.instancePath || '');
            const p = positions[path];
            if (p) e.dataFrame = { byteOffset: p.byteOffset, length: p.length, line: p.line, col: p.col, text: p.text };
          }
        }
        self._posCache.reset();
      }
    }
    if (raw.length > 1) attachRelated(raw);
    attachDiagnosticSource(raw, {
      data: parsedData,
      text: jsonStr,
      schema: self._schemaObj,
      mutatesInput: self._mutatesInput === true,
    });
    this._cached = raw;
    return raw;
  },
});

// The pointers a set of errors will ask the position map about. lib/enrich-error
// looks up the error's own path, and for an additional or unevaluated property
// the child pointer named in `params`, unescaped, which is the form it asks for.
// The escaped form goes in too: including a pointer that is never read costs
// nothing, and the cache answers anything outside this set from the full map
// rather than reporting no position.
function wantedPointersFor (errors) {
  const wanted = new Set();
  for (const e of errors) {
    if (!e) continue;
    const path = e.path != null ? e.path : (e.instancePath || '');
    wanted.add(path);
    if (e.instancePath != null && e.instancePath !== path) wanted.add(e.instancePath);
    const params = e.params;
    const named = params && (params.additionalProperty || params.unevaluatedProperty);
    if (typeof named === 'string') {
      wanted.add(path + '/' + named);
      if (named.indexOf('~') !== -1 || named.indexOf('/') !== -1) {
        wanted.add(path + '/' + named.replace(/~/g, '~0').replace(/\//g, '~1'));
      }
    }
  }
  return wanted;
}

// A raw error without the `_o` ordering key, for the legacy error shape.
function stripOrdinal(e) {
  if (e === null || typeof e !== 'object' || e._o === undefined) return e;
  const out = {};
  for (const k in e) if (k !== '_o') out[k] = e[k];
  return out;
}

// Errors in schema declaration order. Each error's key is its schemaPath's
// pre-order ordinal in the root schema: written into the literal by the code
// generator (`_o`), looked up once per path otherwise. Most rejections come
// out already ordered, and those return without sorting or allocating.
function sortErrorsBySchemaOrder(rootSchema, errors) {
  const n = errors.length;
  const keys = new Array(n);
  let sorted = true;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const e = errors[i];
    let o = typeof e._o === 'number' ? e._o : schemaOrdinal(rootSchema, e.schemaPath);
    // An error with no place in this document (an appended custom-keyword
    // error, a path into another schema) stays next to the error before it,
    // which is where the rank comparison left it too.
    if (o === null) o = prev < 0 ? 0 : prev;
    keys[i] = o;
    if (o < prev) sorted = false;
    prev = o;
  }
  if (sorted) return errors;
  // Error lists are short. A stable insertion sort over the integer keys
  // moves the errors in tandem with no comparator calls and no index array.
  const out = errors.slice();
  for (let i = 1; i < n; i++) {
    const k = keys[i];
    const e = out[i];
    let j = i - 1;
    while (j >= 0 && keys[j] > k) { keys[j + 1] = keys[j]; out[j + 1] = out[j]; j--; }
    keys[j + 1] = k;
    out[j + 1] = e;
  }
  return out;
}


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
const EMPTY_PATH = Object.freeze([]);

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

function createPaddedBuffer(jsonStr) {
  if (typeof Buffer === 'undefined') throw new Error('createPaddedBuffer requires Node.js Buffer');
  const jsonBuf = Buffer.from(jsonStr);
  const padded = Buffer.allocUnsafe(jsonBuf.length + SIMDJSON_PADDING);
  jsonBuf.copy(padded);
  padded.fill(0, jsonBuf.length);
  return { buffer: padded, length: jsonBuf.length };
}

// Deep-clone a value, copying own symbol keys by reference at every level.
// Arrays and plain objects are cloned recursively; primitives, RegExp,
// functions, and other non-plain values are returned as-is. Symbol values
// (e.g. refinement lists, OPTIONAL markers) are owned by the caller's builder
// and sharing them is correct — they are never mutated by normalization.
function _deepCloneWithSymbols(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const a = new Array(v.length);
    for (let i = 0; i < v.length; i++) a[i] = _deepCloneWithSymbols(v[i]);
    return a;
  }
  // Only clone plain objects (skip RegExp, Date, etc.).
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v;
  const out = Object.create(null);
  for (const k of Object.keys(v)) Object.defineProperty(out, k, { value: _deepCloneWithSymbols(v[k]), writable: true, enumerable: true, configurable: true });
  for (const sym of Object.getOwnPropertySymbols(v)) out[sym] = v[sym];
  return Object.setPrototypeOf(out, Object.prototype);
}

// Normalize a caller-provided schema without mutating the original.
// Clones only when normalization would change the object (draft-07 keys
// present or nullable fields present). Internal-only — not exported.
function _normalizeCallerSchema(s, inheritDraft7) {
  const declares = s && typeof s === 'object' && s.$schema !== undefined
  const needsDraft7 = declares
    ? (s.$schema === 'http://json-schema.org/draft-07/schema#' || s.$schema === 'http://json-schema.org/draft-07/schema')
    : !!inheritDraft7
  // One walk answers whether there is anything to do. Almost always there is
  // not, and then the serialize, clone, normalize, serialize, compare below is
  // work spent to find that out. The walk over-reports rather than under, so a
  // schema it clears is one no normalizer would have touched;
  // `tests/test_schema_scan.js` holds that direction against the whole suite.
  if (!needsNormalization(s, needsDraft7)) return s

  const str = JSON.stringify(s)
  const copy = _deepCloneWithSymbols(s)
  if (needsDraft7) normalizeDraft7(copy, true)
  normalizeNullable(copy)
  normalizeExclusiveBounds(copy)
  // Return original when normalization produced no change, copy otherwise.
  // Kept even though the walk has already said there is work, so that a walk
  // which over-reports still returns exactly what it returned before.
  // Change-detection uses JSON content only; symbols do not affect it.
  return JSON.stringify(copy) === str ? s : copy
}

// The identity a document is registered under. Draft-07 ignores every
// keyword sitting next to `$ref`, so normalization drops them, `$id` among
// them: that is the right reading for evaluation, where the reference
// resolves against the retrieval URI rather than the declared `$id`. It is
// the wrong reading for registration, since `$id` is how the caller names
// the document. So the identity is read from the normalized copy first and
// from what the caller passed second. A bare-fragment `$id` is a draft-07
// anchor rather than a document identity, and normalization has already
// turned it into `$anchor`, so it is not used here.
function declaredId(original, normalized) {
  const n = normalized && typeof normalized === 'object' ? normalized.$id : undefined
  if (typeof n === 'string' && n !== '') return n
  const o = original && typeof original === 'object' ? original.$id : undefined
  if (typeof o === 'string' && o !== '' && o[0] !== '#') return o
  return undefined
}

// `inheritDraft7` is true when the root schema is draft-07: a retrieved
// document that declares no dialect is read under the root's draft.
// The map is derived entirely from what the caller passed, so the same
// `schemas` gives the same map. A server building one validator per route over
// a shared registry rebuilt it once per route, normalizing and re-reading the
// `$id` of every registered schema each time. Keyed by the registry object,
// and by the draft it is read under, since that changes what normalization
// does to a document which declares no dialect of its own.
//
// Validators share the returned map, so anything that mutates one calls
// `_ownSchemaMap()` first. There are two such places: registering the vendored
// meta-schemas during compilation, and `addSchema()`.
const _schemaMapCache = new WeakMap()

function buildSchemaMap(schemas, inheritDraft7) {
  if (!schemas) return null
  const byDraft = _schemaMapCache.get(schemas)
  if (byDraft) {
    const hit = byDraft[inheritDraft7 ? 1 : 0]
    if (hit) return hit
  }
  const map = _buildSchemaMap(schemas, inheritDraft7)
  const slot = byDraft || [null, null]
  slot[inheritDraft7 ? 1 : 0] = map
  if (!byDraft) _schemaMapCache.set(schemas, slot)
  return map
}

function _buildSchemaMap(schemas, inheritDraft7) {
  const map = new Map()
  if (Array.isArray(schemas)) {
    for (const s of schemas) {
      const normalized = _normalizeCallerSchema(s, inheritDraft7)
      const id = declaredId(s, normalized)
      if (!id) throw new Error('Schema in schemas option must have $id')
      map.set(id, normalized)
    }
  } else {
    for (const [key, s] of Object.entries(schemas)) {
      const normalized = _normalizeCallerSchema(s, inheritDraft7)
      // A retrieved document is addressable both by the URI it was registered
      // under and by the $id it declares. Registering only the $id makes
      // references to the retrieval URI unresolvable.
      map.set(key, normalized)
      const id = declaredId(s, normalized)
      if (id && id !== key) map.set(id, normalized)
    }
  }
  return map
}

// A schema which names a custom meta-schema in `$schema` is written against
// whatever dialect that meta-schema declares. A keyword from a vocabulary the
// dialect does not have is not part of the dialect, so it is an unknown
// keyword and does not apply. Removing it here means every engine sees the
// same schema and none of them needs to know about vocabularies.
//
// Only the root is consulted. A subschema naming its own `$schema` is its own
// resource under its own dialect, and the walk stops there rather than
// applying this dialect's answer to it.
function _applyVocabularies(schemaObj, original, schemaMap) {
  if (!schemaObj || typeof schemaObj !== 'object') return schemaObj
  const declared = schemaObj.$schema
  if (typeof declared !== 'string') return schemaObj
  const enabled = enabledKeywords(schemaMap.get(declared))
  if (!enabled) return schemaObj
  // `original` is the caller's own object when it reached here unchanged, and
  // that one is never mutated.
  const copy = schemaObj === original
    ? _deepCloneWithSymbols(schemaObj)
    : schemaObj
  return stripDisabledKeywords(copy, enabled)
}

// Compile-cache key for a root schema plus its external schemas. Must include
// the external schema CONTENT, not just their $ids: two validators can share a
// root schema string and the same $id while pointing that $id at different
// schemas (separate app instances, test suites, multi-tenant). Keying on $id
// alone reuses the wrong compiled validator and silently mis-validates.
function compileCacheKey(schemaStr, schemaMap) {
  if (!schemaMap || schemaMap.size === 0) return schemaStr
  const parts = []
  for (const [id, s] of schemaMap) parts.push(id + '=' + JSON.stringify(s))
  parts.sort()
  return schemaStr + '\0' + parts.join('\0')
}

// Resolve a cross-schema $ref to its target schema for preprocessing purposes.
// Handles whole-schema refs (`shared#`), relative-id matching, and JSON pointer
// fragments (`shared#/properties/id`). Returns null for local-only refs or when
// the target cannot be found. Used only to read `type`/`properties` for
// coercion/defaults/removeAdditional, never for validation.
function resolveRefForPreprocess(ref, schemaMap) {
  if (!schemaMap || schemaMap.size === 0 || typeof ref !== 'string') return null
  const hashIdx = ref.indexOf('#')
  const baseId = hashIdx >= 0 ? ref.slice(0, hashIdx) : ref
  const fragment = hashIdx >= 0 ? ref.slice(hashIdx + 1) : ''
  if (!baseId) return null
  let base = null
  if (schemaMap.has(baseId)) base = schemaMap.get(baseId)
  else if (!ref.includes('://')) {
    for (const [id, s] of schemaMap) {
      if (id.endsWith('/' + baseId)) { base = s; break }
    }
  }
  if (!base) return null
  if (!fragment) return base
  let target = base
  for (const part of fragment.split('/')) {
    if (part === '') continue
    if (target == null || typeof target !== 'object') return null
    target = target[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return target == null ? null : target
}

// Preprocessing (coerce/defaults/removeAdditional) reads `schema.properties` and
// each property's `type`. When the data shape lives behind a cross-schema $ref
// (a whole-schema ref like Fastify's `params: { $ref: 'shared#' }`, or a
// property ref like `{ id: { $ref: 'shared#/properties/id' } }`), follow the
// ref so the preprocessor can see the referenced shape. Returns the schema with
// such refs resolved, cloning only when a substitution is made.
function resolveSchemaForPreprocess(schema, schemaMap) {
  if (!schema || typeof schema !== 'object' || !schemaMap || schemaMap.size === 0) return schema
  let s = schema
  // Whole-schema ref (only when it has no own properties, to avoid dropping
  // sibling keywords on schemas that mix $ref with properties).
  if (s.$ref && !s.properties) {
    const t = resolveRefForPreprocess(s.$ref, schemaMap)
    if (t && typeof t === 'object') s = t
  }
  if (!s.properties) return s
  // Property-level refs: substitute the resolved target so coercion sees `type`.
  let cloned = null
  for (const key of Object.keys(s.properties)) {
    const p = s.properties[key]
    if (p && typeof p === 'object' && p.$ref && !p.type) {
      const t = resolveRefForPreprocess(p.$ref, schemaMap)
      if (t && typeof t === 'object') {
        if (!cloned) { cloned = Object.assign({}, s); cloned.properties = Object.assign({}, s.properties) }
        cloned.properties[key] = t
      }
    }
  }
  return cloned || s
}

// `_schemaObj` and `_usesKeywords` are materialized together on first read:
// the caller's schema normalized on a clone (the caller's object is never
// touched), `format` stripped under `assertFormat: false`, and the custom
// keyword scan. The accessors then step aside for own data properties, so
// every later read is a plain field.
function _materializeSchema(self) {
  const raw = self._rawSchema;
  const options = self._options;
  let schemaObj = _normalizeCallerSchema(raw);
  const isCallers = self._rawIsCallers && schemaObj === raw;
  if (options.assertFormat === false) {
    schemaObj = stripFormatAssertions(isCallers ? _deepCloneWithSymbols(schemaObj) : schemaObj);
  }
  const usesKeywords = self._keywords !== null && schemaUsesKeywords(schemaObj, self._keywords);
  Object.defineProperty(self, '_schemaObj', { value: schemaObj, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(self, '_usesKeywords', { value: usesKeywords, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(self, '_schemaIsCallers', { value: isCallers && schemaObj === raw, writable: true, configurable: true, enumerable: true });
  return schemaObj;
}

class Validator {
  constructor(schema, opts) {
    const options = opts || {};

    // Ultra-fast path: same schema object reference -> return cached instance
    // JS constructor returning an object makes `new` return that object
    // Cost: one WeakMap lookup. No property copy, no setup, nothing.
    if (!opts && typeof schema === "object" && schema !== null) {
      const hit = _identityCache.get(schema);
      if (hit) return hit;
    }

    // The schema is not walked here. Normalization (draft-07 rewrites,
    // nullable, `assertFormat: false`) and the scan that decides whether any
    // of it is needed run on the first read of `_schemaObj`, which is the
    // first compile. Construction is the object and its fields; a server
    // building a validator per request pays nothing for a schema it never
    // uses, and a benchmark timing construction measures construction.
    // When schema is a string, JSON.parse already produces a fresh object.
    const raw = typeof schema === "string" ? JSON.parse(schema) : schema;
    const rootIsDraft7 = !!(raw && typeof raw === 'object' && typeof raw.$schema === 'string' &&
      (raw.$schema === 'http://json-schema.org/draft-07/schema#' || raw.$schema === 'http://json-schema.org/draft-07/schema'));

    // Built here rather than below because `$vocabulary` is resolved against
    // it, and that resolution waits until compilation so a meta-schema
    // registered by addSchema() still counts.
    const shared = buildSchemaMap(options.schemas, rootIsDraft7);
    const schemaMap = shared || new Map();
    this._schemaMapShared = shared !== null;
    this._vocabulariesApplied = false;

    // Custom keywords, normalized once. `_usesKeywords` (resolved with the
    // schema) is what routes the schema to the interpreted engine and keeps
    // it out of the shared compile cache; a schema that registers keywords
    // but uses none of them takes the ordinary path.
    this._keywords = normalizeKeywords(options.keywords);

    this._schemaStr = null; // lazy: computed on first use
    this._rawSchema = raw;
    this._rawIsCallers = typeof schema !== "string";
    this._options = options;
    this._noOpts = !opts;
    // engine: 'interpreter' keeps this validator off code generation: no
    // `new Function`, no shared compile cache, the eval-free interpreted
    // engine answers validate(), isValidObject() and validateJSON(). For a
    // schema that arrives from outside the trust boundary (a plugin's
    // declared config shape, a tenant's upload), where turning it into source
    // is not an acceptable execution model. ATA_FORCE_NAPI does this for the
    // whole process; the option does it for one validator. A misspelling
    // must not fall through to codegen, so anything else is refused.
    if (options.engine !== undefined && options.engine !== 'auto' && options.engine !== 'interpreter') {
      throw new TypeError("engine must be 'auto' or 'interpreter', got " + JSON.stringify(options.engine));
    }
    this._interpretOnly = options.engine === 'interpreter';
    this._initialized = false;
    this._nativeReady = false;
    this._compiled = null;
    this._fastSlot = -1;
    this._jsFn = null;
    this._engine = undefined;
    this._preprocess = null;
    this._applyDefaults = null;

    // Schema map for cross-schema $ref resolution
    this._schemaMap = schemaMap;

    // User-supplied format checkers: { formatName: (value) => boolean }.
    // Looked up at runtime when a schema references a format the built-in
    // registry does not know about.
    this._userFormats = options.formats || null;

    // Verbose mode: when on, errors carry parentSchema (the schema object that
    // produced the error). Matches ajv's `verbose: true` behavior.
    this._verbose = !!options.verbose;

    // strictSchema: authoring-time checks, off by default. A mistyped keyword
    // is the one schema mistake that fails open: to every dialect `maxLenght`
    // is an annotation, so the constraint the author meant is simply absent
    // and previously invalid data validates. `true` throws here, at
    // construction, with every finding; `'log'` reports through
    // `options.logger` or the console and continues. The check runs on the
    // schema as written, before any normalization touches it.
    if (options.strictSchema === true || options.strictSchema === 'log') {
      const { checkSchemaStrict } = require('./strict-check');
      const problems = checkSchemaStrict(schema, { userKeywords: options.keywords || null });
      if (problems.length > 0) {
        const text = problems.map((x) => `strict mode: ${x.message} at ${x.path}`).join('\n');
        if (options.strictSchema === true) {
          throw new Error(text);
        }
        const logger = options.logger;
        if (logger !== false) {
          const warn = logger && typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn;
          warn(text);
        }
      }
    }

    // richErrors: default true. Only the literal `false` opts back into the
    // v0.14 error shape (no code/expected/received/docUrl, no aliases).
    this._richErrors = options && options.richErrors === false ? false : true;

    // Optional schema source descriptor. When supplied, the renderer pipeline
    // can attach a `schemaSource` frame to enriched errors.
    this._source = options && options.source && typeof options.source === 'object'
      ? { path: String(options.source.path || ''), content: String(options.source.content || '') }
      : null;

    // Build a JSON pointer -> position map for the schema text once at
    // construction so each runtime error can resolve `schemaSource` without
    // re-scanning the source on every validate() call.
    if (this._source) {
      const { buildPositionMap } = require('./source-positions');
      this._schemaPositions = buildPositionMap(this._source.content);
    } else {
      this._schemaPositions = null;
    }

    // Per-validate data position cache. Populated by validateJSON before
    // dispatching to inner validate(); consulted by the rich-error wrap
    // to attach dataFrame entries to each enriched error.
    this._posCache = null; // created by _pos() on first use, only the JSON text path needs it
    this._lastRawInput = null;
    // undefined: not built yet. null: this schema has no scanner.
    this._scanner = undefined;
    // Checks a wrapper registered through _extendChecks. Declared here so
    // registering one does not change the instance's shape.
    this._verdictTail = null;
    this._validateTail = null;
    this._entryExt = null;

    // Public methods start as memoized accessors on the prototype; nothing is
    // allocated per instance until one is first read. See _defineLazyMethod
    // below the class.

    // "~standard" (Standard Schema V1) is a lazy prototype accessor too;
    // see below the class. Consumers only pay for it if they read it.

    // The identity cache, which lets a later `new Validator(sameSchema)` return
    // this instance, is filled on the first compile rather than here. A WeakMap
    // entry is an ephemeron the collector has to trace separately, and setting
    // one cost about 780 ns against 150 for the rest of this constructor, five
    // times over for an instance that may never validate anything. Once an
    // instance has compiled, the shortcut behaves as before.
  }

  // `$vocabulary` says which keywords the dialect has, and answering needs the
  // meta-schema, which addSchema() may only have registered just now. Run once,
  // before anything reads the schema, and before `_schemaStr` is computed from
  // it. After this addSchema() is refused, so the answer cannot go stale.
  // Whether validation is preceded by a pass that rewrites the input:
  // coercion, removal of undeclared keys, or filling in defaults. The verdict
  // methods have to take the same path when it is, so the quick bindings that
  // answer from the compiled function alone are not used for these validators.
  _needsPreprocess() {
    const o = this._options;
    if (o.coerceTypes || o.removeAdditional) return true;
    if (o.useDefaults === false) return false;
    if (!this._schemaStr) this._schemaStr = JSON.stringify(this._schemaObj);
    return this._schemaStr.includes('"default"');
  }

  _pos() {
    return this._posCache || (this._posCache = require('./data-position-cache').createCache());
  }

  _ensureVocabularies() {
    if (this._vocabulariesApplied) return;
    this._vocabulariesApplied = true;
    const stripped = _applyVocabularies(
      this._schemaObj,
      this._schemaIsCallers ? this._schemaObj : null,
      this._schemaMap,
    );
    if (stripped !== this._schemaObj) {
      this._schemaObj = stripped;
      this._schemaStr = null;
    }
  }

  _ensureCompiled() {
    if (this._initialized) return;
    this._ensureVocabularies();
    this._initialized = true;

    const schemaObj = this._schemaObj;
    const options = this._options;

    // Lazy stringify — only computed here, not in constructor
    if (!this._schemaStr) this._schemaStr = JSON.stringify(schemaObj);

    // A $ref to a meta-schema resolves from the vendored copies, so
    // "validate this schema against its dialect" needs no network and no
    // caller-supplied registry. Only schemas that mention json-schema.org in a
    // reference pay for the lookup.
    if (this._schemaStr.includes('json-schema.org/draft')) {
      const { METASCHEMAS } = require('./metaschemas');
      this._ownSchemaMap();
      for (const [id, meta] of METASCHEMAS) {
        const bare = id.replace(/#$/, '');
        for (const key of [id, bare, bare + '#', bare.replace(/^https:/, 'http:'), bare.replace(/^http:/, 'https:')]) {
          if (!this._schemaMap.has(key)) this._schemaMap.set(key, meta);
        }
      }
    }

    // Check cache first -- reuse compiled functions for same schema
    const sm = this._schemaMap.size > 0 ? this._schemaMap : null;
    const mapKey = compileCacheKey(this._schemaStr, this._schemaMap);
    var _forceNapi = this._interpretOnly || (typeof process !== 'undefined' && process.env && process.env.ATA_FORCE_NAPI);
    // Custom formats are JS functions: bypass the compile cache since they can
    // differ between validators that share the same schema string. An
    // interpreter-only validator never touches it either way: a function a
    // trusted validator compiled for the same schema string must not answer
    // for it.
    const cached = (this._userFormats || this._usesKeywords || _forceNapi) ? null : _compileCache.get(mapKey);
    let jsFn, jsCombinedFn, jsErrFn, _isCodegen = false;
    // v1 removes the bookending requirement for $dynamicRef. Only the
    // interpreted engine implements that; the JS compiler and the native
    // engine both resolve the 2020-12 way, so a v1 schema using the keyword
    // goes to the interpreter rather than being validated under the wrong
    // dialect. Schemas without $dynamicRef are unaffected: v1 and 2020-12
    // agree on everything else ata implements.
    this._v1Dynamic =
      isV1Dialect(schemaObj) &&
      (this._schemaStr.includes('"$dynamicRef"') || this._schemaStr.includes('"$dynamicAnchor"'));
    //
    // Where source cannot be turned into a function, neither JS path is usable
    // either. The closure path does not call `new Function` itself, so it
    // survives the block and would quietly handle schemas it gets wrong; the
    // interpreted engine is both eval-free and more correct, so go straight
    // there. The forced case is decided before the probe: the probe is a
    // `new Function` too, and a validator that promised none must not run it.
    if (_forceNapi || this._v1Dynamic || this._usesKeywords || !codegenAvailable()) {
      jsFn = null; jsCombinedFn = null; jsErrFn = null;
    // `full` separates an entry that holds every compiled function from one
    // the verdict-only fast path seeded, where `combined` and `errFn` are null
    // because nothing has tried to build them yet. Both halves of that
    // distinction are null, and reading the second as the first costs this
    // schema its generated error function for the life of the process.
    } else if (cached && cached.jsFn !== undefined) {
      // `full` says the error and combined functions exist too. An entry
      // without it still carries a verdict function worth reusing; the pair is
      // built by _buildErr/_buildCombined below when something asks, and the
      // entry is upgraded then. `undefined` in `combined`/`errFn` means not
      // built yet; `null` means the compiler declined. Those two must never
      // blur: reading the first as the second is the bug this cache had once
      // already, and it silently cost schemas their generated error function.
      jsFn = cached.jsFn;
      jsCombinedFn = cached.combined;
      jsErrFn = cached.errFn;
      _isCodegen = !!cached.isCodegen;
      this._engine = _isCodegen ? 'codegen' : jsFn ? 'closure' : null;
    } else {
      const uf = this._userFormats;
      const _cgFn = compileToJSCodegen(schemaObj, sm, uf);
      jsFn = _cgFn || compileToJS(schemaObj, null, sm);
      // Only the verdict is compiled here. The error and combined generators
      // are the other two thirds of a cold first call (8.2, 10.4 and 7.8 ms on
      // a 120-property config schema, most of it V8 compiling each generator
      // the first time it is entered), and a caller that never reads an error
      // never needs them. _buildErr/_buildCombined compile them on demand.
      jsCombinedFn = undefined;
      jsErrFn = undefined;
      _isCodegen = !!_cgFn;
      this._engine = _cgFn ? 'codegen' : jsFn ? 'closure' : null;
      if (!uf) {
        _compileCache.set(mapKey, { jsFn, combined: undefined, errFn: undefined, isCodegen: _isCodegen, full: false });
      }
    }
    this._jsFn = jsFn;
    if (this._engine === undefined) this._engine = null;

    // Data mutators -- try codegen first (12x faster), fallback to closure arrays.
    // Follow cross-refs so coercion/defaults/removeAdditional see the referenced
    // shape (e.g. Fastify `params: { $ref: 'shared#' }` or property refs like
    // `{ id: { $ref: 'shared#/properties/id' } }`).
    const preprocessSchema = resolveSchemaForPreprocess(schemaObj, this._schemaMap);
    // The mutator pass (defaults, coercion, removal) is generated source too,
    // with the schema's `default` values embedded; an interpreter-only
    // validator takes the closure mutators instead.
    let preprocess = this._interpretOnly || _codegen === null ? null : _codegen.buildPreprocess(preprocessSchema, options);
    if (!preprocess) {
      const applyDefaults = options.useDefaults === false ? null : buildDefaultsApplier(preprocessSchema);
      const applyCoerce = options.coerceTypes ? buildCoercer(preprocessSchema) : null;
      const applyRemove = options.removeAdditional
        ? buildRemover(preprocessSchema)
        : null;
      const mutators = [applyRemove, applyCoerce, applyDefaults].filter(Boolean);
      preprocess =
        mutators.length === 0
          ? null
          : mutators.length === 1
            ? mutators[0]
            : (data) => {
                for (let i = 0; i < mutators.length; i++) mutators[i](data);
              };
    }
    this._applyDefaults = preprocess;
    // Whether validate() can change the caller's object before the verdict.
    // This is a capability, not an option: `useDefaults` is on by default, but
    // buildDefaultsApplier returns null when the schema declares no defaults,
    // so a plain schema is genuinely non-mutating. The renderers refuse to
    // synthesize a frame when this is true, because a frame built from mutated
    // data would show the reader a value they never sent.
    this._mutatesInput = !!(preprocess || options.coerceTypes || options.removeAdditional);
    this._preprocess = preprocess;

    // removeAdditional alone, the common parse-and-strip use: a verdict function
    // that deletes unknown keys in the walk it already makes, where the pass
    // above walks every object a second time just to find them. It answers
    // the documents it accepts; anything it rejects takes the full path below,
    // which removes, validates and reports exactly as before, so a rejected
    // document is left as clean as it always was. The generator declines any
    // schema where deleting during the walk could change an answer.
    let fusedRemove = null;
    if (preprocess && options.removeAdditional && !options.coerceTypes && !this._interpretOnly &&
        !this._userFormats && !this._usesKeywords && !this._schemaStr.includes('"default"')) {
      try {
        fusedRemove = compileToJSCodegen(schemaObj, this._schemaMap.size > 0 ? this._schemaMap : null, null, { removeAdditional: true });
      } catch {
        fusedRemove = null;
      }
    }

    // Detect if schema is "selective" -- doesn't recurse into arrays/deep objects.
    const hasArrayTraversal =
      schemaObj &&
      (schemaObj.items ||
        schemaObj.prefixItems ||
        schemaObj.contains ||
        (schemaObj.properties &&
          Object.values(schemaObj.properties).some(
            (p) => p && (p.items || p.prefixItems || p.contains),
          )));
    const useSimdjsonForLarge = !hasArrayTraversal;

    // Build the generators the compile step left out, each only when something
    // asks for it, and upgrade the shared cache entry. A first rejection needs
    // one of the two, not both; building both was a millisecond of V8 compiling
    // a generator nobody called. `undefined` means not built yet; `null` means
    // the compiler declined. Conflating those is what once cost every schema
    // its generated error function for the life of the process, so they stay
    // apart, and `full` is set only once both exist.
    const _upgradeCacheEntry = () => {
      if (this._userFormats) return;
      const entry = _compileCache.get(mapKey);
      if (entry && entry.jsFn === jsFn) {
        if (jsCombinedFn !== undefined) entry.combined = jsCombinedFn;
        if (jsErrFn !== undefined) entry.errFn = jsErrFn;
        if (jsCombinedFn !== undefined && jsErrFn !== undefined) entry.full = true;
      }
    };
    const _buildCombined = () => {
      if (jsCombinedFn !== undefined) return;
      jsCombinedFn = compileToJSCombined(schemaObj, VALID_RESULT, sm, this._userFormats) || null;
      _upgradeCacheEntry();
    };
    const _buildErr = () => {
      if (jsErrFn !== undefined) return;
      jsErrFn = compileToJSCodegenWithErrors(schemaObj, sm, this._userFormats) || null;
      _upgradeCacheEntry();
    };

    if (jsFn) {
      _codegen.installPaths.call(this, {
        jsFn, _isCodegen, preprocess, fusedRemove, options, schemaObj, useSimdjsonForLarge, _buildCombined, _buildErr,
        combined: () => jsCombinedFn, err: () => jsErrFn,
      });
    } else if (native) {
      // No JS codegen: buffer/parallel APIs always come from the native
      // engine, but the object-validation entry points take the interpreted
      // engine, which handles the $id/URN base-URI resolution corners the
      // native resolver gets wrong, $dynamicRef included, and works without
      // the addon.
      this._ensureNative();
      let _validate, _isValid, _run;
      {
        const { createInterpreter } = require('./interpreter');
        const interp = createInterpreter(schemaObj, {
          schemaMap: this._schemaMap.size > 0 ? this._schemaMap : null,
          formats: this._userFormats,
          v1: isV1Dialect(schemaObj),
          keywords: this._keywords,
        });
        this._engine = 'interpreter';
        _validate = (data) => interp.validate(data);
        _isValid = (data) => interp.isValid(data);
        this._fastVerdict = preprocess ? null : _isValid;
        // The text path parses and then answers as validate() does, rewrite
        // and abortEarly included; calling the engine directly skipped
        // defaults, coercion and removal, and accepted a document validate()
        // rejects. `_run` is that function, assigned below, before the error
        // presentation layer wraps validate().
        const _validateParsed = (data) => _run(data);
        this.validateJSON = (jsonStr) => {
          let data;
          try {
            data = JSON.parse(jsonStr);
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
            return _jsonSyntaxRejection(e);
          }
          return _validateParsed(data);
        };
        this.isValidJSON = (jsonStr) => this.validateJSON(jsonStr).valid;
      }
      // abortEarly promises the frozen ATA9000 stub whichever engine answers,
      // as on the branch below; this one used to return full errors.
      this.validate = options.abortEarly
        ? (preprocess
            ? (data) => { preprocess(data); return _isValid(data) ? VALID_RESULT : ABORT_EARLY_RESULT; }
            : (data) => (_isValid(data) ? VALID_RESULT : ABORT_EARLY_RESULT))
        : preprocess
          ? (data) => {
              preprocess(data);
              return _validate(data);
            }
          : _validate;
      _run = this.validate;
      _bindVerdict(this, this._fastVerdict
        ? this._fastVerdict
        // The rewrite runs first here too, as it does for validate() above; a
        // verdict without it disagreed with validate() on input that coercion,
        // a default or a removed key would have fixed.
        : preprocess
          ? (data) => { preprocess(data); return _validate(data).valid; }
          : (data) => _validate(data).valid);
      this.validateAndParse = (jsonStr) => this._compiled.validateAndParse(jsonStr);
      {
        const slot = this._fastSlot;
        this.isValid = (buf) => {
          if (typeof buf === 'string') buf = Buffer.from(buf);
          else if (!(buf instanceof Uint8Array)) throw new TypeError('isValid() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().');
          return native.rawFastValidate(slot, buf);
        };
      }
      {
        const slot = this._fastSlot;
        this.countValid = (ndjsonBuf) => {
          if (typeof ndjsonBuf === 'string') ndjsonBuf = Buffer.from(ndjsonBuf);
          else if (!(ndjsonBuf instanceof Uint8Array)) throw new TypeError('countValid() requires a Buffer, Uint8Array, or string');
          const results = native.rawNDJSONValidate(slot, ndjsonBuf);
          let count = 0;
          for (let i = 0; i < results.length; i++) if (results[i]) count++;
          return count;
        };
      }
      {
        const slot = this._fastSlot;
        this.batchIsValid = (buffers) => {
          let valid = 0;
          for (const buf of buffers) {
            if (!(buf instanceof Uint8Array)) throw new TypeError('batchIsValid() requires Buffer or Uint8Array elements');
            if (native.rawFastValidate(slot, buf)) valid++;
          }
          return valid;
        };
      }
    } else {
      // No JS codegen and no native engine: fall back to the interpreted
      // engine. Slow but correct, and strictly better than the previous
      // behavior (the lazy stubs re-dispatched to themselves forever).
      const { createInterpreter } = require('./interpreter');
      const interp = createInterpreter(schemaObj, {
        schemaMap: this._schemaMap.size > 0 ? this._schemaMap : null,
        formats: this._userFormats,
        v1: isV1Dialect(schemaObj),
        keywords: this._keywords,
      });
      this._engine = 'interpreter';
      if (!preprocess) this._fastVerdict = (d) => interp.isValid(d);
      // abortEarly is a documented contract, not a property of whichever engine
      // answered: it promises the frozen ATA9000 stub instead of a detailed
      // error, so code that branches on it has to behave the same with and
      // without code generation. Taking the verdict path here also skips
      // building the errors the caller said it did not want.
      const run = options.abortEarly
        ? (preprocess
            ? (data) => { preprocess(data); return interp.isValid(data) ? VALID_RESULT : ABORT_EARLY_RESULT; }
            : (data) => (interp.isValid(data) ? VALID_RESULT : ABORT_EARLY_RESULT))
        : (preprocess
            ? (data) => { preprocess(data); return interp.validate(data); }
            : (data) => interp.validate(data));
      this.validate = run;
      _bindVerdict(this, this._fastVerdict
        ? this._fastVerdict
        : (data) => run(data).valid);
      this.validateJSON = (jsonStr) => {
        let data;
        try {
          data = JSON.parse(jsonStr);
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
          return _jsonSyntaxRejection(e);
        }
        return run(data);
      };
      this.isValidJSON = (jsonStr) => this.validateJSON(jsonStr).valid;
    }

    // Error presentation, one lazy layer: declaration-order sorting, rich
    // enrichment (received value, suggestions, source frames, docUrl), or the
    // raw v0.14 shape under `richErrors: false`. All of it is work a caller
    // that only reads `.valid` never sees, so it runs on first access to
    // `.errors` and is cached. One wrapper, one allocation per rejection.
    if (this.validate) {
      const inner = this.validate;
      // Loaded on the first error read rather than at compile: a process that
      // only ever accepts never needs it.
      const enrich = this._richErrors ? _enrichLazy : null;
      const root = this._schemaObj;
      const self = this;
      this.validate = (data) => {
        const result = inner(data);
        // abortEarly returns the shared ATA9000 stub; preserve it as-is so the
        // perf fast path stays allocation-free and the documented code stays stable.
        if (result && result.valid === false && result !== ABORT_EARLY_RESULT) {
          // The raw input travels with the rejection when validateJSON set one.
          // The map it implies is built on first access to `.errors`, so a
          // caller reading only `.valid` does not pay for a document walk.
          const rawInput = enrich ? self._lastRawInput : null;
          // One instance of a class with prototype accessors. An object
          // literal with a getter here cost a closure plus an accessor
          // definition on every rejection, several hundred nanoseconds
          // before any error was read.
          return new RichRejection(result, data, rawInput, self, root, enrich);
        }
        return result;
      };

      // validateJSON also enriches: set _lastRawInput so the position cache
      // can lazily build a map for dataFrame attachment. Only validateJSON
      // wires this — validate(data) takes a pre-parsed object, by design.
      if (this._richErrors && this.validateJSON) {
        const innerJson = this.validateJSON;
        this.validateJSON = (jsonStr) => {
          // The inner path reads _lastRawInput to hand the raw text to the
          // rejection it builds. Cleared as soon as it returns: the rejection
          // carries the text itself, so nothing outlives the call.
          this._lastRawInput = jsonStr;
          let result;
          try {
            result = innerJson(jsonStr);
          } finally {
            this._lastRawInput = null;
          }
          // Every diagnostic the text path adds is deferred. Deciding here
          // whether there is anything to add would mean reading `result.errors`,
          // and on the codegen path that realizes the inner lazy layer, which is
          // the document walk this exists to avoid.
          if (result && result.valid === false) {
            return new LazyJsonRejection(result, jsonStr, this, enrich);
          }
          return result;
        };
      }
    }

    // validate() resolves a typed `data` on success: the validated input, after
    // any in-place coercion/defaults. This matches the ValidationResult<T>
    // contract. isValidObject() and abortEarly stay allocation-free for hot
    // paths that only need a boolean.
    if (this.validate) {
      const _bare = this.validate;
      this.validate = fusedRemove
        // A document the removing verdict accepts is answered here, one call
        // deep; anything else takes the full path, see fusedRemove above.
        ? (data) => {
            if (fusedRemove(data)) return { valid: true, data, errors: VALID_RESULT.errors };
            const r = _bare(data);
            return (r.valid === true && r.data === undefined)
              ? { valid: true, data, errors: r.errors }
              : r;
          }
        : (data) => {
            const r = _bare(data);
            return (r.valid === true && r.data === undefined)
              ? { valid: true, data, errors: r.errors }
              : r;
          };
    }

    // Custom error messages: if any subschema declares an `errorMessage`
    // keyword, install an outermost decorator that overrides the `message`
    // field of the errors it owns. Gated on a one-time scan so schemas without
    // errorMessage keep the validate hot path untouched. Layered after rich
    // enrichment so `code`/`keyword`/`path` are already final and only the
    // human-facing message changes.
    {
      const emLib = require('./error-messages');
      const schemaStr = this._schemaStr || (this._schemaObj ? JSON.stringify(this._schemaObj) : '');
      if (emLib.schemaHasErrorMessages(schemaStr)) {
        const root = this._schemaObj;
        const wrap = (inner) => (arg) => {
          const result = inner(arg);
          if (result && result.valid === false && result.errors && result.errors.length && result !== ABORT_EARLY_RESULT) {
            const overridden = emLib.applyErrorMessages(result.errors, root);
            if (overridden !== result.errors) return { valid: false, errors: overridden };
          }
          return result;
        };
        if (this.validate) this.validate = wrap(this.validate);
        if (this.validateJSON) this.validateJSON = wrap(this.validateJSON);
        // validateAndParse routes through self.validate on the codegen path, but
        // the native-only path returns directly from the addon — wrap it so both
        // paths get overrides. The result shape carries `value`, preserved here.
        if (this.validateAndParse) {
          const innerVP = this.validateAndParse;
          this.validateAndParse = (arg) => {
            const result = innerVP(arg);
            if (result && result.valid === false && result.errors && result.errors.length) {
              const overridden = emLib.applyErrorMessages(result.errors, root);
              if (overridden !== result.errors) return { valid: false, value: result.value, errors: overridden };
            }
            return result;
          };
        }
      }
    }

    // Errors are paid for when read, not when produced. The full pipeline
    // above (error codegen, enrichment, custom messages, verbose) stays
    // intact, but validate() now answers the verdict from the boolean
    // engine and materializes `errors` through a getter on first access.
    // A caller that only reads `.valid`, which is every gateway check and
    // every benchmark, skips error construction entirely; a caller that
    // reads `.errors` pays once and the result is cached. Skipped when the
    // schema coerces or defaults (preprocess mutates before the verdict),
    // under abortEarly (already a frozen stub), and for $dynamicRef (the
    // boolean engine is not the authority there).
    // A check registered through _extendValidate joins here when it can: the
    // verdict comes from the generated function with the check compiled in,
    // and the check's own errors are appended when somebody reads them. A
    // rejection then costs what it costs without the check. Where this layer
    // is not installed, the end of this method wraps validate() instead.
    const _vx = this._validateTail !== null ? this._validateTail() : null;
    let _vxApplied = false;
    if (this._fastVerdict && !preprocess && !options.abortEarly && this.validate) {
      const _full = this.validate;
      const _fast = _vx ? _fuseTail(this._fastVerdict, _vx.check) : this._fastVerdict;
      const _extra = _vx ? _vx.errors : null;
      _vxApplied = true;
      const EMPTY_ERRORS = Object.freeze([]);
      const _verdictFallback = [{ keyword: 'validation', instancePath: '', schemaPath: '#', params: {}, message: 'schema validation failed' }];
      const _withExtra = (own, data) => {
        const more = _extra === null ? null : _extra(data);
        if (more && more.length) return own ? own.concat(more) : more;
        // The data changed between the verdict and this read; keep the
        // verdict and say so rather than inventing a specific error.
        return own || _verdictFallback;
      };
      const _buildErrors = (data) => {
        const r = _full(data);
        return _withExtra((r && r.valid === false && r.errors && r.errors.length) ? r.errors : null, data);
      };
      const _buildRawErrors = (data) => {
        const r = _full(data);
        let raw = null;
        if (r && r.valid === false) {
          raw = typeof r._ataRaw === 'function' ? r._ataRaw() : r.errors;
          if (!raw || !raw.length) raw = null;
        }
        return _withExtra(raw, data);
      };
      this.validate = (data) => {
        if (_fast(data)) return { valid: true, data, errors: EMPTY_ERRORS };
        return new LazyRejection(_buildErrors, data, _buildRawErrors);
      };
    }
    if (_vx && !_vxApplied && this.validate) {
      const inner = this.validate;
      const { check, errors } = _vx;
      this.validate = (data) => {
        const r = inner(data);
        if (r.valid && check(data)) return r;
        return new ExtendedRejection(r, data, errors);
      };
    }

    // The buffer APIs answer from the native walker, which disagrees with
    // validate() on shapes listed in lib/buffer-gate.js. For those schemas
    // every buffer entry point goes through validate() instead.
    if (native) {
      const { bufferNeedsSlowPath, installSlowBufferApis } = require('./buffer-gate.js');
      if (bufferNeedsSlowPath(schemaObj, this._schemaMap, this._keywords)) installSlowBufferApis(this);
    }
    // Installed after the buffer gate on purpose: the gate replaces
    // isValidJSON for schemas whose shapes the native walker gets wrong,
    // unevaluatedProperties among them, and the scanner wiring has to wrap
    // whatever answers last or a gated schema silently loses its scanner.
    if (this._jsFn && !this._preprocess) _codegen.installScanner.call(this, schemaObj, options);

    // An extension registered through _extendValidate covers the JSON entry
    // points too. They are final here except for the scanner stubs above,
    // which rebind themselves on first use through _bindEntry, so the
    // extension is applied to whatever each one is now and again on rebind.
    if (_vx) {
      this._entryExt = _jsonEntryWrappers(_vx);
      for (const name of ['validateJSON', 'isValidJSON', 'validateAndParse']) {
        if (Object.prototype.hasOwnProperty.call(this, name) && typeof this[name] === 'function') _bindEntry(this, name, this[name]);
      }
    }


    _rememberInstance(this);
  }

  // Which engine answers validate() for this schema: 'codegen' (generated
  // JS), 'closure' (the closure compiler, the boolean fallback), 'native'
  // (the C++ engine, only for some $dynamicRef schemas), or 'interpreter'.
  // A diagnostic: the answer is the same on every engine, the cost is not.
  engine() {
    this._ensureCompiled();
    return this._engine || 'interpreter';
  }

  _ensureNative() {
    if (this._nativeReady) return;
    this._nativeReady = true;
    if (!native) return;
    let nativeSchemaStr = this._schemaStr;
    // A boolean root references nothing, so the registry has nowhere to go and
    // is left out; merging it used to throw on `true` and `false`.
    if (this._schemaMap.size > 0 && typeof this._schemaObj === 'object' && this._schemaObj !== null) {
      const merged = JSON.parse(this._schemaStr);
      if (!merged.$defs) merged.$defs = {};
      for (const [id, s] of this._schemaMap) {
        merged.$defs['__ext_' + id.replace(/[^a-zA-Z0-9]/g, '_')] = s;
      }
      nativeSchemaStr = JSON.stringify(merged);
    }
    this._compiled = new native.CompiledSchema(nativeSchemaStr);
    // The fast registry is a fixed array of slots in the addon, and registering
    // a distinct schema past the last one throws. It is an accelerator for the
    // buffer path, not a requirement, so a full registry leaves the slot at -1
    // and the buffer methods answer from the JS engine instead. Letting this
    // throw made every validator built after the 4096th unusable on that path.
    try {
      this._fastSlot = native.fastRegister(nativeSchemaStr);
    } catch {
      this._fastSlot = -1;
    }
  }

  // The buffer path without a fast slot: decode, parse, and hand the value to
  // the engine that does not need one. Slower than the zero-copy walk, and the
  // same answer. A negative slot must never reach rawFastValidate, whose bounds
  // check would report a valid document as invalid.
  _slowBufferValid(input, who) {
    let text;
    if (typeof input === 'string') text = input;
    else if (input instanceof Uint8Array) {
      text = Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('utf8');
    } else {
      throw new TypeError(who + '() requires a Buffer, Uint8Array, or string');
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    return this.isValidObject(parsed);
  }

  addSchema(schema) {
    if (this._initialized) {
      throw new Error('Cannot add schema after compilation — call addSchema() before validate()')
    }
    if (!schema || !schema.$id) {
      throw new Error('Schema must have $id')
    }
    // Normalize a copy so the caller's object is never mutated. A document
    // without a dialect of its own is read under the root's draft.
    const root = this._schemaObj
    const rootIsDraft7 = !!(root && typeof root === 'object' && typeof root.$schema === 'string' &&
      (root.$schema === 'http://json-schema.org/draft-07/schema#' || root.$schema === 'http://json-schema.org/draft-07/schema'))
    const normalized = _normalizeCallerSchema(schema, rootIsDraft7)
    this._ownSchemaMap()
    this._schemaMap.set(normalized.$id, normalized)
  }

  // buildSchemaMap hands the same map to every validator built from the same
  // registry. Take a private copy before writing to it.
  _ownSchemaMap() {
    if (!this._schemaMapShared) return
    this._schemaMap = new Map(this._schemaMap)
    this._schemaMapShared = false
  }

  _ensureCodegen() {
    if (this._jsFn) return;
    // A validator that rewrites its input cannot use the binding below: that
    // one answers from the compiled function alone and would skip the rewrite,
    // so isValidObject() and validate() would disagree.
    if (this._needsPreprocess() || this._usesKeywords) {
      this._ensureCompiled();
      return;
    }
    this._ensureVocabularies();
    if (this._interpretOnly || _codegen === null || (typeof process !== 'undefined' && process.env && process.env.ATA_FORCE_NAPI)) return;
    _codegen.compileVerdict.call(this);
  }

  // Load a pre-compiled standalone module. Zero schema compilation.
  // No NAPI, no native compile — pure JS. Startup in microseconds.
  // Usage: const v = Validator.fromStandalone(require('./compiled.js'), schema, opts)
  static fromStandalone(mod, schema, opts) {
    // It loads what Validator.bundleStandalone() writes, and compiles an error
    // function when the module carries none, so it goes with those methods.
    if (_codegen === null) throw new TypeError('Validator.fromStandalone is not part of ata-validator/lite, like the bundle methods it loads for. Import it from ata-validator, or import a module from `ata build` directly.');
    const options = opts || {};
    const schemaObj = typeof schema === "string" ? JSON.parse(schema) : schema;

    // Create a lightweight instance — skip NAPI compile entirely
    const v = Object.create(Validator.prototype);
    v._jsFn = mod.boolFn;
    v._compiled = null;
    v._fastSlot = -1;

    // Mutators
    const applyDefaults = buildDefaultsApplier(schemaObj);
    const applyCoerce = options.coerceTypes ? buildCoercer(schemaObj) : null;
    const applyRemove = options.removeAdditional
      ? buildRemover(schemaObj)
      : null;
    const mutators = [applyRemove, applyCoerce, applyDefaults].filter(Boolean);
    const preprocess =
      mutators.length === 0
        ? null
        : mutators.length === 1
          ? mutators[0]
          : (data) => {
              for (let i = 0; i < mutators.length; i++) mutators[i](data);
            };
    v._preprocess = preprocess;

    // Error function — use pre-compiled from standalone if available, else compile
    let errFn = (d) => ({
      valid: false,
      errors: [
        { code: "validation_failed", path: "", message: "validation failed" },
      ],
    });
    if (mod.errFn) {
      errFn = (d) => mod.errFn(d, true);
    } else {
      const jsErrFn = compileToJSCodegenWithErrors(schemaObj);
      if (jsErrFn) {
        try {
          jsErrFn({}, true);
          errFn = (d) => jsErrFn(d, true);
        } catch {}
      }
    }

    // Hybrid or speculative
    const hybridFn = mod.hybridFactory
      ? mod.hybridFactory(VALID_RESULT, errFn)
      : null;

    v.validate = hybridFn
      ? preprocess
        ? (data) => {
            preprocess(data);
            return hybridFn(data);
          }
        : hybridFn
      : preprocess
        ? (data) => {
            preprocess(data);
            return mod.boolFn(data) ? VALID_RESULT : errFn(data);
          }
        : (data) => (mod.boolFn(data) ? VALID_RESULT : errFn(data));
    {
      const _bare = v.validate;
      v.validate = (data) => {
        const r = _bare(data);
        return (r.valid === true && r.data === undefined)
          ? { valid: true, data, errors: r.errors }
          : r;
      };
    }
    v.isValidObject = mod.boolFn;
    v.isValidJSON = (jsonStr) => {
      try {
        return mod.boolFn(JSON.parse(jsonStr));
      } catch {
        return false;
      }
    };
    v.validateJSON = (jsonStr) => {
      try {
        const obj = JSON.parse(jsonStr);
        return hybridFn
          ? hybridFn(obj)
          : mod.boolFn(obj)
            ? VALID_RESULT
            : errFn(obj);
      } catch {
        return {
          valid: false,
          errors: [{ code: "invalid_json", path: "", message: "invalid JSON" }],
        };
      }
    };

    v.validateAndParse = native
      ? (jsonStr) => {
          v._ensureNative();
          v.validateAndParse = (s) => v._compiled.validateAndParse(s);
          return v.validateAndParse(jsonStr);
        }
      : () => { throw new Error('Native addon required for validateAndParse()'); };

    // Standard Schema V1
    Object.defineProperty(v, "~standard", {
      value: Object.freeze({
        version: 1,
        vendor: "ata-validator",
        validate(value) {
          const result = v.validate(value);
          if (result.valid) return { value };
          return {
            issues: result.errors.map((e) => ({
              message: e.message,
              path: parsePointerPath(e.instancePath),
            })),
          };
        },
      }),
      writable: false,
      enumerable: false,
      configurable: false,
    });

    return v;
  }

  // Raw NAPI fast path for Buffer/Uint8Array
  isValid(input) {
    if (!native) throw new Error('Native addon required for isValid() — install build tools or use validate() instead');
    if (typeof input === 'string') input = Buffer.from(input);
    else if (!(input instanceof Uint8Array)) throw new TypeError('isValid() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().');
    this._ensureNative();
    return native.rawFastValidate(this._fastSlot, input);
  }

  // Zero-copy pre-padded path
  isValidPrepadded(paddedBuffer, jsonLength) {
    if (!native) throw new Error('Native addon required for isValidPrepadded()');
    this._ensureNative();
    return native.rawFastValidate(this._fastSlot, paddedBuffer, jsonLength);
  }

  // Parallel NDJSON batch (multi-core)
  isValidParallel(buffer) {
    if (!native) throw new Error('Native addon required for isValidParallel()');
    this._ensureNative();
    return native.rawParallelValidate(this._fastSlot, buffer);
  }

  // Parallel count (fastest -- single uint32 return)
  countValid(buffer) {
    if (!native) throw new Error('Native addon required for countValid()');
    this._ensureNative();
    return native.rawParallelCount(this._fastSlot, buffer);
  }

  // NDJSON single-thread batch
  isValidNDJSON(buffer) {
    if (!native) throw new Error('Native addon required for isValidNDJSON()');
    this._ensureNative();
    return native.rawNDJSONValidate(this._fastSlot, buffer);
  }
}

// One-shot validate. It goes through a Validator like every other entry
// point, so the result has one shape everywhere: `data` on success, errors
// with a code, a keyword and an instancePath. From the first native binding
// until 1.33.3 it handed the schema straight to the native engine whenever
// the addon was loaded, which is every default install on a supported
// platform, and returned that engine's raw result: numeric codes, `path`
// instead of `instancePath`, no keyword, and no `data`. The compile cache keeps
// a schema passed again from compiling again.
function validate(schema, data) {
  if (schema instanceof Validator) return schema.validate(data);
  const v = new Validator(typeof schema === "string" ? JSON.parse(schema) : schema);
  return v.validate(data);
}

// Async validation for schemas built with `t.refine(...)`. Structural
// validation runs synchronously first; refinements are awaited only when the
// value is structurally valid (a refinement body may assume the right shape).
// Accepts a schema literal or an existing Validator instance plus its schema.
// Returns a Promise<ValidationResult>.
async function validateAsync(schemaOrValidator, data) {
  const refineLib = require('./refine');
  let validator, schema;
  if (schemaOrValidator instanceof Validator) {
    validator = schemaOrValidator;
    schema = validator._schemaObj;
  } else {
    schema = schemaOrValidator;
    validator = new Validator(schema);
  }
  const structural = validator.validate(data);
  if (!structural.valid) return structural;
  const refinements = refineLib.getRefinements(schema);
  if (!refinements) return structural;
  const issues = await refineLib.runRefinements(refinements, structural.data !== undefined ? structural.data : data);
  if (issues.length) return { valid: false, errors: issues };
  return structural;
}

// parseAsync resolves to the validated data, or rejects with an Error whose
// `.errors` carries the ValidationError list. Mirrors the parse/validate split
// used by Zod-style callers.
async function parseAsync(schemaOrValidator, data) {
  const result = await validateAsync(schemaOrValidator, data);
  if (result.valid) return result.data !== undefined ? result.data : data;
  const err = new Error('ata: async validation failed');
  err.errors = result.errors;
  throw err;
}

function version() {
  if (native) return native.version();
  try { return require("./version"); } catch { return "unknown"; }
}

// Static AOT entry points are thin lazy-loaders into `lib/aot.js`. The
// implementation files (and the `fs`/`path` reads they perform) only enter
// the process when one of these is actually called. See `lib/aot.js` for the
// generated module shapes; browser bundles get `lib/aot.browser.js` (a stub
// that throws) via the package.json `browser` field.
function _aot() {
  if (_codegen === null) throw new TypeError('The ahead-of-time bundle methods are not part of ata-validator/lite. Import them from ata-validator.');
  return _codegen.aot();
}
Validator.bundle = function (schemas, opts) {
  return _aot().bundle(Validator, schemas, opts);
};

Validator.bundleStandalone = function (schemas, opts) {
  return _aot().bundleStandalone(Validator, schemas, opts);
};

Validator.bundleCompact = function (schemas, opts) {
  return _aot().bundleCompact(Validator, schemas, opts);
};

Validator.loadBundle = function (mods, schemas, opts) {
  return _aot().loadBundle(Validator, mods, schemas, opts);
};

const parseJSON = native ? native.parseJSON : JSON.parse;

// Ultra-fast compile: returns validate function directly, no Validator wrapper
// WeakMap cached — second call with same schema object is ~3ns
const _compileFnCache = new WeakMap();
function compile(schema, opts) {
  if (!opts && typeof schema === 'object' && schema !== null) {
    const hit = _compileFnCache.get(schema);
    if (hit) return hit;
  }
  const v = new Validator(schema, opts);
  v._ensureCompiled();
  const fn = v.validate;
  if (!opts && typeof schema === 'object' && schema !== null) {
    _compileFnCache.set(schema, fn);
  }
  return fn;
}

// The renderers, TypeScript generation, the output formats, the retry message
// and the suggestion helper are exported by index.js. None of them is called
// by a Validator, so ata-validator/lite leaves them out.

// Post-hoc suggestion enrichment for AOT-compiled validators. The standalone
// modules do not embed the suggestion engine (Levenshtein + format hints would
// inflate the gzipped bundle beyond the size budget). Consumers who want
// suggestions pass the error array through this helper after validation.
// AOT errors don't carry `received`, so we re-derive it from `data` here.
const { setDiagnosticSource } = require('./diagnostic-source');
const attachDiagnosticSource = setDiagnosticSource;

// Resolved once. A require() inside the function was re-resolving the path
// on every rejection, which the profile showed as internalModuleStat at the
// top of the reject path, above the correlation it was loading.
let _correlateTypos = null;
function attachRelated (errors) {
  if (_correlateTypos === null) _correlateTypos = require('./correlate').correlateTypos;
  const pairs = _correlateTypos(errors);
  if (pairs === null) return errors;
  for (const [from, to] of pairs) {
    const e = errors[from];
    if (!e) continue;
    if (e.related) { if (!e.related.includes(to)) e.related.push(to); }
    else e.related = [to];
  }
  return errors;
}

// Authoring helper: identity at runtime. Its only job is to attach the
// JSONSchema type (see index.d.ts) to an inline schema object so TypeScript
// gives autocomplete and value checking while authoring. Returns the schema
// untouched so it can be passed straight to Validator, toStandaloneModule, etc.
function defineSchema (schema) {
  return schema;
}

// Public methods start as memoized accessors on the prototype. A fresh
// Validator allocates none of them; the first read of a method builds the
// bound closure, stores it on the instance as an ordinary writable property
// and returns it. The setter keeps the compile step's plain assignments
// (`this.validate = fn`) working before the getter has ever run. Detached
// use (`const f = v.validate`) keeps working because the closure binds the
// instance.
// Standard Schema V1. Built on first read, then pinned to the instance with
// the same descriptor the constructor used to install eagerly.
Object.defineProperty(Validator.prototype, "~standard", {
  configurable: true,
  get() {
    const self = this;
    const std = Object.freeze({
      version: 1,
      vendor: "ata-validator",
      validate(value) {
        const result = self.validate(value);
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
            message = require('./enrich-error').enrich(err, {}).message;
          }
          issues[i] = { message, path: parsePointerPath(path) };
        }
        return { issues };
      },
    });
    Object.defineProperty(this, "~standard", {
      value: std,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    return std;
  },
});

// The error resolvers run only after a verdict function has said no. If one
// answers valid anyway, two generators disagree, and the verdict is the one
// to keep: returning the resolver's answer is how a vacuous combined function
// turned a rejection into an acceptance in validateJSON. The disagreement is
// reported as a generic failure rather than hidden.
const _VERDICT_DISAGREES = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: Object.freeze({}), message: 'schema validation failed' })]),
});
function _mustReject(r) {
  return r && r.valid === false ? r : _VERDICT_DISAGREES;
}

// Install the verdict method. Every place that binds isValidObject comes
// through here, so a check registered with _extendVerdict survives the method
// being replaced as the validator compiles further, which it does more than
// once over its life.
function _bindVerdict(self, fn) {
  const resolve = self._verdictTail;
  if (resolve !== null && typeof fn === 'function') {
    const tail = resolve();
    if (typeof tail === 'function') fn = _fuseTail(fn, tail);
  }
  self.isValidObject = fn;
}

// Bind one of the JSON entry points, through the extension wrapper when there is one.
function _bindEntry(self, name, fn) {
  const ext = self._entryExt;
  self[name] = ext !== null && ext[name] ? ext[name](fn) : fn;
}

// The JSON entry points under an extension: the schema answers first, and only
// text it accepts is parsed for the check, so a rejection costs nothing extra.
function _jsonEntryWrappers({ check, errors }) {
  const parse = (text) => JSON.parse(typeof text === 'string' ? text : new TextDecoder().decode(text));
  return {
    validateJSON: (inner) => (text) => {
      const res = inner(text);
      if (!res.valid) return res;
      let data;
      try { data = parse(text); } catch { return res; }
      if (check(data)) return res;
      const e = errors(data);
      return e && e.length ? { valid: false, errors: e } : { valid: false, errors: [_EXT_FALLBACK] };
    },
    isValidJSON: (inner) => (text) => {
      if (!inner(text)) return false;
      let data;
      try { data = parse(text); } catch { return true; }
      return check(data);
    },
    validateAndParse: (inner) => (text) => {
      const res = inner(text);
      if (!res.valid) return res;
      if (check(res.value)) return res;
      const e = errors(res.value);
      return { valid: false, value: res.value, errors: e && e.length ? e : [_EXT_FALLBACK] };
    },
  };
}
const _EXT_FALLBACK = Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: {}, message: 'schema validation failed' });

// A verdict function that also runs `tail` on what it accepts. The generated
// function can take the check in place of its final `return true`, one call
// per document; anything else is composed.
function _fuseTail(fn, tail) {
  const fused = typeof fn._withTail === 'function' ? fn._withTail(tail) : null;
  return fused || ((d) => fn(d) && tail(d));
}

// The rejection validate() returns on the paths where an extension check could
// not join the lazy layer: the inner result, plus the check's errors appended
// on first read. `inner` may itself be valid, when only the check failed.
class ExtendedRejection {
  constructor(inner, data, collect) {
    this.valid = false;
    this._inner = inner;
    this._data = data;
    this._collect = collect;
    this._errors = null;
  }
  toJSON() {
    return { valid: false, errors: this.errors };
  }
  _ataRaw() {
    const inner = this._inner;
    const more = this._collect(this._data) || [];
    const raw = inner.valid ? more : (typeof inner._ataRaw === 'function' ? inner._ataRaw() : inner.errors).concat(more);
    return raw.length ? raw : [_EXT_FALLBACK];
  }
}
Object.defineProperty(ExtendedRejection.prototype, 'errors', {
  enumerable: true,
  configurable: true,
  get() {
    if (this._errors === null) {
      const inner = this._inner;
      const more = this._collect(this._data) || [];
      const all = inner.valid ? more : inner.errors.concat(more);
      this._errors = all.length ? all : [_EXT_FALLBACK];
    }
    return this._errors;
  },
});

// For wrappers that enforce a check the schema does not carry, such as the
// `instanceof` keyword of @ata-project/keywords. `resolve` is called whenever
// the verdict method is bound, which is after the schema has been normalized,
// and returns the check, a function of the document that answers true or
// false, or null when there is nothing to add. Only isValidObject takes it;
// the other entry points, which report errors, stay the wrapper's to handle.
//
// Before this, such a wrapper had to hold isValidObject behind an accessor so
// that the validator's own rebinding could not drop its check, and every call
// paid for the accessor and two more calls: 10.1 ns against 4.2 on a document
// the schema rejects at its third property.
Validator.prototype._verdictTail = null;
Validator.prototype._validateTail = null;
Validator.prototype._entryExt = null;

// Let `new Validator(schema)` with the same schema object return this instance.
// Only an instance built without options may answer that call: one built with
// options (richErrors: false, coerceTypes, formats, ...) would hand its options
// to a caller that asked for none, and an extended one would enforce checks the
// caller never registered. Both the caller's object and the normalized one are
// keys, since a later caller passes the former.
function _rememberInstance(self) {
  if (!self._noOpts || self._verdictTail !== null || self._validateTail !== null) return;
  const raw = self._rawSchema;
  if (raw && typeof raw === 'object' && !_identityCache.has(raw)) _identityCache.set(raw, self);
  const obj = self._schemaObj;
  if (obj !== raw && obj && typeof obj === 'object' && !_identityCache.has(obj)) _identityCache.set(obj, self);
}

// An extended validator answers differently from a plain one for the same
// schema, so it must not be the instance `new Validator(sameSchema)` hands out.
function _leaveIdentityCache(self) {
  self._noOpts = false;
  // Nothing is registered before the first compile, so there is nothing to
  // take back.
  if (!self._initialized && self._jsFn === null) return;
  const raw = self._rawSchema;
  if (raw && typeof raw === 'object' && _identityCache.get(raw) === self) _identityCache.delete(raw);
  // The compiled form is cached too, at the end of the first compile. Read it
  // only if it is already materialized: reading it otherwise builds it.
  if (Object.prototype.hasOwnProperty.call(self, '_schemaObj')) {
    const obj = self._schemaObj;
    if (obj && typeof obj === 'object' && _identityCache.get(obj) === self) _identityCache.delete(obj);
  }
}

// The same kind of extension for validate(): `resolve` returns { check, errors }
// or null, where `errors(data)` lists the check's own errors, or returns null
// when there are none. The check's errors come after the schema's, and a value
// that fails only the check is rejected with the check's errors alone. Must be
// called before validate() is first used, which is when it is compiled; later
// calls throw rather than being silently ignored.
Validator.prototype._extendValidate = function (resolve) {
  if (typeof resolve !== 'function') throw new TypeError('_extendValidate expects a function');
  if (this._initialized) throw new Error('_extendValidate must be called before the validator compiles');
  _leaveIdentityCache(this);
  const prev = this._validateTail;
  this._validateTail = prev === null ? resolve : () => {
    const a = prev(), b = resolve();
    if (!a) return b;
    if (!b) return a;
    return {
      check: (d) => a.check(d) && b.check(d),
      errors: (d) => {
        const x = a.errors(d), y = b.errors(d);
        if (!x) return y;
        if (!y) return x;
        return x.concat(y);
      },
    };
  };
  return this;
};

// Both extensions in one call, from one resolver that returns { check, errors }
// or null. This is the form @ata-project/keywords uses: registering costs one
// closure, where wrapping the five entry points cost a closure per entry point,
// the wrappers themselves and an accessor, most of what building a wrapped
// validator took.
// parse(data): validate, then return a copy holding only what the schema
// declares, the way the parse() export of an ahead-of-time module does, with
// the same emitter behind both. Building the copy from the schema's own key
// list costs less than finding and deleting unknown keys, and leaves the
// caller's object alone. Where the key set cannot be proven (a $ref it cannot
// inline, patternProperties, an open object) the method declines with an
// error instead of guessing, as the module ships no parse() there; so it does
// under options that rewrite input, whose answers a copy would not reproduce.
Validator.prototype.parse = function (data) {
  let fn = this._parseFn;
  if (fn === undefined) {
    fn = _buildParse(this);
    Object.defineProperty(this, '_parseFn', { value: fn, writable: true, configurable: true, enumerable: false });
  }
  return fn(data);
};

function _buildParse(self) {
  const decline = (why, instead = 'Use validate() with removeAdditional instead.') => () => {
    throw new TypeError(`parse() is not available for this validator: ${why}. ${instead}`);
  };
  const o = self._options;
  // Each refusal names its own reason: a caller who hit the combined one could
  // not tell a coercion option from a keyword package, and read a deliberate
  // refusal as a failure of valid data.
  if (o.coerceTypes) return decline('coerceTypes rewrites the input before it is checked');
  if (o.removeAdditional === 'all') return decline("removeAdditional: 'all' decides the kept keys at check time");
  if (self._usesKeywords) return decline('custom keywords are in use, and what they accept is not known to the copy');
  // Checks added to the validator (withKeywords from @ata-project/keywords
  // adds instanceof and typeof) only narrow what passes; they do not change
  // which keys the schema declares. The verdict then goes through
  // isValidObject, which runs them, and a property they check with instanceof
  // is carried over as it is (see clone-emit).
  const extended = self._verdictTail !== null || self._validateTail !== null;
  if (_codegen === null) return decline('ata-validator/lite has no code generator to build the copy with', 'Use parse() from ata-validator, or validate(); a valid result carries the input as it is.');
  return _codegen.buildParse(self, decline, extended);
}

Validator.prototype._extendChecks = function (resolve) {
  if (typeof resolve !== 'function') throw new TypeError('_extendChecks expects a function');
  this._extendValidate(resolve);
  return this._extendVerdict(() => {
    const x = resolve();
    return x ? x.check : null;
  });
};

// Whether this instance enforces a check its schema does not carry. The
// ahead-of-time emitters build a module from the schema alone, so they refuse
// an instance that says yes rather than emit one that accepts too much.
// Reading it resolves the registered checks; only an emitter reads it.
Object.defineProperty(Validator.prototype, '_externalChecks', {
  configurable: true,
  get() {
    if (this._validateTail !== null && this._validateTail()) return true;
    if (this._verdictTail !== null && typeof this._verdictTail() === 'function') return true;
    return false;
  },
});

Validator.prototype._extendVerdict = function (resolve) {
  if (typeof resolve !== 'function') throw new TypeError('_extendVerdict expects a function');
  _leaveIdentityCache(this);
  const prev = this._verdictTail;
  this._verdictTail = prev === null ? resolve : () => {
    const a = prev(), b = resolve();
    if (typeof a !== 'function') return b;
    if (typeof b !== 'function') return a;
    return (d) => a(d) && b(d);
  };
  // A method bound before this call was bound without the check. Rebind it.
  // An unbound one binds through _bindVerdict on its first call.
  if (Object.prototype.hasOwnProperty.call(this, 'isValidObject')) _bindVerdict(this, this.isValidObject);
  return this;
};

function _defineLazyMethod(name, maker) {
  Object.defineProperty(Validator.prototype, name, {
    configurable: true,
    get() {
      const fn = maker(this);
      Object.defineProperty(this, name, { value: fn, writable: true, configurable: true, enumerable: true });
      return fn;
    },
    set(fn) {
      Object.defineProperty(this, name, { value: fn, writable: true, configurable: true, enumerable: true });
    },
  });
}

for (const [name, pick] of [
  ['_schemaObj', (self) => _materializeSchema(self)],
  ['_usesKeywords', (self) => { _materializeSchema(self); return self._usesKeywords; }],
  ['_schemaIsCallers', (self) => { _materializeSchema(self); return self._schemaIsCallers; }],
]) {
  Object.defineProperty(Validator.prototype, name, {
    configurable: true,
    get() { return pick(this); },
    set(v) { Object.defineProperty(this, name, { value: v, writable: true, configurable: true, enumerable: true }); },
  });
}

_defineLazyMethod('validate', (self) => (data) => {
  self._ensureCompiled();
  return self.validate(data);
});
_defineLazyMethod('isValidObject', (self) => (data) => {
  // A validator that rewrites its input goes through the full compile, which
  // binds a verdict method that runs the rewrite first. So does one whose
  // schema uses a custom keyword: neither the tier-0 plan nor the code
  // generator knows the keyword, and either would accept what validate()
  // rejects.
  if (self._needsPreprocess() || self._usesKeywords) {
    self._ensureCompiled();
    return self.isValidObject(data);
  }
  // Lazy: classify + build tier 0 plan on first call, not in constructor.
  const _tier = classify(self._schemaObj);
  if (_tier.tier === 0) {
    const _plan = buildTier0Plan(self._schemaObj);
    let _n = 0;
    _bindVerdict(self, (d) => {
      const r = tier0Validate(_plan, d);
      if (++_n === 2) {
        try { self._ensureCodegen(); } catch {}
      }
      return r;
    });
  } else {
    // `new Function` is a property of the realm, not of the schema: under a
    // strict CSP or `--disallow-code-generation-from-strings` this throws
    // rather than declining, and the EvalError reached the caller of a verdict
    // method. The full compile can answer without code generation, so fall
    // through to it. The tier-0 branch above already guarded its own call.
    try { self._ensureCodegen(); } catch { /* no codegen in this realm */ }
    // Codegen can bail on shapes it cannot represent; the full compile
    // binds the native path or the unsupported thrower instead of
    // leaving this stub to re-dispatch to itself.
    if (!self._jsFn) self._ensureCompiled();
  }
  return self.isValidObject(data);
});
_defineLazyMethod('validateJSON', (self) => (jsonStr) => {
  self._ensureCompiled();
  return self.validateJSON(jsonStr);
});
_defineLazyMethod('isValidJSON', (self) => (jsonStr) => {
  self._ensureCompiled();
  return self.isValidJSON(jsonStr);
});
_defineLazyMethod('validateAndParse', (self) => (jsonStr) => {
  if (!native) throw new Error('Native addon required for validateAndParse()');
  self._ensureCompiled();
  return self.validateAndParse(jsonStr);
});
_defineLazyMethod('isValid', (self) => (buf) => {
  if (!native) throw new Error('Native addon required for isValid() — use validate() or isValidObject() instead');
  self._ensureCompiled();
  return self.isValid(buf);
});
_defineLazyMethod('countValid', (self) => (ndjsonBuf) => {
  if (!native) throw new Error('Native addon required for countValid()');
  self._ensureCompiled();
  return self.countValid(ndjsonBuf);
});
_defineLazyMethod('batchIsValid', (self) => (buffers) => {
  if (!native) throw new Error('Native addon required for batchIsValid()');
  self._ensureCompiled();
  return self.batchIsValid(buffers);
});

module.exports = {
  Validator,
  compile,
  validate,
  validateAsync,
  parseAsync,
  version,
  createPaddedBuffer,
  SIMDJSON_PADDING,
  parseJSON,
  defineSchema,
};
// How an entry registers the code generator. Not enumerable, so the exported
// surface of `require('ata-validator')` is what it was.
Object.defineProperty(module.exports, '_registerCodegen', { value: _registerCodegen, enumerable: false });
// What the compiled paths in index.js need from this module.
Object.defineProperty(module.exports, '_internals', { value: { _jsonSyntaxRejection, ABORT_EARLY_RESULT, HYBRID_TIER_CALLS, SIMDJSON_THRESHOLD, VALID_RESULT, _bindEntry, _bindVerdict, _compileCache, _mustReject, _rememberInstance, compileCacheKey, isV1Dialect, native, resolveSchemaByPath }, enumerable: false });
