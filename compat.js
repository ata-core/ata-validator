'use strict';

const { resolvePointer } = require('./lib/pointer.js');

// Drop-in for the default validator's class. `const Ajv = require('ata-validator/compat')`
// and the rest of the file stays as it was: `new Ajv(opts)`, `compile`,
// `validate`, `addSchema`, `getSchema`, `removeSchema`, `addFormat`,
// `addKeyword`, `errorsText`, `validateSchema`, `compileAsync`.
//
// The class reads schemas the way `require('ajv')` does: a schema that names
// no `$schema` is draft-07. tests/test_ajv_parity.js runs a corpus of real
// call shapes through both implementations and compares what comes back.
//
// What is not carried over, and refused rather than accepted quietly:
//   - `$data` references;
//   - keywords defined only through `code` (a code generator hook);
//   - the reference formats plugin, whose formats are built in here.
// Strict-mode schema checks: `strict` and `strictSchema` are enforced for the
// checks that fail open, an unknown keyword (`maxLenght` compiles and the
// constraint is simply absent) and a dangling local `$ref`. `strictTypes`,
// `strictTuples` and `strictRequired` are accepted and ignored.

const { Validator } = require('./index');
// The interpreted engine's coercion where each type is checked and its
// discriminator, which only compat asks for (see lib/interpreter-compat.js).
require('./lib/interpreter-core')._setCompat(require('./lib/interpreter-compat'));
const { METASCHEMAS } = require('./lib/metaschemas');
const { normalizeExclusiveBounds } = require('./lib/draft7');
const { createShaper, asReferenceKeyword } = require('./lib/compat-errors');

const DRAFT7 = 'http://json-schema.org/draft-07/schema#';
const DRAFT2020 = 'https://json-schema.org/draft/2020-12/schema';

// draft-04, which OpenAPI 3.0 builds on, is read as draft-07, the nearest
// dialect ata implements: its boolean exclusiveMinimum and exclusiveMaximum
// are normalized to the numeric form, and its `id` names the schema as `$id`
// does. The reference ships a separate class for it (ajv-draft-04).
const DRAFT4_IDS = new Set(['http://json-schema.org/draft-04/schema#', 'http://json-schema.org/draft-04/schema', 'https://json-schema.org/draft-04/schema#', 'https://json-schema.org/draft-04/schema']);
function isDraft4(schema) {
  return schema !== null && typeof schema === 'object' && typeof schema.$schema === 'string' && DRAFT4_IDS.has(schema.$schema);
}
function draft4AsDraft7(schema) {
  const out = { ...schema, $schema: DRAFT7 };
  if (typeof schema.id === 'string' && schema.$id === undefined) { out.$id = schema.id; delete out.id; }
  return out;
}

function isDraft7Id(id) {
  return id === DRAFT7 || id === 'http://json-schema.org/draft-07/schema';
}

function formatToFunction(name, format) {
  if (typeof format === 'function') return format;
  if (format instanceof RegExp) return (s) => format.test(s);
  if (typeof format === 'string') {
    const re = new RegExp(format, 'u');
    return (s) => re.test(s);
  }
  if (format === true) return () => true;
  if (format && typeof format === 'object') {
    if (typeof format.validate === 'function') return format.validate;
    if (format.validate instanceof RegExp) return (s) => format.validate.test(s);
    if (typeof format.validate === 'string') {
      const re = new RegExp(format.validate, 'u');
      return (s) => re.test(s);
    }
    if (format.async) throw new Error(`format "${name}": async formats are not supported`);
  }
  throw new Error(`format "${name}": unsupported format definition`);
}


