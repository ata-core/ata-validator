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
// it has to know whether a subschema passed (anyOf, oneOf, if, contains), it
// asks a validator built for that subschema in place, with the root and the
// registry it was written against.
//
// `keywordLocation` is the evaluation path, through `$ref`.
// `absoluteKeywordLocation` is the keyword's place in its schema resource, and
// is given whenever the resource has a URI: its own `$id`, the `baseURI`
// option, or a registered schema's.

// Keywords whose value is the annotation they produce.
const METADATA_KEYWORDS = [
  'title', 'description', 'default', 'deprecated', 'readOnly', 'writeOnly',
  'examples', 'format', 'contentEncoding', 'contentMediaType', 'contentSchema',
];

// Keywords every dialect defines. Anything else in a schema object is an
// unknown keyword, and its value is an annotation.
const KNOWN = new Set([
  '$schema', '$id', 'id', '$anchor', '$dynamicAnchor', '$recursiveAnchor', '$ref',
  '$dynamicRef', '$recursiveRef', '$vocabulary', '$comment', '$defs', 'definitions',
  'type', 'enum', 'const', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum',
  'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems',
  'uniqueItems', 'maxContains', 'minContains', 'maxProperties', 'minProperties',
  'required', 'dependentRequired', 'dependencies', 'properties', 'patternProperties',
  'additionalProperties', 'propertyNames', 'dependentSchemas', 'prefixItems', 'items',
  'additionalItems', 'contains', 'unevaluatedItems', 'unevaluatedProperties',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  ...METADATA_KEYWORDS,
]);

// Keywords whose values are not schemas, skipped when indexing resources.
const NOT_SCHEMAS = new Set(['const', 'enum', 'default', 'examples', 'required', 'type', '$vocabulary']);

const ROOT_SENTINEL = 'urn:ata:output-root';

