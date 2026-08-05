'use strict';

// Interpreted draft 2020-12 engine. This is the correctness fallback for
// schemas the JS codegen cannot represent when the native engine is absent
// (browser, edge workers, ATA_NO_NATIVE). It walks the schema directly with
// full annotation tracking (unevaluatedProperties/Items), $id/$anchor
// resolution, and $dynamicRef dynamic-scope semantics. It optimizes for
// correctness and clarity, not speed: hot paths belong to codegen and the
// native engine.

const { compileSafe } = require('./safe-regex');

const SCHEMA_KEYWORDS = {
  single: ['additionalProperties', 'contains', 'propertyNames', 'if', 'then', 'else', 'not', 'items', 'unevaluatedItems', 'unevaluatedProperties'],
  maps: ['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas'],
  lists: ['allOf', 'anyOf', 'oneOf', 'prefixItems'],
};

const FALLBACK_BASE = 'ata://root';

function resolveUri(base, ref) {
  try {
    return new URL(ref, base || FALLBACK_BASE).href;
  } catch {
    return ref;
  }
}

function splitFragment(uri) {
  const hash = uri.indexOf('#');
  if (hash < 0) return [uri, ''];
  return [uri.slice(0, hash), decodeURIComponent(uri.slice(hash + 1))];
}

// ---------- resource index ----------

function indexSchemas(rootSchema, schemaMap) {
  const state = {
    resources: new Map(), // baseUri -> schema node of the resource root
    anchors: new Map(), // baseUri -> Map(anchorName -> node)
    dynamicAnchors: new Map(), // baseUri -> Map(anchorName -> node)
    nodeBase: new Map(), // schema node -> baseUri of its enclosing resource
    rootBase: FALLBACK_BASE,
  };

  const rootBase =
    typeof rootSchema === 'object' && rootSchema !== null && typeof rootSchema.$id === 'string'
      ? resolveUri(FALLBACK_BASE, splitFragment(rootSchema.$id)[0])
      : FALLBACK_BASE;
  state.rootBase = rootBase;
  indexResource(rootSchema, rootBase, state);

  if (schemaMap) {
    for (const [id, schema] of schemaMap) {
      const base = resolveUri(FALLBACK_BASE, splitFragment(id)[0]);
      if (!state.resources.has(base)) indexResource(schema, base, state);
      // Also register under the raw key so non-URI ids stay addressable.
      if (!state.resources.has(id)) state.resources.set(id, schema);
    }
  }
  return state;
}

function indexResource(node, baseUri, state) {
  if (typeof node !== 'object' || node === null) return;
  if (!state.resources.has(baseUri)) state.resources.set(baseUri, node);
  if (!state.anchors.has(baseUri)) state.anchors.set(baseUri, new Map());
  if (!state.dynamicAnchors.has(baseUri)) state.dynamicAnchors.set(baseUri, new Map());
  walkSchema(node, baseUri, state, true);
}

function walkSchema(node, baseUri, state, isResourceRoot) {
  if (typeof node !== 'object' || node === null) return;
  if (state.nodeBase.has(node)) return; // cycle guard
  state.nodeBase.set(node, baseUri);

  if (!isResourceRoot && typeof node.$id === 'string') {
    // Embedded resource: new base URI, indexed as its own resource.
    const newBase = splitFragment(resolveUri(baseUri, node.$id))[0];
    state.nodeBase.delete(node); // re-register under the new base
    indexResource(node, newBase, state);
    return;
  }

  if (typeof node.$anchor === 'string') state.anchors.get(baseUri).set(node.$anchor, node);
  if (typeof node.$dynamicAnchor === 'string') {
    state.dynamicAnchors.get(baseUri).set(node.$dynamicAnchor, node);
    // A $dynamicAnchor is also addressable as a plain anchor.
    state.anchors.get(baseUri).set(node.$dynamicAnchor, node);
  }

  for (const kw of SCHEMA_KEYWORDS.single) {
    if (node[kw] !== undefined) walkSchema(node[kw], baseUri, state, false);
  }
  for (const kw of SCHEMA_KEYWORDS.maps) {
    const map = node[kw];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const key of Object.keys(map)) walkSchema(map[key], baseUri, state, false);
    }
  }
  for (const kw of SCHEMA_KEYWORDS.lists) {
    const list = node[kw];
    if (Array.isArray(list)) for (const sub of list) walkSchema(sub, baseUri, state, false);
  }
  // propertyDependencies nests one level deeper than the other maps:
  // property name -> property value -> schema.
  const propDeps = node.propertyDependencies;
  if (propDeps && typeof propDeps === 'object' && !Array.isArray(propDeps)) {
    for (const choices of Object.values(propDeps)) {
      if (choices && typeof choices === 'object' && !Array.isArray(choices)) {
        for (const sub of Object.values(choices)) walkSchema(sub, baseUri, state, false);
      }
    }
  }
}