class Ata {
  constructor(opts = {}) {
    if (opts.$data) {
      throw new Error('ata compat: $data references are not supported');
    }
    this.opts = { ...opts };
    // The formats plugin of the reference assigns into `opts.code.formats` and
    // then registers each of its formats through addFormat, which is what it
    // does here too. It is not needed (the formats are built in), but a
    // library that calls it inside its own setup, as express-openapi-validator
    // does, could not take this class at all while the call was refused.
    this.opts.code = { ...(opts.code || {}) };

    this.errors = null;
    this._schemas = new Map();      // key or $id -> schema object
    this._byKey = new Map();        // key -> $id (when both exist)
    this._formats = Object.create(null);
    this._keywords = Object.create(null);
    this._compiled = new WeakMap(); // schema object -> validate function
    this._registry = null;          // Validator `schemas` option, rebuilt on change
    this._registryEpoch = 0;

    if (opts.formats) {
      for (const name of Object.keys(opts.formats)) this.addFormat(name, opts.formats[name]);
    }
    if (Array.isArray(opts.keywords)) {
      for (const def of opts.keywords) this.addKeyword(def);
    }
    if (opts.schemas) {
      if (Array.isArray(opts.schemas)) this.addSchema(opts.schemas);
      else for (const key of Object.keys(opts.schemas)) this.addSchema(opts.schemas[key], key);
    }
  }

  // ----- options -------------------------------------------------------

  _validatorOptions() {
    const o = this.opts;
    const out = {
      useDefaults: !!o.useDefaults,
      coerceTypes: o.coerceTypes === 'array' ? 'array' : !!o.coerceTypes,
      removeAdditional: !!o.removeAdditional,
      verbose: !!o.verbose,
      // The errors are reshaped into the reference's own; the fields only
      // rich errors carry (code, received, suggestion, docUrl) are dropped on
      // the way, so they are not built at all.
      richErrors: false,
    };
    // `strict` and `strictSchema`: the unknown-keyword and dangling-local-$ref
    // checks are enforced; `strictTypes`, `strictTuples` and `strictRequired`
    // are still accepted and ignored. The specific keyword option wins over
    // the umbrella one, which is how the reference class reads them.
    const strictness = o.strictSchema !== undefined ? o.strictSchema : o.strict;
    if (strictness === true || strictness === 'log') out.strictSchema = strictness;
    if (o.logger !== undefined) out.logger = o.logger;
    if (o.validateFormats === false) out.assertFormat = false;
    const formatNames = Object.keys(this._formats);
    if (formatNames.length > 0) out.formats = { ...this._formats };
    const keywordNames = Object.keys(this._keywords);
    // Null prototype: a keyword named __proto__ written into a plain object
    // would set its prototype and never reach the validator.
    const kws = Object.create(null);
    for (const name of keywordNames) if (this._keywords[name] !== true) kws[name] = this._keywords[name];
    if (Object.keys(kws).length > 0) out.keywords = kws;
    const registry = this._registrySnapshot();
    if (registry) out.schemas = registry;
    return out;
  }

  _registrySnapshot() {
    if (this._schemas.size === 0) return null;
    if (this._registry === null) {
      const map = {};
      for (const [key, schema] of this._schemas) map[fragmentKey(key)] = this._fragmentRefs(this._withDialect(schema));
      this._registry = map;
    }
    return this._registry;
  }

