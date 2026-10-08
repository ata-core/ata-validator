'use strict';
const { compileFunction } = require('./lib/compile-fn')

// The full package: the validator core with the code generator registered,
// plus the tools no Validator calls (TypeScript generation, renderers, output
// formats). The core lives in lib/validator-core.js so that
// ata-validator/lite can load it without either.
const core = require('./lib/validator-core.js');

const jsCompiler = require('./lib/js-compiler.js');
const { compileToJS, compileToJSCodegen } = jsCompiler;

// The compiled paths a Validator installs when the code generator produced a
// verdict function: the hybrid and combined forms of validate(), the lazy
// error resolvers, validateJSON() over simdjson and the scanner, abortEarly.
// They live here rather than in Validator#_ensureCompiled so that
// ata-validator/lite, which never has a verdict function, does not carry
// them. Called with the validator as `this` and the locals of
// _ensureCompiled in `ctx`; the error and combined functions are built later
// by the builders, so they are read through ctx.err() and ctx.combined().

// A rejection the native walker decided from the text alone. The errors come
// from parsing and validating in JS, on first read, so a caller that reads
// only `.valid` never parses the document.
class TextRejection {
  constructor (text, validateText) {
    this.valid = false;
    this._text = text;
    this._validateText = validateText;
    this._errors = null;
  }

  get errors () {
    if (this._errors === null) this._errors = core._internals._mustReject(this._validateText(this._text)).errors;
    return this._errors;
  }
}

// Errors built enriched where they fail by the rich combined function (see
// makeRich in lib/enrich-site.js), for a validator whose errors are being read
// with richErrors on. Presenting them is the ordering and the `related` links
// presentErrors applies after enriching. Where the rich function does not
// reject (the data changed under the read), the plain fallback is presented
// the usual way.
const { needsOrdering: _needsOrdering, sortErrorsBySchemaOrder: _sortErrors, attachRelated: _attachRelated } = require('./lib/rejections');
let _enrichFnIdx = null;
function _enrichOne(e, data) {
  if (_enrichFnIdx === null) _enrichFnIdx = require('./lib/enrich-error').enrich;
  return _enrichFnIdx(e, data !== undefined ? { data } : null);
}
function richBuilder(combRich, root, presentFallback, fallback, plain, cleanPlain) {
  if (plain) {
    // The runtime-shape combined function writes each error fresh and in the
    // plain shape: no shared literal, no ordinal, no code or docUrl, no
    // collapsed branches (lib/js-compiler.js, compileToJSCombined with
    // runtimeShape). So without enrichment the list is the caller's as it is,
    // once in schema order. Checking each error for those fields instead cost
    // a megamorphic load per field per error across many schemas.
    // tests/test_error_read_paths.js holds every error handed out to being
    // the caller's own.
    return (data) => {
      const r = combRich(data);
      if (r.valid || !r.errors || !r.errors.length) return presentFallback(fallback, data);
      if (cleanPlain) return _needsOrdering(r.errors) ? _sortErrors(root, r.errors) : r.errors;
      return presentFallback(r.errors, data);
    };
  }
  return (data) => {
    const r = combRich(data);
    if (r.valid || !r.errors || !r.errors.length) return presentFallback(fallback, data);
    const out = _needsOrdering(r.errors) ? _sortErrors(root, r.errors) : r.errors;
    // A collapsed oneOf or anyOf comes out plain (no docUrl) and is enriched
    // here, its branch errors with it, as presentErrors would.
    for (let i = 0; i < out.length; i++) {
      if (out[i].docUrl === undefined) out[i] = _enrichOne(out[i], data);
    }
    if (out.length > 1) _attachRelated(out);
    return out;
  };
}

// The rejection validate() returns once it is the one-pass combined function
// (resultShape in compileToJSCombined): the errors are already built, plain,
// fresh and in schema order. Serialises as the lazy rejection does.
class EagerRejection {
  constructor(errors) {
    this.valid = false;
    this.errors = errors;
  }
  toJSON() {
    return { valid: false, errors: this.errors };
  }
  _ataRaw() {
    return this.errors;
  }
}

