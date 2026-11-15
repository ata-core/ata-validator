'use strict';

// The Validator a page's first load carries in 2.0: the verdict core
// (lib/core/verdict.js) answers whether a value is valid, and the small engine
// (lib/engine-small.js), built the first time a value fails, says why, under
// the same error presentation lib/validator-core.js uses (lib/rejections.js). It answers as the full
// Validator does for a schema it takes; for anything it does not carry yet it
// throws an Error whose message starts with "ata2:", naming what is missing.
// Work in progress on feat/v2-entry: the JSON text entry points, coercion,
// removal, custom keywords and the hand-over to generated code are not here
// yet.

const { createSmall } = require('./engine-small');
const core = require('./core/verdict');
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

// What _build asked of the schema's JSON text, answered by one walk of the
// schema instead of writing the text: whether the text would hold
// "errorMessage", "default" or "format" as a token, a $ref, $dynamicRef or
// $recursiveRef naming a json-schema.org document (META_REF), and one of the
// NOT_FLAT names. Each of those can only occur inside one key or string of
// the text (with the key's value, for META_REF), so each key and string is
// asked as its own JSON text where it contains the word. Null where the walk
// cannot follow JSON.stringify (toJSON, a bigint, a cycle or very deep
// nesting): the text answers there, as before.
const TOKENS = ['errorMessage', 'default', 'format'];
// One scan of a string for any of the words; most strings have none.
const WORDS = /errorMessage|default|format|\$(?:id|anchor|dynamicAnchor|recursiveAnchor)/;
function facts(schema) {
  const f = { errorMessage: false, default: false, format: false, metaRef: false, notFlat: false, enumNotList: false };
  const str = (s) => {
    if (!WORDS.test(s)) return;
    const j = JSON.stringify(s);
    for (const t of TOKENS) if (!f[t] && j.includes('"' + t + '"')) f[t] = true;
    if (!f.notFlat && NOT_FLAT.test(j)) f.notFlat = true;
  };
  const walk = (x, depth) => {
    if (typeof x === 'string') { str(x); return true; }
    if (typeof x === 'bigint') return false;
    if (x === null || typeof x !== 'object') return true;
    if (depth > 200 || typeof x.toJSON === 'function') return false;
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) if (!walk(x[i], depth + 1)) return false; return true; }
    for (const k of Object.keys(x)) {
      const v = x[k];
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      str(k);
      if (k === 'enum' && !Array.isArray(v)) f.enumNotList = true;
      if (!f.metaRef && typeof v === 'string' && /(?:ref|Ref)$/.test(k) && v.includes('json-schema.org/') && META_REF.test(JSON.stringify(k) + ':' + JSON.stringify(v))) f.metaRef = true;
      if (!walk(v, depth + 1)) return false;
    }
    return true;
  };
  return walk(schema, 0) ? f : null;
}
// The same questions asked of the text, as _build asked them before.
function textFacts(schema) {
  const text = JSON.stringify(schema) || '';
  return { errorMessage: text.includes('"errorMessage"'), default: text.includes('"default"'), format: text.includes('"format"'), metaRef: text.includes('json-schema.org/') && META_REF.test(text), notFlat: NOT_FLAT.test(text) };
}
const factsOf = (schema) => facts(schema) || textFacts(schema);

class Validator {
  constructor(schema, opts) {
    const o = opts || {};
    for (const k of Object.keys(o)) if (o[k] !== undefined && !KNOWN.has(k)) missing('option ' + k);
    this._rawSchema = typeof schema === 'string' ? JSON.parse(schema) : schema;
    this._options = o;
    this._ready = false;
    this._verdict = null;
    this._small = null;
    this._noCore = false;
    // How validate() answers: 0 before its first call, 1 by the core's verdict
    // (the small engine only for a value that fails), 2 by the small engine,
    // which has the verdict and the errors in one walk, while values fail.
    this._mode = 0;
    this._args = null;
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
    let fx = factsOf(schemaObj);
    if (o.assertFormat === false && fx.format) {
      schemaObj = require('./draft7').stripFormatAssertions(clone(schemaObj));
      fx = factsOf(schemaObj);
    }
    this._messages = fx.errorMessage ? (features.errorMessage || missing('errorMessage, Validator.use(errorMessages)')).apply : null;
    if (map !== null && map.size > 0 && typeof schemaObj === 'object' && schemaObj !== null && typeof schemaObj.$schema === 'string' && map.has(schemaObj.$schema)) missing('vocabularies');
    if (fx.metaRef) {
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
    if (o.useDefaults !== false && (pre !== schemaObj || fx.default)) passes.push(require('./defaults').buildDefaultsApplier(pre));
    const run = passes.filter(Boolean);
    this._fill = run.length === 0 ? null : run.length === 1 ? run[0] : (d) => { for (let i = 0; i < run.length; i++) run[i](d); };
    const flat = (map === null || map.size === 0) && !fx.notFlat;
    const args = { flat, schemaMap: map !== null && map.size > 0 ? map : null, formats: o.formats || null, v1: isV1Dialect(schemaObj) };
    this._schemaObj = schemaObj;
    this._args = args;
    // The core declines a schema with an enum that is not a list; asked here
    // first, so such a schema does not pay for its scan.
    this._noCore = fx.enumNotList === true;
    this._ready = true;
  }

  // The verdict from the core. Where it declines, the small engine answers
  // both; where its later parts have not loaded yet (a browser bundle), the
  // small engine answers until they have.
  _core() {
    if (!this._ready) this._build();
    const schemaObj = this._schemaObj, args = this._args;
    let v = this._noCore ? null : core.createVerdict(schemaObj, args);
    if (v === null || v === core.PENDING) {
      const small = this._explain();
      if (v === core.PENDING) core._loaded().then(() => { const w = core.createVerdict(schemaObj, args); if (typeof w === 'function') this._verdict = w; });
      v = small.isValid;
    }
    return (this._verdict = v);
  }

  // The small engine, built when a value first fails, to say why.
  _explain() {
    if (this._small === null) {
      const e = createSmall(this._schemaObj, this._args);
      if (e === null) missing('keywords');
      this._small = e;
    }
    return this._small;
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
    if (!this._ready) this._build();
    if (this._fill !== null) this._fill(data);
    if (this._options.abortEarly) return (this._verdict || this._core())(data) ? { valid: true, data, errors: [] } : ABORT_EARLY;
    // The first call, and calls while values keep failing, go to the small
    // engine, whose one walk has the verdict and the errors: a value that
    // fails would otherwise be walked twice. The core answers the rest.
    if (this._mode === 1) {
      if ((this._verdict || this._core())(data)) return { valid: true, data, errors: [] };
    }
    const r = this._explain().validate(data);
    this._mode = r.valid ? 1 : 2;
    if (r.valid) return { valid: true, data, errors: [] };
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
    const verdict = this._verdict || this._core();
    if (this._fill !== null) this._fill(data);
    return verdict(data);
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
// The text questions both ways, for tests/test_validator_small_facts.js.
module.exports._facts = { facts, textFacts };

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