  // A schema registered under a key that is only a fragment
  // (`addSchema(s, '#/components/schemas/Pet')`, as OpenAPI tools do) is
  // found by a `$ref` of that exact string that does not resolve in its own
  // document: the reference looks it up among the registered keys then. ata
  // resolves a fragment in the document alone, so such a `$ref` is pointed at
  // the key's entry in the registry (see fragmentKey).
  _fragmentRefs(schema) {
    if (schema === null || typeof schema !== 'object') return schema;
    let keys = this._fragmentKeys;
    if (keys === undefined || this._fragmentStale) {
      // The copies stand while the fragment-only keys are the same ones.
      const now = new Set();
      for (const key of this._schemas.keys()) if (key.startsWith('#')) now.add(key);
      this._fragmentStale = false;
      if (keys === undefined || keys.size !== now.size || [...now].some((k) => !keys.has(k))) {
        // Each key's pointer, split and decoded once.
        keys = this._fragmentKeys = new Map();
        for (const key of now) {
          let segs = null;
          if (key.startsWith('#/')) {
            try { segs = key.slice(2).split('/').map((raw) => decodeURIComponent(raw.replace(/~1/g, '/').replace(/~0/g, '~'))); } catch { segs = null; }
          }
          keys.set(key, segs);
        }
        this._fragmentCopies = new WeakMap();
      }
    }
    if (keys.size === 0) return schema;
    const hit = this._fragmentCopies.get(schema);
    if (hit !== undefined) return hit;
    if ((features(schema) & F_REF) === 0) { this._fragmentCopies.set(schema, schema); return schema; }
    const resolves = (key, segs) => {
      if (key === '#') return true;
      if (segs === null) return !key.startsWith('#/');
      let node = schema;
      for (let i = 0; i < segs.length; i++) {
        if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, segs[i])) return false;
        node = node[segs[i]];
      }
      return true;
    };
    // Only a key that does not resolve in this document can need pointing
    // elsewhere. A document that holds every registered fragment itself, as
    // an OpenAPI tool's schema carrying the whole `components` does, is left
    // as it is without a walk.
    const pointed = new Set();
    for (const [key, segs] of keys) if (!resolves(key, segs)) pointed.add(key);
    if (pointed.size === 0) { this._fragmentCopies.set(schema, schema); return schema; }
    let changed = false;
    const copy = (n, data) => {
      if (n === null || typeof n !== 'object') return n;
      if (Array.isArray(n)) return n.map((x) => copy(x, data));
      const out = {};
      for (const k of Object.keys(n)) {
        let v;
        if (!data && k === '$ref' && typeof n[k] === 'string' && pointed.has(n[k])) { v = fragmentKey(n[k]); changed = true; }
        else v = copy(n[k], !data && (k === 'const' || k === 'enum' || k === 'default' || k === 'examples' || k === 'example'));
        if (k === '__proto__') Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true });
        else out[k] = v;
      }
      return out;
    };
    const out = copy(schema, false);
    const result = changed ? out : schema;
    this._fragmentCopies.set(schema, result);
    return result;
  }

  _touchRegistry() {
    this._fragmentStale = true;
    this._registry = null;
    this._registryEpoch++;
  }

  // A schema with no `$schema` is read as draft-07, which is what the
  // reference class does, or as `defaultMeta` when that names a dialect: the
  // reference's 2020-12 class reads one as 2020-12, which is how an OpenAPI
  // 3.1 document's schemas are meant. The copy is shallow: only the root
  // changes.
  // The copy is kept per schema object, so a schema compiled again or
  // registered again is the same object to everything that remembers work
  // per object below (the scan, normalization, the fragment copies).
  _withDialect(schema) {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return schema;
    if (this._dialectCopies === undefined) this._dialectCopies = new WeakMap();
    let out = this._dialectCopies.get(schema);
    if (out === undefined) {
      out = this._withDialectCopy(schema);
      this._dialectCopies.set(schema, out);
    }
    return out;
  }

  _withDialectCopy(schema) {
    if (isDraft4(schema)) return draft4AsDraft7(schema);
    if (typeof schema.$schema === 'string') return schema;
    const meta = typeof this.opts.defaultMeta === 'string' ? this.opts.defaultMeta : DRAFT7;
    if (DRAFT4_IDS.has(meta)) return draft4AsDraft7({ $schema: meta, ...schema });
    return { $schema: meta, ...schema };
  }

  // ----- compile / validate --------------------------------------------

  compile(schema) {
    if (typeof schema === 'object' && schema !== null) {
      const hit = this._compiled.get(schema);
      if (hit && hit._epoch === this._registryEpoch) return hit;
    }
    if (this.opts.validateSchema !== false && typeof schema === 'object' && schema !== null) {
      if (!this.validateSchema(schema)) {
        const message = 'schema is invalid: ' + this.errorsText();
        if (this.opts.validateSchema === 'log') {
          const logger = this.opts.logger;
          if (logger && typeof logger.error === 'function') logger.error(message);
        } else {
          throw new Error(message);
        }
      }
    }
    if (this._codeOnly && typeof schema === 'object' && schema !== null) {
      const { schemaUsesKeywords } = require('./lib/keywords');
      for (const name of Object.keys(this._codeOnly)) {
        if (schemaUsesKeywords(schema, { [name]: this._codeOnly[name] }) || [...this._schemas.values()].some((s) => schemaUsesKeywords(s, { [name]: this._codeOnly[name] }))) {
          throw new Error(`keyword "${name}": code-generating keywords are not supported; define it with validate, compile or macro`);
        }
      }
    }
    const rootDoc = this._fragmentRefs(this._withDialect(schema));
    const options = this._validatorOptions();
    const allErrors = !!this.opts.allErrors;
    // The reference's `discriminator` option, for a schema that has one.
    const discriminated = this.opts.discriminator === true &&
      ((features(rootDoc) & F_DISCR) !== 0 || Object.values(options.schemas || {}).some((d) => features(d) & F_DISCR));
    let shaper = null;
    if (typeof rootDoc === 'object' && rootDoc !== null) {
      // The root is registered under a private id so the error shaper can
      // re-validate any subschema of it by pointer, with every `$ref` in it
      // still resolving.
      const rootId = 'ata-compat:root';
      options.schemas = { ...(options.schemas || {}), [rootId]: rootDoc };
      shaper = createShaper({
        Validator, rootId, rootDoc, options, allErrors, schemas: options.schemas, discriminator: discriminated,
        macroKeywords: Object.keys(this._keywords).filter((k) => this._keywords[k] !== true && this._keywords[k].macro),
      });
    }
    // coerceTypes reaching a value behind allOf, anyOf, oneOf, $ref and the
    // rest, where ata's coercion pass, which runs before validation and
    // follows `properties` and `items`, does not: the interpreted engine then
    // coerces where each `type` is checked, as the reference does.
    if (options.coerceTypes && (features(rootDoc) & F_BEYOND) !== 0) {
      options._coerceInWalk = this.opts.coerceTypes === 'array' ? 'array' : true;
      options.coerceTypes = false;
      options.engine = 'interpreter';
    }
    // The reference's `discriminator` option: the interpreted engine reads the
    // keyword (see discriminate in lib/interpreter-core.js).
    // A format registered for numbers, for a schema that names a format.
    if (this._numFormats && Object.keys(this._numFormats).length > 0 &&
        ((features(rootDoc) & F_FORMAT) !== 0 || Object.values(options.schemas || {}).some((d) => features(d) & F_FORMAT))) {
      options._numberFormats = { ...this._numFormats };
      options.engine = 'interpreter';
    }
    if (discriminated) {
      options._discriminator = true;
      options.engine = 'interpreter';
    }
    const v = new Validator(rootDoc, options);
    const defaults = this.opts.useDefaults ? referencedDefaults(rootDoc, options.schemas) : null;
    // With keywords that read their data's context, the shaper is given the
    // errors as the validator made them: those carry each anyOf and oneOf
    // branch's errors (see keepBranches in lib/interpreter-core.js), which the
    // copies handed out do not.
    const ctxKeywords = options.keywords !== undefined && Object.values(options.keywords).some((k) => k && k.dataContext === true);
    const validate = (data) => {
      if (defaults !== null) defaults(data);
      const result = v.validate(data);
      if (result.valid) {
        validate.errors = null;
        return true;
      }
      const raw = ctxKeywords && shaper !== null && typeof result._ataRaw === 'function' ? result._ataRaw() : result.errors;
      let errors = shaper === null ? result.errors.map(asReferenceKeyword) : shaper(raw, data);
      // Errors the shaper synthesises, the `if` wrapper among them, are built
      // from the group rather than carried up from the validator, so verbose
      // mode has to fill in the value they point at here or they would be the
      // only ones missing it.
      if (this.opts.verbose) {
        errors = errors.map((e) => (e && !('data' in e)
          ? { ...e, data: resolvePointer(data, e.instancePath || '', undefined) }
          : e));
      }
      validate.errors = inReferenceOrder(shaper === null && !allErrors ? errors.slice(0, 1) : errors);
      return false;
    };
    validate.errors = null;
    validate.schema = schema;
    validate._epoch = this._registryEpoch;
    if (typeof schema === 'object' && schema !== null) this._compiled.set(schema, validate);
    return validate;
  }

  compileAsync(schema) {
    return new Promise((resolve, reject) => {
      try { resolve(this.compile(schema)); } catch (e) { reject(e); }
    });
  }

  validate(schemaKeyRef, data) {
    let validate;
    if (typeof schemaKeyRef === 'string') {
      validate = this.getSchema(schemaKeyRef);
      if (!validate) throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
    } else {
      validate = this.compile(schemaKeyRef);
    }
    const valid = validate(data);
    this.errors = validate.errors;
    return valid;
  }

  // ----- schema registry -----------------------------------------------

  addSchema(schema, key) {
    if (Array.isArray(schema)) {
      for (const s of schema) this.addSchema(s);
      return this;
    }
    const id = schema && typeof schema === 'object' && typeof schema.$id === 'string' ? schema.$id
      : isDraft4(schema) && typeof schema.id === 'string' ? schema.id : undefined;
    const k = key !== undefined ? String(key) : id;
    if (k === undefined) throw new Error('schema with key or id "undefined" cannot be added: no key and no $id');
    if (this._schemas.has(k) && this._schemas.get(k) !== schema) {
      throw new Error(`schema with key or id "${k}" already exists`);
    }
    this._schemas.set(k, schema);
    if (id !== undefined && id !== k) {
      this._schemas.set(id, schema);
      this._byKey.set(k, id);
    }
    this._touchRegistry();
    return this;
  }

  addMetaSchema(schema, key) {
    return this.addSchema(schema, key);
  }

  getSchema(keyRef) {
    const schema = this._schemas.get(keyRef);
    if (schema !== undefined) return this.compile(schema);
    // A fragment into a registered document: compile a reference to it.
    const hash = keyRef.indexOf('#');
    if (hash > 0 && this._schemas.has(keyRef.slice(0, hash))) {
      return this.compile({ $ref: keyRef });
    }
    return undefined;
  }

  removeSchema(schemaKeyRef) {
    if (schemaKeyRef === undefined) {
      this._schemas.clear();
      this._byKey.clear();
      this._compiled = new WeakMap();
      this._touchRegistry();
      return this;
    }
    if (schemaKeyRef instanceof RegExp) {
      for (const key of Array.from(this._schemas.keys())) {
        if (schemaKeyRef.test(key)) this._removeKey(key);
      }
      return this;
    }
    if (typeof schemaKeyRef === 'object' && schemaKeyRef !== null) {
      for (const [key, schema] of Array.from(this._schemas)) {
        if (schema === schemaKeyRef) this._removeKey(key);
      }
      this._compiled.delete(schemaKeyRef);
      return this;
    }
    this._removeKey(String(schemaKeyRef));
    return this;
  }

  _removeKey(key) {
    const schema = this._schemas.get(key);
    if (schema === undefined) return;
    this._schemas.delete(key);
    const alias = this._byKey.get(key);
    if (alias !== undefined) {
      this._schemas.delete(alias);
      this._byKey.delete(key);
    }
    for (const [k, id] of Array.from(this._byKey)) {
      if (id === key) { this._schemas.delete(k); this._byKey.delete(k); }
    }
    if (typeof schema === 'object' && schema !== null) this._compiled.delete(schema);
    this._touchRegistry();
  }

  validateSchema(schema, throwOrLogError) {
    if (typeof schema === 'boolean') { this.errors = null; return true; }
    if (typeof schema !== 'object' || schema === null) {
      this.errors = [{ keyword: 'type', instancePath: '', schemaPath: '#/type', params: { type: 'object' }, message: 'must be object,boolean' }];
      return false;
    }
    // A draft-04 schema is checked as the draft-07 schema it is read as: the
    // boolean exclusive bounds in their numeric form, against draft-07's
    // meta-schema (ata carries no draft-04 meta-schema).
    if (isDraft4(schema)) schema = normalizeExclusiveBounds(structuredClone(draft4AsDraft7(schema)));
    const declared = typeof schema.$schema === 'string' ? schema.$schema : typeof this.opts.defaultMeta === 'string' && !DRAFT4_IDS.has(this.opts.defaultMeta) ? this.opts.defaultMeta : DRAFT7;
    const metaId = METASCHEMAS.has(declared) ? declared : isDraft7Id(declared) ? DRAFT7 : DRAFT2020;
    const meta = metaValidator(metaId);
    const result = meta.validate(schema);
    if (result.valid) { this.errors = null; return true; }
    this.errors = result.errors;
    if (throwOrLogError) {
      const message = 'schema is invalid: ' + this.errorsText();
      if (this.opts.validateSchema === 'log') {
        const logger = this.opts.logger;
        if (logger && typeof logger.error === 'function') logger.error(message);
      } else {
        throw new Error(message);
      }
    }
    return false;
  }

  // ----- formats -------------------------------------------------------

  addFormat(name, format) {
    this._formats[name] = formatToFunction(name, format);
    // The reference applies a format declared `type: 'number'` to numbers,
    // where JSON Schema, and ata, apply formats to strings only. Such a
    // format is also checked on numbers here, by the interpreted engine (see
    // compile).
    if (format && typeof format === 'object' && format.type === 'number') {
      this._numFormats = this._numFormats || Object.create(null);
      this._numFormats[name] = this._formats[name];
    } else if (this._numFormats) delete this._numFormats[name];
    this._touchRegistry();
    this._compiled = new WeakMap();
    return this;
  }

  // ----- keywords ------------------------------------------------------

  addKeyword(kwdOrDef, def) {
    let keyword;
    let definition;
    if (typeof kwdOrDef === 'string') {
      keyword = kwdOrDef;
      definition = def;
    } else if (kwdOrDef && typeof kwdOrDef === 'object') {
      keyword = kwdOrDef.keyword;
      definition = kwdOrDef;
    }
    // The reference takes a list of names for one definition (the formats
    // plugin registers formatMinimum and its kin that way).
    if (Array.isArray(keyword)) {
      for (const k of keyword) this.addKeyword({ ...definition, keyword: k });
      return this;
    }
    if (typeof keyword !== 'string' || keyword === '') {
      throw new Error('addKeyword: keyword must be a non-empty string');
    }
    if (this._keywords[keyword] !== undefined) {
      throw new Error(`keyword "${keyword}" is already defined`);
    }
    if (!definition || (typeof definition === 'object' && !definition.validate && !definition.compile && !definition.macro && !definition.code)) {
      // A bare name: the keyword is known and checks nothing.
      this._keywords[keyword] = true;
      return this;
    }
    if (typeof definition.code === 'function' && !definition.validate && !definition.compile && !definition.macro) {
      // A keyword defined only as generated code cannot run here. It is
      // registered as known and refused when a schema uses it (see compile),
      // so a library that defines such keywords for options it may never use
      // can still take this class, and a schema that relies on one is never
      // accepted without the check.
      this._codeOnly = this._codeOnly || Object.create(null);
      this._codeOnly[keyword] = { name: keyword, types: null, validate: null, compile: null, macro: null };
      this._compiled = new WeakMap();
      return this;
    }
    const mapped = {};
    if (definition.type !== undefined) mapped.type = definition.type;
    if (typeof definition.validate === 'function') mapped.validate = definition.validate;
    if (typeof definition.compile === 'function') mapped.compile = compileWithContext(definition.compile);
    if (typeof definition.macro === 'function') mapped.macro = definition.macro;
    if (typeof definition.before === 'string') mapped.before = definition.before;
    if (definition.post === true) mapped.post = true;
    if (mapped.validate && mapped.compile) delete mapped.validate;
    // The reference hands every keyword function the data's context
    // (parentData, parentDataProperty, instancePath, rootData), and keywords
    // that remove or rewrite the value they check rely on it.
    if (mapped.validate || mapped.compile) mapped.dataContext = true;
    this._keywords[keyword] = mapped;
    this._keywordDefs = this._keywordDefs || Object.create(null);
    this._keywordDefs[keyword] = definition;
    this._compiled = new WeakMap();
    return this;
  }

  addVocabulary(definitions) {
    for (const def of definitions) this.addKeyword(def);
    return this;
  }

  getKeyword(keyword) {
    const def = this._keywords[keyword];
    if (def === undefined) return false;
    return def === true ? true : (this._keywordDefs && this._keywordDefs[keyword]) || def;
  }

  removeKeyword(keyword) {
    delete this._keywords[keyword];
    if (this._codeOnly) delete this._codeOnly[keyword];
    if (this._keywordDefs) delete this._keywordDefs[keyword];
    this._compiled = new WeakMap();
    return this;
  }

  // ----- errors --------------------------------------------------------

  errorsText(errors = this.errors, { separator = ', ', dataVar = 'data' } = {}) {
    if (!errors || errors.length === 0) return 'No errors';
    return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
  }
}