function installCodegenPaths (ctx) {
  const { ABORT_EARLY_RESULT, HYBRID_TIER_CALLS, SIMDJSON_THRESHOLD, VALID_RESULT, _bindVerdict, _jsonSyntaxRejection, _mustReject, _verboseWrap, getNative, isV1Dialect, resolveSchemaByPath } = core._internals;
  const { jsFn, _isCodegen, preprocess, fusedRemove, options, schemaObj, useSimdjsonForLarge, _buildCombined, _buildErr } = ctx;
  // errFn: the generated error function when it is safe, else the
  // interpreted engine, on every platform alike.
  const hasDynRef = this._schemaStr.includes('"$dynamicRef"') || this._schemaStr.includes('"$dynamicAnchor"')
  // The interpreted engine re-validates failing data to produce full errors. If it disagrees with the codegen verdict
  // (it should not), a generic error keeps the result consistent.
  let _interp = null;
  const jsOnlyFallback = (d) => {
    if (jsFn(d)) return { valid: true, data: d, errors: [] };
    if (!_interp) {
      const { createInterpreter } = require('./lib/interpreter');
      _interp = createInterpreter(schemaObj, {
        schemaMap: this._schemaMap.size > 0 ? this._schemaMap : null,
        formats: this._userFormats,
        v1: isV1Dialect(schemaObj),
        keywords: this._keywords,
      });
    }
    const r = _interp.validate(d);
    if (!r.valid) return r;
    return {
      valid: false,
      errors: [{
        keyword: 'validation',
        instancePath: '',
        schemaPath: '',
        params: {},
        message: 'schema validation failed'
      }]
    };
  };
  // The error generator declines unevaluated*; the interpreted engine
  // reports those schemas correctly, so failing data is re-validated
  // there. This used to be a placeholder error with no keyword and no
  // path, which hid whatever had actually failed.
  // Resolved on the first rejection rather than at compile time, because
  // building the generator behind it is two thirds of what a first call
  // costs and a caller that never reads an error never needs it. The probe
  // moves here with it: it calls the generated function, so it cannot run
  // before the function exists.
  let _errOnlyImpl = null;
  const errOnly = (d) => {
    if (_errOnlyImpl === null) {
      _buildErr();
      let safe = null;
      if (ctx.err()) {
        try {
          ctx.err()({}, true);
          safe = (x) => ctx.err()(x, true);
        } catch {}
      }
      // Where the generator declines, the interpreted engine answers. It used
      // to be the native addon when one was installed, whose errors carry
      // other wording and no schemaPath, so the same validator reported
      // differently depending on what the platform had installed.
      _errOnlyImpl = safe || jsOnlyFallback;
    }
    return _mustReject(_errOnlyImpl(d));
  };

  // Best path: combined validator (single pass, validates + collects errors)
  // Valid data: returns VALID_RESULT, no allocation
  // Invalid data: collects errors in one pass (no double validation)
  // Fallback: hybridFn or jsFn + errFn for schemas combined can't handle
  // Test combined at compile time -- some schemas produce broken combined code
  // Test combined at compile time -- some schemas (e.g. if/then/else)
  // produce broken combined code that crashes on certain inputs.
  // We probe with diverse data; if any throws, fall back to hybrid.
  let _combinedProbed = false;
  let _safeCombined = null;
  const combinedIfSafe = () => {
    if (_combinedProbed) return _safeCombined;
    _combinedProbed = true;
    _buildCombined();
    if (ctx.combined()) {
      try {
        const probe = {};
        // Populate probe with one key per known property to trigger nested paths
        if (schemaObj && schemaObj.properties) {
          for (const k of Object.keys(schemaObj.properties)) probe[k] = "";
        }
        if (schemaObj && schemaObj.if && schemaObj.if.properties) {
          for (const k of Object.keys(schemaObj.if.properties)) probe[k] = "";
        }
        ctx.combined()(probe);
        ctx.combined()({});
        ctx.combined()(null);
        ctx.combined()(0);
        _safeCombined = ctx.combined();
      } catch {}
    }
    return _safeCombined;
  };

  // The error function on its own, probed the way errOnly probes it, or null.
  const errFnIfSafe = () => {
    _buildErr();
    const efn = ctx.err();
    if (!efn) return null;
    try { efn({}, true); } catch { return null; }
    return (x) => efn(x, true);
  };

  // The rich combined function, built and probed the way the plain one is,
  // and only where the plain one passed its probe.
  let _richProbed = false;
  let _safeRich = null;
  const richIfSafe = () => {
    if (_richProbed) return _safeRich;
    _richProbed = true;
    if (!combinedIfSafe() || !ctx.buildRich) return null;
    const fn = ctx.buildRich();
    if (fn) {
      try {
        const probe = {};
        if (schemaObj && schemaObj.properties) for (const k of Object.keys(schemaObj.properties)) probe[k] = "";
        if (schemaObj && schemaObj.if && schemaObj.if.properties) for (const k of Object.keys(schemaObj.if.properties)) probe[k] = "";
        fn(probe); fn({}); fn(null); fn(0);
        _safeRich = fn;
      } catch {}
    }
    return _safeRich;
  };

  // What the hybrid path hands to its error slot: the combined function
  // when it is usable, since it validates and collects in one pass, and
  // the error generator otherwise. Same order the eager code chose, just
  // chosen on the first rejection.
  let _errPreferredImpl = null;
  const errPreferCombined = (d) => {
    if (_errPreferredImpl === null) _errPreferredImpl = combinedIfSafe() || errOnly;
    return _mustReject(_errPreferredImpl(d));
  };

  // The boolean engine is the verdict authority for these paths; the
  // final lazy wrapper uses it to skip error construction entirely.
  if (!hasDynRef || _isCodegen) this._fastVerdict = preprocess ? null : jsFn;

  if (options.abortEarly && jsFn && !hasDynRef) {
    // abortEarly: do NOT enrich. Skip position lookups, suggestions, source maps.
    // This is the perf-critical path for edge gateways. The richErrors wrap
    // below recognises the ATA9000 stub keyword and passes the frozen result
    // through unchanged, so a single shared object is returned per failure.
    const _fn = jsFn;
    this.validate = preprocess
      ? (data) => { preprocess(data); return _fn(data) ? VALID_RESULT : ABORT_EARLY_RESULT; }
      : (data) => (_fn(data) ? VALID_RESULT : ABORT_EARLY_RESULT);
  } else if (hasDynRef && !(_isCodegen && jsFn)) {
    // $dynamicRef without codegen: the interpreted engine. A schema the
    // generators unroll by scope (expandDynamicScopes) takes the assembly
    // below like any other, with the one-pass function once its errors are
    // read; a direct verdict-then-error-function path kept for these from
    // before the unrolling cost the suite's dynamicRef groups 5229 ns a pass
    // where the assembly answers in 3136. (A first attempt dropped them into
    // this interpreter branch instead and measured slower; the condition
    // here is what makes them fall through.) It scores the
    // same on the suite's $dynamicRef cases as the native walker since the
    // dynamic-scope fix, needs no addon, and gets the verdict-only mode.
    if (!_interp) {
      const { createInterpreter } = require('./lib/interpreter');
      _interp = createInterpreter(schemaObj, {
        schemaMap: this._schemaMap.size > 0 ? this._schemaMap : null,
        formats: this._userFormats,
        v1: isV1Dialect(schemaObj),
        keywords: this._keywords,
      });
    }
    const interp = _interp;
    this._fastVerdict = preprocess ? null : (d) => interp.isValid(d);
    this.validate = preprocess
      ? (data) => { preprocess(data); return interp.validate(data); }
      : (data) => interp.validate(data);
  } else if (jsFn && jsFn._hybridFactory) {
    // Zero-wrapper: hybridFactory bakes VALID_RESULT + errFn into a single function
    // No arrow function wrapper, no ternary, one function call
    // The factory bakes the error function in as an argument and never
    // calls it for a document that passes, so a resolver here costs the
    // accepted path nothing and keeps the compile off the first call.
    // Until the first rejection this is the hybrid: the verdict function,
    // with the error resolver baked in and never called for a document that
    // passes. That keeps the combined function's compile off the first call,
    // which is two thirds of what a first call costs.
    //
    // From the first rejection on, the combined function answers directly.
    // It decides and collects in one pass, so the verdict pass in front of it
    // was validating the document a second time: 134.1 microseconds against
    // its 45.3 on a 1000-user array. Swapping rather than starting there keeps
    // the lazy compile, and swapping at all is only free because the combined
    // function now costs what the verdict function costs on accepted
    // documents (1.02x on that array, 0.99x on a small body) since
    // additionalProperties stopped materialising its key array. The
    // indirection this needs measured inside the noise at both sizes.
    let impl = null;
    const onReject = (data) => {
      const combined = combinedIfSafe();
      if (combined) { impl = combined; return _mustReject(combined(data)); }
      return errOnly(data);
    };
    // Tiered: the first calls go through the verdict function and the
    // resolver, and the hybrid is compiled once the validator is in use.
    // Compiling it up front was a second parse of the whole schema on
    // every validator, most of which answer a handful of requests or only
    // verdicts. A refused compile stays on the first tier.
    let warm = 0;
    const first = (data) => {
      if (++warm >= HYBRID_TIER_CALLS && impl === first) {
        impl = jsFn._hybridFactory(VALID_RESULT, onReject) || ((d) => (jsFn(d) ? VALID_RESULT : onReject(d)));
        return impl(data);
      }
      return jsFn(data) ? VALID_RESULT : onReject(data);
    };
    impl = first;
    const run = (data) => impl(data);
    this.validate = preprocess
      ? (data) => { preprocess(data); return run(data); }
      : run;
    // What validate() returns for a document already known to fail, without
    // deciding again: the lazy layer in lib/validator-core.js has its verdict
    // and used to call validate() to get the errors, which ran the verdict a
    // second time and built a second rejection around it.
    if (!preprocess) ctx.rejectBase = onReject;
    // The rich combined function, for a validator whose errors are being read
    // with richErrors on. See _ensureCompiled.
    if (!preprocess) {
      ctx.richBuilder = richBuilder;
      // The plain combined function stands in where no rich one is built
      // (richErrors off, or a schema source to frame errors from): its errors
      // are presented, and enriched when asked, the usual way, without the
      // rejection layers between.
      // Where the plain combined function declines (oneOf, anyOf, an
      // additionalProperties schema), the error function stands in, called
      // directly rather than through the rejection layers. Its errors can be
      // collapsed branches that still need presenting; only the combined
      // function's are already in their final plain shape (isCleanShape).
      ctx.oneShotRich = ctx.buildRich ? richIfSafe : () => combinedIfSafe() || errFnIfSafe();
      ctx.oneShotPlain = !ctx.buildRich;
      ctx.isCleanShape = (fn) => fn !== null && fn === _safeCombined;
      ctx.isCombined = (fn) => fn !== null && fn === _safeCombined;
      // validate() as the combined function in its result shape: built and
      // probed here, null when it declines or throws on the probe.
      ctx.onePassOf = (empty, fallback) => {
        // A collapsed branch error is built in its final plain shape here
        // (no ordering key in the runtime shape); its branch errors are put
        // in order with the rest.
        const sort = (errs) => (_needsOrdering(errs) ? _sortErrors(schemaObj, errs) : errs);
        try {
          const fn = jsCompiler.compileToJSCombined(schemaObj, VALID_RESULT, this._schemaMap.size > 0 ? this._schemaMap : null, this._userFormats, { runtimeShape: true, resultShape: { Rejection: EagerRejection, empty, sort, fallback, verdict: jsFn } });
          if (!fn) return null;
          fn({}); fn(null); fn(0);
          return fn;
        } catch { return null; }
      };
    }
  } else {
    // No hybrid factory, so the assembly needs the function itself rather
    // than a reference it can call later: build it now.
    const safeCombinedFn = combinedIfSafe();
    if (safeCombinedFn) {
      this.validate = preprocess
        ? (data) => { preprocess(data); return safeCombinedFn(data); }
        : safeCombinedFn;
      if (!preprocess) ctx.rejectBase = (data) => _mustReject(safeCombinedFn(data));
    } else {
      this.validate = preprocess
        ? (data) => {
            preprocess(data);
            return jsFn(data) ? VALID_RESULT : errOnly(data);
          }
        : (data) => (jsFn(data) ? VALID_RESULT : errOnly(data));
      if (!preprocess) ctx.rejectBase = errOnly;
    }
  }
  // Verbose mode: populate parentSchema, schema and data on each error, the
  // three fields the default error shape carries under the same option.
  // `data` is the value the error points at; without it a caller has to
  // walk the document by the instance path itself, which is what one
  // migration ended up writing by hand. Errors may be frozen, so clone
  // them with the extra fields.
  if (this._verbose) {
    // The verbose fields are added here, so a path around this layer would
    // miss them.
    ctx.rejectBase = null;
    ctx.oneShotRich = null;
    this.validate = _verboseWrap(this.validate, this._schemaObj);
  }
  // The verdict methods answer validate()'s question without building the
  // error list, so they run the same preprocess pass. Skipping it made the
  // two disagree on input that coercion or a default would have fixed.
  _bindVerdict(this, fusedRemove
    ? (data) => fusedRemove(data) || (preprocess(data), jsFn(data))
    : preprocess
      ? (data) => { preprocess(data); return jsFn(data) }
      : jsFn);
  // Same preference as the object path: the combined function first, since
  // it validates and collects in one pass, and the error generator behind
  // it. `errPreferCombined` is that order, resolved on the first rejection
  // instead of at compile time.
  // Tiered the same way as validate() above.
  let jsonHybrid = null;
  let jsonWarm = 0;
  const jsonValidateTiered = (obj) => {
    if (jsonHybrid !== null) return jsonHybrid(obj);
    if (++jsonWarm >= HYBRID_TIER_CALLS) {
      jsonHybrid = (jsFn._hybridFactory && jsFn._hybridFactory(VALID_RESULT, errPreferCombined))
        || ((o) => (jsFn(o) ? VALID_RESULT : errPreferCombined(o)));
      return jsonHybrid(obj);
    }
    return jsFn(obj) ? VALID_RESULT : errPreferCombined(obj);
  };
  // Parsed text takes the same preprocess pass as a parsed object, so
  // validate(obj) and validateJSON(text) answer the same for the same
  // document. Without it, coercion, removal and defaults applied on one
  // path and not the other.
  // abortEarly holds for the text path too: the stub, not errors, as the
  // scanner below and the interpreted engine already answered.
  const jsonValidateInner = options.abortEarly
    ? (obj) => (jsFn(obj) ? VALID_RESULT : ABORT_EARLY_RESULT)
    : jsonValidateTiered;
  const jsonValidateFn = preprocess
    ? (obj) => { preprocess(obj); return jsonValidateInner(obj) }
    : jsonValidateInner;
  // A document at or above the simdjson threshold is answered by the native
  // walker without being parsed, except for the shapes lib/buffer-gate.js
  // lists, where the walker disagrees with validate(); those schemas never
  // ask it. A rejection's errors come from the same path as a small
  // document's, on first read. The addon's own validateJSON used to supply
  // them and accepted documents validate() rejects, 231 of the official
  // suite's cases once padded past the threshold.
  let nativeText; // undefined until the first large document
  const nativeVerdict = (jsonStr) => {
    if (nativeText === undefined) {
      nativeText = !!getNative() && !require('./lib/buffer-gate.js').bufferNeedsSlowPath(schemaObj, this._schemaMap, this._keywords);
      if (nativeText) {
        this._ensureNative();
        if (!(this._fastSlot >= 0)) nativeText = false;
      }
    }
    return nativeText ? getNative().rawFastValidate(this._fastSlot, Buffer.from(jsonStr)) : undefined;
  };
  // The parsed document is left on `_lastParsed` for the rich layer around
  // validateJSON, which hands it to the rejection so reading the errors does
  // not parse the text again (see LazyJsonRejection).
  const validateText = (jsonStr) => {
    let obj;
    try {
      obj = JSON.parse(jsonStr);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      return _jsonSyntaxRejection(e);
    }
    this._lastParsed = obj;
    return jsonValidateFn(obj);
  };
  this.validateJSON = useSimdjsonForLarge && !preprocess
    ? (jsonStr) => {
        // `_skipNativeFast` is set by the scanner short-circuit below when it
        // has already decided the document is invalid. The encode and the
        // native call would run only to return false.
        if (jsonStr.length >= SIMDJSON_THRESHOLD && this._skipNativeFast !== true) {
          const ok = nativeVerdict(jsonStr);
          if (ok === true) return VALID_RESULT;
          if (ok === false) return options.abortEarly ? ABORT_EARLY_RESULT : new TextRejection(jsonStr, validateText);
        }
        return validateText(jsonStr);
      }
    : validateText;
  // The addon validates the bytes as they are, which is the wrong answer
  // when the schema asks for coercion, removal or defaults: those change
  // what counts as valid. With a preprocess pass configured the text is
  // parsed and run through the same path validate() takes.
  const verdictFromText = (jsonStr) => {
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      return false;
    }
    if (preprocess) preprocess(parsed);
    return jsFn(parsed);
  };
  this.isValidJSON = useSimdjsonForLarge && !preprocess
    ? (jsonStr) => {
        if (jsonStr.length >= SIMDJSON_THRESHOLD) {
          const ok = nativeVerdict(jsonStr);
          if (ok !== undefined) return ok;
        }
        return verdictFromText(jsonStr);
      }
    : verdictFromText;

  // A schema-directed scanner answers the verdict from the JSON text
  // without building the document. Parsing is around three quarters of the
  // cost of a real request, and a caller that only wants yes or no should
  // not pay it; a rejection can also stop at the byte that caused it
  // instead of parsing the rest of a document that is already refused.
  //
  // It is wired only where the verdict IS the answer. On a path that has
  // to produce errors, scanning an invalid document is work thrown away,
  // so those keep parsing. `abortEarly` has no errors to produce, so it
  // counts as a verdict path.
  //
  // Not wired when a preprocess pass is configured: coercion, removal and
  // defaults rewrite the document before it is judged, and the scanner
  // reads what arrived. The compiler declines any schema it cannot answer
  // and a compiled scanner returns BAIL for a document shape it cannot
  // answer, and then the parse path below takes over unchanged.
};

