'use strict';

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
// Strict-mode schema checks (`strict`, `strictTypes`, ...) are accepted and
// ignored: an unknown keyword is an annotation, as the specification says.

const { Validator } = require('./index');
const { METASCHEMAS } = require('./lib/metaschemas');
const { createShaper } = require('./lib/compat-errors');

const DRAFT7 = 'http://json-schema.org/draft-07/schema#';
const DRAFT2020 = 'https://json-schema.org/draft/2020-12/schema';

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
    // The formats plugin of the reference assigns into `opts.code.formats`
    // before registering anything; the formats it carries are built in here,
    // so say so at that exact point instead of failing further down.
    const code = { ...(opts.code || {}) };
    Object.defineProperty(code, 'formats', {
      get() { return undefined; },
      set() {
        throw new Error('ata compat: the formats plugin is not needed, formats such as email, uri, date-time and uuid are built in; remove addFormats()');
      },
    });
    this.opts.code = code;

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
      coerceTypes: !!o.coerceTypes,
      removeAdditional: !!o.removeAdditional,
      verbose: !!o.verbose,
    };
    if (o.validateFormats === false) out.assertFormat = false;
    const formatNames = Object.keys(this._formats);
    if (formatNames.length > 0) out.formats = { ...this._formats };
    const keywordNames = Object.keys(this._keywords);
    if (keywordNames.length > 0) {
      const kws = {};
      for (const name of keywordNames) if (this._keywords[name] !== true) kws[name] = this._keywords[name];
      if (Object.keys(kws).length > 0) out.keywords = kws;
    }
    const registry = this._registrySnapshot();
    if (registry) out.schemas = registry;
    return out;
  }

  _registrySnapshot() {
    if (this._schemas.size === 0) return null;
    if (this._registry === null) {
      const map = {};
      for (const [key, schema] of this._schemas) map[key] = this._withDialect(schema);
      this._registry = map;
    }
    return this._registry;
  }

  _touchRegistry() {
    this._registry = null;
    this._registryEpoch++;
  }

  // A schema with no `$schema` is read as draft-07, which is what the
  // reference class does. The copy is shallow: only the root changes.
  _withDialect(schema) {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return schema;
    if (typeof schema.$schema === 'string') return schema;
    return { $schema: DRAFT7, ...schema };
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
    const rootDoc = this._withDialect(schema);
    const options = this._validatorOptions();
    const allErrors = !!this.opts.allErrors;
    let shaper = null;
    if (typeof rootDoc === 'object' && rootDoc !== null) {
      // The root is registered under a private id so the error shaper can
      // re-validate any subschema of it by pointer, with every `$ref` in it
      // still resolving.
      const rootId = 'ata-compat:root';
      options.schemas = { ...(options.schemas || {}), [rootId]: rootDoc };
      shaper = createShaper({
        Validator, rootId, rootDoc, options, allErrors,
        macroKeywords: Object.keys(this._keywords).filter((k) => this._keywords[k] !== true && this._keywords[k].macro),
      });
    }
    const v = new Validator(rootDoc, options);
    const validate = (data) => {
      const result = v.validate(data);
      if (result.valid) {
        validate.errors = null;
        return true;
      }
      const errors = shaper === null ? result.errors : shaper(result.errors, data);
      validate.errors = shaper === null && !allErrors ? errors.slice(0, 1) : errors;
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
    const id = schema && typeof schema === 'object' && typeof schema.$id === 'string' ? schema.$id : undefined;
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
    const declared = typeof schema.$schema === 'string' ? schema.$schema : DRAFT7;
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
      throw new Error(`keyword "${keyword}": code-generating keywords are not supported; define it with validate, compile or macro`);
    }
    const mapped = {};
    if (definition.type !== undefined) mapped.type = definition.type;
    if (typeof definition.validate === 'function') mapped.validate = definition.validate;
    if (typeof definition.compile === 'function') mapped.compile = definition.compile;
    if (typeof definition.macro === 'function') mapped.macro = definition.macro;
    if (mapped.validate && mapped.compile) delete mapped.validate;
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

const _metaValidators = new Map();
function metaValidator(id) {
  let v = _metaValidators.get(id);
  if (!v) {
    v = new Validator({ $ref: id }, { useDefaults: false });
    _metaValidators.set(id, v);
  }
  return v;
}

module.exports = Ata;
module.exports.default = Ata;
module.exports.Ata = Ata;