// A reference keyword's compile(schema, parentSchema, it) returns a function
// of (data, dataCxt). `it.schemaPath.str` is read by keywords that build their
// own error objects, at the time they fail: it names the schema the check
// sits in, which is known per call here, so it is read from the context the
// call was given.
function compileWithContext(compile) {
  return (value, parentSchema) => {
    let current = '#';
    const it = { get schemaPath() { return { str: current }; } };
    const inner = compile(value, parentSchema, it);
    if (typeof inner !== 'function') return inner;
    const wrapped = (data, ctx) => {
      if (ctx && typeof ctx.schemaPath === 'string') current = ctx.schemaPath.slice(0, ctx.schemaPath.lastIndexOf('/')) || '#';
      return inner(data, ctx);
    };
    // Errors the keyword writes land on its own function, read from here.
    wrapped.source = inner;
    return wrapped;
  };
}

// The reference writes an error's fields as instancePath, schemaPath,
// keyword, params, message; code that serializes errors sees the order. The
// errors a custom keyword reports come out in another, and are put in this one.
const REFERENCE_FIELDS = ['instancePath', 'schemaPath', 'keyword', 'params', 'message'];
function inReferenceOrder(errors) {
  for (let i = 0; i < errors.length; i++) {
    const e = errors[i];
    if (e === null || typeof e !== 'object') continue;
    const keys = Object.keys(e);
    let ordered = true;
    for (let j = 0; j < REFERENCE_FIELDS.length && j < keys.length; j++) if (keys[j] !== REFERENCE_FIELDS[j]) { ordered = false; break; }
    if (ordered) continue;
    const out = {};
    for (const k of REFERENCE_FIELDS) if (k in e) out[k] = e[k];
    for (const k of keys) if (!(k in out)) out[k] = e[k];
    errors[i] = out;
  }
  return errors;
}