// The verdict function alone, for isValidObject() before a full compile: the
// error and combined generators are left for the first rejection.
installCodegenPaths.compileVerdict = function compileVerdict () {
  const { compileCacheKey, _compileCache, _compileCacheSet, _bindVerdict, _rememberInstance } = core._internals;
  if (!this._schemaStr) this._schemaStr = JSON.stringify(this._schemaObj);
  const sm = this._schemaMap.size > 0 ? this._schemaMap : null;
  const mapKey = compileCacheKey(this._schemaStr, this._schemaMap);
  // Custom formats are JS functions: skip the shared cache so different
  // validators with the same schema string but different formats don't collide.
  const cached = (this._userFormats || this._usesKeywords) ? null : _compileCache.get(mapKey);
  if (cached && cached.jsFn) {
    this._jsFn = cached.jsFn;
    _bindVerdict(this, cached.jsFn);
    _rememberInstance(this);
    return;
  }
  const uf = this._userFormats;
  // Custom keywords: see the note on the same call in lib/validator-core.js.
  const _cg = compileToJSCodegen(this._schemaObj, sm, uf, this._keywords ? { keywords: this._keywords } : undefined);
  const jsFn = _cg || (this._usesKeywords ? null : compileToJS(this._schemaObj, null, sm));
  this._jsFn = jsFn;
  if (jsFn) {
    _bindVerdict(this, jsFn);
    _rememberInstance(this);
    // A partial entry: the verdict function is real, the other two are not
    // built yet rather than declined. `undefined` is the not-built marker
    // the full compile's _buildErr/_buildCombined look for; `null` would read as
    // "the compiler declined" and cost the schema its error function, which
    // is the bug this cache had once already. `isCodegen` rides along so a
    // validator that later reuses this entry reports the same engine it
    // would have compiled to.
    if (!uf && !this._keywords) {
      if (!cached) _compileCacheSet(mapKey, { jsFn, combined: undefined, errFn: undefined, isCodegen: !!_cg, full: false });
      else cached.jsFn = jsFn;
    }
  }
};

