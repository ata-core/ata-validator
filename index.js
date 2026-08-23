// Native addon: optional. Core validate() uses JS codegen and works without it.
// Buffer APIs (isValid, countValid, isValidParallel) require native.
// Loading is delegated to lib/native-load.js so this file stays free of
// platform probing and `path` (the browser entry must not pull those in).
const native = require("./lib/native-load")();
const {
  compileToJS,
  compileToJSCodegen,
  compileToJSCodegenWithErrors,
  compileToJSCombined,
} = require("./lib/js-compiler");
const { normalizeDraft7, normalizeNullable, stripFormatAssertions } = require("./lib/draft7");
const { isV1Dialect } = require("./lib/dialect");
const { classify } = require("./lib/shape-classifier");
const { buildTier0Plan, tier0Validate } = require("./lib/tier0");

// Extract default values from a schema tree. Returns a function that applies
// defaults to an object in-place (mutates), or null if no defaults exist.
function buildDefaultsApplier(schema) {
  if (typeof schema !== "object" || schema === null) return null;
  const actions = [];
  collectDefaults(schema, actions);
  if (actions.length === 0) return null;
  return (data) => {
    for (let i = 0; i < actions.length; i++) actions[i](data);
  };
}

function collectDefaults(schema, actions, path) {
  if (typeof schema !== "object" || schema === null) return;
  const props = schema.properties;
  if (!props) return;
  for (const [key, prop] of Object.entries(props)) {
    if (prop && typeof prop === "object" && prop.default !== undefined) {
      const defaultVal = prop.default;
      if (!path) {
        actions.push((data) => {
          if (typeof data === "object" && data !== null && !(key in data)) {
            data[key] =
              typeof defaultVal === "object" && defaultVal !== null
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal;
          }
        });
      } else {
        const parentPath = path;
        actions.push((data) => {
          let target = data;
          for (let j = 0; j < parentPath.length; j++) {
            if (typeof target !== "object" || target === null) return;
            target = target[parentPath[j]];
          }
          if (
            typeof target === "object" &&
            target !== null &&
            !(key in target)
          ) {
            target[key] =
              typeof defaultVal === "object" && defaultVal !== null
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal;
          }
        });
      }
    }
    // Recurse into nested object schemas
    if (prop && typeof prop === "object" && prop.properties) {
      collectDefaults(prop, actions, (path || []).concat(key));
    }
  }
}

// Build a function that coerces property values to match schema types in-place.
// Handles string→number, string→integer, string→boolean, number→string, boolean→string.
function buildCoercer(schema) {
  if (typeof schema !== "object" || schema === null) return null;
  const actions = [];
  collectCoercions(schema, actions);
  if (actions.length === 0) return null;
  return (data) => {
    for (let i = 0; i < actions.length; i++) actions[i](data);
  };
}

function collectCoercions(schema, actions, path) {
  if (typeof schema !== "object" || schema === null) return;
  const props = schema.properties;
  if (!props) return;
  for (const [key, prop] of Object.entries(props)) {
    if (!prop || typeof prop !== "object" || !prop.type) continue;
    const targetType = Array.isArray(prop.type) ? null : prop.type;
    if (!targetType) continue;

    const coerce = buildSingleCoercion(targetType);
    if (!coerce) continue;

    if (!path) {
      actions.push((data) => {
        if (typeof data === "object" && data !== null && key in data) {
          const coerced = coerce(data[key]);
          if (coerced !== undefined) data[key] = coerced;
        }
      });
    } else {
      const parentPath = path;
      actions.push((data) => {
        let target = data;
        for (let j = 0; j < parentPath.length; j++) {
          if (typeof target !== "object" || target === null) return;
          target = target[parentPath[j]];
        }
        if (typeof target === "object" && target !== null && key in target) {
          const coerced = coerce(target[key]);
          if (coerced !== undefined) target[key] = coerced;
        }
      });
    }

    // Recurse into nested object properties
    if (prop.properties) {
      collectCoercions(prop, actions, (path || []).concat(key));
    }
  }
}

function buildSingleCoercion(targetType) {
  switch (targetType) {
    case "number":
      return (v) => {
        if (typeof v === "string") {
          const n = Number(v);
          if (v !== "" && !isNaN(n)) return n;
        }
        if (typeof v === "boolean") return v ? 1 : 0;
      };
    case "integer":
      return (v) => {
        if (typeof v === "string") {
          const n = Number(v);
          if (v !== "" && Number.isInteger(n)) return n;
        }
        if (typeof v === "boolean") return v ? 1 : 0;
      };
    case "string":
      return (v) => {
        if (typeof v === "number" || typeof v === "boolean") return String(v);
      };
    case "boolean":
      return (v) => {
        if (v === "true" || v === "1") return true;
        if (v === "false" || v === "0") return false;
      };
    default:
      return null;
  }
}

// Build a function that removes properties not defined in schema.properties.
// Walks nested objects recursively.
function buildRemover(schema) {
  if (typeof schema !== "object" || schema === null) return null;
  const actions = [];
  collectRemovals(schema, actions);
  if (actions.length === 0) return null;
  return (data) => {
    for (let i = 0; i < actions.length; i++) actions[i](data);
  };
}

function collectRemovals(schema, actions, path) {
  if (typeof schema !== "object" || schema === null || !schema.properties)
    return;

  // If this level has additionalProperties: false, add a removal action
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties));
    if (!path) {
      actions.push((data) => {
        if (typeof data !== "object" || data === null || Array.isArray(data))
          return;
        const keys = Object.keys(data);
        for (let i = 0; i < keys.length; i++) {
          if (!allowed.has(keys[i])) delete data[keys[i]];
        }
      });
    } else {
      const parentPath = path;
      actions.push((data) => {
        let target = data;
        for (let j = 0; j < parentPath.length; j++) {
          if (typeof target !== "object" || target === null) return;
          target = target[parentPath[j]];
        }
        if (
          typeof target !== "object" ||
          target === null ||
          Array.isArray(target)
        )
          return;
        const keys = Object.keys(target);
        for (let i = 0; i < keys.length; i++) {
          if (!allowed.has(keys[i])) delete target[keys[i]];
        }
      });
    }
  }

  // Always recurse into nested properties (they may have their own additionalProperties: false)
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop && typeof prop === "object" && prop.properties) {
      collectRemovals(prop, actions, (path || []).concat(key));
    }
  }
}