// useDefaults the way the reference applies it: in the properties of every
// subschema the data is validated against outside anyOf, oneOf, not and if,
// which includes those behind `allOf` and a `$ref`. ata's own pass fills the
// `properties` it can reach by nesting alone; this one, run before it, also
// goes through `allOf` and `$ref`. Both fill only a key the object does not
// have, so what one fills the other leaves. Null when the schema has no
// default anywhere such a walk could reach that ata's own pass would not.
function referencedDefaults(rootDoc, registry) {
  if (rootDoc === null || typeof rootDoc !== 'object') return null;
  const f = features(rootDoc);
  if ((f & F_DEFAULT) === 0 && !Object.values(registry || {}).some((d) => features(d) & F_DEFAULT)) return null;
  if ((f & (F_REF | F_ALLOF)) === 0) return null;
  const resolve = (ref) => {
    const hash = ref.indexOf('#');
    const base = hash < 0 ? ref : ref.slice(0, hash);
    const doc = base === '' ? rootDoc : registry && registry[base];
    if (doc === undefined || doc === null) return null;
    const frag = hash < 0 ? '' : ref.slice(hash + 1);
    if (frag !== '' && !frag.startsWith('/')) return null;
    let node = doc;
    for (const raw of frag === '' ? [] : frag.slice(1).split('/')) {
      let seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      try { seg = decodeURIComponent(seg); } catch { return null; }
      if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, seg)) return null;
      node = node[seg];
    }
    return node;
  };
  // `done`, per call: the schemas already applied to each object. A second
  // application fills nothing new, and following every edge of a chain such
  // as n_i = allOf [n_(i-1), n_(i-1)] applied the bottom schema 2^n times.
  let done = null;
  const fill = (schema, data, active) => {
    if (schema === null || typeof schema !== 'object' || data === null || typeof data !== 'object' || active.has(schema)) return;
    let applied = done.get(data);
    if (applied === undefined) done.set(data, (applied = new Set()));
    if (applied.has(schema)) return;
    applied.add(schema);
    active.add(schema);
    if (typeof schema.$ref === 'string') fill(resolve(schema.$ref), data, active);
    if (Array.isArray(schema.allOf)) for (const sub of schema.allOf) fill(sub, data, active);
    const props = schema.properties;
    if (props !== null && typeof props === 'object' && !Array.isArray(data)) {
      for (const key of Object.keys(props)) {
        const prop = props[key];
        if (prop === null || typeof prop !== 'object') continue;
        if (prop.default !== undefined && !Object.hasOwn(data, key)) {
          const value = prop.default !== null && typeof prop.default === 'object' ? JSON.parse(JSON.stringify(prop.default)) : prop.default;
          Object.defineProperty(data, key, { value, writable: true, enumerable: true, configurable: true });
        }
        // Into the value with a fresh set: the same schema may apply again
        // one level down, in a recursive one.
        if (Object.hasOwn(data, key)) fill(prop, data[key], new Set());
      }
    }
    if (Array.isArray(data) && schema.items !== null && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      for (const item of data) fill(schema.items, item, new Set());
    }
    active.delete(schema);
  };
  return (data) => {
    done = new Map();
    try { fill(rootDoc, data, new Set()); } finally { done = null; }
  };
}