// validateJSON and isValidJSON over a schema-directed scanner, which answers
// from the JSON text without building the document.
installCodegenPaths.installScanner = function installScanner (schemaObj, options) {
  const { ABORT_EARLY_RESULT, VALID_RESULT, _bindEntry, _jsonSyntaxRejection } = core._internals;
  let textRejects = 0;
  const self = this;
  // Generating a scanner costs about 20 microseconds, measured, and it
  // saves from around 85 nanoseconds on a small accepted document to
  // several microseconds on a rejected one. Building it on the first
  // call would therefore be a straight loss for a caller that checks one
  // document and exits, so it is built once a caller has asked often
  // enough that it is plainly doing this in a loop. A server passes the
  // line during warm-up and never sees it.
  const SCAN_AFTER = 64;
  let calls = 0;
  // undefined: not built. null: this schema has no scanner. Passing true
  // builds it now, which is how the differential test reaches it.
  this._ensureScanner = (now) => {
    if (self._scanner === undefined) {
      // The scanner reads the schema's own keywords from the text and knows
      // nothing of custom ones, so it would accept what they reject.
      if (self._usesKeywords) { self._scanner = null; return null; }
      if (!now && ++calls < SCAN_AFTER) return undefined;
      const built = require('./lib/scan-compiler').compileScanner(schemaObj, { userFormats: self._userFormats });
      self._scanner = built ? built.scan : null;
    }
    return self._scanner;
  };
  const byParsing = this.isValidJSON;
  // The verdict is a pure function of the text, and the caller a
  // gateway or a drift monitor keeps asking about is usually the same
  // text: a config file re-read on a timer, a heartbeat body. One
  // remembered (text, verdict) pair answers that case with a native
  // string compare, which is a memcmp, instead of a scan. Withheld when
  // user formats or custom keywords are present, since those are user
  // functions and nothing guarantees they are pure.
  const memoizable = !self._userFormats && !self._usesKeywords;
  let _memoText = null;
  let _memoVerdict = false;
  this.isValidJSON = (jsonStr) => {
    const scan = self._ensureScanner();
    if (scan === undefined) return byParsing(jsonStr);
    if (scan === null) { _bindEntry(self, 'isValidJSON', byParsing); return byParsing(jsonStr); }
    _bindEntry(self, 'isValidJSON', memoizable
      ? (text) => {
          if (typeof text !== 'string') return byParsing(text);
          if (text === _memoText) return _memoVerdict;
          const r = scan(text);
          const verdict = r === -1 ? byParsing(text) : r === 1;
          _memoText = text;
          _memoVerdict = verdict;
          return verdict;
        }
      : (text) => {
          if (typeof text !== 'string') return byParsing(text);
          const r = scan(text);
          if (r === -1) return byParsing(text);
          return r === 1;
        });
    return self.isValidJSON(jsonStr);
  };
  // validateJSON gets the same short-circuit isValidJSON has. The verdict is
  // a property of the text, and the scanner reads the text once and
  // allocates nothing; above the simdjson threshold the path underneath
  // encoded the whole document to a Buffer and called the native validator
  // instead, which measured 340 microseconds against the scanner's 191 on a
  // 149 KB config, the same against the published addon as against a local
  // build.
  //
  // An accepted document stops at the scanner. A rejected one still has to
  // produce errors, so it goes on to the path below, which is the
  // rich-errors wrapper and everything under it; the flag only tells that
  // path to skip an encode and a native call that would return false. Doing
  // it the other way, returning errors from the inner function directly,
  // would hand back errors that never passed through enrichment.
  {
    const validateByParsing = this.validateJSON;
    const abortEarly = !!options.abortEarly;
      // A validator whose errors are being read answers validate() with
      // the one-pass function (the switch in lib/validator-core.js), and
      // without richErrors nothing it hands out depends on the text. A
      // rejected text is then parsed and given to that function directly,
      // instead of to the layers below, which parsed it, decided again and
      // wrapped a rejection whose errors are built on first read: a 1.7 KB
      // rejected body took 9.2 microseconds through those layers.
      // The scanner itself is the other half of that cost on a rejected
      // text (2.7 of the 9.2 on that body) and all the saving on an accepted
      // one, which it answers without parsing. So the scan runs while the
      // texts a validator sees are mostly accepted, and is skipped while
      // they are mostly rejected: `bias` counts rejections against
      // acceptances, from either path, and the mode follows its sign with
      // some room, so a mixed stream does not flip on every document.
      const onePassText = (text) => {
        let op = self._onePass;
        // A validator rejecting text only never reads through the object
        // path's switch; the second rejected text makes it.
        if (op === undefined && self._tierOnePass !== undefined && ++textRejects >= 2) { op = self._tierOnePass() || undefined; if (op === undefined) self._tierOnePass = undefined; }
        if (op === undefined) return undefined;
        let obj;
        try { obj = JSON.parse(text); } catch (e) { if (!(e instanceof SyntaxError)) throw e; return _jsonSyntaxRejection(e); }
        return op(obj);
      };
    this.validateJSON = (jsonStr) => {
      const scan = self._ensureScanner();
      if (scan === undefined) return validateByParsing(jsonStr);
      if (scan === null) {
        // No scanner for this schema: the one-pass function still answers a
        // lean validator's texts directly once it is installed.
        _bindEntry(self, 'validateJSON', self._richErrors ? validateByParsing : (text) => {
          if (typeof text === 'string') { const o = onePassText(text); if (o !== undefined) return o; }
          return validateByParsing(text);
        });
        return self.validateJSON(jsonStr);
      }
      let bias = 0;
      _bindEntry(self, 'validateJSON', (text) => {
        if (typeof text === 'string') {
          if (bias > 16 && !self._richErrors && self._onePass !== undefined) {
            const r = onePassText(text);
            if (r !== undefined) { if (r.valid) { if (--bias < -32) bias = -32; } else if (bias < 64) bias++; return r; }
          }
          const r = scan(text);
          if (r === 1) { if (--bias < -32) bias = -32; return VALID_RESULT; }
          if (r === 0) {
            if (bias < 64) bias++;
            if (abortEarly) return ABORT_EARLY_RESULT;
            if (!self._richErrors) {
              const o = onePassText(text);
              if (o !== undefined) return o;
            }
            self._skipNativeFast = true;
            try {
              return validateByParsing(text);
            } finally {
              self._skipNativeFast = false;
            }
          }
        }
        // The scanner could not decide (a shape it does not read): the
        // one-pass function answers a lean validator here too.
        if (!self._richErrors && typeof text === 'string') { const o = onePassText(text); if (o !== undefined) return o; }
        return validateByParsing(text);
      });
      return self.validateJSON(jsonStr);
    };
  }
};

