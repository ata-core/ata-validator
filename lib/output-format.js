'use strict';

// The standardised output format from draft 2019-09 and 2020-12.
//
// ata reports errors in its own shape, the one consumers and the compat entry
// expect. The specification also defines an output format of its own, with
// `keywordLocation`, `absoluteKeywordLocation` and `instanceLocation`, and the
// official test suite has a small set of tests for it under `output-tests/`.
// This produces that shape from a validation, so those tests can be run and so
// a caller that wants spec output can have it.
//
// `flag` and `basic` are implemented. `detailed` and `verbose` are not: they
// need the full applicator tree, including the subschemas that passed, which
// the engines do not keep. The v1 `list` format is not implemented either; it
// is still moving, and the suite's own v1 output schema does not yet define it.
//
// Annotations are collected only when validation succeeded. That is not a
// shortcut: a subschema that fails contributes no annotations, and the output
// is rooted at the root schema, so a failing root drops all of them.
//
// The verdict always comes from `validate()`. Annotations come from a separate
// walk of the schema beside the instance, which never decides validity: where
// it has to know whether a subschema passed (anyOf, oneOf, if, contains, a
// patternProperties pattern), it asks a validator built for that subschema in
// place, with the validator's own options, schema and registry.
//
// `keywordLocation` is the evaluation path, through `$ref`.
// `absoluteKeywordLocation` is the keyword's place in its schema resource, and
// is given whenever the resource has a URI: its own `$id`, the `baseURI`
// option, or a registered schema's.
//
// Not covered: `$recursiveRef`, a vocabulary turned off by a custom
// meta-schema, and the dynamic scope inside a branch probe (a `$dynamicRef`
// in an anyOf branch is probed from the branch's own resource).

// Keywords whose value is the annotation they produce.
const METADATA_KEYWORDS = [
  'title', 'description', 'default', 'deprecated', 'readOnly', 'writeOnly',
  'examples', 'format', 'contentEncoding', 'contentMediaType', 'contentSchema',
];

// Keywords whose value is a schema, an array of schemas, or a map of them.
const ONE = new Set(['additionalProperties', 'propertyNames', 'items', 'additionalItems', 'contains',
  'unevaluatedItems', 'unevaluatedProperties', 'not', 'if', 'then', 'else', 'contentSchema']);
const MANY = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items']);
const MAP = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);

// Keywords every dialect defines. Anything else in a schema object is an
// unknown keyword, and its value is an annotation.
const KNOWN = new Set([
  '$schema', '$id', 'id', '$anchor', '$dynamicAnchor', '$recursiveAnchor', '$ref',
  '$dynamicRef', '$recursiveRef', '$vocabulary', '$comment',
  'type', 'enum', 'const', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum',
  'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems',
  'uniqueItems', 'maxContains', 'minContains', 'maxProperties', 'minProperties',
  'required', 'dependentRequired', ...ONE, ...MANY, ...MAP, ...METADATA_KEYWORDS,
]);

const ROOT_SENTINEL = 'urn:ata:output-root';