// ---------- ref resolution ----------

function walkPointer(root, pointer) {
  if (pointer === '' || pointer === '/') return root;
  const parts = pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = root;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      node = node[Number(part)];
    } else if (part in node) {
      node = node[part];
    } else if (part === 'definitions' && node.$defs) {
      // draft-07 normalization renames definitions to $defs; keep old
      // pointers working (mirrors the 1.0.2 alias fix).
      node = node.$defs;
    } else if (part === '$defs' && node.definitions) {
      node = node.definitions;
    } else {
      return undefined;
    }
  }
  return node;
}

function resolveRef(ref, fromBase, state) {
  const abs = resolveUri(fromBase, ref);
  const [uri, fragment] = splitFragment(abs);
  let resource = state.resources.get(uri);
  let resourceBase = uri;
  if (resource === undefined && (uri === FALLBACK_BASE || uri === '')) {
    resource = state.resources.get(state.rootBase);
    resourceBase = state.rootBase;
  }
  if (resource === undefined) {
    // Raw-id registration (schemaMap keys that are not URIs).
    const [rawUri, rawFragment] = splitFragment(ref);
    if (state.resources.has(rawUri)) {
      resource = state.resources.get(rawUri);
      resourceBase = rawUri;
      if (rawFragment === '') return { node: resource, base: resourceBase };
      if (rawFragment.startsWith('/')) return { node: walkPointer(resource, rawFragment), base: resourceBase };
      const anchored = state.anchors.get(resourceBase);
      return { node: anchored ? anchored.get(rawFragment) : undefined, base: resourceBase };
    }
    return { node: undefined, base: resourceBase };
  }
  if (fragment === '') return { node: resource, base: resourceBase };
  if (fragment.startsWith('/')) {
    const node = walkPointer(resource, fragment);
    // A pointer can land inside an embedded resource; its recorded base wins.
    const base = node !== null && typeof node === 'object' && state.nodeBase.has(node) ? state.nodeBase.get(node) : resourceBase;
    return { node, base };
  }
  const anchored = state.anchors.get(resourceBase);
  return { node: anchored ? anchored.get(fragment) : undefined, base: resourceBase };
}

// ---------- value helpers ----------

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!(k in b) || !deepEqual(a[k], b[k])) return false;
  }
  return true;
}

function codePointLength(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) i++;
    n++;
  }
  return n;
}

function typeMatches(type, d) {
  switch (type) {
    case 'string': return typeof d === 'string';
    case 'number': return typeof d === 'number' && isFinite(d);
    case 'integer': return typeof d === 'number' && Number.isInteger(d);
    case 'boolean': return typeof d === 'boolean';
    case 'null': return d === null;
    case 'array': return Array.isArray(d);
    case 'object': return typeof d === 'object' && d !== null && !Array.isArray(d);
    default: return true;
  }
}

function multipleOfOk(d, m) {
  if (m === 0) return false;
  const q = d / m;
  if (Number.isInteger(q)) return true;
  // Float remainder tolerance (0.0075 % 0.0001 style cases)
  return Math.abs(q - Math.round(q)) < 1e-9;
}