// The defaults, coercion and removal pass as generated source, which runs
// about twelve times faster than the closure mutators in validator-core.js.
// ata-validator/lite takes the closures.
// Emit the in-place strip for one schema node and everything under its
// `properties`. Scope matches collectRemovals(): object properties only, so
// the two paths keep the same answer.
// Each level's code, its own removal loop and its children's, sits inside the
// guard for that level. A child used to be guarded only on itself, so its
// access expression read through a parent that could be absent or null:
// `{ c: { properties: { d: { additionalProperties: false } } } }` threw a
// TypeError from validate({}) whenever the optional `c` was missing.
function emitRemovals(node, access, lines, depth, seen) {
  if (!node || typeof node !== 'object' || !node.properties) return;
  if (seen.has(node)) return;
  seen.add(node);
  const keys = Object.keys(node.properties);
  const body = [];
  // With no declared property every key is additional, as the interpreted
  // engine's remover has it; this pass used to skip such a node entirely.
  if (node.additionalProperties === false) {
    const kv = '_k' + depth;
    const checks = keys.map((k) => `${kv}!==${JSON.stringify(k)}`).join('&&');
    body.push(keys.length > 0
      ? `for(var ${kv} in ${access})if(${checks})delete ${access}[${kv}]`
      : `for(var ${kv} in ${access})delete ${access}[${kv}]`);
  }
  for (const key of keys) {
    const prop = node.properties[key];
    if (prop && typeof prop === 'object' && prop.properties) {
      emitRemovals(prop, `${access}[${JSON.stringify(key)}]`, body, depth + 1, seen);
    }
  }
  seen.delete(node);
  if (body.length === 0) return;
  if (depth === 0) lines.push(...body);
  else lines.push(`if(${access}!==null&&typeof ${access}==='object'&&!Array.isArray(${access})){${body.join('\n')}}`);
}