function pointerSegment (s) {
  return String(s).replace(/~/g, '~0').replace(/\//g, '~1');
}

function unpointer (s) {
  let d = s;
  try { d = decodeURIComponent(s); } catch { /* keep as written */ }
  return d.replace(/~1/g, '/').replace(/~0/g, '~');
}

// A JSON Pointer as a URI fragment: the characters a fragment cannot carry,
// `%` among them, percent-encoded.
function fragmentOf (ptr) {
  return encodeURI(ptr).replace(/#/g, '%23');
}

function isObject (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Resolved as the validator resolves: a relative id against a base that is
// not hierarchical (a registry key such as "shared") stays as written.
function resolveUri (ref, base) {
  try { return (base === null ? new URL(ref) : new URL(ref, base)).href; } catch { /* fall through */ }
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
  const [u, f] = splitUri(ref);
  if (u === '') return base === null ? null : splitUri(base)[0] + '#' + f;
  return ref;
}

function splitUri (uri) {
  const i = uri.indexOf('#');
  return i < 0 ? [uri, ''] : [uri.slice(0, i), uri.slice(i + 1)];
}

function legacyDialect (d) {
  return typeof d === 'string' && /draft-0[3-7]\/schema/.test(d);
}

function unitFor (error, base) {
  const keywordLocation = typeof error.schemaPath === 'string' && error.schemaPath.charAt(0) === '#'
    ? error.schemaPath.slice(1)
    : (error.schemaPath || '');
  const unit = {
    valid: false,
    keywordLocation,
    instanceLocation: error.instancePath || '',
  };
  if (base) unit.absoluteKeywordLocation = base + '#' + fragmentOf(keywordLocation);
  if (typeof error.message === 'string') unit.error = error.message;
  return unit;
}

// The schema the caller wrote, before `assertFormat: false` took `format` out
// of the copy the engines use: format is still an annotation then.
function callerSchema (validator) {
  const raw = validator._rawSchema;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  if (raw !== undefined) return raw;
  return validator._schemaObj;
}

// The root's URI, the way the validator settles it: its `$id` against the
// `baseURI` option, except that before 2019-09 an `$id` beside `$ref` does
// nothing.
function rootBase (root, opts) {
  const given = typeof opts.baseURI === 'string' && opts.baseURI !== '' ? resolveUri(opts.baseURI, ROOT_SENTINEL) : null;
  if (isObject(root) && typeof root.$id === 'string' && !(legacyDialect(root.$schema) && root.$ref !== undefined)) {
    const own = resolveUri(root.$id, given || ROOT_SENTINEL);
    if (own !== null && splitUri(own)[0] !== '') return splitUri(own)[0];
  }
  return given !== null ? splitUri(given)[0] : null;
}

class Context {
  constructor (validator, root) {
    const opts = validator._options || {};
    this.validator = validator;
    this.opts = opts;
    this.dialect = isObject(root) && typeof root.$schema === 'string' ? root.$schema : null;
    this.rootUri = rootBase(root, opts) || ROOT_SENTINEL;
    this.root = root;
    this.resources = new Map();
    this.anchors = new Map();
    this.dynamicAnchors = new Map();
    // The registry the validator resolves through: `schemas`, `addSchema()`
    // and the meta-schemas, each under every name it was registered by.
    this.registry = validator._schemaMap instanceof Map ? validator._schemaMap : new Map();
    this.index(root, this.rootUri, '', this.dialect);
    // The caller's own documents first, as written: the registry holds
    // normalized copies (draft-07 `definitions` become `$defs`), which a
    // pointer written against the original would miss.
    const written = [];
    const given = opts.schemas;
    if (Array.isArray(given)) {
      for (const s of given) if (isObject(s) && typeof s.$id === 'string') written.push([s.$id, s]);
    } else if (isObject(given)) {
      for (const k of Object.keys(given)) {
        if (!isObject(given[k])) continue;
        written.push([k, given[k]]);
        if (typeof given[k].$id === 'string') written.push([given[k].$id, given[k]]);
      }
    }
    for (const [key, s] of written.concat([...this.registry])) {
      const uri = resolveUri(key, null);
      if (uri !== null && isObject(s) && !this.resources.has(splitUri(uri)[0])) {
        this.index(s, splitUri(uri)[0], '', typeof s.$schema === 'string' ? s.$schema : this.dialect);
      }
    }
    this.validators = new Map();
  }

  // Record every resource and anchor under `schema`, following only the
  // keywords whose values are schemas. `uri` is the resource the schema sits
  // in, `ptr` its place there, `dialect` the one it is read under.
  index (schema, uri, ptr, dialect) {
    if (!isObject(schema)) return;
    if (typeof schema.$schema === 'string') dialect = schema.$schema;
    const legacy = legacyDialect(dialect);
    if (ptr !== '' && typeof schema.$id === 'string' && !(legacy && schema.$ref !== undefined)) {
      const next = resolveUri(schema.$id, uri);
      if (next !== null && splitUri(next)[1] === '') { uri = splitUri(next)[0]; ptr = ''; }
    }
    if (ptr === '' && !this.resources.has(uri)) this.resources.set(uri, { schema, dialect });
    const at = { schema, uri, ptr, dialect };
    if (typeof schema.$anchor === 'string') this.anchors.set(uri + '#' + schema.$anchor, at);
    if (typeof schema.$dynamicAnchor === 'string') {
      this.anchors.set(uri + '#' + schema.$dynamicAnchor, at);
      this.dynamicAnchors.set(uri + '#' + schema.$dynamicAnchor, at);
    }
    // A pre-2019 plain-name `$id` such as "#foo" is an anchor.
    if (typeof schema.$id === 'string' && schema.$id.charAt(0) === '#' && schema.$id.length > 1) {
      this.anchors.set(uri + schema.$id, at);
    }
    if (legacy && schema.$ref !== undefined) return;
    for (const k of Object.keys(schema)) {
      const v = schema[k];
      const seg = ptr + '/' + pointerSegment(k);
      if (MAP.has(k) && isObject(v)) {
        for (const name of Object.keys(v)) this.index(v[name], uri, seg + '/' + pointerSegment(name), dialect);
      } else if (MANY.has(k) && Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) this.index(v[i], uri, seg + '/' + i, dialect);
      } else if (ONE.has(k)) {
        this.index(v, uri, seg, dialect);
      }
    }
  }

  // The schema a reference points at, with its resource, its place there
  // and its dialect.
  lookup (ref, baseUri) {
    let target = resolveUri(ref, baseUri);
    if (target === null) return null;
    // A registry key such as "shared" is found by name, as the validator does.
    if (!this.resources.has(splitUri(target)[0]) && this.resources.has(splitUri(ref)[0])) target = ref;
    const [uri, frag] = splitUri(target);
    if (frag !== '' && frag.charAt(0) !== '/') return this.anchors.get(uri + '#' + frag) || null;
    const res = this.resources.get(uri);
    if (res === undefined) return null;
    let schema = res.schema;
    let dialect = res.dialect;
    let ptr = '';
    if (frag !== '') {
      for (const seg of frag.slice(1).split('/')) {
        const key = unpointer(seg);
        if (schema === null || typeof schema !== 'object' || !Object.prototype.hasOwnProperty.call(schema, key)) return null;
        schema = schema[key];
        if (isObject(schema) && typeof schema.$schema === 'string') dialect = schema.$schema;
        ptr += '/' + pointerSegment(key);
      }
    }
    return { schema, uri, ptr, dialect };
  }

  // A validator for `schema` with this validator's options and registry, the
  // root registered under its URI as the engines see it (with `format`
  // stripped under `assertFormat: false`). Cached by `key`.
  probe (key, schema) {
    let v = this.validators.get(key);
    if (v !== undefined) return v;
    v = null;
    try {
      const schemas = {};
      for (const [k, s] of this.registry) schemas[k] = s;
      const engines = this.validator._schemaObj;
      const rootCopy = isObject(engines) ? engines : this.root;
      if (isObject(rootCopy)) schemas[this.rootUri] = { ...rootCopy, $id: this.rootUri };
      const opts = { ...this.opts, schemas };
      delete opts.baseURI;
      v = new this.validator.constructor(schema, opts);
    } catch { v = null; }
    this.validators.set(key, v);
    return v;
  }

  // Whether `data` passes the subschema at `uri#ptr`, read under `dialect`.
  passes (uri, ptr, dialect, data) {
    const wrapper = { $ref: uri + '#' + fragmentOf(ptr) };
    if (typeof dialect === 'string') wrapper.$schema = dialect;
    const v = this.probe('ref ' + dialect + ' ' + wrapper.$ref, wrapper);
    if (v === null) return false;
    try { return v.isValidObject(data); } catch { return false; }
  }

  // Whether a property name matches a patternProperties pattern, by the
  // validator's own pattern engine and its patternFallback option.
  matches (pattern, key) {
    const v = this.probe('pattern ' + pattern, { pattern });
    if (v === null) return false;
    try { return v.isValidObject(key); } catch { return false; }
  }
}

// What a subschema evaluated, for unevaluatedProperties and unevaluatedItems.
function evaluated () {
  return { props: new Set(), allProps: false, upTo: 0, items: new Set(), allItems: false };
}

function merge (into, from) {
  if (from === null) return;
  for (const k of from.props) into.props.add(k);
  if (from.allProps) into.allProps = true;
  if (from.upTo > into.upTo) into.upTo = from.upTo;
  for (const i of from.items) into.items.add(i);
  if (from.allItems) into.allItems = true;
}

// Walk `schema` beside `data`, pushing the annotations of a subschema that
// passed into `out`. Every caller passes only subschemas known to pass.
// `at` is { uri, ptr, dialect }: where `schema` sits in its resource and the
// dialect it is read under. `scope` is the dynamic scope, the resources
// entered so far, outermost first.
function walk (ctx, schema, data, at, path, inst, scope, out, depth) {
  const ev = evaluated();
  if (!isObject(schema) || depth > 64) return ev;

  if (typeof schema.$schema === 'string' && schema.$schema !== at.dialect) at = { ...at, dialect: schema.$schema };
  const legacy = legacyDialect(at.dialect);
  const tupleItems = legacy || /draft\/2019-09\//.test(at.dialect || '');

  // Entering an embedded resource.
  if (at.ptr !== '' && typeof schema.$id === 'string' && !(legacy && schema.$ref !== undefined)) {
    const next = resolveUri(schema.$id, at.uri);
    if (next !== null && splitUri(next)[1] === '') at = { uri: splitUri(next)[0], ptr: '', dialect: at.dialect };
  }
  if (scope[scope.length - 1] !== at.uri) scope = scope.concat(at.uri);

  const down = (sub, seg, value, instSeg) =>
    walk(ctx, sub, value, { uri: at.uri, ptr: at.ptr + seg, dialect: at.dialect },
      path + seg, inst + (instSeg || ''), scope, out, depth + 1);
  const follow = (target, seg) =>
    walk(ctx, target.schema, data, { uri: target.uri, ptr: target.ptr, dialect: target.dialect || at.dialect },
      path + seg, inst, scope, out, depth + 1);
  const passes = (seg, value) => ctx.passes(at.uri, at.ptr + seg, at.dialect, value);
  const emit = (kw, value) => {
    const unit = {
      valid: true,
      keywordLocation: path + '/' + pointerSegment(kw),
      instanceLocation: inst,
      annotation: value,
    };
    if (at.uri !== ROOT_SENTINEL) unit.absoluteKeywordLocation = at.uri + '#' + fragmentOf(at.ptr + '/' + pointerSegment(kw));
    out.push(unit);
  };

  // Before 2019-09 a $ref replaces its schema object: siblings do nothing.
  if (legacy && typeof schema.$ref === 'string') {
    const target = ctx.lookup(schema.$ref, at.uri);
    if (target !== null) merge(ev, follow(target, '/$ref'));
    return ev;
  }

  const isString = typeof data === 'string';
  for (const kw of Object.keys(schema)) {
    if (kw === 'contentEncoding' || kw === 'contentMediaType') {
      if (isString) emit(kw, schema[kw]);
    } else if (kw === 'contentSchema') {
      if (isString && schema.contentMediaType !== undefined) emit(kw, schema[kw]);
    } else if (METADATA_KEYWORDS.includes(kw) || !KNOWN.has(kw)) {
      emit(kw, schema[kw]);
    }
  }

  if (typeof schema.$ref === 'string') {
    const target = ctx.lookup(schema.$ref, at.uri);
    if (target !== null) merge(ev, follow(target, '/$ref'));
  }
  if (typeof schema.$dynamicRef === 'string') {
    let target = ctx.lookup(schema.$dynamicRef, at.uri);
    const frag = splitUri(resolveUri(schema.$dynamicRef, at.uri) || '')[1];
    // Only a reference to a $dynamicAnchor looks through the dynamic scope;
    // the outermost resource with an anchor of that name wins.
    if (target !== null && frag !== '' && frag.charAt(0) !== '/' && ctx.dynamicAnchors.has(target.uri + '#' + frag)) {
      for (const uri of scope) {
        const hit = ctx.dynamicAnchors.get(uri + '#' + frag);
        if (hit !== undefined) { target = hit; break; }
      }
    }
    if (target !== null) merge(ev, follow(target, '/$dynamicRef'));
  }

  if (Array.isArray(schema.allOf)) {
    for (let i = 0; i < schema.allOf.length; i++) merge(ev, down(schema.allOf[i], '/allOf/' + i, data, ''));
  }
  for (const kw of ['anyOf', 'oneOf']) {
    if (!Array.isArray(schema[kw])) continue;
    for (let i = 0; i < schema[kw].length; i++) {
      const seg = '/' + kw + '/' + i;
      if (passes(seg, data)) merge(ev, down(schema[kw][i], seg, data, ''));
    }
  }
  if (schema.if !== undefined) {
    if (passes('/if', data)) {
      merge(ev, down(schema.if, '/if', data, ''));
      if (schema.then !== undefined) merge(ev, down(schema.then, '/then', data, ''));
    } else if (schema.else !== undefined) {
      merge(ev, down(schema.else, '/else', data, ''));
    }
  }

  if (isObject(data)) {
    const keys = Object.keys(data);
    const props = isObject(schema.properties) ? schema.properties : null;
    const patterns = isObject(schema.patternProperties) ? Object.keys(schema.patternProperties) : [];
    for (const key of keys) {
      const instSeg = '/' + pointerSegment(key);
      let matched = false;
      if (props !== null && Object.prototype.hasOwnProperty.call(props, key)) {
        matched = true;
        down(props[key], '/properties/' + pointerSegment(key), data[key], instSeg);
        ev.props.add(key);
      }
      for (const p of patterns) {
        if (ctx.matches(p, key)) {
          matched = true;
          down(schema.patternProperties[p], '/patternProperties/' + pointerSegment(p), data[key], instSeg);
          ev.props.add(key);
        }
      }
      if (!matched && schema.additionalProperties !== undefined) {
        down(schema.additionalProperties, '/additionalProperties', data[key], instSeg);
        ev.props.add(key);
      }
    }
    const depKw = legacy ? 'dependencies' : 'dependentSchemas';
    const deps = schema[depKw];
    if (isObject(deps)) {
      for (const key of Object.keys(deps)) {
        if (Array.isArray(deps[key]) || !Object.prototype.hasOwnProperty.call(data, key)) continue;
        merge(ev, down(deps[key], '/' + depKw + '/' + pointerSegment(key), data, ''));
      }
    }
    if (schema.unevaluatedProperties !== undefined && !legacy) {
      for (const key of keys) {
        if (ev.allProps || ev.props.has(key)) continue;
        down(schema.unevaluatedProperties, '/unevaluatedProperties', data[key], '/' + pointerSegment(key));
      }
      ev.allProps = true;
    }
  }

  if (Array.isArray(data)) {
    let start = 0;
    const tuple = tupleItems ? (Array.isArray(schema.items) ? schema.items : null) : schema.prefixItems;
    const tupleKw = tupleItems ? 'items' : 'prefixItems';
    if (Array.isArray(tuple)) {
      for (let i = 0; i < tuple.length && i < data.length; i++) down(tuple[i], '/' + tupleKw + '/' + i, data[i], '/' + i);
      start = tuple.length;
      if (start > ev.upTo) ev.upTo = Math.min(start, data.length);
    }
    const rest = tupleItems && Array.isArray(schema.items) ? schema.additionalItems : schema.items;
    const restKw = tupleItems && Array.isArray(schema.items) ? 'additionalItems' : 'items';
    if (rest !== undefined && !Array.isArray(rest)) {
      for (let i = start; i < data.length; i++) down(rest, '/' + restKw, data[i], '/' + i);
      ev.allItems = true;
    }
    if (schema.contains !== undefined) {
      for (let i = 0; i < data.length; i++) {
        if (passes('/contains', data[i])) {
          down(schema.contains, '/contains', data[i], '/' + i);
          ev.items.add(i);
        }
      }
    }
    if (schema.unevaluatedItems !== undefined && !legacy) {
      for (let i = 0; i < data.length; i++) {
        if (ev.allItems || i < ev.upTo || ev.items.has(i)) continue;
        down(schema.unevaluatedItems, '/unevaluatedItems', data[i], '/' + i);
      }
      ev.allItems = true;
    }
  }

  return ev;
}

// Produce spec output for `data` under `validator`.
//   format: 'flag' | 'basic' (default 'basic')
function toOutput (validator, data, opts) {
  const format = (opts && opts.format) || 'basic';
  const result = validator.validate(data);
  if (format === 'flag') return { valid: result.valid };
  if (format !== 'basic') {
    throw new Error(`toOutput: unsupported format "${format}". Supported: "flag", "basic".`);
  }

  const schema = callerSchema(validator);
  const out = { valid: result.valid };

  if (!result.valid) {
    const base = rootBase(schema, validator._options || {});
    const errors = [];
    for (const e of result.errors) errors.push(unitFor(e, base));
    out.errors = errors;
    return out;
  }

  const ctx = new Context(validator, schema);
  const annotations = [];
  walk(ctx, schema, data, { uri: ctx.rootUri, ptr: '', dialect: ctx.dialect }, '', '', [ctx.rootUri], annotations, 0);
  if (annotations.length) out.annotations = annotations;
  return out;
}

module.exports = { toOutput, METADATA_KEYWORDS };
