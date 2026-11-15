'use strict';

// The Validator a page's first load carries in 2.0: the small engine
// (lib/engine-small.js) under the same error presentation lib/validator-core.js
// uses (lib/rejections.js), and nothing else. It answers as the full
// Validator does for a schema it takes; for anything it does not carry yet it
// throws an Error whose message starts with "ata2:", naming what is missing.
// Work in progress on feat/v2-entry: the JSON text entry points, coercion,
// removal, custom keywords and the hand-over to generated code are not here
// yet.

const { createSmall } = require('./engine-small');
const { draftCode, isV1Dialect } = require('./dialect');
const { needsNormalization } = require('./schema-scan');
const { RichRejection, _enrichLazy } = require('./rejections');

const missing = (what) => { throw new Error('ata2: ' + what); };

// Options this class answers itself. Anything else is refused by name, so an
// option is never silently ignored.
const KNOWN = new Set(['useDefaults', 'richErrors', 'abortEarly', 'formats', 'schemas', 'assertFormat', 'baseURI']);

const ABORT_EARLY = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze(Object.defineProperty({ code: 'ATA9000', message: 'validation failed', keyword: '__abort_early__', path: '' }, '_s', { value: true }))]),
});

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
// when a normalizer has something to change. `inherit` is the root's draft
// for a registered document that declares none.
function normalize(s, inherit) {
  const code = s && typeof s === 'object' && s.$schema !== undefined ? draftCode(s.$schema) : (inherit || 0);
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

// As declaredId and _buildSchemaMap in lib/validator-core.js.
function declaredId(original, normalized) {
  const n = normalized && typeof normalized === 'object' ? normalized.$id : undefined;
  if (typeof n === 'string' && n !== '') return n;
  const o = original && typeof original === 'object' ? original.$id : undefined;
  if (typeof o === 'string' && o !== '' && o[0] !== '#') return o;
  return undefined;
}
function schemaMapOf(schemas, inherit) {
  const map = new Map();
  if (Array.isArray(schemas)) {
    for (const s of schemas) {
      const n = normalize(s, inherit);
      const id = declaredId(s, n);
      if (!id) throw new Error('Schema in schemas option must have $id');
      map.set(id, n);
    }
  } else {
    for (const [key, s] of Object.entries(schemas)) {
      const n = normalize(s, inherit);
      map.set(key, n);
      const id = declaredId(s, n);
      if (id && id !== key) map.set(id, n);
    }
  }
  return map;
}

const NOT_FLAT = /"\$(?:id|anchor|dynamicAnchor|recursiveAnchor)"/;
const META_REF = /"\$(?:ref|dynamicRef|recursiveRef)":"[^"]*json-schema\.org\//;

class Validator {
  constructor(schema, opts) {
    const o = opts || {};
    for (const k of Object.keys(o)) if (o[k] !== undefined && !KNOWN.has(k)) missing('option ' + k);
    this._rawSchema = typeof schema === 'string' ? JSON.parse(schema) : schema;
    this._options = o;
    this._engine = null;
    this._schemaObj = null;
    this._schemaPositions = null;
    this._source = null;
    this._fill = null;
    this._enrich = o.richErrors === false ? null : _enrichLazy;
  }

  _build() {
    const o = this._options;
    const raw = this._rawSchema;
    const inherit = raw && typeof raw === 'object' ? draftCode(raw.$schema) : 0;
    const map = o.schemas ? schemaMapOf(o.schemas, inherit) : null;
    let schemaObj = normalize(raw, 0);
    if (typeof o.baseURI === 'string' && o.baseURI !== '' && schemaObj && typeof schemaObj === 'object' && !Array.isArray(schemaObj) && typeof schemaObj.$id !== 'string') {
      schemaObj = { ...schemaObj, $id: o.baseURI };
    }
    let text = JSON.stringify(schemaObj) || '';
    if (o.assertFormat === false && text.includes('"format"')) {
      schemaObj = require('./draft7').stripFormatAssertions(clone(schemaObj));
      text = JSON.stringify(schemaObj) || '';
    }
    if (text.includes('"errorMessage"')) missing('errorMessage');
    if (text.includes('json-schema.org/') && META_REF.test(text)) missing('metaschemas');
    if (map !== null && map.size > 0) {
      if (typeof schemaObj === 'object' && schemaObj !== null && typeof schemaObj.$schema === 'string' && map.has(schemaObj.$schema)) missing('vocabularies');
      require('./schema-order').registerDocuments(schemaObj, map);
    }
    // Defaults are filled before the verdict, as the full Validator's closure
    // pass does where no generated pass is loaded; a schema whose text has no
    // `default` has none to fill.
    if (o.useDefaults !== false && (map !== null && map.size > 0 ? missing('defaults through schemas') : text.includes('"default"'))) {
      this._fill = require('./defaults').buildDefaultsApplier(schemaObj);
    }
    const flat = (map === null || map.size === 0) && !NOT_FLAT.test(text);
    const e = createSmall(schemaObj, { flat, schemaMap: map !== null && map.size > 0 ? map : null, formats: o.formats || null, v1: isV1Dialect(schemaObj) });
    if (e === null) missing('keywords');
    this._schemaObj = schemaObj;
    return (this._engine = e);
  }

  validate(data) {
    const e = this._engine || this._build();
    if (this._fill !== null) this._fill(data);
    if (this._options.abortEarly) return e.isValid(data) ? { valid: true, data, errors: [] } : ABORT_EARLY;
    const r = e.validate(data);
    if (r.valid) return r;
    return new RichRejection(r, data, null, this, this._schemaObj, this._enrich);
  }

  isValidObject(data) {
    const e = this._engine || this._build();
    if (this._fill !== null) this._fill(data);
    return e.isValid(data);
  }

  // JSON text, parsed with JSON.parse. The full Validator also attaches a
  // frame of the text to each error (lib/json-rejections.js); that is not
  // carried here yet, the error fields are the same.
  validateJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      return { valid: false, errors: [{ keyword: '__parse__', instancePath: '', schemaPath: '', params: {}, message: 'invalid JSON: ' + e.message }] };
    }
    return this.validate(data);
  }

  isValidJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      return false;
    }
    return this.isValidObject(data);
  }
}

module.exports = { Validator };

// Standard Schema V1, built on first read as the full Validator's is
// (lib/standard-schema.js), so a form library or router reading `~standard`
// gets the same object.
Object.defineProperty(Validator.prototype, '~standard', {
  configurable: true,
  enumerable: false,
  get() {
    const std = require('./standard-schema').standardSchemaFor(this, (self) => self._rawSchema, (self, value) => self.validate(value));
    Object.defineProperty(this, '~standard', { value: std, writable: false, enumerable: false, configurable: false });
    return std;
  },
});