// The coercions the closure pass applies, emitted. Values: `number` and
// `integer` from numeric strings and booleans, `string` from numbers and
// booleans, `boolean` from "true"/"1" and "false"/"0".
const COERCIBLE_TYPES = new Set(['number', 'integer', 'string', 'boolean']);
function scalarCoercion(a, t) {
  if (t === 'integer') return [`if(typeof ${a}==='string'){var _n=Number(${a});if(${a}!==''&&Number.isInteger(_n))${a}=_n}`, `if(typeof ${a}==='boolean')${a}=${a}?1:0`];
  if (t === 'number') return [`if(typeof ${a}==='string'){var _n=Number(${a});if(${a}!==''&&!isNaN(_n))${a}=_n}`, `if(typeof ${a}==='boolean')${a}=${a}?1:0`];
  if (t === 'string') return [`if(typeof ${a}==='number'||typeof ${a}==='boolean')${a}=String(${a})`];
  return [`if(${a}==='true'||${a}==='1')${a}=true`, `if(${a}==='false'||${a}==='0')${a}=false`];
}
function isScalarCoercible(node) {
  return !!(node && typeof node === 'object' && typeof node.type === 'string' && COERCIBLE_TYPES.has(node.type));
}
// Whether anything below `node` is coerced, as buildNodeCoercer decides it.
// Remembered per node for the build, since every enclosing node asks again.
function coercesInside(node, seen, memo) {
  if (!node || typeof node !== 'object' || seen.has(node)) return false;
  if (memo && memo.has(node)) return memo.get(node);
  seen.add(node);
  let found = false;
  if (node.properties) {
    for (const [key, prop] of Object.entries(node.properties)) {
      if (key === '__proto__' || !prop || typeof prop !== 'object') continue;
      if (isScalarCoercible(prop) || coercesInside(prop, seen, memo)) { found = true; break; }
    }
  }
  if (!found && node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
    found = isScalarCoercible(node.items) || coercesInside(node.items, seen, memo);
  }
  seen.delete(node);
  if (memo) memo.set(node, found);
  return found;
}
function emitCoercions(node, ov, lines, st, depth) {
  if (st.seen.has(node)) { st.cycle = true; return; }
  st.seen.add(node);
  if (node.properties) {
    for (const [key, prop] of Object.entries(node.properties)) {
      // Coercion writes with plain assignment, which for a key named
      // __proto__ rewrites the prototype instead. The raw value still goes
      // through validation, so skipping is a refusal to coerce, not a hole.
      if (key === '__proto__' || !prop || typeof prop !== 'object') continue;
      const k = JSON.stringify(key);
      const a = `${ov}[${k}]`;
      if (isScalarCoercible(prop)) lines.push(...scalarCoercion(a, prop.type));
      // Wrapping a lone value in an array is a top-level rule only, as it was.
      else if (depth === 0 && prop.type === 'array' && st.arrayMode) lines.push(`if(${k} in ${ov}&&${a}!==undefined&&!Array.isArray(${a}))${a}=[${a}]`);
      // A leaf, the common case, has nothing below it to coerce.
      if ((prop.properties || prop.items) && coercesInside(prop, new Set(), st.memo)) {
        const n = '_c' + st.n++;
        lines.push(`{const ${n}=${a};if(typeof ${n}==='object'&&${n}!==null){`);
        emitCoercions(prop, n, lines, st, depth + 1);
        lines.push('}}');
      }
    }
  }
  const it = node.items;
  if (it && typeof it === 'object' && !Array.isArray(it) && (isScalarCoercible(it) || coercesInside(it, new Set(), st.memo))) {
    const i = '_i' + st.n++;
    lines.push(`if(Array.isArray(${ov}))for(let ${i}=0;${i}<${ov}.length;${i}++){`);
    if (isScalarCoercible(it)) lines.push(...scalarCoercion(`${ov}[${i}]`, it.type));
    if (coercesInside(it, new Set(), st.memo)) {
      const n = '_c' + st.n++;
      lines.push(`{const ${n}=${ov}[${i}];if(typeof ${n}==='object'&&${n}!==null){`);
      emitCoercions(it, n, lines, st, depth + 1);
      lines.push('}}');
    }
    lines.push('}');
  }
  st.seen.delete(node);
}
function hasDefaultsInside(node, seen) {
  if (!node || typeof node !== 'object' || !node.properties || seen.has(node)) return false;
  seen.add(node);
  let found = false;
  for (const prop of Object.values(node.properties)) {
    if (prop && typeof prop === 'object' && (prop.default !== undefined || hasDefaultsInside(prop, seen))) { found = true; break; }
  }
  seen.delete(node);
  return found;
}
function emitDefaults(node, ov, lines, st) {
  if (st.seen.has(node)) { st.cycle = true; return; }
  st.seen.add(node);
  for (const [key, prop] of Object.entries(node.properties || {})) {
    if (!prop || typeof prop !== 'object') continue;
    const k = JSON.stringify(key);
    if (prop.default !== undefined) {
      const def = JSON.stringify(prop.default);
      // Assignment to a key named __proto__ hits the prototype setter
      // instead of creating a property; defineProperty writes an own key.
      lines.push(key === '__proto__'
        ? `if(!Object.hasOwn(${ov},${k}))Object.defineProperty(${ov},${k},{value:${def},writable:true,enumerable:true,configurable:true})`
        : `if(!Object.hasOwn(${ov},${k}))${ov}[${k}]=${def}`);
    }
    // Into an own property that holds an object, arrays included, as the
    // closure pass walks it.
    if (prop.properties && hasDefaultsInside(prop, new Set())) {
      const n = '_d' + st.n++;
      lines.push(`if(Object.hasOwn(${ov},${k})){const ${n}=${ov}[${k}];if(typeof ${n}==='object'&&${n}!==null){`);
      emitDefaults(prop, n, lines, st);
      lines.push('}}');
    }
  }
  st.seen.delete(node);
}

