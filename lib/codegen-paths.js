'use strict';

// The compiled paths a Validator installs when the code generator produced a
// verdict function: the hybrid and combined forms of validate(), the lazy
// error resolvers, validateJSON() over simdjson and the scanner, abortEarly.
// Moved out of Validator#_ensureCompiled so that ata-validator/lite, which never
// has a verdict function, does not carry them; index.js reaches this through
// lib/codegen-engine.js. Called with the validator as `this` and the locals of
// _ensureCompiled in `ctx`; the error and combined functions are built later
// by the builders, so they are read through ctx.err() and ctx.combined().

const core = require('./validator-core.js');
const { compileToJS, compileToJSCodegen } = require('./js-compiler');

function installCodegenPaths (ctx) {
  const { ABORT_EARLY_RESULT, HYBRID_TIER_CALLS, SIMDJSON_THRESHOLD, VALID_RESULT, _bindVerdict, _mustReject, isV1Dialect, native, resolveSchemaByPath } = core._internals;
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
      const { createInterpreter } = require('./interpreter');
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
  } else if (hasDynRef && _isCodegen && jsFn) {
    // $dynamicRef with JS codegen: direct path, no wrapper layers
    const _fn = jsFn, _efn = errOnly, _R = VALID_RESULT;
    this.validate = preprocess
      ? (data) => { preprocess(data); return _fn(data) ? _R : _efn(data); }
      : (data) => _fn(data) ? _R : _efn(data);
  } else if (hasDynRef) {
    // $dynamicRef without codegen: the interpreted engine. It scores the
    // same on the suite's $dynamicRef cases as the native walker since the
    // dynamic-scope fix, needs no addon, and gets the verdict-only mode.
    if (!_interp) {
      const { createInterpreter } = require('./interpreter');
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
  } else {
    // No hybrid factory, so the assembly needs the function itself rather
    // than a reference it can call later: build it now.
    const safeCombinedFn = combinedIfSafe();
    if (safeCombinedFn) {
      this.validate = preprocess
        ? (data) => { preprocess(data); return safeCombinedFn(data); }
        : safeCombinedFn;
    } else {
      this.validate = preprocess
        ? (data) => {
            preprocess(data);
            return jsFn(data) ? VALID_RESULT : errOnly(data);
          }
        : (data) => (jsFn(data) ? VALID_RESULT : errOnly(data));
    }
  }
  // Verbose mode: populate parentSchema, schema and data on each error, the
  // three fields the default error shape carries under the same option.
  // `data` is the value the error points at; without it a caller has to
  // walk the document by the instance path itself, which is what one
  // migration ended up writing by hand. Errors may be frozen, so clone
  // them with the extra fields.
  if (this._verbose) {
    const inner = this.validate;
    const root = this._schemaObj;
    const { resolvePointer } = require('./pointer.js');
    this.validate = (data) => {
      const result = inner(data);
      if (result && !result.valid && result.errors) {
        const enriched = result.errors.map((err) => {
          if (!err || err.parentSchema !== undefined) return err;
          const parentSchema = resolveSchemaByPath(root, err.schemaPath);
          // The last segment of the schema path is the keyword that
          // failed, so its value on the parent is that keyword's schema.
          const sp = typeof err.schemaPath === 'string' ? err.schemaPath : '';
          const last = sp.slice(sp.lastIndexOf('/') + 1).replace(/~1/g, '/').replace(/~0/g, '~');
          const keywordSchema = (parentSchema !== null && typeof parentSchema === 'object' && last)
            ? parentSchema[last]
            : undefined;
          return {
            ...err,
            parentSchema,
            schema: keywordSchema,
            data: resolvePointer(data, err.instancePath, undefined),
          };
        });
        return { valid: false, errors: enriched };
      }
      return result;
    };
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
  this.validateJSON = useSimdjsonForLarge && native && !preprocess
    ? (jsonStr) => {
        // `_skipNativeFast` is set by the scanner short-circuit below when it
        // has already decided the document is invalid. The encode and the
        // native call would run only to return false, and the error path
        // underneath does not need them.
        if (jsonStr.length >= SIMDJSON_THRESHOLD && this._skipNativeFast !== true) {
          this._ensureNative();
          const buf = Buffer.from(jsonStr);
          if (native.rawFastValidate(this._fastSlot, buf))
            return VALID_RESULT;
          if (options.abortEarly) return ABORT_EARLY_RESULT;
          return this._compiled.validateJSON(jsonStr);
        }
        try {
          return jsonValidateFn(JSON.parse(jsonStr));
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
        this._ensureNative();
        return this._compiled.validateJSON(jsonStr);
      }
    : (jsonStr) => {
        try {
          return jsonValidateFn(JSON.parse(jsonStr));
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
          if (!native) return { valid: false, errors: [{ keyword: 'syntax', instancePath: '', schemaPath: '#', params: {}, message: e.message }] };
        }
        this._ensureNative();
        return this._compiled.validateJSON(jsonStr);
      };
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
  this.isValidJSON = useSimdjsonForLarge && native && !preprocess
    ? (jsonStr) => {
        if (jsonStr.length >= SIMDJSON_THRESHOLD) {
          this._ensureNative();
          return native.rawFastValidate(
            this._fastSlot,
            Buffer.from(jsonStr),
          );
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
  // validateAndParse: parse the JSON, then validate. Pure JS (JSON.parse +
  // validate) so it works with or without the native addon and in browsers.
  {
    const self = this;
    this.validateAndParse = (jsonStr) => {
      let value;
      try {
        value = JSON.parse(typeof jsonStr === 'string' ? jsonStr : new TextDecoder().decode(jsonStr));
      } catch (e) {
        return { valid: false, value: undefined, errors: [{ code: 'ATA9001', message: 'invalid JSON: ' + e.message, keyword: '__parse__', instancePath: '', schemaPath: '', params: {} }] };
      }
      const r = self.validate(value);
      return { valid: r.valid, value, errors: r.errors };
    };
  }
  // Buffer APIs: lazy native init — only compile native schema on first buffer call.
  // This keeps cold start fast (JS codegen only) for users who only use validate().
  if (native) {
    const self = this;
    this.isValid = (buf) => {
      self._ensureNative();
      const slot = self._fastSlot;
      self.isValid = slot < 0
        ? (b) => self._slowBufferValid(b, 'isValid')
        : (b) => {
          if (typeof b === 'string') b = Buffer.from(b);
          else if (!(b instanceof Uint8Array)) throw new TypeError('isValid() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().');
          return native.rawFastValidate(slot, b);
        };
      return self.isValid(buf);
    };
    this.countValid = (ndjsonBuf) => {
      self._ensureNative();
      const slot = self._fastSlot;
      self.countValid = slot < 0
        ? (b) => {
          if (typeof b !== 'string' && !(b instanceof Uint8Array)) throw new TypeError('countValid() requires a Buffer, Uint8Array, or string');
          const text = typeof b === 'string' ? b : Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('utf8');
          let c = 0;
          for (const line of text.split('\n')) {
            if (line.trim() === '') continue;
            if (self._slowBufferValid(line, 'countValid')) c++;
          }
          return c;
        }
        : (b) => {
          if (typeof b === 'string') b = Buffer.from(b);
          else if (!(b instanceof Uint8Array)) throw new TypeError('countValid() requires a Buffer, Uint8Array, or string');
          const r = native.rawNDJSONValidate(slot, b);
          let c = 0;
          for (let i = 0; i < r.length; i++) if (r[i]) c++;
          return c;
        };
      return self.countValid(ndjsonBuf);
    };
    this.batchIsValid = (buffers) => {
      self._ensureNative();
      const slot = self._fastSlot;
      self.batchIsValid = slot < 0
        ? (bufs) => {
          let v = 0;
          for (const b of bufs) {
            if (!(b instanceof Uint8Array)) throw new TypeError('batchIsValid() requires Buffer or Uint8Array elements');
            if (self._slowBufferValid(b, 'batchIsValid')) v++;
          }
          return v;
        }
        : (bufs) => {
          let v = 0;
          for (const b of bufs) {
            if (!(b instanceof Uint8Array)) throw new TypeError('batchIsValid() requires Buffer or Uint8Array elements');
            if (native.rawFastValidate(slot, b)) v++;
          }
          return v;
        };
      return self.batchIsValid(buffers);
    };
  }

};

// The verdict function alone, for isValidObject() before a full compile: the
// error and combined generators are left for the first rejection.
installCodegenPaths.compileVerdict = function compileVerdict () {
  const { compileCacheKey, _compileCache, _bindVerdict, _rememberInstance } = core._internals;
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
  const _cg = compileToJSCodegen(this._schemaObj, sm, uf);
  const jsFn = _cg || compileToJS(this._schemaObj, null, sm);
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
    if (!uf) {
      if (!cached) _compileCache.set(mapKey, { jsFn, combined: undefined, errFn: undefined, isCodegen: !!_cg, full: false });
      else cached.jsFn = jsFn;
    }
  }
};

// validateJSON and isValidJSON over a schema-directed scanner, which answers
// from the JSON text without building the document.
installCodegenPaths.installScanner = function installScanner (schemaObj, options) {
  const { ABORT_EARLY_RESULT, VALID_RESULT, _bindEntry } = core._internals;
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
      if (!now && ++calls < SCAN_AFTER) return undefined;
      const built = require('./scan-compiler').compileScanner(schemaObj, { userFormats: self._userFormats });
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
    this.validateJSON = (jsonStr) => {
      const scan = self._ensureScanner();
      if (scan === undefined) return validateByParsing(jsonStr);
      if (scan === null) { _bindEntry(self, 'validateJSON', validateByParsing); return validateByParsing(jsonStr); }
      _bindEntry(self, 'validateJSON', (text) => {
        if (typeof text === 'string') {
          const r = scan(text);
          if (r === 1) return VALID_RESULT;
          if (r === 0) {
            if (abortEarly) return ABORT_EARLY_RESULT;
            self._skipNativeFast = true;
            try {
              return validateByParsing(text);
            } finally {
              self._skipNativeFast = false;
            }
          }
        }
        return validateByParsing(text);
      });
      return self.validateJSON(jsonStr);
    };
  }
};

module.exports = installCodegenPaths;
