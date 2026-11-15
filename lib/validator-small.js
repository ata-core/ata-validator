'use strict';

// The Validator a page's first load carries in 2.0: the small engine
// (lib/engine-small.js) under the same error presentation lib/validator-core.js
// uses (lib/rejections.js), and nothing else. It answers as the full
// Validator does for a schema it takes; for anything it does not carry yet it
// throws an Error whose message starts with "ata2:", naming what is missing.
// Work in progress on feat/v2-entry: options, defaults, the JSON text entry
// points and the hand-over to generated code are not here yet.

const { createSmall } = require('./engine-small');
const { draftCode, isV1Dialect } = require('./dialect');
const { needsNormalization } = require('./schema-scan');
const { RichRejection, _enrichLazy } = require('./rejections');

const missing = (what) => { throw new Error('ata2: ' + what); };

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === '__proto__') Object.defineProperty(out, k, { value: clone(v[k]), writable: true, enumerable: true, configurable: true });
    else out[k] = clone(v[k]);
  }
  return out;
}

// As _normalizeCallerSchemaUncached in lib/validator-core.js: a copy only
// when a normalizer has something to change.
function normalize(s) {
  const code = s && typeof s === 'object' && s.$schema !== undefined ? draftCode(s.$schema) : 0;
  const needsDraft7 = code === 1 || code === 2 || code === 4;
  const draft4 = code === 4, draft6 = code === 2 || draft4, draft2019 = code === 3;
  if (!draft6 && !draft2019 && !needsNormalization(s, needsDraft7)) return s;
  const copy = clone(s);
  const d = require('./draft7');
  if (needsDraft7) d.normalizeDraft7(copy, true, draft6, draft4);
  if (draft2019) d.normalizeDraft2019(copy, true);
  d.normalizeNullable(copy);
  d.normalizeExclusiveBounds(copy);
  return JSON.stringify(copy) === JSON.stringify(s) ? s : copy;
}

const NOT_FLAT = /"\$(?:id|anchor|dynamicAnchor|recursiveAnchor)"/;
const META_REF = /"\$(?:ref|dynamicRef|recursiveRef)":"[^"]*json-schema\.org\//;

class Validator {
  constructor(schema, opts) {
    if (opts) for (const k of Object.keys(opts)) if (opts[k] !== undefined) missing('option ' + k);
    this._rawSchema = typeof schema === 'string' ? JSON.parse(schema) : schema;
    this._engine = null;
    this._schemaObj = null;
    this._schemaPositions = null;
    this._source = null;
    this._fill = null;
  }

  _build() {
    const schemaObj = normalize(this._rawSchema);
    const text = JSON.stringify(schemaObj) || '';
    // Defaults are filled before the verdict, as the full Validator's closure
    // pass does where no generated pass is loaded; a schema whose text has no
    // `default` has none to fill.
    this._fill = text.includes('"default"') ? require('./defaults').buildDefaultsApplier(schemaObj) : null;
    if (text.includes('"errorMessage"')) missing('errorMessage');
    if (text.includes('json-schema.org/') && META_REF.test(text)) missing('metaschemas');
    const e = createSmall(schemaObj, { flat: !NOT_FLAT.test(text), schemaMap: null, formats: null, v1: isV1Dialect(schemaObj) });
    if (e === null) missing('keywords');
    this._schemaObj = schemaObj;
    return (this._engine = e);
  }

  validate(data) {
    const e = this._engine || this._build();
    if (this._fill !== null) this._fill(data);
    const r = e.validate(data);
    if (r.valid) return r;
    return new RichRejection(r, data, null, this, this._schemaObj, _enrichLazy);
  }

  isValidObject(data) {
    const e = this._engine || this._build();
    if (this._fill !== null) this._fill(data);
    return e.isValid(data);
  }
}

module.exports = { Validator };