// The registry id a fragment-only key is kept under: a `#...` string is not an
// id a document can be found by, so it is given one.
function fragmentKey(key) {
  return key.startsWith('#') ? 'ata-compat:fragment:' + encodeURIComponent(key.slice(1)) : key;
}


// What a schema holds anywhere below it, read from the walk normalization
// makes of it anyway (lib/schema-scan.js), which remembers it per object.
const _scan = require('./lib/schema-scan');
const F_REF = 1 << 16, F_BEYOND = 1 << 17, F_DISCR = 1 << 18, F_DEFAULT = 1 << 19, F_ALLOF = 1 << 20, F_FORMAT = 1 << 21;
_scan._setExtraKeys(new Map([
  ['$ref', F_REF | F_BEYOND], ['$dynamicRef', F_BEYOND], ['allOf', F_ALLOF | F_BEYOND],
  ['anyOf', F_BEYOND], ['oneOf', F_BEYOND], ['not', F_BEYOND], ['if', F_BEYOND],
  ['then', F_BEYOND], ['else', F_BEYOND], ['additionalProperties', F_BEYOND],
  ['patternProperties', F_BEYOND], ['prefixItems', F_BEYOND], ['additionalItems', F_BEYOND],
  ['contains', F_BEYOND], ['dependentSchemas', F_BEYOND], ['dependencies', F_BEYOND],
  ['propertyNames', F_BEYOND], ['unevaluatedProperties', F_BEYOND], ['unevaluatedItems', F_BEYOND],
  ['discriminator', F_DISCR], ['default', F_DEFAULT], ['format', F_FORMAT],
]));
const features = _scan.scan;