// Generate a fast preprocess function via codegen instead of closure arrays
function buildPreprocessCodegen(schema, options) {
  if (typeof schema !== 'object' || schema === null || !schema.properties) return null;
  const lines = [];
  const props = schema.properties;
  const keys = Object.keys(props);

  // removeAdditional: inline key check
  if (options.removeAdditional && schema.additionalProperties === false) {
    const checks = keys.map(k => `_k!==${JSON.stringify(k)}`).join('&&');
    lines.push(`for(var _k in d)if(${checks})delete d[_k]`);
  }

  // coerceTypes: inline per property
  if (options.coerceTypes) {
    for (const [key, prop] of Object.entries(props)) {
      if (!prop || typeof prop !== 'object' || !prop.type) continue;
      const t = Array.isArray(prop.type) ? null : prop.type;
      if (!t) continue;
      const k = JSON.stringify(key);
      if (t === 'integer') {
        lines.push(`if(typeof d[${k}]==='string'){var _n=Number(d[${k}]);if(d[${k}]!==''&&Number.isInteger(_n))d[${k}]=_n}`);
        lines.push(`if(typeof d[${k}]==='boolean')d[${k}]=d[${k}]?1:0`);
      } else if (t === 'number') {
        lines.push(`if(typeof d[${k}]==='string'){var _n=Number(d[${k}]);if(d[${k}]!==''&&!isNaN(_n))d[${k}]=_n}`);
        lines.push(`if(typeof d[${k}]==='boolean')d[${k}]=d[${k}]?1:0`);
      } else if (t === 'string') {
        lines.push(`if(typeof d[${k}]==='number'||typeof d[${k}]==='boolean')d[${k}]=String(d[${k}])`);
      } else if (t === 'boolean') {
        lines.push(`if(d[${k}]==='true'||d[${k}]==='1')d[${k}]=true`);
        lines.push(`if(d[${k}]==='false'||d[${k}]==='0')d[${k}]=false`);
      } else if (t === 'array' && options.coerceTypes === 'array') {
        lines.push(`if(${k} in d&&d[${k}]!==undefined&&!Array.isArray(d[${k}]))d[${k}]=[d[${k}]]`);
      }
    }
  }

  // defaults: inline per property
  if (options.useDefaults !== false) {
    for (const [key, prop] of Object.entries(props)) {
      if (prop && typeof prop === 'object' && prop.default !== undefined) {
        const k = JSON.stringify(key);
        const def = JSON.stringify(prop.default);
        lines.push(`if(!(${k} in d))d[${k}]=${def}`);
      }
    }
  }

  if (lines.length === 0) return null;
  // Data may legitimately be null or a non-object (e.g. a `['object','null']`
  // schema), so the per-property mutations must not run on it.
  lines.unshift(`if(d===null||typeof d!=='object')return`);
  try {
    return new Function('d', lines.join('\n'));
  } catch {
    return null;
  }
}

// Cloudflare Workers, Deno Deploy and pages under a strict Content-Security-
// Policy refuse `new Function`. Probed once, lazily, because the answer cannot
// change within a realm and the probe itself is a code generation attempt.
let _codegenAvailable = null;
function codegenAvailable() {
  if (_codegenAvailable === null) {
    try {
      _codegenAvailable = new Function('return 1')() === 1;
    } catch {
      _codegenAvailable = false;
    }
  }
  return _codegenAvailable;
}

// Schema compilation cache: same schema string -> reuse compiled functions
const _compileCache = new Map();

// Object identity cache: same schema object reference -> reuse entire compiled state
// Skips JSON.stringify, cache lookup, and all setup. Near-zero cost for repeated schemas.
const _identityCache = new WeakMap();

const SIMDJSON_PADDING = 64;
const VALID_RESULT = Object.freeze({ valid: true, errors: Object.freeze([]) });
const ABORT_EARLY_RESULT = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({
    code: 'ATA9000',
    message: 'validation failed',
    keyword: '__abort_early__',
    path: '',
  })]),
});

// `_CP_LEN_SOURCE`, the safe-regex embed, and the AOT helpers that consume them
// now live in `lib/aot.js` — keeping this file free of `fs`/`path`/`__dirname`
// references so a default import never touches disk. The static AOT methods
// further down lazily require `./lib/aot`, so they pay nothing until a user
// calls `bundleStandalone`/`bundle`/etc.

// Above this size, simdjson On Demand (selective field access) beats JSON.parse
// (which must materialize the full JS object tree). Buffer.from + NAPI ~2x faster.
const SIMDJSON_THRESHOLD = 8192;

// Resolve a JSON Schema path like "#/properties/name/type" to the schema object
// that *contains* the failing keyword. Used by verbose mode to populate
// `parentSchema` on validation errors. Returns undefined if the path can't be
// walked (malformed pointer or missing intermediate node).
function resolveSchemaByPath(rootSchema, schemaPath) {
  if (!schemaPath || typeof schemaPath !== 'string' || !schemaPath.startsWith('#')) {
    return undefined;
  }
  const stripped = schemaPath.slice(1);
  if (!stripped || stripped === '/') return rootSchema;
  const parts = stripped.split('/').filter(Boolean).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  // The last segment is the keyword that failed (e.g. "type"); parentSchema is
  // the schema object that owns that keyword, so walk all but the last segment.
  let target = rootSchema;
  for (let i = 0; i < parts.length - 1; i++) {
    if (target == null || typeof target !== 'object') return undefined;
    target = target[parts[i]];
  }
  return target;
}

// Rank an error by walking its schemaPath through the schema object: at each
// level the segment's index among the node's declared keys. Comparing ranks
// lexicographically orders errors by keyword declaration order, which is the
// order AJV emits and what schema authors read top to bottom. Segments that
// cannot be resolved (cross-schema refs, normalized keys) end the walk; the
// stable sort then keeps such errors in engine emission order.
function schemaOrderRank(rootSchema, schemaPath) {
  if (!schemaPath || typeof schemaPath !== 'string' || !schemaPath.startsWith('#')) return null;
  const parts = schemaPath.slice(1).split('/').filter(Boolean).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  const rank = [];
  let node = rootSchema;
  for (const seg of parts) {
    if (node == null || typeof node !== 'object') break;
    if (Array.isArray(node)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) break;
      rank.push(idx);
      node = node[idx];
    } else {
      const idx = Object.keys(node).indexOf(seg);
      if (idx < 0) break;
      rank.push(idx);
      node = node[seg];
    }
  }
  return rank;
}

function sortErrorsBySchemaOrder(rootSchema, errors) {
  const ranked = errors.map((e, i) => ({ e, i, rank: schemaOrderRank(rootSchema, e.schemaPath) }));
  ranked.sort((a, b) => {
    if (!a.rank || !b.rank) return a.i - b.i;
    const n = Math.min(a.rank.length, b.rank.length);
    for (let k = 0; k < n; k++) {
      if (a.rank[k] !== b.rank[k]) return a.rank[k] - b.rank[k];
    }
    return a.i - b.i;
  });
  return ranked.map((r) => r.e);
}

function parsePointerPath(path) {
  if (!path) return [];
  return path
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      const decoded = seg.replace(/~1/g, "/").replace(/~0/g, "~");
      // Per Standard Schema V1: array indices should be emitted as numbers,
      // object keys as strings. Treat all-digit segments as numeric indices.
      if (/^(0|[1-9][0-9]*)$/.test(decoded)) {
        return { key: Number(decoded) };
      }
      return { key: decoded };
    });
}

function createPaddedBuffer(jsonStr) {
  if (typeof Buffer === 'undefined') throw new Error('createPaddedBuffer requires Node.js Buffer');
  const jsonBuf = Buffer.from(jsonStr);
  const padded = Buffer.allocUnsafe(jsonBuf.length + SIMDJSON_PADDING);
  jsonBuf.copy(padded);
  padded.fill(0, jsonBuf.length);
  return { buffer: padded, length: jsonBuf.length };
}

// Deep-clone a value, copying own symbol keys by reference at every level.
// Arrays and plain objects are cloned recursively; primitives, RegExp,
// functions, and other non-plain values are returned as-is. Symbol values
// (e.g. refinement lists, OPTIONAL markers) are owned by the caller's builder
// and sharing them is correct — they are never mutated by normalization.
function _deepCloneWithSymbols(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const a = new Array(v.length);
    for (let i = 0; i < v.length; i++) a[i] = _deepCloneWithSymbols(v[i]);
    return a;
  }
  // Only clone plain objects (skip RegExp, Date, etc.).
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v;
  const out = Object.create(null);
  for (const k of Object.keys(v)) Object.defineProperty(out, k, { value: _deepCloneWithSymbols(v[k]), writable: true, enumerable: true, configurable: true });
  for (const sym of Object.getOwnPropertySymbols(v)) out[sym] = v[sym];
  return Object.setPrototypeOf(out, Object.prototype);
}

