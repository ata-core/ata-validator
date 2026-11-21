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
const { needsNormalization, scan, DEFINITIONS } = require('./schema-scan');
// The rejections without the enrichment (a copy of lib/rejections.js made by
// scripts/gen-rejection-core.js): the rich fields come with the richErrors
// feature.
const { RichRejection } = require('./rejection-core');

const missing = (what) => { throw new Error('ata2: ' + what); };
// The lines between core markers are the plugin's core. The full entries use
// lib/validator-full.js, this file with those lines replaced
// (scripts/gen-validator-full.js): every schema-decided group wired in, and
// none of the registration, the questions or featuresFor()'s recorder.
// ---- core: begin setup ----
// What the engine reads of the groups (lib/groups.js), and the questions
// asked of a schema's text before it is built.
const { G } = require('./groups');
const gates = require('./gates');
G.eq = require('./deq')._deq;
// While featuresFor() asks (index.v2.features.mjs): every feature by name,
// and the names of those a schema asked for.
let PROBE = null;
// A registered feature, or the refusal that names its import. Asked for
// under featuresFor(), it is recorded and handed over whether registered or
// not, so the questions after it are asked of what the schema becomes.
const need = (name, as) => {
  if (PROBE !== null) { PROBE.got.add(as || name); return PROBE.all[name]; }
  return features[name] || missing(name + ', Validator.use(' + (as || name) + ')');
};
// ---- core: end setup ----

// Features a schema can need that a page does not carry unless it asks:
// Validator.use(feature) with a feature from 'ata-validator/features/...'.
// A schema that needs one that is not registered is refused at its first
// use, naming the import, rather than validated without it. The six from
// formats on are the schema-decided groups (lib/groups.js), which the full
// entries register and the plugin's core does not. The feature of a single
// format name (formatDate, formatDateTime, ...: lib/groups.js) registers as
// part of formats or uri, and its check is kept beside the others (`got`).
// ---- core: begin features ----
const features = { errorMessage: null, metaschemas: null, coerceTypes: null, removeAdditional: null, codegen: null, richErrors: null, verbose: null, formats: null, uri: null, draft7: null, defaults: null, uniqueItems: null, branchCollapse: null };
// ---- core: end features ----
// ---- core: begin regroup ----
// Whether every group the engines read is registered, so _build has no
// question to ask for them.
let complete = false;
// The format checks registered, by format name, the table the engine reads
// (lib/groups.js). A registration is never taken back, so Validator.use
// merges the table of each feature it is given into this one: formatDate and
// then formatEmail, both registered under the name formats, leave both.
const got = G.table;
// The pieces the engines read, taken from the groups when one is registered:
// they take them where they build a node, so a call reads no slot.
function regroup () {
  G.dup = features.uniqueItems !== null ? features.uniqueItems.duplicatePair : null;
  G.distinct = features.uniqueItems !== null ? features.uniqueItems.allDistinct : null;
  G.collapse = features.branchCollapse !== null ? features.branchCollapse.collapse : null;
  // `got` holds built-in names only.
  complete = Object.keys(got).length === gates.NAMES.length && features.uniqueItems !== null && features.branchCollapse !== null;
}
regroup();
// ---- core: end regroup ----

// Options this class answers itself. Anything else is refused by name, so an
// option is never silently ignored.
const KNOWN = new Set(['coerceTypes', 'removeAdditional', 'useDefaults', 'richErrors', 'abortEarly', 'formats', 'schemas', 'assertFormat', 'baseURI', 'verbose']);

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
//
// The copy is kept per object, for the draft it was last read under, as
// _normalizeCallerSchema keeps it per object and draft:
// a second validator over the same registry then holds the same documents as
// the first, and lib/schema-order.js orders their errors as it did, where a
// new copy each time read as a conflicting registration and lost the order.
// A schema answered from the cache still asks for the draft7 group.
//
// `shown`: the schema is handed out (verbose's parentSchema of a root error).
// A draft-07 schema whose only rewrite would be `definitions` to `$defs` is
// read as it is otherwise: the engines resolve a reference into either name
// (lib/engine-shared.js), so only a schema shown tells the two apart.
const kept = new WeakMap();
function normalize(s, inherit, shown) {
  const k = (inherit || 0) + (shown ? 8 : 0), c = kept.get(s);
  if (c && c[0] === k) return need('draft7') && c[1];
  const code = s && s.$schema !== undefined ? draftCode(s.$schema) : (inherit || 0);
  const needsDraft7 = code === 1 || code === 2 || code === 4;
  const draft4 = code === 4, draft6 = code === 2 || draft4, draft2019 = code === 3;
  if (!draft6 && !draft2019 && !needsNormalization(s, needsDraft7)) return s;
  if (code === 1 && !shown && scan(s) === DEFINITIONS) return s;
  const copy = clone(s);
  const d = need('draft7');
  if (needsDraft7) d.normalizeDraft7(copy, true, draft6, draft4);
  if (draft2019) d.normalizeDraft2019(copy, true);
  d.normalizeNullable(copy);
  d.normalizeExclusiveBounds(copy);
  if (JSON.stringify(copy) === JSON.stringify(s)) return s;
  kept.set(s, [k, copy]);
  return copy;
}