const _metaValidators = new Map();
function metaValidator(id) {
  let v = _metaValidators.get(id);
  if (!v) {
    v = new Validator({ $ref: id }, { useDefaults: false, engine: 'interpreter' });
    _metaValidators.set(id, v);
  }
  return v;
}

// Maps each error's instancePath to its position in the JSON text the data
// was parsed from and attaches it as `dataFrame` ({ byteOffset, length,
// line, col, text }). One walk of the text, and correct when the same key
// appears in several sections, which a first-occurrence string search is
// not. Not an Ajv API: exported for callers that keep the source text
// around and want file positions on Ajv-shaped errors.
Ata.attachDataFrames = function attachDataFrames(errors, text) {
  if (!errors || !errors.length || text == null) return errors;
  const { buildDataPositionMap } = require('./lib/data-positions');
  let map;
  try { map = buildDataPositionMap(text); } catch { return errors; }
  for (const e of errors) {
    if (!e || e.dataFrame) continue;
    const ptr = e.instancePath != null ? e.instancePath : (e.dataPath || '');
    const p = map[ptr];
    if (p) e.dataFrame = { byteOffset: p.byteOffset, length: p.length, line: p.line, col: p.col, text: p.text };
  }
  return errors;
};

module.exports = Ata;
module.exports.default = Ata;
module.exports.Ata = Ata;
module.exports.Ajv = Ata;