const FORMAT_CHECKS = {
  email: (s) => { const at = s.indexOf('@'); return at > 0 && at < s.length - 1 && s.indexOf('.', at) > at + 1; },
  date: (s) => { if (s.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const m = +s.slice(5, 7), d = +s.slice(8, 10); return m >= 1 && m <= 12 && d >= 1 && d <= 31; },
  'date-time': (s) => /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(s) && !isNaN(Date.parse(s)),
  time: (s) => /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/.test(s),
  duration: (s) => /^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(s) && s !== 'P' && !s.endsWith('T'),
  uuid: (s) => s.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  uri: (s) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) && !/[\s\u0000-\u001f\u007f]/.test(s),
  'uri-reference': (s) => !/[\s\u0000-\u001f\u007f]/.test(s),
  ipv4: (s) => { const p = s.split('.'); return p.length === 4 && p.every((n) => { const v = +n; return n !== '' && v >= 0 && v <= 255 && String(v) === n; }); },
  ipv6: (s) => s !== '' && /^[0-9a-fA-F:.]+$/.test(s) && s.split(':').length >= 3 && s.split(':').length <= 8,
  hostname: (s) => s.length > 0 && s.length <= 253 && /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(s),
  regex: (s) => { try { new RegExp(s, 'u'); return true; } catch { try { new RegExp(s); return true; } catch { return false; } } },
  'json-pointer': (s) => s === '' || (/^\//.test(s) && !/~(?![01])/.test(s)),
};

// ---------- evaluation ----------

const NO_ANNOTATIONS = { props: null, items: null };

function mergeAnnotations(target, from) {
  if (from.props && from.props.size) {
    if (!target.props) target.props = new Set();
    for (const p of from.props) target.props.add(p);
  }
  if (from.items && from.items.size) {
    if (!target.items) target.items = new Set();
    for (const i of from.items) target.items.add(i);
  }
}

class Interpreter {
  constructor(rootSchema, options) {
    const opts = options || {};
    this.root = rootSchema;
    this.state = indexSchemas(rootSchema, opts.schemaMap);
    this.userFormats = opts.formats || null;
    this.patternCache = new Map();
  }

  pattern(src) {
    let re = this.patternCache.get(src);
    if (!re) {
      if (/\\[pP]\{/.test(src)) {
        // Unicode property escapes need a real RegExp in unicode mode; the
        // linear engine does not understand them.
        try { re = new RegExp(src, 'u'); } catch { re = new RegExp(src); }
      } else {
        try {
          re = compileSafe(src);
        } catch {
          try { re = new RegExp(src, 'u'); } catch { re = new RegExp(src); }
        }
      }
      this.patternCache.set(src, re);
    }
    return re;
  }

  validate(data) {
    const errors = [];
    const dynScope = [this.state.rootBase];
    const valid = this.eval(this.root, data, this.state.rootBase, dynScope, errors, '', '#', [], NO_ANNOTATIONS_SINK());
    return valid ? { valid: true, data, errors: [] } : { valid: false, errors };
  }

  // Evaluates `schema` against `data`. Collected annotations for data are
  // written into `sink` ({props, items}); errors append to `errors`.
  // `stack` breaks infinite $ref recursion on identical (schema, data) pairs.
  eval(schema, data, base, dynScope, errors, instancePath, schemaPath, stack, sink) {
    if (schema === true) return true;
    if (schema === false) {
      errors.push(err('false schema', 'not', instancePath, schemaPath, {}, 'boolean schema is false'));
      return false;
    }
    if (typeof schema !== 'object' || schema === null) return true;

    for (const frame of stack) {
      if (frame[0] === schema && frame[1] === data) return true; // fixed point
    }
    stack = stack.concat([[schema, data]]);

    const nodeBase = this.state.nodeBase.get(schema);
    if (nodeBase !== undefined && nodeBase !== base) base = nodeBase;
    // Entering a schema resource extends the dynamic scope.
    if (this.state.resources.get(base) === schema && dynScope[dynScope.length - 1] !== base) {
      dynScope = dynScope.concat(base);
    }

    let valid = true;
    const local = { props: null, items: null };

    // $ref / $dynamicRef: in-place applicators, annotations flow through
    if (typeof schema.$ref === 'string') {
      const { node, base: refBase } = resolveRef(schema.$ref, base, this.state);
      if (node === undefined) {
        errors.push(err('$ref', '$ref', instancePath, schemaPath + '/$ref', { ref: schema.$ref }, `cannot resolve $ref ${schema.$ref}`));
        valid = false;
      } else {
        const sub = { props: null, items: null };
        if (!this.eval(node, data, refBase, dynScope, errors, instancePath, schemaPath + '/$ref', stack, sub)) valid = false;
        else mergeAnnotations(local, sub);
      }
    }

    if (typeof schema.$dynamicRef === 'string') {
      const ref = schema.$dynamicRef;
      let { node, base: refBase } = resolveRef(ref, base, this.state);
      const [, fragment] = splitFragment(resolveUri(base, ref));
      if (node !== undefined && fragment && !fragment.startsWith('/')) {
        // Initial target must itself carry the matching $dynamicAnchor for
        // dynamic resolution; otherwise it behaves like $ref.
        const initialDyn = this.state.dynamicAnchors.get(refBase);
        if (initialDyn && initialDyn.get(fragment) === node) {
          for (const scopeBase of dynScope) {
            const dyn = this.state.dynamicAnchors.get(scopeBase);
            if (dyn && dyn.has(fragment)) {
              node = dyn.get(fragment);
              refBase = scopeBase;
              break;
            }
          }
        }
      }
      if (node === undefined) {
        errors.push(err('$dynamicRef', '$dynamicRef', instancePath, schemaPath + '/$dynamicRef', { ref }, `cannot resolve $dynamicRef ${ref}`));
        valid = false;
      } else {
        const sub = { props: null, items: null };
        if (!this.eval(node, data, refBase, dynScope, errors, instancePath, schemaPath + '/$dynamicRef', stack, sub)) valid = false;
        else mergeAnnotations(local, sub);
      }
    }

    // type / enum / const
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => typeMatches(t, data))) {
        errors.push(err('type', 'type', instancePath, schemaPath + '/type', { type: schema.type }, `must be ${types.join(' or ')}`));
        valid = false;
      }
    }
    if (schema.enum !== undefined) {
      if (!schema.enum.some((v) => deepEqual(v, data))) {
        errors.push(err('enum', 'enum', instancePath, schemaPath + '/enum', { allowedValues: schema.enum }, 'must be equal to one of the allowed values'));
        valid = false;
      }
    }
    if (schema.const !== undefined) {
      if (!deepEqual(schema.const, data)) {
        errors.push(err('const', 'const', instancePath, schemaPath + '/const', { allowedValue: schema.const }, 'must be equal to constant'));
        valid = false;
      }
    }

    // numbers
    if (typeof data === 'number') {
      if (typeof schema.minimum === 'number' && !(data >= schema.minimum)) { errors.push(err('minimum', 'minimum', instancePath, schemaPath + '/minimum', { comparison: '>=', limit: schema.minimum }, `must be >= ${schema.minimum}`)); valid = false; }
      if (typeof schema.maximum === 'number' && !(data <= schema.maximum)) { errors.push(err('maximum', 'maximum', instancePath, schemaPath + '/maximum', { comparison: '<=', limit: schema.maximum }, `must be <= ${schema.maximum}`)); valid = false; }
      if (typeof schema.exclusiveMinimum === 'number' && !(data > schema.exclusiveMinimum)) { errors.push(err('exclusiveMinimum', 'exclusiveMinimum', instancePath, schemaPath + '/exclusiveMinimum', { comparison: '>', limit: schema.exclusiveMinimum }, `must be > ${schema.exclusiveMinimum}`)); valid = false; }
      if (typeof schema.exclusiveMaximum === 'number' && !(data < schema.exclusiveMaximum)) { errors.push(err('exclusiveMaximum', 'exclusiveMaximum', instancePath, schemaPath + '/exclusiveMaximum', { comparison: '<', limit: schema.exclusiveMaximum }, `must be < ${schema.exclusiveMaximum}`)); valid = false; }
      if (typeof schema.multipleOf === 'number' && !multipleOfOk(data, schema.multipleOf)) { errors.push(err('multipleOf', 'multipleOf', instancePath, schemaPath + '/multipleOf', { multipleOf: schema.multipleOf }, `must be multiple of ${schema.multipleOf}`)); valid = false; }
    }

    // strings
    if (typeof data === 'string') {
      if (schema.minLength !== undefined && codePointLength(data) < schema.minLength) { errors.push(err('minLength', 'minLength', instancePath, schemaPath + '/minLength', { limit: schema.minLength }, `must NOT have fewer than ${schema.minLength} characters`)); valid = false; }
      if (schema.maxLength !== undefined && codePointLength(data) > schema.maxLength) { errors.push(err('maxLength', 'maxLength', instancePath, schemaPath + '/maxLength', { limit: schema.maxLength }, `must NOT have more than ${schema.maxLength} characters`)); valid = false; }
      if (schema.pattern !== undefined && !this.pattern(schema.pattern).test(data)) { errors.push(err('pattern', 'pattern', instancePath, schemaPath + '/pattern', { pattern: schema.pattern }, `must match pattern "${schema.pattern}"`)); valid = false; }
      if (schema.format !== undefined) {
        const fc = (this.userFormats && typeof this.userFormats[schema.format] === 'function') ? this.userFormats[schema.format] : FORMAT_CHECKS[schema.format];
        if (fc && !fc(data)) { errors.push(err('format', 'format', instancePath, schemaPath + '/format', { format: schema.format }, `must match format "${schema.format}"`)); valid = false; }
      }
    }

    // arrays
    if (Array.isArray(data)) {
      if (schema.minItems !== undefined && data.length < schema.minItems) { errors.push(err('minItems', 'minItems', instancePath, schemaPath + '/minItems', { limit: schema.minItems }, `must NOT have fewer than ${schema.minItems} items`)); valid = false; }
      if (schema.maxItems !== undefined && data.length > schema.maxItems) { errors.push(err('maxItems', 'maxItems', instancePath, schemaPath + '/maxItems', { limit: schema.maxItems }, `must NOT have more than ${schema.maxItems} items`)); valid = false; }
      if (schema.uniqueItems === true) {
        outer: for (let i = 0; i < data.length; i++) {
          for (let j = i + 1; j < data.length; j++) {
            if (deepEqual(data[i], data[j])) {
              errors.push(err('uniqueItems', 'uniqueItems', instancePath, schemaPath + '/uniqueItems', { i, j }, 'must NOT have duplicate items'));
              valid = false;
              break outer;
            }
          }
        }
      }
      const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : null;
      if (prefix) {
        for (let i = 0; i < Math.min(prefix.length, data.length); i++) {
          const sub = { props: null, items: null };
          if (!this.eval(prefix[i], data[i], base, dynScope, errors, instancePath + '/' + i, schemaPath + '/prefixItems/' + i, stack, sub)) valid = false;
          if (!local.items) local.items = new Set();
          local.items.add(i);
        }
      }
      if (schema.items !== undefined) {
        const start = prefix ? prefix.length : 0;
        for (let i = start; i < data.length; i++) {
          const sub = { props: null, items: null };
          if (!this.eval(schema.items, data[i], base, dynScope, errors, instancePath + '/' + i, schemaPath + '/items', stack, sub)) valid = false;
          if (!local.items) local.items = new Set();
          local.items.add(i);
        }
      }
      if (schema.contains !== undefined) {
        const matched = [];
        for (let i = 0; i < data.length; i++) {
          const scratch = [];
          const sub = { props: null, items: null };
          if (this.eval(schema.contains, data[i], base, dynScope, scratch, instancePath + '/' + i, schemaPath + '/contains', stack, sub)) matched.push(i);
        }
        const minC = schema.minContains !== undefined ? schema.minContains : 1;
        if (matched.length < minC) { errors.push(err('contains', 'contains', instancePath, schemaPath + '/contains', { minContains: minC }, `must contain at least ${minC} valid item(s)`)); valid = false; }
        if (schema.maxContains !== undefined && matched.length > schema.maxContains) { errors.push(err('maxContains', 'maxContains', instancePath, schemaPath + '/maxContains', { limit: schema.maxContains }, `must NOT contain more than ${schema.maxContains} valid item(s)`)); valid = false; }
        if (matched.length) {
          if (!local.items) local.items = new Set();
          for (const i of matched) local.items.add(i);
        }
      }
    }

    // objects
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const keys = Object.keys(data);
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (!Object.prototype.hasOwnProperty.call(data, key)) { errors.push(err('required', 'required', instancePath, schemaPath + '/required', { missingProperty: key }, `must have required property '${key}'`)); valid = false; }
        }
      }
      if (schema.minProperties !== undefined && keys.length < schema.minProperties) { errors.push(err('minProperties', 'minProperties', instancePath, schemaPath + '/minProperties', { limit: schema.minProperties }, `must NOT have fewer than ${schema.minProperties} properties`)); valid = false; }
      if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) { errors.push(err('maxProperties', 'maxProperties', instancePath, schemaPath + '/maxProperties', { limit: schema.maxProperties }, `must NOT have more than ${schema.maxProperties} properties`)); valid = false; }
      if (schema.dependentRequired && typeof schema.dependentRequired === 'object') {
        for (const [key, deps] of Object.entries(schema.dependentRequired)) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            for (const dep of deps) {
              if (!Object.prototype.hasOwnProperty.call(data, dep)) { errors.push(err('required', 'required', instancePath, schemaPath + '/dependentRequired', { missingProperty: dep }, `must have required property '${dep}'`)); valid = false; }
            }
          }
        }
      }
      if (schema.propertyNames !== undefined) {
        for (const key of keys) {
          if (!this.eval(schema.propertyNames, key, base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/propertyNames', stack, { props: null, items: null })) valid = false;
        }
      }
      const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : null;
      const patterns = schema.patternProperties && typeof schema.patternProperties === 'object' ? Object.keys(schema.patternProperties) : null;
      for (const key of keys) {
        let evaluated = false;
        if (props && Object.prototype.hasOwnProperty.call(props, key)) {
          const sub = { props: null, items: null };
          if (!this.eval(props[key], data[key], base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/properties/' + escapePointer(key), stack, sub)) valid = false;
          evaluated = true;
        }
        if (patterns) {
          for (const src of patterns) {
            if (this.pattern(src).test(key)) {
              const sub = { props: null, items: null };
              if (!this.eval(schema.patternProperties[src], data[key], base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/patternProperties/' + escapePointer(src), stack, sub)) valid = false;
              evaluated = true;
            }
          }
        }
        if (!evaluated && schema.additionalProperties !== undefined) {
          const sub = { props: null, items: null };
          if (!this.eval(schema.additionalProperties, data[key], base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/additionalProperties', stack, sub)) valid = false;
          evaluated = true;
        }
        if (evaluated) {
          if (!local.props) local.props = new Set();
          local.props.add(key);
        }
      }
      if (schema.dependentSchemas && typeof schema.dependentSchemas === 'object') {
        for (const [key, dep] of Object.entries(schema.dependentSchemas)) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            const sub = { props: null, items: null };
            if (!this.eval(dep, data, base, dynScope, errors, instancePath, schemaPath + '/dependentSchemas/' + escapePointer(key), stack, sub)) valid = false;
            else mergeAnnotations(local, sub);
          }
        }
      }
      // propertyDependencies: like dependentSchemas but keyed on the property's
      // value rather than its presence. Only string values can match, since the
      // inner keys are object keys. Equivalent to
      // `if: { properties: { p: { const: v } }, required: [p] }, then: <schema>`.
      if (schema.propertyDependencies && typeof schema.propertyDependencies === 'object') {
        for (const [key, choices] of Object.entries(schema.propertyDependencies)) {
          if (!choices || typeof choices !== 'object' || Array.isArray(choices)) continue;
          if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
          const value = data[key];
          if (typeof value !== 'string') continue;
          if (!Object.prototype.hasOwnProperty.call(choices, value)) continue;
          const sub = { props: null, items: null };
          const branchPath = schemaPath + '/propertyDependencies/' + escapePointer(key) + '/' + escapePointer(value);
          if (!this.eval(choices[value], data, base, dynScope, errors, instancePath, branchPath, stack, sub)) valid = false;
          else mergeAnnotations(local, sub);
        }
      }
    }

    // in-place applicators
    if (Array.isArray(schema.allOf)) {
      for (let i = 0; i < schema.allOf.length; i++) {
        const sub = { props: null, items: null };
        if (!this.eval(schema.allOf[i], data, base, dynScope, errors, instancePath, schemaPath + '/allOf/' + i, stack, sub)) valid = false;
        else mergeAnnotations(local, sub);
      }
    }
    if (Array.isArray(schema.anyOf)) {
      let any = false;
      const scratch = [];
      for (let i = 0; i < schema.anyOf.length; i++) {
        const sub = { props: null, items: null };
        if (this.eval(schema.anyOf[i], data, base, dynScope, scratch, instancePath, schemaPath + '/anyOf/' + i, stack, sub)) {
          any = true;
          mergeAnnotations(local, sub);
        }
      }
      if (!any) {
        for (const e of scratch) errors.push(e);
        errors.push(err('anyOf', 'anyOf', instancePath, schemaPath + '/anyOf', {}, 'must match a schema in anyOf'));
        valid = false;
      }
    }
    if (Array.isArray(schema.oneOf)) {
      let count = 0;
      let winner = null;
      const scratch = [];
      for (let i = 0; i < schema.oneOf.length; i++) {
        const sub = { props: null, items: null };
        if (this.eval(schema.oneOf[i], data, base, dynScope, scratch, instancePath, schemaPath + '/oneOf/' + i, stack, sub)) {
          count++;
          winner = sub;
        }
      }
      if (count === 1) mergeAnnotations(local, winner);
      else {
        if (count === 0) for (const e of scratch) errors.push(e);
        errors.push(err('oneOf', 'oneOf', instancePath, schemaPath + '/oneOf', { passingSchemas: count }, 'must match exactly one schema in oneOf'));
        valid = false;
      }
    }
    if (schema.not !== undefined) {
      const scratch = [];
      if (this.eval(schema.not, data, base, dynScope, scratch, instancePath, schemaPath + '/not', stack, { props: null, items: null })) {
        errors.push(err('not', 'not', instancePath, schemaPath + '/not', {}, 'must NOT be valid'));
        valid = false;
      }
    }
    if (schema.if !== undefined) {
      const ifSub = { props: null, items: null };
      const ifScratch = [];
      const ifOk = this.eval(schema.if, data, base, dynScope, ifScratch, instancePath, schemaPath + '/if', stack, ifSub);
      if (ifOk) {
        mergeAnnotations(local, ifSub);
        if (schema.then !== undefined) {
          const sub = { props: null, items: null };
          if (!this.eval(schema.then, data, base, dynScope, errors, instancePath, schemaPath + '/then', stack, sub)) valid = false;
          else mergeAnnotations(local, sub);
        }
      } else if (schema.else !== undefined) {
        const sub = { props: null, items: null };
        if (!this.eval(schema.else, data, base, dynScope, errors, instancePath, schemaPath + '/else', stack, sub)) valid = false;
        else mergeAnnotations(local, sub);
      }
    }

    // unevaluated*: run last, against annotations from everything above
    if (schema.unevaluatedProperties !== undefined && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      for (const key of Object.keys(data)) {
        if (local.props && local.props.has(key)) continue;
        const sub = { props: null, items: null };
        if (!this.eval(schema.unevaluatedProperties, data[key], base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/unevaluatedProperties', stack, sub)) valid = false;
        if (!local.props) local.props = new Set();
        local.props.add(key);
      }
    }
    if (schema.unevaluatedItems !== undefined && Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        if (local.items && local.items.has(i)) continue;
        const sub = { props: null, items: null };
        if (!this.eval(schema.unevaluatedItems, data[i], base, dynScope, errors, instancePath + '/' + i, schemaPath + '/unevaluatedItems', stack, sub)) valid = false;
        if (!local.items) local.items = new Set();
        local.items.add(i);
      }
    }

    if (valid) mergeAnnotations(sink, local);
    return valid;
  }
}

function NO_ANNOTATIONS_SINK() {
  return { props: null, items: null };
}

function escapePointer(s) {
  return String(s).replace(/~/g, '~0').replace(/\//g, '~1');
}

function err(code, keyword, instancePath, schemaPath, params, message) {
  return { keyword, instancePath, schemaPath, params, message };
}

function createInterpreter(schema, options) {
  return new Interpreter(schema, options);
}

module.exports = { createInterpreter };