// The draft code a document without `$schema` is read under: the root's.
const draftOf = (raw) => draftCode(raw && raw.$schema);

// As declaredId and _buildSchemaMap in lib/validator-core.js.
function declaredId(original, normalized) {
  const n = normalized && normalized.$id;
  if (typeof n === 'string' && n !== '') return n;
  const o = original && original.$id;
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
// Called with a map that holds a document.
function resolveRefForPreprocess(ref, schemaMap) {
  if (typeof ref !== 'string') return null
  const h = ref.indexOf('#')
  const baseId = h >= 0 ? ref.slice(0, h) : ref
  if (!baseId) return null
  let target = null
  if (schemaMap.has(baseId)) target = schemaMap.get(baseId)
  else if (!ref.includes('://')) for (const [id, s] of schemaMap) if (id.endsWith('/' + baseId)) { target = s; break }
  if (!target) return null
  // An empty fragment walks nothing and leaves the document itself.
  if (h >= 0) {
    for (const part of ref.slice(h + 1).split('/')) {
      if (part === '') continue
      if (target == null || typeof target !== 'object') return null
      target = target[part.replace(/~1/g, '/').replace(/~0/g, '~')]
    }
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
  if (!schema || typeof schema !== 'object') return schema
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
    this._fill = null;
    this._messages = null;
    this._full = null;
    this._calls = 0;
    this._start = 0;
    this._enrich = null;
    this._verbose = null;
    // Documents given to addSchema(): the caller's objects, and the map
    // entries they make, read by _build after the `schemas` option's.
    this._added = null;
  }

  // As addSchema in lib/validator-core.js: a document with an `$id`, read
  // under the root's draft when it declares none, registered under that id
  // (replacing an entry of the `schemas` option with the same one), and only
  // before the first call.
  addSchema(schema) {
    if (this._engine !== null) throw new Error('Cannot add schema after compilation: call addSchema() before validate(), isValidObject(), validateJSON() or isValidJSON()');
    const n = schema && typeof schema === 'object' && schema.$id ? normalize(schema, draftOf(this._rawSchema)) : null;
    const id = declaredId(schema, n);
    if (id === undefined) throw new Error('Schema must have $id');
    (this._added || (this._added = [])).push([schema, id, n]);
  }

  _build() {
    const o = this._options;
    this._enrich = this._rich();
    this._verbose = o.verbose ? need('verbose').wrap : null;
    const raw = this._rawSchema;
    let map = o.schemas ? schemaMapOf(o.schemas, draftOf(raw)) : null;
    if (this._added !== null) for (const [, id, n] of this._added) (map || (map = new Map())).set(id, n);
    let schemaObj = normalize(raw, 0, !!o.verbose);
    if (o.baseURI && typeof o.baseURI === 'string' && schemaObj && typeof schemaObj === 'object' && !Array.isArray(schemaObj) && typeof schemaObj.$id !== 'string') {
      schemaObj = { ...schemaObj, $id: o.baseURI };
    }
    // The verdict core, where an entry's class carries it as `core`
    // (lib/core/feature.js, index.v2.edge.mjs): given a schema alone, a text
    // holding only the words the questions below look for; given the
    // arguments as well, the engine. Without it, the schema's JSON text and
    // the small engine.
    const C = this.core;
    let text = (C || JSON.stringify)(schemaObj) || '';
    if (o.assertFormat === false && text.includes('"format"')) {
      schemaObj = need('draft7').stripFormatAssertions(clone(schemaObj));
      text = (C || JSON.stringify)(schemaObj) || '';
    }
    this._messages = text.includes('"errorMessage"') ? need('errorMessage', 'errorMessages').apply : null;
    // A registered meta-schema with a `$vocabulary` can turn keywords off
    // (_applyVocabularies in lib/validator-core.js), which this class does not
    // do. One without it, such as the draft-06 meta-schema a form library
    // registers through addSchema(), changes nothing.
    const meta = map && schemaObj && map.get(schemaObj.$schema);
    if (meta && meta.$vocabulary && typeof meta.$vocabulary === 'object') missing('vocabularies');
    // A root `$schema` URL puts `json-schema.org/` in the text of most
    // schemas, and asking META_REF then cost about 20 microseconds. When that
    // URL holds the text's only occurrence, no reference can name a
    // meta-schema, so the test is skipped. Only on the JSON text: the core's
    // text names a reference to a meta-schema with one `json-schema.org/`
    // (lib/core/feature.js), so beside a root `$schema` the count says nothing.
    const at = text.indexOf('json-schema.org/');
    if (at >= 0 && (C || text.indexOf('json-schema.org/', at + 1) >= 0 || !(schemaObj && typeof schemaObj.$schema === 'string' && schemaObj.$schema.includes('json-schema.org/'))) && META_REF.test(text)) {
      const metas = need('metaschemas').map;
      if (map === null) map = new Map(); else map = new Map(map);
      for (const [id, meta] of metas) {
        const bare = id.replace(/#$/, '');
        for (const key of [id, bare, bare + '#', bare.replace(/^https:/, 'http:'), bare.replace(/^http:/, 'https:')]) if (!map.has(key)) map.set(key, meta);
      }
    }
    // No document registered is no map, for the questions below.
    if (map !== null && map.size === 0) map = null;
// ---- core: begin gates ----
    // The groups the engine will read, asked of the JSON text of the schema
    // and of every registered document, where one is not registered. A
    // format name is asked for by its own feature, and is answered by any
    // registered feature that holds its check; featuresFor() asks for every
    // name, whatever this module has registered.
    if (PROBE !== null || !complete) {
      const user = o.formats || null, has = PROBE === null && got;
      const out = gates.textNeeds(C ? JSON.stringify(schemaObj) || '' : text, user, new Set(), has);
      if (map !== null) for (const doc of new Set(map.values())) gates.textNeeds(gates.docText(doc), user, out, has);
      for (const g of out) need(g);
    }
    if (map !== null && PROBE === null) require('./schema-order').registerDocuments(schemaObj, map);
// ---- core: end gates ----
    // Defaults are filled before the verdict, as the full Validator's closure
    // pass does where no generated pass is loaded; a schema whose text has no
    // `default` has none to fill.
    const pre = map !== null ? resolveSchemaForPreprocess(schemaObj, map) : schemaObj;
    // As the full Validator's closure passes, in its order: removal, coercion,
    // defaults.
    const passes = [];
    if (o.removeAdditional) passes.push(need('removeAdditional').build(pre));
    if (o.coerceTypes) passes.push(need('coerceTypes').build(pre, o.coerceTypes === 'array'));
    if (o.useDefaults !== false && (pre !== schemaObj || text.includes('"default"'))) passes.push(need('defaults').buildDefaultsApplier(pre));
    const run = passes.filter(Boolean);
    // featuresFor() asks no further.
// ---- core: begin stop ----
    if (PROBE !== null) return null;
// ---- core: end stop ----
    this._fill = run.length === 0 ? null : run.length === 1 ? run[0] : (d) => { for (let i = 0; i < run.length; i++) run[i](d); };
    const flat = map === null && !NOT_FLAT.test(text);
    const e = (C || createSmall)(schemaObj, { flat, schemaMap: map, formats: o.formats || null, v1: isV1Dialect(schemaObj) });
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

  // The enrichment that gives errors the rich fields: the richErrors
  // feature's. Without it, errors have the fields of the 1.x Validator's
  // `richErrors: false` shape, and asking for the rich ones by name is
  // refused rather than answered without them.
  _rich() {
    const r = this._options.richErrors;
    if (r === false) return null;
    const f = features.richErrors;
// ---- core: begin rich ----
    if (r !== undefined && (!f || PROBE !== null)) need('richErrors');
// ---- core: end rich ----
    return f ? f.enrich : null;
  }

  _tierUp() {
    if (features.codegen === null) return Promise.resolve(false);
    // The full Validator gives the rich fields unless told not to. Once
    // built, the shape stays the one this validator answered with.
    const opts = (this._engine !== null ? this._enrich : this._rich()) === null ? { ...this._options, richErrors: false } : this._options;
    return features.codegen.load().then((m) => m === null ? false : new Promise((resolve) => later(() => {
      const full = (m.default || m).full(this._rawSchema, opts);
      if (this._added !== null) for (const [s] of this._added) full.addSchema(s);
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
    const o = this._options;
    let r;
    if (o.abortEarly) {
      if (e.isValid(data)) return { valid: true, data, errors: [] };
      // As the full Validator, which puts verbose's fields on the stub too.
      if (this._verbose === null) return ABORT_EARLY;
      r = ABORT_EARLY;
    } else {
      r = e.validate(data);
      if (r.valid) return r;
    }
    if (this._verbose !== null) r = this._verbose(r, this._schemaObj, data);
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
// ---- core: begin merge ----
      // A feature without checks adds nothing.
      Object.assign(got, f.checks);
// ---- core: end merge ----
    }
// ---- core: begin use ----
    regroup();
// ---- core: end use ----
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
  // JSON text, parsed with JSON.parse in place: no object per call.
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

// For featuresFor() (index.v2.features.mjs): set while it asks, cleared after.
// ---- core: begin exports ----
const _probe = (p) => { PROBE = p; };
module.exports = { Validator, _probe };
// ---- core: end exports ----


// Standard Schema V1, built on first read as the full Validator's is
// (lib/standard-schema.js), so a form library or router reading `~standard`
// gets the same object.
// Not enumerable, and on the instance neither writable nor configurable: the
// defaults of defineProperty, left unsaid.
Object.defineProperty(Validator.prototype, '~standard', {
  configurable: true,
  get() {
    const std = require('./standard-schema').standardSchemaFor(this, (self) => self._rawSchema, (self, value) => self.validate(value));
    Object.defineProperty(this, '~standard', { value: std });
    return std;
  },
});
