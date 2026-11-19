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

// Features a schema can need that a page does not carry unless it asks:
// Validator.use(feature) with a feature from 'ata-validator/features/...'.
// A schema that needs one that is not registered is refused at its first
// use, naming the import, rather than validated without it.
const features = { errorMessage: null, metaschemas: null, coerceTypes: null, removeAdditional: null, codegen: null };

// Options this class answers itself. Anything else is refused by name, so an
// option is never silently ignored.
const KNOWN = new Set(['coerceTypes', 'removeAdditional', 'useDefaults', 'richErrors', 'abortEarly', 'formats', 'schemas', 'assertFormat', 'baseURI']);

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

// As in lib/validator-core.js: the shape the defaults pass reads, behind a
// reference into a registered document.
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
        // Spread and defineProperty: a property named "__proto__" stays an own
        // key of the copy (assignment would set the copy's prototype).
        if (!cloned) { cloned = { ...s }; cloned.properties = { ...s.properties } }
        Object.defineProperty(cloned.properties, key, { value: t, writable: true, enumerable: true, configurable: true })
      }
    }
  }
  return cloned || s
}

// Hot means TIER_CALLS calls within WINDOW_MS, as lib/tiering.js has it for
// the full Validator in the browser: a form checked as the user types stays
// on the small engine and never causes the download.
const TIER_CALLS = 1000;
const WINDOW_MS = 1000;
const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : Date.now;
const later = typeof requestIdleCallback === 'function' ? (f) => requestIdleCallback(f, { timeout: 1000 }) : (f) => setTimeout(f, 0);

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
    this._messages = null;
    this._full = null;
    this._calls = 0;
    this._start = 0;
    this._enrich = o.richErrors === false ? null : _enrichLazy;
  }

  _build() {
    const o = this._options;
    const raw = this._rawSchema;
    const inherit = raw && typeof raw === 'object' ? draftCode(raw.$schema) : 0;
    let map = o.schemas ? schemaMapOf(o.schemas, inherit) : null;
    let schemaObj = normalize(raw, 0);
    if (typeof o.baseURI === 'string' && o.baseURI !== '' && schemaObj && typeof schemaObj === 'object' && !Array.isArray(schemaObj) && typeof schemaObj.$id !== 'string') {
      schemaObj = { ...schemaObj, $id: o.baseURI };
    }
    let text = JSON.stringify(schemaObj) || '';
    if (o.assertFormat === false && text.includes('"format"')) {
      schemaObj = require('./draft7').stripFormatAssertions(clone(schemaObj));
      text = JSON.stringify(schemaObj) || '';
    }
    this._messages = text.includes('"errorMessage"') ? (features.errorMessage || missing('errorMessage, Validator.use(errorMessages)')).apply : null;
    if (map !== null && map.size > 0 && typeof schemaObj === 'object' && schemaObj !== null && typeof schemaObj.$schema === 'string' && map.has(schemaObj.$schema)) missing('vocabularies');
    // A root `$schema` URL puts `json-schema.org/` in the text of most
    // schemas, and asking META_REF then cost about 20 microseconds. When that
    // URL holds the text's only occurrence, no reference can name a
    // meta-schema, so the test is skipped.
    const at = text.indexOf('json-schema.org/');
    if (at >= 0 && (text.indexOf('json-schema.org/', at + 1) >= 0 || !(schemaObj !== null && typeof schemaObj === 'object' && typeof schemaObj.$schema === 'string' && schemaObj.$schema.includes('json-schema.org/'))) && META_REF.test(text)) {
      const metas = (features.metaschemas || missing('metaschemas, Validator.use(metaschemas)')).map;
      if (map === null) map = new Map(); else map = new Map(map);
      for (const [id, meta] of metas) {
        const bare = id.replace(/#$/, '');
        for (const key of [id, bare, bare + '#', bare.replace(/^https:/, 'http:'), bare.replace(/^http:/, 'https:')]) if (!map.has(key)) map.set(key, meta);
      }
    }
    if (map !== null && map.size > 0) require('./schema-order').registerDocuments(schemaObj, map);
    // Defaults are filled before the verdict, as the full Validator's closure
    // pass does where no generated pass is loaded; a schema whose text has no
    // `default` has none to fill.
    const pre = map !== null && map.size > 0 ? resolveSchemaForPreprocess(schemaObj, map) : schemaObj;
    // As the full Validator's closure passes, in its order: removal, coercion,
    // defaults.
    const passes = [];
    if (o.removeAdditional) passes.push((features.removeAdditional || missing('removeAdditional, Validator.use(removeAdditional)')).build(pre));
    if (o.coerceTypes) passes.push((features.coerceTypes || missing('coerceTypes, Validator.use(coerceTypes)')).build(pre, o.coerceTypes === 'array'));
    if (o.useDefaults !== false && (pre !== schemaObj || text.includes('"default"'))) passes.push(require('./defaults').buildDefaultsApplier(pre));
    const run = passes.filter(Boolean);
    this._fill = run.length === 0 ? null : run.length === 1 ? run[0] : (d) => { for (let i = 0; i < run.length; i++) run[i](d); };
    const flat = (map === null || map.size === 0) && !NOT_FLAT.test(text);
    const e = createSmall(schemaObj, { flat, schemaMap: map !== null && map.size > 0 ? map : null, formats: o.formats || null, v1: isV1Dialect(schemaObj) });
    if (e === null) missing('keywords');
    this._schemaObj = schemaObj;
    return (this._engine = e);
  }

  // With the codegen feature registered, counts calls; the TIER_CALLS-th
  // within WINDOW_MS loads the full
  // Validator with the code generator, and once it has compiled this schema,
  // when the page is idle, the calls go to it.
  _count() {
    if (features.codegen === null) return;
    if (++this._calls < TIER_CALLS) { if (this._calls === 1) this._start = now(); return; }
    if (this._calls !== TIER_CALLS) return;
    if (now() - this._start > WINDOW_MS) { this._calls = 0; return; }
    this._tierUp();
  }

  _tierUp() {
    if (features.codegen === null) return Promise.resolve(false);
    return features.codegen.load().then((m) => m === null ? false : new Promise((resolve) => later(() => {
      const full = (m.default || m).full(this._rawSchema, this._options);
      full.isValidObject(null);
      this._full = full;
      resolve(true);
    })), () => false);
  }

  validate(data) {
    if (this._full !== null) return this._full.validate(data);
    this._count();
    const e = this._engine || this._build();
    if (this._fill !== null) this._fill(data);
    if (this._options.abortEarly) return e.isValid(data) ? { valid: true, data, errors: [] } : ABORT_EARLY;
    const r = e.validate(data);
    if (r.valid) return r;
    const out = new RichRejection(r, data, null, this, this._schemaObj, this._enrich);
    if (this._messages === null) return out;
    // As the full Validator: the messages replace those of the presented
    // list, which is read here to do it.
    const errors = out.errors;
    const over = errors.length ? this._messages(errors, this._schemaObj) : errors;
    return over !== errors ? { valid: false, errors: over } : out;
  }

  static use(...list) {
    for (const f of list) {
      if (!f || typeof f !== 'object' || !Object.hasOwn(features, f.name)) throw new TypeError('Validator.use: not an ata-validator feature');
      features[f.name] = f;
    }
    return Validator;
  }

  isValidObject(data) {
    if (this._full !== null) return this._full.isValidObject(data);
    this._count();
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
