'use strict';

// The rejection objects validate() and validateJSON() return, and the helpers
// that build their errors on first read: declaration-order sorting,
// enrichment, typo correlation and source frames. Shared by the validator core
// and by the wrapper around a compiled module, so both report errors through
// the same code.

const { ordinalFor: schemaOrdinal } = require('./schema-order');
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

module.exports = { LazyRejection, RichRejection, LazyJsonRejection, _enrichLazy, attachRelated, sortErrorsBySchemaOrder, stripOrdinal, wantedPointersFor };