// Generate a fast preprocess function via codegen instead of closure arrays
function buildPreprocessCodegen(schema, options) {
  if (typeof schema !== 'object' || schema === null || !schema.properties) return null;
  const lines = [];

  // removeAdditional: strip unknown keys at every level the schema describes,
  // not just the top one. The closure path below (collectRemovals) always
  // recursed; this one did not, so the same schema and the same document got
  // opposite verdicts depending on whether the runtime allowed code
  // generation, and the codegen answer was the one that disagreed with both
  // the interpreter and the default validator this aims to match.
  if (options.removeAdditional) {
    emitRemovals(schema, 'd', lines, 0, new Set());
  }

  // Coercion and defaults reach every depth the closure passes in
  // validator-core.js reach, with the same rules in the same order, so the
  // interpreted engine, which uses those passes, gives the same answer. Both
  // used to stop at the top-level properties. A schema object that contains
  // itself declines here, and the closure passes, which carry a guard for it,
  // take the schema.
  const st = { n: 0, seen: new Set(), cycle: false, arrayMode: options.coerceTypes === 'array', memo: new Map() };
  if (options.coerceTypes) emitCoercions(schema, 'd', lines, st, 0);
  // hasDefaultsInside answers without emitting; most schemas have no default,
  // and the emitting walk allocates for every property it visits.
  if (options.useDefaults !== false && hasDefaultsInside(schema, new Set())) emitDefaults(schema, 'd', lines, st);
  if (st.cycle) return null;

  if (lines.length === 0) return null;
  // Data may legitimately be null or a non-object (e.g. a `['object','null']`
  // schema), so the per-property mutations must not run on it.
  lines.unshift(`if(d===null||typeof d!=='object')return`);
  // The pass depends on property names, types, defaults and which objects
  // are closed, not on the constraints the verdict checks, so routes that
  // take the same shape with different limits (a page/limit querystring, an
  // id param) emit the same source. Compiling it is most of what building the
  // pass costs, so the function is kept by its source and compiled once. It
  // holds no state: it rewrites the object it is given and nothing else.
  const src = lines.join('\n');
  let fn = _preprocessBySource.get(src);
  if (fn === undefined) {
    try {
      fn = compileFunction('d', src);
    } catch {
      fn = null;
    }
    if (_preprocessBySource.size >= PREPROCESS_SOURCE_LIMIT) _preprocessBySource.clear();
    _preprocessBySource.set(src, fn);
  }
  return fn;
}
const _preprocessBySource = new Map();
const PREPROCESS_SOURCE_LIMIT = 4096;


// parse() for the full package: a generated function that copies the keys the
// schema declares, behind the generated verdict. The refusals every build
// shares stay in validator-core.js; this is the part that needs the code
// generator.
function buildParse (self, decline, extended) {
  const { cloneExprFor } = require('./lib/clone-emit');
  const expr = cloneExprFor(self._schemaObj);
  if (!expr) return decline('the set of keys to keep cannot be proven from the schema');
  let copy;
  try {
    // eslint-disable-next-line no-new-func
    copy = compileFunction('data', 'return ' + expr);
  } catch {
    return decline('code generation is not allowed here');
  }
  self._ensureCompiled();
  const verdict = extended ? (d) => self.isValidObject(d) : self._jsFn;
  if (typeof self._jsFn !== 'function') return decline('the schema has no generated verdict function');
  return (data) => {
    if (!verdict(data)) {
      const e = new Error('validation failed');
      e.name = 'AtaValidationError';
      let target = data;
      if (self._mutatesInput) {
        try { target = structuredClone(data); } catch { target = data; }
      }
      // The errors are worked out when first read, as validate() works them
      // out: building every error with its enrichment before throwing made a
      // rejected parse() cost about 12 µs on a document with 16 violations,
      // most of it for callers that only catch. Read once, the list stays.
      const rejection = self.validate(target);
      Object.defineProperty(e, 'errors', {
        configurable: true,
        enumerable: true,
        get () {
          const errors = rejection.errors;
          Object.defineProperty(e, 'errors', { value: errors, writable: true, configurable: true, enumerable: true });
          return errors;
        },
        set (v) { Object.defineProperty(e, 'errors', { value: v, writable: true, configurable: true, enumerable: true }); },
      });
      throw e;
    }
    return copy(data);
  };
}

