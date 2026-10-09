'use strict';

// The rejection objects validate() and validateJSON() return, and the helpers
// that build their errors on first read: declaration-order sorting,
// enrichment, typo correlation and source frames. Shared by the validator core
// and by the wrapper around a compiled module, so both report errors through
// the same code.

const { ordinalFor: schemaOrdinal, rankFor: schemaRank } = require('./schema-order');
const { setDiagnosticSource: attachDiagnosticSource } = require('./diagnostic-source');

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
    if (needsOrdering(raw)) raw = sortErrorsBySchemaOrder(this._root, raw);
    return raw;
  }
}
// Orders a raw error list and gives it the shape the caller asked for: the
// legacy key set, or enriched. Shared by both rejection classes below.
function presentErrors(raw, data, rawInput, self, root, enrich) {
  if (needsOrdering(raw)) raw = sortErrorsBySchemaOrder(root, raw);
  // The position map, resolved on the first read of an error's frame (see
  // defineLazyFrames in lib/enrich-error.js): a walk of the document that a
  // caller reading messages and paths never needs.
  const lazyPositions = enrich && raw.length && rawInput != null ? lazyPositionsFor(self, rawInput, raw) : null;
  // One options object for the whole list, not one per error.
  const opts = enrich && raw.length
    ? {
        data,
        positions: null,
        lazyPositions,
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
  return cached;
}

Object.defineProperty(RichRejection.prototype, 'errors', {
  enumerable: true,
  configurable: true,
  get() {
    if (this._cached === null) {
      this._cached = presentErrors(this._result.errors || [], this._data, this._rawInput, this._self, this._root, this._enrich);
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
  // `parsed`, when given, is the document the inner path parsed from
  // `jsonStr` and validated, after defaults, coercion and removal: reading the
  // errors uses it instead of parsing the text again, which on a 5 MB
  // document was a third of what reading them cost.
  constructor(result, jsonStr, self, enrich, parsed) {
    this.valid = false;
    this._result = result;
    this._jsonStr = jsonStr;
    this._self = self;
    this._enrich = enrich;
    this._cached = null;
    this._parsed = parsed;
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
    let parsedData = this._parsed;
    if (parsedData === undefined) {
      try { parsedData = JSON.parse(jsonStr); } catch { parsedData = undefined; }
      // What was checked is the document after defaults, coercion and removal,
      // so `received` has to come from that, as it does for validate(). A
      // default that failed its own schema has no value in the text at all.
      if (parsedData !== undefined && self._preprocess) self._preprocess(parsedData);
    }

    // Errors the inner path already enriched carry a `received` key: enrich()
    // always sets one, even when there is no value to show. `code` is not a
    // safe signal, because branch-collapse attaches codes to raw errors, and
    // `docUrl` is not either, because the generated error functions stamp it
    // on raw errors; taking it as the signal left those errors without
    // `received` or a suggestion on the text path while validate() had both.
    if (!raw[0] || !('received' in raw[0])) {
      // Declaration order, as validate() applies it; the text path used to
      // enrich in emission order.
      const ordered = needsOrdering(raw) ? sortErrorsBySchemaOrder(self._schemaObj, raw) : raw;
      // The position map waits for the first read of a frame (lib/enrich-error
      // defineLazyFrames); until then reading the list costs the enrichment alone.
      const lazyPositions = lazyPositionsFor(self, jsonStr, ordered);
      const enrichOpts = {
        data: parsedData,
        positions: null,
        lazyPositions,
        schemaPositions: self._schemaPositions,
        schemaFile: self._source ? self._source.path : undefined,
      };
      const enriched = ordered.map((e) => enrich(e, enrichOpts));
      if (enriched.length > 1) attachRelated(enriched);
      attachDiagnosticSource(enriched, {
        data: parsedData,
        text: jsonStr,
        // Read by the diagnostic renderer only, which resolves the same map.
        get positions () { return lazyPositions(); },
        schema: self._schemaObj,
        mutatesInput: self._mutatesInput === true,
      });
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

// The targeted position map for a list, built on the first call and shared
// by every error's frame accessor (lib/enrich-error defineLazyFrames).
function lazyPositionsFor (self, text, errors) {
  let done = false;
  let positions = null;
  return () => {
    if (done) return positions;
    done = true;
    positions = self._pos().targeted(text, wantedPointersFor(errors));
    if (positions) self._posCache.reset();
    return positions;
  };
}

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

// A raw error in the legacy shape. The error generator writes `code` and
// `docUrl` into its literals because a standalone module returns them as they
// are; the runtime's legacy shape never had them, and the interpreter leaves
// them out, so they are dropped here with the ordering key `_o`. A collapsed
// oneOf/anyOf error keeps its code, which both engines give it, and its
// branch errors get the same treatment, so the shape does not depend on
// which engine answered.
const COLLAPSE_CODES = new Set(['ATA4001', 'ATA4002', 'ATA4003']);
function stripOrdinal(e) {
  if (e === null || typeof e !== 'object') return e;
  // Generated code keeps errors at a fixed path as frozen literals shared by
  // every call, marked with a non-enumerable `_s` (see sharedErr in
  // lib/js-compiler.js). The caller gets its own copy, as it always has, so an
  // error it edits (a translated message) is its own and editing it does not
  // throw. Those literals hold the five keys of this shape and nothing else
  // enumerable, so a literal of the same shape copies them: spreading one cost
  // twice as much, and Object.isFrozen, which used to pick them out, more than
  // the copy itself.
  if (e._s === true && e.code === undefined && e.docUrl === undefined && e.branchErrors === undefined) {
    return { keyword: e.keyword, instancePath: e.instancePath, schemaPath: e.schemaPath, params: e.params, message: e.message };
  }
  // A collapsed oneOf/anyOf error has one of the two shapes __ataCollapse in
  // lib/branch-collapse.js builds, the only place these codes come from. Its
  // fields are copied by name, in that order, without the ordinal: walking
  // its keys with for-in was most of the cost of reading such an error.
  if (e.path !== undefined && e.docUrl === undefined && COLLAPSE_CODES.has(e.code)) {
    const out = { code: e.code, keyword: e.keyword, instancePath: e.instancePath, path: e.path, schemaPath: e.schemaPath, message: e.message, params: e.params };
    if ('branchErrors' in e) out.branchErrors = Array.isArray(e.branchErrors) ? e.branchErrors.map(stripOrdinal) : e.branchErrors;
    return out;
  }
  if (e._o === undefined && e.docUrl === undefined && (e.code === undefined || COLLAPSE_CODES.has(e.code)) && !e.branchErrors) return e._s === true ? { ...e } : e;
  const out = {};
  for (const k in e) {
    if (k === '_o' || k === 'docUrl') continue;
    if (k === 'code' && !COLLAPSE_CODES.has(e.code)) continue;
    out[k] = k === 'branchErrors' && Array.isArray(e[k]) ? e[k].map(stripOrdinal) : e[k];
  }
  return out;
}

// Errors in schema declaration order. Each error's key is its schemaPath's
// pre-order ordinal in the root schema: written into the literal by the code
// generator (`_o`), looked up once per path otherwise. Errors behind the same
// `$ref` share the ordinal of that `$ref`, and among themselves go by their
// place in the target (rankFor), so they come out in the order they would
// inline, whichever engine produced them. Most rejections come out already
// ordered, and those return without sorting or allocating.
// A list of one can still hold a collapsed error whose branch errors, at any
// depth, need ordering.
function needsOrdering(raw) {
  if (raw.length > 1) return true;
  const e = raw[0];
  return raw.length === 1 && e !== null && typeof e === 'object' && Array.isArray(e.branchErrors) && needsOrdering(e.branchErrors);
}

// A collapsed oneOf/anyOf error carries the closest branch's errors, which
// each engine produces in its own walk order. They go in schema order like the
// list they sit in, so which engine answered cannot be read off them.
function sortBranchErrors(rootSchema, errors) {
  let out = null;
  for (let i = 0; i < errors.length; i++) {
    const e = errors[i];
    const b = e !== null && typeof e === 'object' ? e.branchErrors : undefined;
    if (!Array.isArray(b) || b.length === 0) continue;
    const sb = sortErrorsBySchemaOrder(rootSchema, b);
    if (sb === b) continue;
    if (out === null) out = errors.slice();
    out[i] = Object.assign({}, e, { branchErrors: sb });
  }
  return out === null ? errors : out;
}

function sortErrorsBySchemaOrder(rootSchema, errors) {
  errors = sortBranchErrors(rootSchema, errors);
  const n = errors.length;
  const keys = new Array(n);
  let sorted = true;
  let prev = -1;
  let prevPath = null;
  for (let i = 0; i < n; i++) {
    const e = errors[i];
    let o = typeof e._o === 'number' ? e._o : schemaOrdinal(rootSchema, e.schemaPath);
    // An error with no place in this document (an appended custom-keyword
    // error, a path into another schema) stays next to the error before it,
    // which is where the rank comparison left it too.
    if (o === null) o = prev < 0 ? 0 : prev;
    keys[i] = o;
    if (o < prev || (o === prev && sorted && e.schemaPath !== prevPath && tieOrder(rootSchema, prevPath, e.schemaPath) > 0)) sorted = false;
    prev = o;
    prevPath = e.schemaPath;
  }
  if (sorted) return errors;
  // Error lists are short. A stable insertion sort over the integer keys
  // moves the errors in tandem with no index array; equal keys fall back to
  // the rank only when the paths differ.
  const out = errors.slice();
  for (let i = 1; i < n; i++) {
    const k = keys[i];
    const e = out[i];
    let j = i - 1;
    while (j >= 0 && (keys[j] > k || (keys[j] === k && tieOrder(rootSchema, out[j].schemaPath, e.schemaPath) > 0))) {
      keys[j + 1] = keys[j]; out[j + 1] = out[j]; j--;
    }
    keys[j + 1] = k;
    out[j + 1] = e;
  }
  return out;
}

// Order of two paths with the same ordinal: positive when `a` belongs after
// `b`. Zero keeps them as they are, for identical paths and for paths
// outside this document.
function tieOrder(rootSchema, a, b) {
  if (a === b) return 0;
  const ra = schemaRank(rootSchema, a), rb = schemaRank(rootSchema, b);
  if (ra === null || rb === null) return 0;
  const m = Math.min(ra.length, rb.length);
  for (let k = 0; k < m; k++) if (ra[k] !== rb[k]) return ra[k] - rb[k];
  return ra.length - rb.length;
}

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

module.exports = { LazyRejection, RichRejection, presentErrors, needsOrdering, LazyJsonRejection, _enrichLazy, attachRelated, sortErrorsBySchemaOrder, stripOrdinal, wantedPointersFor };
