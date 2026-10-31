'use strict';

// The rejection validateJSON() returns, and the position map behind an error's
// frame in the JSON text. Apart from lib/rejections.js so that code with no
// JSON entry point (validate() through a compiled wrapper) does not bundle it.

const { needsOrdering, sortErrorsBySchemaOrder, attachRelated, _setPositionsFor } = require('./rejections');
const { setDiagnosticSource: attachDiagnosticSource } = require('./diagnostic-source');

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
            if (p) { e.dataFrame = { byteOffset: p.byteOffset, length: p.length, line: p.line, col: p.col, text: p.text }; if (p.textCol !== undefined) e.dataFrame.textCol = p.textCol; }
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

_setPositionsFor(lazyPositionsFor);

module.exports = { LazyJsonRejection };
