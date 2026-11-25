'use strict';

// Browser twin of lib/aot.js, wired by the package.json `browser` field. The
// emitters write module source for a bundler or the filesystem, which is build
// tooling, not something a page does; leaving them out keeps their code and
// the embedded safe-regex engine source out of the browser bundle. Loading a
// bundle somebody already built is a runtime act, so that one works here too.
//
// Validator.fromStandalone is here too, for every entry, Node included: the
// core reaches it through what the entry registered (_aotHost), on the first
// call, and ata-validator/lite, which refuses the method, does not carry it.

function unavailable(name) {
  return function () {
    throw new Error(
      name + '() is not in the default browser bundle. ' +
      "Import it from 'ata-validator/aot', which works in the browser too; " +
      'pages that never emit code stay free of the emitters this way.'
    );
  };
}

function loadBundle(Validator, mods, schemas, opts) {
  return schemas.map((schema, i) => {
    if (mods[i]) return Validator.fromStandalone(mods[i], schema, opts);
    return new Validator(schema, opts);
  });
}

// After the caller's three arguments, the parts of the core it needs.
function fromStandalone (mod, schema, opts, Validator, _pf, draftCode, buildSchemaMap, _normalizeCallerSchema, resolveSchemaForPreprocess, closurePass, compileToJSCodegenWithErrors, VALID_RESULT, off) {
  const options = opts || {};
  // `off`: what lib/validator-core.js adds to a draft code under
  // `assertFormat: false`, so a reference reaches no format here either.
  off = off || 0;
  const schemaObj = typeof schema === "string" ? JSON.parse(schema) : schema;
  // The module's patterns run as they were compiled (lib/pattern-fallback.js).
  const pf = _pf(options);
  if (pf !== null) pf.module(options, schemaObj);

  // A lightweight instance: the native compile is skipped entirely.
  const v = Object.create(Validator.prototype);
  v._jsFn = mod.boolFn;
  v._compiled = null;
  v._fastSlot = -1;

  // Mutators, built as a Validator builds its closure pass: from the schema
  // as the runtime reads it, through references into the documents given
  // with `schemas`, and without defaults under `useDefaults: false`. Built
  // from the schema as written, a default in a registered document was
  // never filled, and `useDefaults: false` still filled.
  let ppSchema = schemaObj;
  try {
    const draft = schemaObj && typeof schemaObj === 'object' ? draftCode(schemaObj.$schema) : 0;
    const map = buildSchemaMap(options.schemas, draft + off);
    ppSchema = resolveSchemaForPreprocess(_normalizeCallerSchema(schemaObj, off), map && map.size > 0 ? map : null);
  } catch {
    ppSchema = schemaObj;
  }
  const preprocess = closurePass(ppSchema, options, options.useDefaults !== false, !!options.removeAdditional);
  v._preprocess = preprocess;

  // Error function: the one compiled into the module if it has one, else compiled here.
  const stub = (d) => ({
    valid: false,
    errors: [
      { code: "validation_failed", path: "", message: "validation failed" },
    ],
  });
  let errFn = stub;
  if (mod.errFn) {
    errFn = (d) => mod.errFn(d, true);
  } else if (compileToJSCodegenWithErrors !== undefined) {
    // Without the code generator (the edge entry) a module that carries no
    // error function reports the stub above. The function is compiled from
    // the schema as the runtime reads it, normalized, with the registry and
    // the caller's formats: compiled from the schema as written, a draft-04
    // boolean exclusiveMinimum was an annotation and the function said
    // valid. It only explains a rejection: the module's verdict stands, so
    // a valid: true from here is reported as the stub, never as acceptance.
    let jsErrFn = null;
    try {
      const draft = schemaObj && typeof schemaObj === 'object' ? draftCode(schemaObj.$schema) : 0;
      const normalized = _normalizeCallerSchema(schemaObj, off);
      const map = buildSchemaMap(options.schemas, draft + off);
      jsErrFn = compileToJSCodegenWithErrors(normalized, map && map.size > 0 ? map : null, options.formats || null);
      if (jsErrFn) jsErrFn({}, true);
    } catch {
      jsErrFn = null;
    }
    if (jsErrFn) {
      errFn = (d) => {
        const r = jsErrFn(d, true);
        return r && r.valid === false ? r : stub(d);
      };
    }
  }

  // Hybrid or speculative
  const hybridFn = mod.hybridFactory
    ? mod.hybridFactory(VALID_RESULT, errFn)
    : null;

  v.validate = hybridFn
    ? preprocess
      ? (data) => {
          preprocess(data);
          return hybridFn(data);
        }
      : hybridFn
    : preprocess
      ? (data) => {
          preprocess(data);
          return mod.boolFn(data) ? VALID_RESULT : errFn(data);
        }
      : (data) => (mod.boolFn(data) ? VALID_RESULT : errFn(data));
  {
    const _bare = v.validate;
    v.validate = (data) => {
      const r = _bare(data);
      return (r.valid === true && r.data === undefined)
        ? { valid: true, data, errors: r.errors }
        : r;
    };
  }
  // Every read fills before its verdict, as validate() does: isValidObject()
  // and the JSON reads judged the document as it came, so a default that
  // fails its own schema passed there and a required name with a default
  // did not.
  v.isValidObject = preprocess ? (data) => { preprocess(data); return mod.boolFn(data); } : mod.boolFn;
  v.isValidJSON = (jsonStr) => {
    try {
      const obj = JSON.parse(jsonStr);
      if (preprocess) preprocess(obj);
      return mod.boolFn(obj);
    } catch {
      return false;
    }
  };
  v.validateJSON = (jsonStr) => {
    try {
      const obj = JSON.parse(jsonStr);
      if (preprocess) preprocess(obj);
      return hybridFn
        ? hybridFn(obj)
        : mod.boolFn(obj)
          ? VALID_RESULT
          : errFn(obj);
    } catch {
      return {
        valid: false,
        errors: [{ code: "invalid_json", path: "", message: "invalid JSON" }],
      };
    }
  };

  // Standard Schema V1, the same object a Validator hands out. Not writable,
  // enumerable or configurable, which is what defineProperty gives a new name.
  Object.defineProperty(v, "~standard", {
    value: require('./standard-schema').standardSchemaFor(v, () => schemaObj, (self, value) => self.validate(value)),
  });

  return v;
}

module.exports = {
  toStandalone: unavailable('toStandalone'),
  toStandaloneModule: unavailable('toStandaloneModule'),
  bundle: unavailable('bundle'),
  bundleStandalone: unavailable('bundleStandalone'),
  bundleCompact: unavailable('bundleCompact'),
  loadBundle,
  fromStandalone,
};