// Normalize a caller-provided schema without mutating the original.
// Clones only when normalization would change the object (draft-07 keys
// present or nullable fields present). Internal-only — not exported.
function _normalizeCallerSchema(s, inheritDraft7) {
  const declares = s && typeof s === 'object' && s.$schema !== undefined
  const needsDraft7 = declares
    ? (s.$schema === 'http://json-schema.org/draft-07/schema#' || s.$schema === 'http://json-schema.org/draft-07/schema')
    : !!inheritDraft7
  const str = JSON.stringify(s)
  const copy = _deepCloneWithSymbols(s)
  if (needsDraft7) normalizeDraft7(copy, true)
  normalizeNullable(copy)
  // Return original when normalization produced no change, copy otherwise.
  // Change-detection uses JSON content only; symbols do not affect it.
  return JSON.stringify(copy) === str ? s : copy
}

// `inheritDraft7` is true when the root schema is draft-07: a retrieved
// document that declares no dialect is read under the root's draft.
function buildSchemaMap(schemas, inheritDraft7) {
  if (!schemas) return null
  const map = new Map()
  if (Array.isArray(schemas)) {
    for (const s of schemas) {
      const normalized = _normalizeCallerSchema(s, inheritDraft7)
      const id = normalized.$id
      if (!id) throw new Error('Schema in schemas option must have $id')
      map.set(id, normalized)
    }
  } else {
    for (const [key, s] of Object.entries(schemas)) {
      const normalized = _normalizeCallerSchema(s, inheritDraft7)
      // A retrieved document is addressable both by the URI it was registered
      // under and by the $id it declares. Registering only the $id makes
      // references to the retrieval URI unresolvable.
      map.set(key, normalized)
      if (normalized.$id && normalized.$id !== key) map.set(normalized.$id, normalized)
    }
  }
  return map
}

// Compile-cache key for a root schema plus its external schemas. Must include
// the external schema CONTENT, not just their $ids: two validators can share a
// root schema string and the same $id while pointing that $id at different
// schemas (separate app instances, test suites, multi-tenant). Keying on $id
// alone reuses the wrong compiled validator and silently mis-validates.
function compileCacheKey(schemaStr, schemaMap) {
  if (!schemaMap || schemaMap.size === 0) return schemaStr
  const parts = []
  for (const [id, s] of schemaMap) parts.push(id + '=' + JSON.stringify(s))
  parts.sort()
  return schemaStr + '\0' + parts.join('\0')
}

// Resolve a relative URI ref against a base URI
function resolveRelativeRef(ref, baseId) {
  if (!baseId || ref.includes('://') || ref.startsWith('#')) return ref
  const lastSlash = baseId.lastIndexOf('/')
  if (lastSlash < 0) return ref
  return baseId.substring(0, lastSlash + 1) + ref
}

// Resolve a cross-schema $ref to its target schema for preprocessing purposes.
// Handles whole-schema refs (`shared#`), relative-id matching, and JSON pointer
// fragments (`shared#/properties/id`). Returns null for local-only refs or when
// the target cannot be found. Used only to read `type`/`properties` for
// coercion/defaults/removeAdditional, never for validation.
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
        if (!cloned) { cloned = Object.assign({}, s); cloned.properties = Object.assign({}, s.properties) }
        cloned.properties[key] = t
      }
    }
  }
  return cloned || s
}

class Validator {
  constructor(schema, opts) {
    const options = opts || {};

    // Ultra-fast path: same schema object reference -> return cached instance
    // JS constructor returning an object makes `new` return that object
    // Cost: one WeakMap lookup. No property copy, no setup, nothing.
    if (!opts && typeof schema === "object" && schema !== null) {
      const hit = _identityCache.get(schema);
      if (hit) return hit;
    }

    // When schema is a string, JSON.parse already produces a fresh object.
    // When schema is an object, normalization runs on a clone so the caller's
    // object is never touched.
    let schemaObj = typeof schema === "string"
      ? _normalizeCallerSchema(JSON.parse(schema))
      : _normalizeCallerSchema(schema);
    const rootIsDraft7 = !!(schemaObj && typeof schemaObj === 'object' && typeof schemaObj.$schema === 'string' &&
      (schemaObj.$schema === 'http://json-schema.org/draft-07/schema#' || schemaObj.$schema === 'http://json-schema.org/draft-07/schema'));

    // assertFormat: false makes `format` annotation-only. Strip it on a clone
    // so the caller's schema keeps the keyword.
    if (options.assertFormat === false) {
      schemaObj = stripFormatAssertions(
        schemaObj === schema ? _deepCloneWithSymbols(schemaObj) : schemaObj,
      );
    }

    this._schemaStr = null; // lazy: computed on first use
    this._schemaObj = schemaObj;
    this._options = options;
    this._initialized = false;
    this._nativeReady = false;
    this._compiled = null;
    this._fastSlot = -1;
    this._jsFn = null;
    this._engine = undefined;
    this._preprocess = null;
    this._applyDefaults = null;

    // Schema map for cross-schema $ref resolution
    this._schemaMap = buildSchemaMap(options.schemas, rootIsDraft7) || new Map();

    // User-supplied format checkers: { formatName: (value) => boolean }.
    // Looked up at runtime when a schema references a format the built-in
    // registry does not know about.
    this._userFormats = options.formats || null;

    // Verbose mode: when on, errors carry parentSchema (the schema object that
    // produced the error). Matches ajv's `verbose: true` behavior.
    this._verbose = !!options.verbose;

    // richErrors: default true. Only the literal `false` opts back into the
    // v0.14 error shape (no code/expected/received/docUrl, no aliases).
    this._richErrors = options && options.richErrors === false ? false : true;

    // Optional schema source descriptor. When supplied, the renderer pipeline
    // can attach a `schemaSource` frame to enriched errors.
    this._source = options && options.source && typeof options.source === 'object'
      ? { path: String(options.source.path || ''), content: String(options.source.content || '') }
      : null;

    // Build a JSON pointer -> position map for the schema text once at
    // construction so each runtime error can resolve `schemaSource` without
    // re-scanning the source on every validate() call.
    if (this._source) {
      const { buildPositionMap } = require('./lib/source-positions');
      this._schemaPositions = buildPositionMap(this._source.content);
    } else {
      this._schemaPositions = null;
    }

    // Per-validate data position cache. Populated by validateJSON before
    // dispatching to inner validate(); consulted by the rich-error wrap
    // to attach dataFrame entries to each enriched error.
    this._posCache = require('./lib/data-position-cache').createCache();
    this._lastRawInput = null;

    // Lazy stubs: trigger compilation on first call, then re-dispatch
    this.validate = (data) => {
      this._ensureCompiled();
      return this.validate(data);
    };
    this.isValidObject = (data) => {
      // Lazy: classify + build tier 0 plan on first call, not in constructor.
      const _tier = classify(this._schemaObj);
      if (_tier.tier === 0) {
        const _plan = buildTier0Plan(this._schemaObj);
        let _n = 0;
        this.isValidObject = (d) => {
          const r = tier0Validate(_plan, d);
          if (++_n === 2) {
            try { this._ensureCodegen(); } catch {}
          }
          return r;
        };
      } else {
        this._ensureCodegen();
        // Codegen can bail on shapes it cannot represent; the full compile
        // binds the native path or the unsupported thrower instead of
        // leaving this stub to re-dispatch to itself.
        if (!this._jsFn) this._ensureCompiled();
      }
      return this.isValidObject(data);
    };
    this.validateJSON = (jsonStr) => {
      this._ensureCompiled();
      return this.validateJSON(jsonStr);
    };
    this.isValidJSON = (jsonStr) => {
      this._ensureCompiled();
      return this.isValidJSON(jsonStr);
    };
    this.validateAndParse = (jsonStr) => {
      if (!native) throw new Error('Native addon required for validateAndParse()');
      this._ensureCompiled();
      return this.validateAndParse(jsonStr);
    };
    this.isValid = (buf) => {
      if (!native) throw new Error('Native addon required for isValid() — use validate() or isValidObject() instead');
      this._ensureCompiled();
      return this.isValid(buf);
    };
    this.countValid = (ndjsonBuf) => {
      if (!native) throw new Error('Native addon required for countValid()');
      this._ensureCompiled();
      return this.countValid(ndjsonBuf);
    };
    this.batchIsValid = (buffers) => {
      if (!native) throw new Error('Native addon required for batchIsValid()');
      this._ensureCompiled();
      return this.batchIsValid(buffers);
    };

    // ~standard uses self.validate() -- works with lazy because it goes through
    // the instance property which gets swapped after compilation
    const self = this;
    Object.defineProperty(this, "~standard", {
      value: Object.freeze({
        version: 1,
        vendor: "ata-validator",
        validate(value) {
          const result = self.validate(value);
          if (result.valid) {
            return { value };
          }
          return {
            issues: result.errors.map((err) => ({
              message: err.message,
              path: parsePointerPath(err.instancePath),
            })),
          };
        },
      }),
      writable: false,
      enumerable: false,
      configurable: false,
    });

    // Populate identity cache so repeated `new Validator(sameSchema)` short-circuits.
    if (!opts && typeof schema === "object" && schema !== null) {
      _identityCache.set(schema, this);
    }
  }