// Everything that turns a schema into JavaScript source, registered with the
// core: the three code generators and the paths above, the generated
// preprocess pass, the JSON-text scanner, the parse() copy and the
// ahead-of-time bundle methods. parse() and the bundle methods load on first
// use.
// Cold start. A validator's first COLD_CALLS calls are answered by an
// interpreted twin, built from the same schema and options with
// `engine: 'interpreter'`, which the test suite holds to the same answers and
// errors as the generated code. Generating code and having V8 compile it is
// the largest part of a first call on a large schema: from process start to
// one rejection with its error read, SchemaStore's SARIF schema took 87 ms
// with code generated at the first call and 31 ms with the twin answering.
// A validator still in use after that compiles as before, so a server reaches
// the generated code's speed within its first requests, and a command line
// tool or a short-lived function never pays to compile. Only where compiling
// costs enough to matter: a schema whose size with its references followed
// passes COLD_MIN characters (expandedChars in lib/js-compiler.js). A small
// schema compiles in about a millisecond and is generated at its first call
// as before, which also keeps every test that compares the generated code
// with the interpreter comparing the generated code. Not for a validator with
// an extension (_extendValidate, _extendChecks), which the twin would not
// carry. Returns the twin to answer this call, or null to compile.
const COLD_CALLS = 64;
const COLD_MIN = 16 * 1024;
// Whether the schema may expand past `limit`, answered from its text where
// that settles it. Without a `$ref` nothing expands, and expandedChars counts
// at most 8 for each character of the text, so a short schema is decided
// without walking it. The text is the one _ensureCompiled needs anyway. Walking
// every small route schema here cost a Fastify boot of ten routes 0.15 ms.
function mayExpandPast (self, limit) {
  const str = self._schemaStr || (self._schemaStr = JSON.stringify(self._schemaObj));
  if (str === undefined) return false;
  if (str.length * 8 <= limit && !str.includes('"$ref"')) return false;
  return jsCompiler.expandedChars(self._schemaObj, limit) > limit;
}

function coldTwin (self, Validator) {
  const n = self._coldCalls === undefined ? 0 : self._coldCalls;
  if (n >= COLD_CALLS || self._validateTail !== null || self._verdictTail !== null) return null;
  let t = self._twin;
  if (t === undefined) {
    t = null;
    if (!self._interpretOnly && !self._initialized && mayExpandPast(self, COLD_MIN)) {
      try { t = new Validator(self._rawSchema, Object.assign({}, self._options, { engine: 'interpreter' })); } catch { t = null; }
    }
    self._twin = t;
  }
  if (t === null) return null;
  self._coldCalls = n + 1;
  return t;
}

core._registerCodegen({
  jsCompiler,
  coldTwin,
  // The native locator for error frames, loaded with the first frame.
  nativePositions: () => require('./lib/native-positions').nativeTargeted,
  installPaths: installCodegenPaths,
  compileVerdict: installCodegenPaths.compileVerdict,
  installScanner: installCodegenPaths.installScanner,
  buildPreprocess: buildPreprocessCodegen,
  buildParse,
  aot: () => require('./lib/aot.js'),
});

// The parts no Validator calls: TypeScript generation, the error renderers,
// the spec output format, the retry message for language models, the schema
// description and the suggestion helper. ata-validator/lite leaves them out.
// Each loads its module on first call. None of them is on the path to a first
// validated request, and together they were about a sixth of what requiring
// the package cost.
function toTypeScript (...a) { return require('./lib/ts-gen').toTypeScript(...a); }
function renderPretty (...a) { return require('./lib/render-pretty').renderPretty(...a); }
function renderCompact (...a) { return require('./lib/render-compact').renderCompact(...a); }
function toOutput (...a) { return require('./lib/output-format').toOutput(...a); }
function toRetryMessage (...a) { return require('./lib/retry-message').toRetryMessage(...a); }
function describeSchema (...a) { return require('./lib/describe-schema').describeSchema(...a); }
function renderJSON (...a) { return require('./lib/render-json').renderJSON(...a); }

// Walk a JSON pointer (RFC 6901 escapes) into a data tree. Mirrors the helper
// inside lib/suggestions.js, kept local to avoid exporting an internal.
function _walkPointer (root, pointer) {
  if (!pointer) return root;
  const parts = pointer.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = root;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

// Post-hoc suggestion enrichment for AOT-compiled validators. The standalone
// modules do not embed the suggestion engine, so consumers who want
// suggestions pass the error array through this after validation.
function attachSuggestions (errors, data) {
  if (!errors) return errors;
  const { suggestFor } = require('./lib/suggestions');
  const { reprValue } = require('./lib/enrich-error');
  for (const e of errors) {
    if (!e || e.suggestion) continue;
    let received = e.received;
    if (received === undefined && data !== undefined) {
      const ptr = e.instancePath != null ? e.instancePath : (e.path || '');
      const raw = _walkPointer(data, ptr);
      if (raw !== undefined || ptr === '') received = reprValue(raw);
    }
    const probe = received !== undefined && e.received === undefined
      ? Object.assign({}, e, { received })
      : e;
    const s = suggestFor(probe, data);
    if (s) e.suggestion = s;
  }
  // AOT modules import nothing, so this is their only route to a frame. The
  // caller holds the original object and ran no preprocessing through here.
  require('./lib/diagnostic-source').setDiagnosticSource(errors, { data, mutatesInput: false });
  return errors;
}

module.exports = {
  Validator: core.Validator,
  compile: core.compile,
  validate: core.validate,
  validateAsync: core.validateAsync,
  parseAsync: core.parseAsync,
  version: core.version,
  createPaddedBuffer: core.createPaddedBuffer,
  SIMDJSON_PADDING: core.SIMDJSON_PADDING,
  parseJSON: core.parseJSON,
  toTypeScript,
  defineSchema: core.defineSchema,
  renderPretty,
  renderCompact,
  toOutput,
  toRetryMessage,
  describeSchema,
  renderJSON,
  attachSuggestions, // internal: used by the renderers; not public API
};