function pointerSegment (s) {
  return String(s).replace(/~/g, '~0').replace(/\//g, '~1');
}

function unpointer (s) {
  return decodeURIComponent(s).replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveUri (ref, base) {
  try { return new URL(ref, base).href; } catch { return null; }
}

function splitUri (uri) {
  const i = uri.indexOf('#');
  return i < 0 ? [uri, ''] : [uri.slice(0, i), uri.slice(i + 1)];
}

function isObject (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function compilePattern (p) {
  try { return new RegExp(p, 'u'); } catch { /* fall through */ }
  try { return new RegExp(p); } catch { return null; }
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
  if (base) unit.absoluteKeywordLocation = base + '#' + keywordLocation;
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

function registryList (schemas) {
  if (!schemas) return [];
  if (Array.isArray(schemas)) return schemas.filter(isObject);
  if (isObject(schemas)) {
    return Object.keys(schemas).filter((k) => isObject(schemas[k])).map((k) =>
      typeof schemas[k].$id === 'string' ? schemas[k] : { ...schemas[k], $id: k });
  }
  return [];
}

class Context {
  constructor (validator, root) {
    const opts = validator._options || {};
    this.validator = validator;
    this.opts = opts;
    this.dialect = isObject(root) && typeof root.$schema === 'string' ? root.$schema : null;
    this.legacy = this.dialect !== null && /draft-0[3-7]\/schema/.test(this.dialect);
    this.is2019 = this.dialect !== null && /draft\/2019-09\//.test(this.dialect);
    // Array-form items and additionalItems before 2020-12.
    this.tupleItems = this.legacy || this.is2019;
    let base = null;
    if (isObject(root) && typeof root.$id === 'string') base = resolveUri(root.$id, opts.baseURI || ROOT_SENTINEL);
    if (base === null && typeof opts.baseURI === 'string' && opts.baseURI !== '') base = resolveUri(opts.baseURI, ROOT_SENTINEL);
    this.rootUri = base !== null ? splitUri(base)[0] : ROOT_SENTINEL;
    this.root = root;
    this.resources = new Map();
    this.anchors = new Map();
    this.dynamicAnchors = new Map();
    this.registry = registryList(opts.schemas);
    this.index(root, this.rootUri, '');
    for (const s of this.registry) {
      const uri = resolveUri(s.$id, ROOT_SENTINEL);
      if (uri !== null) this.index(s, splitUri(uri)[0], '');
    }
    this.validators = new Map();
  }

  // Record every resource and anchor under `schema`, the way a $ref will look
  // them up. `uri` is the resource the schema sits in, `ptr` its place there.
  index (schema, uri, ptr) {
    if (!isObject(schema)) return;
    if (ptr === '' || typeof schema.$id !== 'string' || (this.legacy && schema.$ref !== undefined)) {
      if (ptr === '') this.resources.set(uri, schema);
    } else {
      const next = resolveUri(schema.$id, uri);
      if (next !== null) {
        const [u, frag] = splitUri(next);
        if (frag === '') { uri = u; ptr = ''; this.resources.set(uri, schema); }
      }
    }
    if (typeof schema.$anchor === 'string') this.anchors.set(uri + '#' + schema.$anchor, { schema, uri, ptr });
    if (typeof schema.$dynamicAnchor === 'string') {
      const at = { schema, uri, ptr };
      this.anchors.set(uri + '#' + schema.$dynamicAnchor, at);
      this.dynamicAnchors.set(uri + '#' + schema.$dynamicAnchor, at);
    }
    // A pre-2019 plain-name `$id` such as "#foo" is an anchor.
    if (typeof schema.$id === 'string' && schema.$id.charAt(0) === '#' && schema.$id.length > 1) {
      this.anchors.set(uri + schema.$id, { schema, uri, ptr });
    }
    for (const k of Object.keys(schema)) {
      if (NOT_SCHEMAS.has(k)) continue;
      const v = schema[k];
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) this.index(v[i], uri, ptr + '/' + pointerSegment(k) + '/' + i);
      } else if (isObject(v)) {
        if (k === 'properties' || k === 'patternProperties' || k === '$defs' || k === 'definitions' ||
            k === 'dependentSchemas' || k === 'dependencies') {
          for (const name of Object.keys(v)) this.index(v[name], uri, ptr + '/' + pointerSegment(k) + '/' + pointerSegment(name));
        } else {
          this.index(v, uri, ptr + '/' + pointerSegment(k));
        }
      }
    }
  }

  // The schema a reference points at, with its resource and place there.
  lookup (ref, baseUri) {
    const target = resolveUri(ref, baseUri);
    if (target === null) return null;
    const [uri, frag] = splitUri(target);
    if (frag !== '' && frag.charAt(0) !== '/') return this.anchors.get(uri + '#' + frag) || null;
    let schema = this.resources.get(uri);
    if (schema === undefined) return null;
    let ptr = '';
    if (frag !== '') {
      for (const seg of frag.slice(1).split('/')) {
        const key = unpointer(seg);
        if (schema === null || typeof schema !== 'object' || !(key in schema)) return null;
        schema = schema[key];
        ptr += '/' + pointerSegment(key);
      }
    }
    return { schema, uri, ptr };
  }

  // Whether `data` passes the subschema at `uri#ptr`, judged with the root,
  // the registry and the options it was written against.
  passes (uri, ptr, data) {
    const key = uri + '#' + ptr;
    let v = this.validators.get(key);
    if (v === undefined) {
      v = null;
      try {
        const schemas = this.registry.slice();
        if (uri === this.rootUri && isObject(this.root)) {
          schemas.push(typeof this.root.$id === 'string' && this.rootUri !== ROOT_SENTINEL
            ? this.root
            : { ...this.root, $id: this.rootUri });
        }
        const wrapper = { $ref: uri + '#' + ptr };
        if (this.dialect !== null) wrapper.$schema = this.dialect;
        const opts = { ...this.opts, schemas };
        delete opts.baseURI;
        v = new this.validator.constructor(wrapper, opts);
      } catch { v = null; }
      this.validators.set(key, v);
    }
    if (v === null) return false;
    try { return v.isValidObject(data); } catch { return false; }
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
// `at` is { uri, ptr }: where `schema` sits in its resource. `scope` is the
// dynamic scope, the resources entered so far, outermost first.
function walk (ctx, schema, data, at, path, inst, scope, out, depth) {
  const ev = evaluated();
  if (!isObject(schema) || depth > 64) return ev;

  // Entering an embedded resource.
  if (at.ptr !== '' && typeof schema.$id === 'string' && !(ctx.legacy && schema.$ref !== undefined)) {
    const next = resolveUri(schema.$id, at.uri);
    if (next !== null && splitUri(next)[1] === '') at = { uri: splitUri(next)[0], ptr: '' };
  }
  if (scope[scope.length - 1] !== at.uri) scope = scope.concat(at.uri);

  const child = (sub, seg) => ({ uri: at.uri, ptr: at.ptr + seg });
  const down = (sub, seg, value, instSeg) =>
    walk(ctx, sub, value, child(sub, seg), path + seg, inst + (instSeg || ''), scope, out, depth + 1);
  const emit = (kw, value) => {
    const unit = {
      valid: true,
      keywordLocation: path + '/' + pointerSegment(kw),
      instanceLocation: inst,
      annotation: value,
    };
    if (at.uri !== ROOT_SENTINEL) unit.absoluteKeywordLocation = at.uri + '#' + at.ptr + '/' + pointerSegment(kw);
    out.push(unit);
  };

  // Before 2019-09 a $ref replaces its schema object: siblings do nothing.
  if (ctx.legacy && typeof schema.$ref === 'string') {
    const target = ctx.lookup(schema.$ref, at.uri);
    if (target !== null) {
      merge(ev, walk(ctx, target.schema, data, { uri: target.uri, ptr: target.ptr }, path + '/$ref', inst, scope, out, depth + 1));
    }
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
    if (target !== null) {
      merge(ev, walk(ctx, target.schema, data, { uri: target.uri, ptr: target.ptr }, path + '/$ref', inst, scope, out, depth + 1));
    }
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
    if (target !== null) {
      merge(ev, walk(ctx, target.schema, data, { uri: target.uri, ptr: target.ptr }, path + '/$dynamicRef', inst, scope, out, depth + 1));
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (let i = 0; i < schema.allOf.length; i++) merge(ev, down(schema.allOf[i], '/allOf/' + i, data, ''));
  }
  for (const kw of ['anyOf', 'oneOf']) {
    if (!Array.isArray(schema[kw])) continue;
    for (let i = 0; i < schema[kw].length; i++) {
      const seg = '/' + kw + '/' + i;
      if (ctx.passes(at.uri, at.ptr + seg, data)) merge(ev, down(schema[kw][i], seg, data, ''));
    }
  }
  if (schema.if !== undefined) {
    if (ctx.passes(at.uri, at.ptr + '/if', data)) {
      merge(ev, down(schema.if, '/if', data, ''));
      if (schema.then !== undefined) merge(ev, down(schema.then, '/then', data, ''));
    } else if (schema.else !== undefined) {
      merge(ev, down(schema.else, '/else', data, ''));
    }
  }

  if (isObject(data)) {
    const keys = Object.keys(data);
    const props = isObject(schema.properties) ? schema.properties : null;
    const patterns = isObject(schema.patternProperties)
      ? Object.keys(schema.patternProperties).map((p) => [p, compilePattern(p)])
      : [];
    for (const key of keys) {
      const instSeg = '/' + pointerSegment(key);
      let matched = false;
      if (props !== null && Object.prototype.hasOwnProperty.call(props, key)) {
        matched = true;
        down(props[key], '/properties/' + pointerSegment(key), data[key], instSeg);
        ev.props.add(key);
      }
      for (const [p, re] of patterns) {
        if (re !== null && re.test(key)) {
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
    const deps = ctx.legacy ? schema.dependencies : schema.dependentSchemas;
    const depKw = ctx.legacy ? 'dependencies' : 'dependentSchemas';
    if (isObject(deps)) {
      for (const key of Object.keys(deps)) {
        if (Array.isArray(deps[key]) || !Object.prototype.hasOwnProperty.call(data, key)) continue;
        merge(ev, down(deps[key], '/' + depKw + '/' + pointerSegment(key), data, ''));
      }
    }
    if (schema.unevaluatedProperties !== undefined && !ctx.legacy) {
      for (const key of keys) {
        if (ev.allProps || ev.props.has(key)) continue;
        down(schema.unevaluatedProperties, '/unevaluatedProperties', data[key], '/' + pointerSegment(key));
      }
      ev.allProps = true;
    }
  }

  if (Array.isArray(data)) {
    let start = 0;
    const tuple = ctx.tupleItems ? (Array.isArray(schema.items) ? schema.items : null) : schema.prefixItems;
    const tupleKw = ctx.tupleItems ? 'items' : 'prefixItems';
    if (Array.isArray(tuple)) {
      for (let i = 0; i < tuple.length && i < data.length; i++) down(tuple[i], '/' + tupleKw + '/' + i, data[i], '/' + i);
      start = tuple.length;
      if (start > ev.upTo) ev.upTo = Math.min(start, data.length);
    }
    const rest = ctx.tupleItems
      ? (Array.isArray(schema.items) ? schema.additionalItems : schema.items)
      : schema.items;
    const restKw = ctx.tupleItems && Array.isArray(schema.items) ? 'additionalItems' : 'items';
    if (rest !== undefined && !Array.isArray(rest)) {
      for (let i = start; i < data.length; i++) down(rest, '/' + restKw, data[i], '/' + i);
      ev.allItems = true;
    }
    if (schema.contains !== undefined) {
      for (let i = 0; i < data.length; i++) {
        if (ctx.passes(at.uri, at.ptr + '/contains', data[i])) {
          down(schema.contains, '/contains', data[i], '/' + i);
          ev.items.add(i);
        }
      }
    }
    if (schema.unevaluatedItems !== undefined && !ctx.legacy) {
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
    const base = isObject(schema) && typeof schema.$id === 'string' ? schema.$id.split('#')[0] : null;
    const errors = [];
    for (const e of result.errors) errors.push(unitFor(e, base));
    out.errors = errors;
    return out;
  }

  const ctx = new Context(validator, schema);
  const annotations = [];
  walk(ctx, schema, data, { uri: ctx.rootUri, ptr: '' }, '', '', [ctx.rootUri], annotations, 0);
  if (annotations.length) out.annotations = annotations;
  return out;
}

module.exports = { toOutput, METADATA_KEYWORDS };