  _ensureCompiled() {
    if (this._initialized) return;
    this._initialized = true;

    const schemaObj = this._schemaObj;
    const options = this._options;

    // Lazy stringify — only computed here, not in constructor
    if (!this._schemaStr) this._schemaStr = JSON.stringify(schemaObj);

    // A $ref to a meta-schema resolves from the vendored copies, so
    // "validate this schema against its dialect" needs no network and no
    // caller-supplied registry. Only schemas that mention json-schema.org in a
    // reference pay for the lookup.
    if (this._schemaStr.includes('json-schema.org/draft')) {
      const { METASCHEMAS } = require('./lib/metaschemas');
      for (const [id, meta] of METASCHEMAS) {
        const bare = id.replace(/#$/, '');
        for (const key of [id, bare, bare + '#', bare.replace(/^https:/, 'http:'), bare.replace(/^http:/, 'https:')]) {
          if (!this._schemaMap.has(key)) this._schemaMap.set(key, meta);
        }
      }
    }

    // Check cache first -- reuse compiled functions for same schema
    const sm = this._schemaMap.size > 0 ? this._schemaMap : null;
    const mapKey = compileCacheKey(this._schemaStr, this._schemaMap);
    // Custom formats are JS functions: bypass the compile cache since they can
    // differ between validators that share the same schema string.
    const cached = this._userFormats ? null : _compileCache.get(mapKey);
    let jsFn, jsCombinedFn, jsErrFn, _isCodegen = false;
    var _forceNapi = typeof process !== 'undefined' && process.env && process.env.ATA_FORCE_NAPI;
    // v1 removes the bookending requirement for $dynamicRef. Only the
    // interpreted engine implements that; the JS compiler and the native
    // engine both resolve the 2020-12 way, so a v1 schema using the keyword
    // goes to the interpreter rather than being validated under the wrong
    // dialect. Schemas without $dynamicRef are unaffected: v1 and 2020-12
    // agree on everything else ata implements.
    this._v1Dynamic =
      isV1Dialect(schemaObj) &&
      (this._schemaStr.includes('"$dynamicRef"') || this._schemaStr.includes('"$dynamicAnchor"'));
    //
    // Where source cannot be turned into a function, neither JS path is usable
    // either. The closure path does not call `new Function` itself, so it
    // survives the block and would quietly handle schemas it gets wrong; the
    // interpreted engine is both eval-free and more correct, so go straight
    // there.
    if (this._v1Dynamic || !codegenAvailable()) {
      jsFn = null; jsCombinedFn = null; jsErrFn = null;
    } else if (cached && !_forceNapi) {
      jsFn = cached.jsFn;
      jsCombinedFn = cached.combined;
      jsErrFn = cached.errFn;
      _isCodegen = !!cached.isCodegen;
    } else if (!_forceNapi) {
      const uf = this._userFormats;
      const _cgFn = compileToJSCodegen(schemaObj, sm, uf);
      jsFn = _cgFn || compileToJS(schemaObj, null, sm);
      jsCombinedFn = compileToJSCombined(schemaObj, VALID_RESULT, sm, uf);
      jsErrFn = compileToJSCodegenWithErrors(schemaObj, sm, uf);
      _isCodegen = !!_cgFn;
      this._engine = _cgFn ? 'codegen' : jsFn ? 'closure' : null;
      if (!uf) {
        _compileCache.set(mapKey, { jsFn, combined: jsCombinedFn, errFn: jsErrFn, isCodegen: _isCodegen });
      }
    } else {
      jsFn = null; jsCombinedFn = null; jsErrFn = null;
    }
    this._jsFn = jsFn;
    if (this._engine === undefined) this._engine = cached ? (cached.isCodegen ? 'codegen' : jsFn ? 'closure' : null) : null;

    // Data mutators -- try codegen first (12x faster), fallback to closure arrays.
    // Follow cross-refs so coercion/defaults/removeAdditional see the referenced
    // shape (e.g. Fastify `params: { $ref: 'shared#' }` or property refs like
    // `{ id: { $ref: 'shared#/properties/id' } }`).
    const preprocessSchema = resolveSchemaForPreprocess(schemaObj, this._schemaMap);
    let preprocess = buildPreprocessCodegen(preprocessSchema, options);
    if (!preprocess) {
      const applyDefaults = options.useDefaults === false ? null : buildDefaultsApplier(preprocessSchema);
      const applyCoerce = options.coerceTypes ? buildCoercer(preprocessSchema) : null;
      const applyRemove = options.removeAdditional
        ? buildRemover(preprocessSchema)
        : null;
      const mutators = [applyRemove, applyCoerce, applyDefaults].filter(Boolean);
      preprocess =
        mutators.length === 0
          ? null
          : mutators.length === 1
            ? mutators[0]
            : (data) => {
                for (let i = 0; i < mutators.length; i++) mutators[i](data);
              };
    }
    this._applyDefaults = preprocess;
    this._preprocess = preprocess;

    // Detect if schema is "selective" -- doesn't recurse into arrays/deep objects.
    const hasArrayTraversal =
      schemaObj &&
      (schemaObj.items ||
        schemaObj.prefixItems ||
        schemaObj.contains ||
        (schemaObj.properties &&
          Object.values(schemaObj.properties).some(
            (p) => p && (p.items || p.prefixItems || p.contains),
          )));
    const useSimdjsonForLarge = !hasArrayTraversal;

    if (jsFn) {
      let safeErrFn = null;
      if (jsErrFn) {
        try {
          jsErrFn({}, true);
          safeErrFn = (d) => jsErrFn(d, true);
        } catch {}
      }
      // errFn: use JS codegen if safe, else native fallback (only when native
      // is available). Environments without the native addon — Cloudflare
      // Workers, browser, Bun without N-API — get a JS-only fallback so the
      // invalid path doesn't dereference a null _compiled.
      const hasUnevaluated = schemaObj && (schemaObj.unevaluatedProperties !== undefined || schemaObj.unevaluatedItems !== undefined || this._schemaStr.includes('unevaluatedProperties') || this._schemaStr.includes('unevaluatedItems'))
      const hasDynRef = this._schemaStr.includes('"$dynamicRef"') || this._schemaStr.includes('"$dynamicAnchor"')
      // Native-less error path: the interpreted engine re-validates failing
      // data to produce full errors. If it disagrees with the codegen verdict
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
      const errFn =
        safeErrFn ||
        (hasUnevaluated
          ? (d) => ({ valid: jsFn(d), errors: jsFn(d) ? [] : [{ code: 'unevaluated', path: '', message: 'unevaluated property or item' }] })
          : !native
            ? jsOnlyFallback
            : hasDynRef
              ? (d) => {
                  this._ensureNative();
                  return this._compiled.validateJSON(JSON.stringify(d));
                }
              : (d) => {
                  this._ensureNative();
                  return this._compiled.validate(d);
                });

      // Best path: combined validator (single pass, validates + collects errors)
      // Valid data: returns VALID_RESULT, no allocation
      // Invalid data: collects errors in one pass (no double validation)
      // Fallback: hybridFn or jsFn + errFn for schemas combined can't handle
      // Test combined at compile time -- some schemas produce broken combined code
      // Test combined at compile time -- some schemas (e.g. if/then/else)
      // produce broken combined code that crashes on certain inputs.
      // We probe with diverse data; if any throws, fall back to hybrid.
      let safeCombinedFn = null;
      if (jsCombinedFn) {
        try {
          const probe = {};
          // Populate probe with one key per known property to trigger nested paths
          if (schemaObj && schemaObj.properties) {
            for (const k of Object.keys(schemaObj.properties)) probe[k] = "";
          }
          if (schemaObj && schemaObj.if && schemaObj.if.properties) {
            for (const k of Object.keys(schemaObj.if.properties)) probe[k] = "";
          }
          jsCombinedFn(probe);
          jsCombinedFn({});
          jsCombinedFn(null);
          jsCombinedFn(0);
          safeCombinedFn = jsCombinedFn;
        } catch {}
      }

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
        const _fn = jsFn, _efn = safeErrFn || errFn, _R = VALID_RESULT;
        this.validate = preprocess
          ? (data) => { preprocess(data); return _fn(data) ? _R : _efn(data); }
          : (data) => _fn(data) ? _R : _efn(data);
      } else if (hasDynRef) {
        // $dynamicRef without codegen: the interpreted engine. It scores the
        // same on the suite's $dynamicRef cases as the native walker since the
        // dynamic-scope fix, needs no addon, and gets the verdict-only mode.
        if (!_interp) {
          const { createInterpreter } = require('./lib/interpreter');
          _interp = createInterpreter(schemaObj, {
            schemaMap: this._schemaMap.size > 0 ? this._schemaMap : null,
            formats: this._userFormats,
            v1: isV1Dialect(schemaObj),
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
        const hybridFn = jsFn._hybridFactory(VALID_RESULT, safeCombinedFn || errFn);
        this.validate = preprocess
          ? (data) => { preprocess(data); return hybridFn(data); }
          : hybridFn;
      } else if (safeCombinedFn) {
        this.validate = preprocess
          ? (data) => { preprocess(data); return safeCombinedFn(data); }
          : safeCombinedFn;
      } else {
        const hybridFn = jsFn && jsFn._hybridFactory
          ? jsFn._hybridFactory(VALID_RESULT, errFn)
          : null;
        this.validate = hybridFn
          ? preprocess
            ? (data) => {
                preprocess(data);
                return hybridFn(data);
              }
            : hybridFn
          : preprocess
            ? (data) => {
                preprocess(data);
                return jsFn(data) ? VALID_RESULT : errFn(data);
              }
            : (data) => (jsFn(data) ? VALID_RESULT : errFn(data));
      }
      // Verbose mode: populate parentSchema on each error.
      // Errors may be frozen, so clone them with the extra field.
      if (this._verbose) {
        const inner = this.validate;
        const root = this._schemaObj;
        this.validate = (data) => {
          const result = inner(data);
          if (result && !result.valid && result.errors) {
            const enriched = result.errors.map((err) =>
              err && err.parentSchema === undefined
                ? { ...err, parentSchema: resolveSchemaByPath(root, err.schemaPath) }
                : err
            );
            return { valid: false, errors: enriched };
          }
          return result;
        };
      }
      this.isValidObject = jsFn;
      const hybridFn = jsFn._hybridFactory
        ? jsFn._hybridFactory(VALID_RESULT, errFn)
        : null;
      const jsonValidateFn = safeCombinedFn
        || hybridFn
        || ((obj) => (jsFn(obj) ? VALID_RESULT : errFn(obj)));
      this.validateJSON = useSimdjsonForLarge && native
        ? (jsonStr) => {
            if (jsonStr.length >= SIMDJSON_THRESHOLD) {
              this._ensureNative();
              const buf = Buffer.from(jsonStr);
              if (native.rawFastValidate(this._fastSlot, buf))
                return VALID_RESULT;
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
      this.isValidJSON = useSimdjsonForLarge && native
        ? (jsonStr) => {
            if (jsonStr.length >= SIMDJSON_THRESHOLD) {
              this._ensureNative();
              return native.rawFastValidate(
                this._fastSlot,
                Buffer.from(jsonStr),
              );
            }
            try {
              return jsFn(JSON.parse(jsonStr));
            } catch (e) {
              if (!(e instanceof SyntaxError)) throw e;
              return false;
            }
          }
        : (jsonStr) => {
            try {
              return jsFn(JSON.parse(jsonStr));
            } catch (e) {
              if (!(e instanceof SyntaxError)) throw e;
              return false;
            }
          };
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
          self.isValid = (b) => {
            if (typeof b === 'string') b = Buffer.from(b);
            else if (!(b instanceof Uint8Array)) throw new TypeError('isValid() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().');
            return native.rawFastValidate(slot, b);
          };
          return self.isValid(buf);
        };
        this.countValid = (ndjsonBuf) => {
          self._ensureNative();
          const slot = self._fastSlot;
          self.countValid = (b) => {
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
          self.batchIsValid = (bufs) => {
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
    } else if (native) {
      // No JS codegen: buffer/parallel APIs always come from the native
      // engine, but the object-validation entry points go to whichever
      // engine is more correct for the schema shape. Pure dynamic-ref
      // schemas stay on the C++ path (full $dynamicRef scope tracking);
      // everything else uses the interpreted engine, which handles the
      // $id/URN base-URI resolution corners the native resolver gets wrong.
      this._ensureNative();
      const _hasDynRef = this._schemaStr.includes('"$dynamicRef"') || this._schemaStr.includes('"$dynamicAnchor"')
      const _hasUneval = this._schemaStr.includes('"unevaluatedProperties"') || this._schemaStr.includes('"unevaluatedItems"')
      // propertyDependencies exists only in the interpreted engine, so a schema
      // using it goes there even when it also uses $dynamicRef.
      const _hasPropDeps = this._schemaStr.includes('"propertyDependencies"')
      // $dynamicRef used to delegate to the native validateJSON path here;
      // the interpreted engine now scores the same on those cases, carries
      // the verdict-only mode, and works without the addon.
      let _validate;
      {
        const { createInterpreter } = require('./lib/interpreter');
        const interp = createInterpreter(schemaObj, {
          schemaMap: this._schemaMap.size > 0 ? this._schemaMap : null,
          formats: this._userFormats,
          v1: isV1Dialect(schemaObj),
        });
        this._engine = 'interpreter';
        _validate = (data) => interp.validate(data);
        this._fastVerdict = preprocess ? null : (d) => interp.isValid(d);
        this.validateJSON = (jsonStr) => {
          try {
            return _validate(JSON.parse(jsonStr));
          } catch (e) {
            return { valid: false, errors: [{ keyword: 'syntax', instancePath: '', schemaPath: '#', params: {}, message: e.message }] };
          }
        };
        this.isValidJSON = (jsonStr) => this.validateJSON(jsonStr).valid;
      }
      this.validate = preprocess
        ? (data) => {
            preprocess(data);
            return _validate(data);
          }
        : _validate;
      this.isValidObject = this._fastVerdict
        ? this._fastVerdict
        : (data) => _validate(data).valid;
      this.validateAndParse = (jsonStr) => this._compiled.validateAndParse(jsonStr);
      {
        const slot = this._fastSlot;
        this.isValid = (buf) => {
          if (typeof buf === 'string') buf = Buffer.from(buf);
          else if (!(buf instanceof Uint8Array)) throw new TypeError('isValid() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().');
          return native.rawFastValidate(slot, buf);
        };
      }
      {
        const slot = this._fastSlot;
        this.countValid = (ndjsonBuf) => {
          if (typeof ndjsonBuf === 'string') ndjsonBuf = Buffer.from(ndjsonBuf);
          else if (!(ndjsonBuf instanceof Uint8Array)) throw new TypeError('countValid() requires a Buffer, Uint8Array, or string');
          const results = native.rawNDJSONValidate(slot, ndjsonBuf);
          let count = 0;
          for (let i = 0; i < results.length; i++) if (results[i]) count++;
          return count;
        };
      }
      {
        const slot = this._fastSlot;
        this.batchIsValid = (buffers) => {
          let valid = 0;
          for (const buf of buffers) {
            if (!(buf instanceof Uint8Array)) throw new TypeError('batchIsValid() requires Buffer or Uint8Array elements');
            if (native.rawFastValidate(slot, buf)) valid++;
          }
          return valid;
        };
      }
    } else {
      // No JS codegen and no native engine: fall back to the interpreted
      // engine. Slow but correct, and strictly better than the previous
      // behavior (the lazy stubs re-dispatched to themselves forever).
      const { createInterpreter } = require('./lib/interpreter');
      const interp = createInterpreter(schemaObj, {
        schemaMap: this._schemaMap.size > 0 ? this._schemaMap : null,
        formats: this._userFormats,
        v1: isV1Dialect(schemaObj),
      });
      this._engine = 'interpreter';
      if (!preprocess) this._fastVerdict = (d) => interp.isValid(d);
      const run = preprocess
        ? (data) => { preprocess(data); return interp.validate(data); }
        : (data) => interp.validate(data);
      this.validate = run;
      this.isValidObject = this._fastVerdict
        ? this._fastVerdict
        : (data) => run(data).valid;
      this.validateJSON = (jsonStr) => {
        try {
          return run(JSON.parse(jsonStr));
        } catch (e) {
          return { valid: false, errors: [{ keyword: 'syntax', instancePath: '', schemaPath: '#', params: {}, message: e.message }] };
        }
      };
      this.isValidJSON = (jsonStr) => this.validateJSON(jsonStr).valid;
    }

    // Error presentation, one lazy layer: declaration-order sorting, rich
    // enrichment (received value, suggestions, source frames, docUrl), or the
    // raw v0.14 shape under `richErrors: false`. All of it is work a caller
    // that only reads `.valid` never sees, so it runs on first access to
    // `.errors` and is cached. One wrapper, one allocation per rejection.
    if (this.validate) {
      const inner = this.validate;
      const enrich = this._richErrors ? require('./lib/enrich-error').enrich : null;
      const root = this._schemaObj;
      const self = this;
      this.validate = (data) => {
        const result = inner(data);
        // abortEarly returns the shared ATA9000 stub; preserve it as-is so the
        // perf fast path stays allocation-free and the documented code stays stable.
        if (result && result.valid === false && result !== ABORT_EARLY_RESULT) {
          // Positions come from the raw input when validateJSON set one;
          // resolved eagerly since the cache is reset per call.
          const positions = (enrich && self._lastRawInput != null) ? self._posCache.get(self._lastRawInput) : null;
          if (positions) self._posCache.reset();
          let cached = null;
          return {
            valid: false,
            get errors() {
              if (cached === null) {
                let raw = result.errors || [];
                if (raw.length > 1) raw = sortErrorsBySchemaOrder(root, raw);
                cached = (enrich && raw.length)
                  ? raw.map((e) => enrich(e, {
                      data,
                      positions,
                      schemaPositions: self._schemaPositions,
                      schemaFile: self._source ? self._source.path : undefined,
                    }))
                  : raw;
              }
              return cached;
            },
          };
        }
        return result;
      };

      // validateJSON also enriches: set _lastRawInput so the position cache
      // can lazily build a map for dataFrame attachment. Only validateJSON
      // wires this — validate(data) takes a pre-parsed object, by design.
      if (this._richErrors && this.validateJSON) {
        const innerJson = this.validateJSON;
        this.validateJSON = (jsonStr) => {
          this._lastRawInput = jsonStr;
          let result;
          try {
            result = innerJson(jsonStr);
          } finally {
            // Don't clear here; the enrich step below needs the cache. We
            // clear after enrich, or in the early-return path.
          }
          if (result && !result.valid && result.errors && result.errors.length) {
            // If errors came from the inner path that already ran through the
            // wrapped this.validate (codegen jsonValidateFn -> validate path),
            // they may already be enriched. Detect by presence of `code`.
            const first = result.errors[0];
            if (!first || !first.code) {
              const positions = (this._lastRawInput != null) ? this._posCache.get(this._lastRawInput) : null;
              // Re-parse the input once so the enrich pass can pluck `received`
              // and feed the suggestion engine (required-typo, format hints,
              // coercion nudges all need the live value tree).
              let parsedData;
              try { parsedData = JSON.parse(jsonStr); } catch { parsedData = undefined; }
              const enriched = result.errors.map((e) => enrich(e, {
                data: parsedData,
                positions,
                schemaPositions: this._schemaPositions,
                schemaFile: this._source ? this._source.path : undefined,
              }));
              if (positions) this._posCache.reset();
              this._lastRawInput = null;
              return { valid: false, errors: enriched };
            }
            // Already-enriched path: still attach dataFrame if missing.
            const positions = (this._lastRawInput != null) ? this._posCache.get(this._lastRawInput) : null;
            if (positions) {
              for (const e of result.errors) {
                if (e && !e.dataFrame) {
                  const path = e.path != null ? e.path : (e.instancePath || '');
                  const p = positions[path];
                  if (p) e.dataFrame = { byteOffset: p.byteOffset, length: p.length, line: p.line, col: p.col, text: p.text };
                }
              }
              this._posCache.reset();
            }
          }
          this._lastRawInput = null;
          return result;
        };
      }
    }

    // validate() resolves a typed `data` on success: the validated input, after
    // any in-place coercion/defaults. This matches the ValidationResult<T>
    // contract. isValidObject() and abortEarly stay allocation-free for hot
    // paths that only need a boolean.
    if (this.validate) {
      const _bare = this.validate;
      this.validate = (data) => {
        const r = _bare(data);
        return (r.valid === true && r.data === undefined)
          ? { valid: true, data, errors: r.errors }
          : r;
      };
    }

    // Custom error messages: if any subschema declares an `errorMessage`
    // keyword, install an outermost decorator that overrides the `message`
    // field of the errors it owns. Gated on a one-time scan so schemas without
    // errorMessage keep the validate hot path untouched. Layered after rich
    // enrichment so `code`/`keyword`/`path` are already final and only the
    // human-facing message changes.
    {
      const emLib = require('./lib/error-messages');
      const schemaStr = this._schemaStr || (this._schemaObj ? JSON.stringify(this._schemaObj) : '');
      if (emLib.schemaHasErrorMessages(schemaStr)) {
        const root = this._schemaObj;
        const wrap = (inner) => (arg) => {
          const result = inner(arg);
          if (result && result.valid === false && result.errors && result.errors.length && result !== ABORT_EARLY_RESULT) {
            const overridden = emLib.applyErrorMessages(result.errors, root);
            if (overridden !== result.errors) return { valid: false, errors: overridden };
          }
          return result;
        };
        if (this.validate) this.validate = wrap(this.validate);
        if (this.validateJSON) this.validateJSON = wrap(this.validateJSON);
        // validateAndParse routes through self.validate on the codegen path, but
        // the native-only path returns directly from the addon — wrap it so both
        // paths get overrides. The result shape carries `value`, preserved here.
        if (this.validateAndParse) {
          const innerVP = this.validateAndParse;
          this.validateAndParse = (arg) => {
            const result = innerVP(arg);
            if (result && result.valid === false && result.errors && result.errors.length) {
              const overridden = emLib.applyErrorMessages(result.errors, root);
              if (overridden !== result.errors) return { valid: false, value: result.value, errors: overridden };
            }
            return result;
          };
        }
      }
    }

    // Errors are paid for when read, not when produced. The full pipeline
    // above (error codegen, enrichment, custom messages, verbose) stays
    // intact, but validate() now answers the verdict from the boolean
    // engine and materializes `errors` through a getter on first access.
    // A caller that only reads `.valid`, which is every gateway check and
    // every benchmark, skips error construction entirely; a caller that
    // reads `.errors` pays once and the result is cached. Skipped when the
    // schema coerces or defaults (preprocess mutates before the verdict),
    // under abortEarly (already a frozen stub), and for $dynamicRef (the
    // boolean engine is not the authority there).
    if (this._fastVerdict && !preprocess && !options.abortEarly && this.validate) {
      const _full = this.validate;
      const _fast = this._fastVerdict;
      const EMPTY_ERRORS = Object.freeze([]);
      this.validate = (data) => {
        if (_fast(data)) return { valid: true, data, errors: EMPTY_ERRORS };
        let cached = null;
        return {
          valid: false,
          get errors() {
            if (cached === null) {
              const r = _full(data);
              cached = (r && r.valid === false && r.errors && r.errors.length)
                ? r.errors
                // The data changed between the verdict and this read; keep the
                // verdict and say so rather than inventing a specific error.
                : [{ keyword: 'validation', instancePath: '', schemaPath: '#', params: {}, message: 'schema validation failed' }];
            }
            return cached;
          },
        };
      };
    }

    // The buffer APIs answer from the native walker, which disagrees with
    // validate() on shapes listed in lib/buffer-gate.js. For those schemas
    // every buffer entry point goes through validate() instead.
    if (native) {
      const { bufferNeedsSlowPath, installSlowBufferApis } = require('./lib/buffer-gate');
      if (bufferNeedsSlowPath(schemaObj, this._schemaMap)) installSlowBufferApis(this);
    }

    // Save to identity cache for ultra-fast reuse with same schema object
    if (this._schemaObj && typeof this._schemaObj === 'object') {
      _identityCache.set(this._schemaObj, this);
    }
  }

  // Which engine answers validate() for this schema: 'codegen' (generated
  // JS), 'closure' (the closure compiler, the boolean fallback), 'native'
  // (the C++ engine, only for some $dynamicRef schemas), or 'interpreter'.
  // A diagnostic: the answer is the same on every engine, the cost is not.
  engine() {
    this._ensureCompiled();
    return this._engine || 'interpreter';
  }

  _ensureNative() {
    if (this._nativeReady) return;
    this._nativeReady = true;
    if (!native) return;
    let nativeSchemaStr = this._schemaStr;
    if (this._schemaMap.size > 0) {
      const merged = JSON.parse(this._schemaStr);
      if (!merged.$defs) merged.$defs = {};
      for (const [id, s] of this._schemaMap) {
        merged.$defs['__ext_' + id.replace(/[^a-zA-Z0-9]/g, '_')] = s;
      }
      nativeSchemaStr = JSON.stringify(merged);
    }
    this._compiled = new native.CompiledSchema(nativeSchemaStr);
    this._fastSlot = native.fastRegister(nativeSchemaStr);
  }

  addSchema(schema) {
    if (this._initialized) {
      throw new Error('Cannot add schema after compilation — call addSchema() before validate()')
    }
    if (!schema || !schema.$id) {
      throw new Error('Schema must have $id')
    }
    // Normalize a copy so the caller's object is never mutated. A document
    // without a dialect of its own is read under the root's draft.
    const root = this._schemaObj
    const rootIsDraft7 = !!(root && typeof root === 'object' && typeof root.$schema === 'string' &&
      (root.$schema === 'http://json-schema.org/draft-07/schema#' || root.$schema === 'http://json-schema.org/draft-07/schema'))
    const normalized = _normalizeCallerSchema(schema, rootIsDraft7)
    this._schemaMap.set(normalized.$id, normalized)
  }

  _ensureCodegen() {
    if (this._jsFn) return;
    if (typeof process !== 'undefined' && process.env && process.env.ATA_FORCE_NAPI) return;
    if (!this._schemaStr) this._schemaStr = JSON.stringify(this._schemaObj);
    const sm = this._schemaMap.size > 0 ? this._schemaMap : null;
    const mapKey = compileCacheKey(this._schemaStr, this._schemaMap);
    // Custom formats are JS functions: skip the shared cache so different
    // validators with the same schema string but different formats don't collide.
    const cached = this._userFormats ? null : _compileCache.get(mapKey);
    if (cached && cached.jsFn) {
      this._jsFn = cached.jsFn;
      this.isValidObject = cached.jsFn;
      return;
    }
    const uf = this._userFormats;
    const jsFn = compileToJSCodegen(this._schemaObj, sm, uf) || compileToJS(this._schemaObj, null, sm);
    this._jsFn = jsFn;
    if (jsFn) {
      this.isValidObject = jsFn;
      // seed cache with codegen, combined/errFn filled later by _ensureCompiled
      if (!uf) {
        if (!cached) _compileCache.set(mapKey, { jsFn, combined: null, errFn: null });
        else cached.jsFn = jsFn;
      }
    }
  }

  // Load a pre-compiled standalone module. Zero schema compilation.
  // No NAPI, no native compile — pure JS. Startup in microseconds.
  // Usage: const v = Validator.fromStandalone(require('./compiled.js'), schema, opts)
  static fromStandalone(mod, schema, opts) {
    const options = opts || {};
    const schemaObj = typeof schema === "string" ? JSON.parse(schema) : schema;

    // Create a lightweight instance — skip NAPI compile entirely
    const v = Object.create(Validator.prototype);
    v._jsFn = mod.boolFn;
    v._compiled = null;
    v._fastSlot = -1;

    // Mutators
    const applyDefaults = buildDefaultsApplier(schemaObj);
    const applyCoerce = options.coerceTypes ? buildCoercer(schemaObj) : null;
    const applyRemove = options.removeAdditional
      ? buildRemover(schemaObj)
      : null;
    const mutators = [applyRemove, applyCoerce, applyDefaults].filter(Boolean);
    const preprocess =
      mutators.length === 0
        ? null
        : mutators.length === 1
          ? mutators[0]
          : (data) => {
              for (let i = 0; i < mutators.length; i++) mutators[i](data);
            };
    v._preprocess = preprocess;

    // Error function — use pre-compiled from standalone if available, else compile
    let errFn = (d) => ({
      valid: false,
      errors: [
        { code: "validation_failed", path: "", message: "validation failed" },
      ],
    });
    if (mod.errFn) {
      errFn = (d) => mod.errFn(d, true);
    } else {
      const jsErrFn = compileToJSCodegenWithErrors(schemaObj);
      if (jsErrFn) {
        try {
          jsErrFn({}, true);
          errFn = (d) => jsErrFn(d, true);
        } catch {}
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
    v.isValidObject = mod.boolFn;
    v.isValidJSON = (jsonStr) => {
      try {
        return mod.boolFn(JSON.parse(jsonStr));
      } catch {
        return false;
      }
    };
    v.validateJSON = (jsonStr) => {
      try {
        const obj = JSON.parse(jsonStr);
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

    v.validateAndParse = native
      ? (jsonStr) => {
          v._ensureNative();
          v.validateAndParse = (s) => v._compiled.validateAndParse(s);
          return v.validateAndParse(jsonStr);
        }
      : () => { throw new Error('Native addon required for validateAndParse()'); };

    // Standard Schema V1
    Object.defineProperty(v, "~standard", {
      value: Object.freeze({
        version: 1,
        vendor: "ata-validator",
        validate(value) {
          const result = v.validate(value);
          if (result.valid) return { value };
          return {
            issues: result.errors.map((e) => ({
              message: e.message,
              path: parsePointerPath(e.instancePath),
            })),
          };
        },
      }),
      writable: false,
      enumerable: false,
      configurable: false,
    });

    return v;
  }

  // Raw NAPI fast path for Buffer/Uint8Array
  isValid(input) {
    if (!native) throw new Error('Native addon required for isValid() — install build tools or use validate() instead');
    if (typeof input === 'string') input = Buffer.from(input);
    else if (!(input instanceof Uint8Array)) throw new TypeError('isValid() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().');
    this._ensureNative();
    return native.rawFastValidate(this._fastSlot, input);
  }

  // Zero-copy pre-padded path
  isValidPrepadded(paddedBuffer, jsonLength) {
    if (!native) throw new Error('Native addon required for isValidPrepadded()');
    this._ensureNative();
    return native.rawFastValidate(this._fastSlot, paddedBuffer, jsonLength);
  }

  // Parallel NDJSON batch (multi-core)
  isValidParallel(buffer) {
    if (!native) throw new Error('Native addon required for isValidParallel()');
    this._ensureNative();
    return native.rawParallelValidate(this._fastSlot, buffer);
  }

  // Parallel count (fastest -- single uint32 return)
  countValid(buffer) {
    if (!native) throw new Error('Native addon required for countValid()');
    this._ensureNative();
    return native.rawParallelCount(this._fastSlot, buffer);
  }

  // NDJSON single-thread batch
  isValidNDJSON(buffer) {
    if (!native) throw new Error('Native addon required for isValidNDJSON()');
    this._ensureNative();
    return native.rawNDJSONValidate(this._fastSlot, buffer);
  }
}

function validate(schema, data) {
  if (native) {
    const schemaStr =
      typeof schema === "string" ? schema : JSON.stringify(schema);
    return native.validate(schemaStr, data);
  }
  // JS fallback: compile and validate
  const v = new Validator(typeof schema === "string" ? JSON.parse(schema) : schema);
  return v.validate(data);
}

// Async validation for schemas built with `t.refine(...)`. Structural
// validation runs synchronously first; refinements are awaited only when the
// value is structurally valid (a refinement body may assume the right shape).
// Accepts a schema literal or an existing Validator instance plus its schema.
// Returns a Promise<ValidationResult>.
async function validateAsync(schemaOrValidator, data) {
  const refineLib = require('./lib/refine');
  let validator, schema;
  if (schemaOrValidator instanceof Validator) {
    validator = schemaOrValidator;
    schema = validator._schemaObj;
  } else {
    schema = schemaOrValidator;
    validator = new Validator(schema);
  }
  const structural = validator.validate(data);
  if (!structural.valid) return structural;
  const refinements = refineLib.getRefinements(schema);
  if (!refinements) return structural;
  const issues = await refineLib.runRefinements(refinements, structural.data !== undefined ? structural.data : data);
  if (issues.length) return { valid: false, errors: issues };
  return structural;
}

// parseAsync resolves to the validated data, or rejects with an Error whose
// `.errors` carries the ValidationError list. Mirrors the parse/validate split
// used by Zod-style callers.
async function parseAsync(schemaOrValidator, data) {
  const result = await validateAsync(schemaOrValidator, data);
  if (result.valid) return result.data !== undefined ? result.data : data;
  const err = new Error('ata: async validation failed');
  err.errors = result.errors;
  throw err;
}

function version() {
  if (native) return native.version();
  try { return require("./lib/version"); } catch { return "unknown"; }
}

// Static AOT entry points are thin lazy-loaders into `lib/aot.js`. The
// implementation files (and the `fs`/`path` reads they perform) only enter
// the process when one of these is actually called. See `lib/aot.js` for the
// generated module shapes; browser bundles get `lib/aot.browser.js` (a stub
// that throws) via the package.json `browser` field.
Validator.bundle = function (schemas, opts) {
  return require('./lib/aot').bundle(Validator, schemas, opts);
};

Validator.bundleStandalone = function (schemas, opts) {
  return require('./lib/aot').bundleStandalone(Validator, schemas, opts);
};

Validator.bundleCompact = function (schemas, opts) {
  return require('./lib/aot').bundleCompact(Validator, schemas, opts);
};

Validator.loadBundle = function (mods, schemas, opts) {
  return require('./lib/aot').loadBundle(Validator, mods, schemas, opts);
};

const parseJSON = native ? native.parseJSON : JSON.parse;

// Ultra-fast compile: returns validate function directly, no Validator wrapper
// WeakMap cached — second call with same schema object is ~3ns
const _compileFnCache = new WeakMap();
function compile(schema, opts) {
  if (!opts && typeof schema === 'object' && schema !== null) {
    const hit = _compileFnCache.get(schema);
    if (hit) return hit;
  }
  const v = new Validator(schema, opts);
  v._ensureCompiled();
  const fn = v.validate;
  if (!opts && typeof schema === 'object' && schema !== null) {
    _compileFnCache.set(schema, fn);
  }
  return fn;
}

const { toTypeScript } = require("./lib/ts-gen");
const { renderPretty } = require("./lib/render-pretty");
const { renderCompact } = require("./lib/render-compact");
const { renderJSON } = require("./lib/render-json");
const { suggestFor } = require("./lib/suggestions");
const { reprValue } = require("./lib/enrich-error");

// Walk a JSON pointer (RFC 6901 escapes) into a data tree. Mirrors the helper
// inside lib/suggestions.js — kept local to avoid exporting an internal.
function _walkPointer (root, pointer) {
  if (!pointer) return root;
  const parts = pointer.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = root;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

// Post-hoc suggestion enrichment for AOT-compiled validators. The standalone
// modules do not embed the suggestion engine (Levenshtein + format hints would
// inflate the gzipped bundle beyond the size budget). Consumers who want
// suggestions pass the error array through this helper after validation.
// AOT errors don't carry `received`, so we re-derive it from `data` here.
function attachSuggestions (errors, data) {
  if (!errors) return errors;
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
  return errors;
}

// Authoring helper: identity at runtime. Its only job is to attach the
// JSONSchema type (see index.d.ts) to an inline schema object so TypeScript
// gives autocomplete and value checking while authoring. Returns the schema
// untouched so it can be passed straight to Validator, toStandaloneModule, etc.
function defineSchema (schema) {
  return schema;
}

module.exports = {
  Validator,
  compile,
  validate,
  validateAsync,
  parseAsync,
  version,
  createPaddedBuffer,
  SIMDJSON_PADDING,
  parseJSON,
  toTypeScript,
  defineSchema,
  renderPretty,
  renderCompact,
  renderJSON,
  attachSuggestions, // internal: used by the renderers; not public API
};
