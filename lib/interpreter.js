'use strict';

// Interpreted draft 2020-12 engine. This is the correctness fallback for
// schemas the JS codegen cannot represent when the native engine is absent
// (browser, edge workers, ATA_NO_NATIVE). It walks the schema directly with
// full annotation tracking (unevaluatedProperties/Items), $id/$anchor
// resolution, and $dynamicRef dynamic-scope semantics. Each schema node is
// resolved once into a fixed-shape Plan (type bitmask, compiled pattern,
// looked-up format, a flag per keyword group) so the walk itself reads no
// schema properties; codegen and the native engine remain the fast paths.

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
    } else if (part === 'items' && Array.isArray(node.prefixItems)) {
      // draft-07 array-form items is normalized to prefixItems; pointers
      // written against the original document still land.
      node = node.prefixItems;
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
    // Wraparound test: one compare classifies a high surrogate.
    if (((s.charCodeAt(i) - 0xd800) >>> 0) < 0x400 && i + 1 < s.length) i++;
    n++;
  }
  return n;
}

// The code point count of a UTF-16 string sits between ceil(length / 2) and
// length, so most length bounds are decided without counting anything.
function cpAtLeast(s, min) {
  if (s.length >= 2 * min) return true;
  if (s.length < min) return false;
  return codePointLength(s) >= min;
}

function cpAtMost(s, max) {
  if (s.length <= max) return true;
  if (s.length > 2 * max + 1) return false;
  return codePointLength(s) <= max;
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

const _formats = require('./formats');
const FORMAT_CHECKS = {
  email: (s) => { const at = s.indexOf('@'); return at > 0 && at < s.length - 1 && s.indexOf('.', at) > at + 1; },
  date: _formats.date,
  'date-time': _formats.dateTime,
  time: (s) => /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/.test(s),
  duration: (s) => /^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(s) && s !== 'P' && !s.endsWith('T'),
  uuid: (s) => s.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  uri: (s) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) && !/[\s\u0000-\u001f\u007f]/.test(s),
  'uri-reference': (s) => !/[\s\u0000-\u001f\u007f]/.test(s),
  ipv4: _formats.ipv4,
  ipv6: (s) => s !== '' && /^[0-9a-fA-F:.]+$/.test(s) && s.split(':').length >= 3 && s.split(':').length <= 8,
  hostname: (s) => s.length > 0 && s.length <= 253 && /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(s),
  regex: (s) => { try { new RegExp(s, 'u'); return true; } catch { try { new RegExp(s); return true; } catch { return false; } } },
  'json-pointer': (s) => s === '' || (/^\//.test(s) && !/~(?![01])/.test(s)),
};

// ---------- evaluation ----------

// Sink for subschema results whose annotations the caller never reads
// (properties, items, propertyNames and friends). eval() skips the merge when
// it sees this object, so it is never mutated.
const DISCARD = { props: null, items: null };

// Verdict-only error sink. When eval() sees this identity it neither builds
// error objects nor formats messages; every push site is guarded on it. The
// array is frozen so a missed guard throws in tests instead of hiding.
const NOERRORS = Object.freeze([]);

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

// ---------- plans ----------

// Type bits, one per JSON Schema type. `integer` data also sets the `number`
// bit so a `number` constraint accepts it.
const T_STRING = 1;
const T_NUMBER = 2;
const T_INTEGER = 4;
const T_BOOLEAN = 8;
const T_NULL = 16;
const T_OBJECT = 32;
const T_ARRAY = 64;
const T_ANY = 127;

function typeBit(name) {
  switch (name) {
    case 'string': return T_STRING;
    case 'number': return T_NUMBER;
    case 'integer': return T_INTEGER;
    case 'boolean': return T_BOOLEAN;
    case 'null': return T_NULL;
    case 'object': return T_OBJECT;
    case 'array': return T_ARRAY;
    default: return T_ANY; // unknown type names match everything
  }
}

function dataBits(d) {
  switch (typeof d) {
    case 'string': return T_STRING;
    case 'number':
      if (!isFinite(d)) return 0;
      return Number.isInteger(d) ? T_NUMBER | T_INTEGER : T_NUMBER;
    case 'boolean': return T_BOOLEAN;
    case 'object':
      if (d === null) return T_NULL;
      return Array.isArray(d) ? T_ARRAY : T_OBJECT;
    default: return 0;
  }
}

function isObjectMap(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// A plan is the schema node with every keyword resolved once: the type list
// folded to a bitmask, the format looked up, patterns compiled, and a flag
// per section so eval() can skip whole blocks without touching the schema
// object. Plans have a fixed shape, which keeps eval() monomorphic where the
// raw schema objects are not.
class Plan {
  // The plan is registered in the cache before `link` runs, so a schema
  // object that contains itself structurally resolves to the same plan
  // instead of recursing without end.
  constructor(schema) {
    this.schema = schema;
  }

  link(interp) {
    const schema = this.schema;
    // Children are linked as plans (or booleans) up front, so a visit never
    // goes back through the plan cache. Reference targets are resolved at
    // evaluation time and cached per base URI.
    const child = (sub) => interp.node(sub);
    this.refCache = null;
    this.refBase0 = undefined;
    this.refRes0 = null;
    this.dynCache = null;
    this.ref = typeof schema.$ref === 'string' ? schema.$ref : null;
    this.dynamicRef = typeof schema.$dynamicRef === 'string' ? schema.$dynamicRef : null;
    this.tracked = this.ref !== null || this.dynamicRef !== null;

    this.typeMask = 0;
    this.typeNames = null;
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      let mask = 0;
      for (const t of types) mask |= typeBit(t);
      this.typeMask = mask;
      this.typeNames = types;
    }
    this.hasType = schema.type !== undefined;
    this.enum = schema.enum !== undefined ? schema.enum : null;
    this.hasConst = schema.const !== undefined;
    this.const = schema.const;

    this.minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined;
    this.maximum = typeof schema.maximum === 'number' ? schema.maximum : undefined;
    this.exclusiveMinimum = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined;
    this.exclusiveMaximum = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined;
    this.multipleOf = typeof schema.multipleOf === 'number' ? schema.multipleOf : undefined;
    this.hasNumber = this.minimum !== undefined || this.maximum !== undefined || this.exclusiveMinimum !== undefined || this.exclusiveMaximum !== undefined || this.multipleOf !== undefined;

    this.minLength = schema.minLength;
    this.maxLength = schema.maxLength;
    this.pattern = schema.pattern !== undefined ? interp.pattern(schema.pattern) : null;
    this.patternSource = schema.pattern;
    this.format = schema.format;
    this.formatFn = null;
    if (schema.format !== undefined) {
      const uf = interp.userFormats;
      const fc = (uf && typeof uf[schema.format] === 'function') ? uf[schema.format] : FORMAT_CHECKS[schema.format];
      this.formatFn = fc || null;
    }
    this.hasString = this.minLength !== undefined || this.maxLength !== undefined || this.pattern !== null || this.formatFn !== null;

    this.minItems = schema.minItems;
    this.maxItems = schema.maxItems;
    this.uniqueItems = schema.uniqueItems === true;
    this.prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems.map(child) : null;
    this.items = schema.items !== undefined ? child(schema.items) : undefined;
    this.contains = schema.contains !== undefined ? child(schema.contains) : undefined;
    this.minContains = schema.minContains;
    this.maxContains = schema.maxContains;
    this.hasArray = this.minItems !== undefined || this.maxItems !== undefined || this.uniqueItems || this.prefixItems !== null || this.items !== undefined || this.contains !== undefined;

    this.required = Array.isArray(schema.required) ? schema.required : null;
    this.minProperties = schema.minProperties;
    this.maxProperties = schema.maxProperties;
    this.dependentRequired = isObjectMap(schema.dependentRequired) ? Object.entries(schema.dependentRequired) : null;
    this.propertyNames = schema.propertyNames !== undefined ? child(schema.propertyNames) : undefined;
    this.properties = null;
    if (isObjectMap(schema.properties)) {
      this.properties = new Map();
      for (const key of Object.keys(schema.properties)) {
        const ek = escapePointer(key);
        // Escaped once here; the walk only concatenates.
        this.properties.set(key, { node: child(schema.properties[key]), seg: '/' + ek, schemaSeg: '/properties/' + ek });
      }
    }
    this.patternProperties = null;
    if (isObjectMap(schema.patternProperties)) {
      this.patternProperties = Object.keys(schema.patternProperties).map((src) => ({ src, re: interp.pattern(src), node: child(schema.patternProperties[src]) }));
    }
    this.additionalProperties = schema.additionalProperties !== undefined ? child(schema.additionalProperties) : undefined;
    this.dependentSchemas = isObjectMap(schema.dependentSchemas) ? Object.entries(schema.dependentSchemas).map(([k, v]) => [k, child(v)]) : null;
    this.propertyDependencies = null;
    if (isObjectMap(schema.propertyDependencies)) {
      this.propertyDependencies = Object.entries(schema.propertyDependencies)
        .filter(([, choices]) => isObjectMap(choices))
        .map(([k, choices]) => [k, new Map(Object.keys(choices).map((v) => [v, child(choices[v])]))]);
    }
    this.hasObject = this.required !== null || this.minProperties !== undefined || this.maxProperties !== undefined || this.dependentRequired !== null || this.propertyNames !== undefined || this.properties !== null || this.patternProperties !== null || this.additionalProperties !== undefined || this.dependentSchemas !== null || this.propertyDependencies !== null;

    this.allOf = Array.isArray(schema.allOf) ? schema.allOf.map(child) : null;
    this.anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.map(child) : null;
    this.oneOf = Array.isArray(schema.oneOf) ? schema.oneOf.map(child) : null;
    this.not = schema.not !== undefined ? child(schema.not) : undefined;
    this.if = schema.if !== undefined ? child(schema.if) : undefined;
    this.then = schema.then !== undefined ? child(schema.then) : undefined;
    this.else = schema.else !== undefined ? child(schema.else) : undefined;
    this.hasApplicators = this.allOf !== null || this.anyOf !== null || this.oneOf !== null || this.not !== undefined || this.if !== undefined;

    this.unevaluatedProperties = schema.unevaluatedProperties !== undefined ? child(schema.unevaluatedProperties) : undefined;
    this.unevaluatedItems = schema.unevaluatedItems !== undefined ? child(schema.unevaluatedItems) : undefined;
    this.hasUnevaluated = this.unevaluatedProperties !== undefined || this.unevaluatedItems !== undefined;

    // Resource bookkeeping, read once instead of two Map lookups per visit.
    const nodeBase = interp.state.nodeBase.get(schema);
    this.nodeBase = nodeBase !== undefined ? nodeBase : null;
    this.isResourceRoot = nodeBase !== undefined && interp.state.resources.get(nodeBase) === schema;

    // A leaf plan checks only value-level keywords: no references, no
    // subschemas, no annotations, no resource boundary. Those skip the whole
    // eval() prologue (cycle guard, scope, annotation sinks) and run through
    // evalLeaf(). Most schemas are mostly leaves.
    this.leaf = !this.tracked && !this.hasApplicators && !this.hasUnevaluated &&
      this.properties === null && this.patternProperties === null &&
      this.additionalProperties === undefined && this.propertyNames === undefined &&
      this.dependentSchemas === null && this.propertyDependencies === null &&
      this.prefixItems === null && this.items === undefined && this.contains === undefined &&
      this.nodeBase === null;
  }
}


// Verdict-only twin of evalLeaf: no error objects, no path strings, first
// failure returns. Kept adjacent so the two cannot drift.
function evalLeafV(P, data) {
  const bits = dataBits(data);
  if (P.hasType && (bits & P.typeMask) === 0) return false;
  if (P.enum !== null) {
    let found = false;
    for (let i = 0; i < P.enum.length; i++) { if (deepEqual(P.enum[i], data)) { found = true; break; } }
    if (!found) return false;
  }
  if (P.hasConst && !deepEqual(P.const, data)) return false;
  if (P.hasNumber && typeof data === 'number') {
    if (P.minimum !== undefined && !(data >= P.minimum)) return false;
    if (P.maximum !== undefined && !(data <= P.maximum)) return false;
    if (P.exclusiveMinimum !== undefined && !(data > P.exclusiveMinimum)) return false;
    if (P.exclusiveMaximum !== undefined && !(data < P.exclusiveMaximum)) return false;
    if (P.multipleOf !== undefined && !multipleOfOk(data, P.multipleOf)) return false;
  }
  if (P.hasString && bits === T_STRING) {
    if (P.minLength !== undefined && !cpAtLeast(data, P.minLength)) return false;
    if (P.maxLength !== undefined && !cpAtMost(data, P.maxLength)) return false;
    if (P.pattern !== null && !P.pattern.test(data)) return false;
    if (P.formatFn !== null && !P.formatFn(data)) return false;
  }
  if (P.hasArray && bits === T_ARRAY) {
    if (P.minItems !== undefined && data.length < P.minItems) return false;
    if (P.maxItems !== undefined && data.length > P.maxItems) return false;
    if (P.uniqueItems) {
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          if (deepEqual(data[i], data[j])) return false;
        }
      }
    }
  }
  if (P.hasObject && bits === T_OBJECT) {
    if (P.required !== null) {
      const req = P.required;
      for (let i = 0; i < req.length; i++) {
        if (!Object.hasOwn(data, req[i])) return false;
      }
    }
    if (P.minProperties !== undefined && Object.keys(data).length < P.minProperties) return false;
    if (P.maxProperties !== undefined && Object.keys(data).length > P.maxProperties) return false;
    if (P.dependentRequired !== null) {
      for (const [key, deps] of P.dependentRequired) {
        if (Object.hasOwn(data, key)) {
          for (const dep of deps) if (!Object.hasOwn(data, dep)) return false;
        }
      }
    }
  }
  return true;
}

// Value-level checks only; the caller guarantees P.leaf. The bodies mirror
// the corresponding sections of eval() exactly, minus the prologue.
function evalLeaf(P, data, errors, instancePath, schemaPath) {
  let valid = true;
  const schema = P.schema;
  const bits = dataBits(data);
  if (P.hasType && (bits & P.typeMask) === 0) {
    if (errors !== NOERRORS) errors.push(err('type', 'type', instancePath, schemaPath + '/type', { type: schema.type }, `must be ${P.typeNames.join(' or ')}`));
    valid = false;
  }
  if (P.enum !== null) {
    let found = false;
    for (let i = 0; i < P.enum.length; i++) { if (deepEqual(P.enum[i], data)) { found = true; break; } }
    if (!found) {
      if (errors !== NOERRORS) errors.push(err('enum', 'enum', instancePath, schemaPath + '/enum', { allowedValues: P.enum }, 'must be equal to one of the allowed values'));
      valid = false;
    }
  }
  if (P.hasConst && !deepEqual(P.const, data)) {
    if (errors !== NOERRORS) errors.push(err('const', 'const', instancePath, schemaPath + '/const', { allowedValue: P.const }, 'must be equal to constant'));
    valid = false;
  }
  if (P.hasNumber && typeof data === 'number') {
    if (P.minimum !== undefined && !(data >= P.minimum)) { errors === NOERRORS || errors.push(err('minimum', 'minimum', instancePath, schemaPath + '/minimum', { comparison: '>=', limit: P.minimum }, `must be >= ${P.minimum}`)); valid = false; }
    if (P.maximum !== undefined && !(data <= P.maximum)) { errors === NOERRORS || errors.push(err('maximum', 'maximum', instancePath, schemaPath + '/maximum', { comparison: '<=', limit: P.maximum }, `must be <= ${P.maximum}`)); valid = false; }
    if (P.exclusiveMinimum !== undefined && !(data > P.exclusiveMinimum)) { errors === NOERRORS || errors.push(err('exclusiveMinimum', 'exclusiveMinimum', instancePath, schemaPath + '/exclusiveMinimum', { comparison: '>', limit: P.exclusiveMinimum }, `must be > ${P.exclusiveMinimum}`)); valid = false; }
    if (P.exclusiveMaximum !== undefined && !(data < P.exclusiveMaximum)) { errors === NOERRORS || errors.push(err('exclusiveMaximum', 'exclusiveMaximum', instancePath, schemaPath + '/exclusiveMaximum', { comparison: '<', limit: P.exclusiveMaximum }, `must be < ${P.exclusiveMaximum}`)); valid = false; }
    if (P.multipleOf !== undefined && !multipleOfOk(data, P.multipleOf)) { errors === NOERRORS || errors.push(err('multipleOf', 'multipleOf', instancePath, schemaPath + '/multipleOf', { multipleOf: P.multipleOf }, `must be multiple of ${P.multipleOf}`)); valid = false; }
  }
  if (P.hasString && bits === T_STRING) {
    if (P.minLength !== undefined && !cpAtLeast(data, P.minLength)) { errors === NOERRORS || errors.push(err('minLength', 'minLength', instancePath, schemaPath + '/minLength', { limit: P.minLength }, `must NOT have fewer than ${P.minLength} characters`)); valid = false; }
    if (P.maxLength !== undefined && !cpAtMost(data, P.maxLength)) { errors === NOERRORS || errors.push(err('maxLength', 'maxLength', instancePath, schemaPath + '/maxLength', { limit: P.maxLength }, `must NOT have more than ${P.maxLength} characters`)); valid = false; }
    if (P.pattern !== null && !P.pattern.test(data)) { errors === NOERRORS || errors.push(err('pattern', 'pattern', instancePath, schemaPath + '/pattern', { pattern: P.patternSource }, `must match pattern "${P.patternSource}"`)); valid = false; }
    if (P.formatFn !== null && !P.formatFn(data)) { errors === NOERRORS || errors.push(err('format', 'format', instancePath, schemaPath + '/format', { format: P.format }, `must match format "${P.format}"`)); valid = false; }
  }
  if (P.hasArray && bits === T_ARRAY) {
    if (P.minItems !== undefined && data.length < P.minItems) { errors === NOERRORS || errors.push(err('minItems', 'minItems', instancePath, schemaPath + '/minItems', { limit: P.minItems }, `must NOT have fewer than ${P.minItems} items`)); valid = false; }
    if (P.maxItems !== undefined && data.length > P.maxItems) { errors === NOERRORS || errors.push(err('maxItems', 'maxItems', instancePath, schemaPath + '/maxItems', { limit: P.maxItems }, `must NOT have more than ${P.maxItems} items`)); valid = false; }
    if (P.uniqueItems) {
      outer: for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          if (deepEqual(data[i], data[j])) {
            if (errors !== NOERRORS) errors.push(err('uniqueItems', 'uniqueItems', instancePath, schemaPath + '/uniqueItems', { i, j }, 'must NOT have duplicate items'));
            valid = false;
            break outer;
          }
        }
      }
    }
  }
  if (P.hasObject && bits === T_OBJECT) {
    const keys = Object.keys(data);
    if (P.required !== null) {
      const req = P.required;
      for (let i = 0; i < req.length; i++) {
        const key = req[i];
        if (!Object.hasOwn(data, key)) { errors === NOERRORS || errors.push(err('required', 'required', instancePath, schemaPath + '/required', { missingProperty: key }, `must have required property '${key}'`)); valid = false; }
      }
    }
    if (P.minProperties !== undefined && keys.length < P.minProperties) { errors === NOERRORS || errors.push(err('minProperties', 'minProperties', instancePath, schemaPath + '/minProperties', { limit: P.minProperties }, `must NOT have fewer than ${P.minProperties} properties`)); valid = false; }
    if (P.maxProperties !== undefined && keys.length > P.maxProperties) { errors === NOERRORS || errors.push(err('maxProperties', 'maxProperties', instancePath, schemaPath + '/maxProperties', { limit: P.maxProperties }, `must NOT have more than ${P.maxProperties} properties`)); valid = false; }
    if (P.dependentRequired !== null) {
      for (const [key, deps] of P.dependentRequired) {
        if (Object.hasOwn(data, key)) {
          for (const dep of deps) {
            if (!Object.hasOwn(data, dep)) { errors === NOERRORS || errors.push(err('required', 'required', instancePath, schemaPath + '/dependentRequired', { missingProperty: dep }, `must have required property '${dep}'`)); valid = false; }
          }
        }
      }
    }
  }
  return valid;
}

class Interpreter {
  constructor(rootSchema, options) {
    const opts = options || {};
    this.root = rootSchema;
    this.state = indexSchemas(rootSchema, opts.schemaMap);
    this.userFormats = opts.formats || null;
    // 2020-12 requires bookending for `$dynamicRef`; v1 removes the
    // requirement. See the `$dynamicRef` branch in eval().
    this.bookending = !opts.v1;
    this.patternCache = new Map();
    // Plans are built on first visit; a schema node is never re-read after.
    this.plans = new Map();
    this.rootNode = this.node(rootSchema);
    // Compiled closure tree: undefined = not attempted, null = out of scope.
    this._fast = undefined;
  }

  // The closure-tree compiler covers every schema the interpreter accepts;
  // eval() stays as the reference the compiled tree is diffed against.
  // Compiled lazily so construction stays cheap for schemas that never
  // validate.
  _fastRoot() {
    if (this._fast === undefined) {
      try { this._fast = compileInterpreter(this); } catch { this._fast = null; }
    }
    return this._fast;
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

  plan(schema) {
    let p = this.plans.get(schema);
    if (p === undefined) {
      p = new Plan(schema);
      this.plans.set(schema, p);
      p.link(this);
    }
    return p;
  }

  // $ref resolution depends on the base URI in effect, which can differ
  // between visits of the same node; cache per (plan, base). Nearly every
  // plan only ever sees one base, so the last resolution lives in two plain
  // fields and the Map exists only for the rare second base. The cached
  // entry carries the already-planned child, so a visit does no Map lookups.
  resolveRefCached(P, base) {
    if (P.refBase0 === base) return P.refRes0;
    let cache = P.refCache;
    let r = cache !== null ? cache.get(base) : undefined;
    if (r === undefined) {
      const raw = resolveRef(P.ref, base, this.state);
      r = { child: raw.node === undefined ? undefined : this.node(raw.node), base: raw.base };
      if (P.refBase0 === undefined) { P.refBase0 = base; P.refRes0 = r; }
      else { if (cache === null) cache = P.refCache = new Map(); cache.set(base, r); }
    }
    return r;
  }

  // The static half of $dynamicRef (initial target and fragment) per base;
  // the dynamic-scope search still runs on every visit.
  resolveDynamicRefCached(P, base) {
    let cache = P.dynCache;
    if (cache === null) cache = P.dynCache = new Map();
    let r = cache.get(base);
    if (r === undefined) {
      const { node, base: refBase } = resolveRef(P.dynamicRef, base, this.state);
      const [, fragment] = splitFragment(resolveUri(base, P.dynamicRef));
      r = { node, base: refBase, fragment, byAnchor: Boolean(fragment) && !fragment.startsWith('/') };
      cache.set(base, r);
    }
    return r;
  }

  // Maps any schema value to what eval() accepts: a boolean or a Plan.
  // Non-object, non-boolean values validate everything, as before.
  node(schema) {
    if (schema === true || schema === false) return schema;
    if (typeof schema !== 'object' || schema === null) return true;
    return this.plan(schema);
  }

  // Verdict only: same walk as validate(), no error construction at all.
  isValid(data) {
    const fast = this._fastRoot();
    if (fast !== null) return fast.v(data, fast.cyclic ? [] : null);
    const dynScope = [this.state.rootBase];
    return this.eval(this.rootNode, data, this.state.rootBase, dynScope, NOERRORS, '', '#', [], DISCARD);
  }

  validate(data) {
    const fast = this._fastRoot();
    if (fast !== null) {
      const errors = [];
      const valid = fast.c(data, errors, '', '#', fast.cyclic ? [] : null);
      return valid ? { valid: true, data, errors: [] } : { valid: false, errors };
    }
    const errors = [];
    const dynScope = [this.state.rootBase];
    // Nothing reads the root's annotations, so they are discarded from the start.
    const valid = this.eval(this.rootNode, data, this.state.rootBase, dynScope, errors, '', '#', [], DISCARD);
    return valid ? { valid: true, data, errors: [] } : { valid: false, errors };
  }

  // Evaluates `schema` against `data`. Collected annotations for data are
  // written into `sink` ({props, items}); errors append to `errors`.
  // `stack` breaks infinite $ref recursion on identical (schema, data) pairs.
  eval(P, data, base, dynScope, errors, instancePath, schemaPath, stack, sink) {
    if (P === true) return true;
    if (P === false) {
      if (errors !== NOERRORS) errors.push(err('false schema', 'not', instancePath, schemaPath, {}, 'boolean schema is false'));
      return false;
    }
    if (P.leaf) return evalLeaf(P, data, errors, instancePath, schemaPath);
    const schema = P.schema;

    // Only a reference can lead evaluation back to a schema it is already
    // inside of, so the cycle guard is maintained on reference nodes alone.
    // The frame is pushed in place and popped on the way out; the array is
    // created per validate() call, so a throw leaves nothing to clean up.
    const tracked = P.tracked;
    if (tracked) {
      for (let i = stack.length - 2; i >= 0; i -= 2) {
        if (stack[i] === schema && stack[i + 1] === data) return true; // fixed point
      }
      stack.push(schema, data);
    }

    if (P.nodeBase !== null && P.nodeBase !== base) base = P.nodeBase;
    // Entering a schema resource extends the dynamic scope, whether evaluation
    // lands on the resource's root or on a subschema inside it: a reference
    // to first#/$defs/stuff still passes through resource `first`. The scope
    // is pushed in place and popped on the way out; evaluation is depth-first
    // and nothing retains the array.
    let scopePushed = false;
    if (dynScope[dynScope.length - 1] !== base) {
      dynScope.push(base);
      scopePushed = true;
    }

    let valid = true;
    // Annotations only matter if this node or an ancestor reads them. When
    // nobody does, in-place children get the discard sink too and `local`
    // stays unallocated.
    const collect = sink !== DISCARD || P.hasUnevaluated;
    const local = collect ? { props: null, items: null } : DISCARD;

    // $ref / $dynamicRef: in-place applicators, annotations flow through
    if (P.ref !== null) {
      const { child, base: refBase } = this.resolveRefCached(P, base);
      if (child === undefined) {
        if (errors !== NOERRORS) errors.push(err('$ref', '$ref', instancePath, schemaPath + '/$ref', { ref: P.ref }, `cannot resolve $ref ${P.ref}`));
        valid = false;
      } else {
        const sub = collect ? { props: null, items: null } : DISCARD;
        if (!this.eval(child, data, refBase, dynScope, errors, instancePath, schemaPath + '/$ref', stack, sub)) valid = false;
        else if (collect) mergeAnnotations(local, sub);
      }
    }

    if (P.dynamicRef !== null) {
      const ref = P.dynamicRef;
      const initial = this.resolveDynamicRefCached(P, base);
      let node = initial.node;
      let refBase = initial.base;
      const fragment = initial.fragment;
      if (initial.byAnchor) {
        // Under 2020-12 the initial target must itself carry the matching
        // $dynamicAnchor before the dynamic scope is consulted (bookending);
        // otherwise the keyword behaves like $ref. v1 removes that
        // requirement, so the scope is searched whether or not the initial
        // target carries the anchor, and also when the reference does not
        // resolve on its own, which is the shape the suite uses: a
        // `$dynamicRef` in a resource that declares no anchor of that name.
        const initialDyn = this.state.dynamicAnchors.get(refBase);
        const bookended = node !== undefined && initialDyn && initialDyn.get(fragment) === node;
        if (bookended || !this.bookending) {
          // Outermost scope first: the first matching $dynamicAnchor
          // encountered while evaluating wins.
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
        if (errors !== NOERRORS) errors.push(err('$dynamicRef', '$dynamicRef', instancePath, schemaPath + '/$dynamicRef', { ref }, `cannot resolve $dynamicRef ${ref}`));
        valid = false;
      } else {
        const sub = collect ? { props: null, items: null } : DISCARD;
        if (!this.eval(this.node(node), data, refBase, dynScope, errors, instancePath, schemaPath + '/$dynamicRef', stack, sub)) valid = false;
        else if (collect) mergeAnnotations(local, sub);
      }
    }

    const bits = dataBits(data);

    // type / enum / const
    if (P.hasType && (bits & P.typeMask) === 0) {
      if (errors !== NOERRORS) errors.push(err('type', 'type', instancePath, schemaPath + '/type', { type: schema.type }, `must be ${P.typeNames.join(' or ')}`));
      valid = false;
    }
    if (P.enum !== null) {
      let found = false;
      for (let i = 0; i < P.enum.length; i++) { if (deepEqual(P.enum[i], data)) { found = true; break; } }
      if (!found) {
        if (errors !== NOERRORS) errors.push(err('enum', 'enum', instancePath, schemaPath + '/enum', { allowedValues: P.enum }, 'must be equal to one of the allowed values'));
        valid = false;
      }
    }
    if (P.hasConst && !deepEqual(P.const, data)) {
      if (errors !== NOERRORS) errors.push(err('const', 'const', instancePath, schemaPath + '/const', { allowedValue: P.const }, 'must be equal to constant'));
      valid = false;
    }

    // numbers
    if (P.hasNumber && typeof data === 'number') {
      if (P.minimum !== undefined && !(data >= P.minimum)) { errors === NOERRORS || errors.push(err('minimum', 'minimum', instancePath, schemaPath + '/minimum', { comparison: '>=', limit: P.minimum }, `must be >= ${P.minimum}`)); valid = false; }
      if (P.maximum !== undefined && !(data <= P.maximum)) { errors === NOERRORS || errors.push(err('maximum', 'maximum', instancePath, schemaPath + '/maximum', { comparison: '<=', limit: P.maximum }, `must be <= ${P.maximum}`)); valid = false; }
      if (P.exclusiveMinimum !== undefined && !(data > P.exclusiveMinimum)) { errors === NOERRORS || errors.push(err('exclusiveMinimum', 'exclusiveMinimum', instancePath, schemaPath + '/exclusiveMinimum', { comparison: '>', limit: P.exclusiveMinimum }, `must be > ${P.exclusiveMinimum}`)); valid = false; }
      if (P.exclusiveMaximum !== undefined && !(data < P.exclusiveMaximum)) { errors === NOERRORS || errors.push(err('exclusiveMaximum', 'exclusiveMaximum', instancePath, schemaPath + '/exclusiveMaximum', { comparison: '<', limit: P.exclusiveMaximum }, `must be < ${P.exclusiveMaximum}`)); valid = false; }
      if (P.multipleOf !== undefined && !multipleOfOk(data, P.multipleOf)) { errors === NOERRORS || errors.push(err('multipleOf', 'multipleOf', instancePath, schemaPath + '/multipleOf', { multipleOf: P.multipleOf }, `must be multiple of ${P.multipleOf}`)); valid = false; }
    }

    // strings
    if (P.hasString && bits === T_STRING) {
      if (P.minLength !== undefined && !cpAtLeast(data, P.minLength)) { errors === NOERRORS || errors.push(err('minLength', 'minLength', instancePath, schemaPath + '/minLength', { limit: P.minLength }, `must NOT have fewer than ${P.minLength} characters`)); valid = false; }
      if (P.maxLength !== undefined && !cpAtMost(data, P.maxLength)) { errors === NOERRORS || errors.push(err('maxLength', 'maxLength', instancePath, schemaPath + '/maxLength', { limit: P.maxLength }, `must NOT have more than ${P.maxLength} characters`)); valid = false; }
      if (P.pattern !== null && !P.pattern.test(data)) { errors === NOERRORS || errors.push(err('pattern', 'pattern', instancePath, schemaPath + '/pattern', { pattern: P.patternSource }, `must match pattern "${P.patternSource}"`)); valid = false; }
      if (P.formatFn !== null && !P.formatFn(data)) { errors === NOERRORS || errors.push(err('format', 'format', instancePath, schemaPath + '/format', { format: P.format }, `must match format "${P.format}"`)); valid = false; }
    }

    // arrays
    if (P.hasArray && bits === T_ARRAY) {
      if (P.minItems !== undefined && data.length < P.minItems) { errors === NOERRORS || errors.push(err('minItems', 'minItems', instancePath, schemaPath + '/minItems', { limit: P.minItems }, `must NOT have fewer than ${P.minItems} items`)); valid = false; }
      if (P.maxItems !== undefined && data.length > P.maxItems) { errors === NOERRORS || errors.push(err('maxItems', 'maxItems', instancePath, schemaPath + '/maxItems', { limit: P.maxItems }, `must NOT have more than ${P.maxItems} items`)); valid = false; }
      if (P.uniqueItems) {
        outer: for (let i = 0; i < data.length; i++) {
          for (let j = i + 1; j < data.length; j++) {
            if (deepEqual(data[i], data[j])) {
              if (errors !== NOERRORS) errors.push(err('uniqueItems', 'uniqueItems', instancePath, schemaPath + '/uniqueItems', { i, j }, 'must NOT have duplicate items'));
              valid = false;
              break outer;
            }
          }
        }
      }
      const prefix = P.prefixItems;
      if (prefix !== null) {
        const n = Math.min(prefix.length, data.length);
        for (let i = 0; i < n; i++) {
          if (!this.eval(prefix[i], data[i], base, dynScope, errors, instancePath + '/' + i, schemaPath + '/prefixItems/' + i, stack, DISCARD)) valid = false;
          if (collect) { if (!local.items) local.items = new Set(); local.items.add(i); }
        }
      }
      if (P.items !== undefined) {
        const start = prefix !== null ? prefix.length : 0;
        for (let i = start; i < data.length; i++) {
          if (!this.eval(P.items, data[i], base, dynScope, errors, instancePath + '/' + i, schemaPath + '/items', stack, DISCARD)) valid = false;
          if (collect) { if (!local.items) local.items = new Set(); local.items.add(i); }
        }
      }
      if (P.contains !== undefined) {
        const matched = [];
        for (let i = 0; i < data.length; i++) {
          const scratch = errors === NOERRORS ? NOERRORS : [];
          if (this.eval(P.contains, data[i], base, dynScope, scratch, instancePath + '/' + i, schemaPath + '/contains', stack, DISCARD)) matched.push(i);
        }
        const minC = P.minContains !== undefined ? P.minContains : 1;
        if (matched.length < minC) { errors === NOERRORS || errors.push(err('contains', 'contains', instancePath, schemaPath + '/contains', { minContains: minC }, `must contain at least ${minC} valid item(s)`)); valid = false; }
        if (P.maxContains !== undefined && matched.length > P.maxContains) { errors === NOERRORS || errors.push(err('maxContains', 'maxContains', instancePath, schemaPath + '/maxContains', { limit: P.maxContains }, `must NOT contain more than ${P.maxContains} valid item(s)`)); valid = false; }
        if (collect && matched.length) {
          if (!local.items) local.items = new Set();
          for (const i of matched) local.items.add(i);
        }
      }
    }

    // objects
    if (P.hasObject && bits === T_OBJECT) {
      const keys = Object.keys(data);
      if (P.required !== null) {
        const req = P.required;
        for (let i = 0; i < req.length; i++) {
          const key = req[i];
          if (!Object.hasOwn(data, key)) { errors === NOERRORS || errors.push(err('required', 'required', instancePath, schemaPath + '/required', { missingProperty: key }, `must have required property '${key}'`)); valid = false; }
        }
      }
      if (P.minProperties !== undefined && keys.length < P.minProperties) { errors === NOERRORS || errors.push(err('minProperties', 'minProperties', instancePath, schemaPath + '/minProperties', { limit: P.minProperties }, `must NOT have fewer than ${P.minProperties} properties`)); valid = false; }
      if (P.maxProperties !== undefined && keys.length > P.maxProperties) { errors === NOERRORS || errors.push(err('maxProperties', 'maxProperties', instancePath, schemaPath + '/maxProperties', { limit: P.maxProperties }, `must NOT have more than ${P.maxProperties} properties`)); valid = false; }
      if (P.dependentRequired !== null) {
        for (const [key, deps] of P.dependentRequired) {
          if (Object.hasOwn(data, key)) {
            for (const dep of deps) {
              if (!Object.hasOwn(data, dep)) { errors === NOERRORS || errors.push(err('required', 'required', instancePath, schemaPath + '/dependentRequired', { missingProperty: dep }, `must have required property '${dep}'`)); valid = false; }
            }
          }
        }
      }
      if (P.propertyNames !== undefined) {
        for (const key of keys) {
          if (!this.eval(P.propertyNames, key, base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/propertyNames', stack, DISCARD)) valid = false;
        }
      }
      const props = P.properties;
      const patterns = P.patternProperties;
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        let evaluated = false;
        const prop = props !== null ? props.get(key) : undefined;
        if (prop !== undefined) {
          if (!this.eval(prop.node, data[key], base, dynScope, errors, instancePath + prop.seg, schemaPath + prop.schemaSeg, stack, DISCARD)) valid = false;
          evaluated = true;
        }
        if (patterns !== null) {
          for (let pi = 0; pi < patterns.length; pi++) {
            const pp = patterns[pi];
            if (pp.re.test(key)) {
              if (!this.eval(pp.node, data[key], base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/patternProperties/' + escapePointer(pp.src), stack, DISCARD)) valid = false;
              evaluated = true;
            }
          }
        }
        if (!evaluated && P.additionalProperties !== undefined) {
          if (!this.eval(P.additionalProperties, data[key], base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/additionalProperties', stack, DISCARD)) valid = false;
          evaluated = true;
        }
        if (evaluated && collect) {
          if (!local.props) local.props = new Set();
          local.props.add(key);
        }
      }
      if (P.dependentSchemas !== null) {
        for (const [key, dep] of P.dependentSchemas) {
          if (Object.hasOwn(data, key)) {
            const sub = collect ? { props: null, items: null } : DISCARD;
            if (!this.eval(dep, data, base, dynScope, errors, instancePath, schemaPath + '/dependentSchemas/' + escapePointer(key), stack, sub)) valid = false;
            else if (collect) mergeAnnotations(local, sub);
          }
        }
      }
      // propertyDependencies: like dependentSchemas but keyed on the property's
      // value rather than its presence. Only string values can match, since the
      // inner keys are object keys. Equivalent to
      // `if: { properties: { p: { const: v } }, required: [p] }, then: <schema>`.
      if (P.propertyDependencies !== null) {
        for (const [key, choices] of P.propertyDependencies) {
          if (!Object.hasOwn(data, key)) continue;
          const value = data[key];
          if (typeof value !== 'string') continue;
          const choice = choices.get(value);
          if (choice === undefined) continue;
          const sub = collect ? { props: null, items: null } : DISCARD;
          const branchPath = schemaPath + '/propertyDependencies/' + escapePointer(key) + '/' + escapePointer(value);
          if (!this.eval(choice, data, base, dynScope, errors, instancePath, branchPath, stack, sub)) valid = false;
          else if (collect) mergeAnnotations(local, sub);
        }
      }
    }

    // in-place applicators
    if (P.hasApplicators) {
      if (P.allOf !== null) {
        for (let i = 0; i < P.allOf.length; i++) {
          const sub = collect ? { props: null, items: null } : DISCARD;
          if (!this.eval(P.allOf[i], data, base, dynScope, errors, instancePath, schemaPath + '/allOf/' + i, stack, sub)) valid = false;
          else if (collect) mergeAnnotations(local, sub);
        }
      }
      if (P.anyOf !== null) {
        let any = false;
        const scratch = errors === NOERRORS ? NOERRORS : [];
        for (let i = 0; i < P.anyOf.length; i++) {
          const sub = collect ? { props: null, items: null } : DISCARD;
          if (this.eval(P.anyOf[i], data, base, dynScope, scratch, instancePath, schemaPath + '/anyOf/' + i, stack, sub)) {
            any = true;
            if (collect) mergeAnnotations(local, sub);
          }
        }
        if (!any) {
          if (errors !== NOERRORS) for (const e of scratch) errors.push(e);
          if (errors !== NOERRORS) errors.push(err('anyOf', 'anyOf', instancePath, schemaPath + '/anyOf', {}, 'must match a schema in anyOf'));
          valid = false;
        }
      }
      if (P.oneOf !== null) {
        let count = 0;
        let winner = null;
        const scratch = errors === NOERRORS ? NOERRORS : [];
        for (let i = 0; i < P.oneOf.length; i++) {
          const sub = collect ? { props: null, items: null } : DISCARD;
          if (this.eval(P.oneOf[i], data, base, dynScope, scratch, instancePath, schemaPath + '/oneOf/' + i, stack, sub)) {
            count++;
            winner = sub;
          }
        }
        if (count === 1) { if (collect) mergeAnnotations(local, winner); }
        else {
          if (count === 0) for (const e of scratch) errors.push(e);
          if (errors !== NOERRORS) errors.push(err('oneOf', 'oneOf', instancePath, schemaPath + '/oneOf', { passingSchemas: count }, 'must match exactly one schema in oneOf'));
          valid = false;
        }
      }
      if (P.not !== undefined) {
        const scratch = errors === NOERRORS ? NOERRORS : [];
        if (this.eval(P.not, data, base, dynScope, scratch, instancePath, schemaPath + '/not', stack, DISCARD)) {
          if (errors !== NOERRORS) errors.push(err('not', 'not', instancePath, schemaPath + '/not', {}, 'must NOT be valid'));
          valid = false;
        }
      }
      if (P.if !== undefined) {
        const ifSub = collect ? { props: null, items: null } : DISCARD;
        const ifScratch = errors === NOERRORS ? NOERRORS : [];
        const ifOk = this.eval(P.if, data, base, dynScope, ifScratch, instancePath, schemaPath + '/if', stack, ifSub);
        if (ifOk) {
          if (collect) mergeAnnotations(local, ifSub);
          if (P.then !== undefined) {
            const sub = collect ? { props: null, items: null } : DISCARD;
            if (!this.eval(P.then, data, base, dynScope, errors, instancePath, schemaPath + '/then', stack, sub)) valid = false;
            else if (collect) mergeAnnotations(local, sub);
          }
        } else if (P.else !== undefined) {
          const sub = collect ? { props: null, items: null } : DISCARD;
          if (!this.eval(P.else, data, base, dynScope, errors, instancePath, schemaPath + '/else', stack, sub)) valid = false;
          else if (collect) mergeAnnotations(local, sub);
        }
      }
    }

    // unevaluated*: run last, against annotations from everything above
    if (P.hasUnevaluated) {
      if (P.unevaluatedProperties !== undefined && bits === T_OBJECT) {
        for (const key of Object.keys(data)) {
          if (local.props && local.props.has(key)) continue;
          if (!this.eval(P.unevaluatedProperties, data[key], base, dynScope, errors, instancePath + '/' + escapePointer(key), schemaPath + '/unevaluatedProperties', stack, DISCARD)) valid = false;
          if (!local.props) local.props = new Set();
          local.props.add(key);
        }
      }
      if (P.unevaluatedItems !== undefined && bits === T_ARRAY) {
        for (let i = 0; i < data.length; i++) {
          if (local.items && local.items.has(i)) continue;
          if (!this.eval(P.unevaluatedItems, data[i], base, dynScope, errors, instancePath + '/' + i, schemaPath + '/unevaluatedItems', stack, DISCARD)) valid = false;
          if (!local.items) local.items = new Set();
          local.items.add(i);
        }
      }
    }

    if (scopePushed) dynScope.pop();
    if (tracked) stack.length -= 2;
    if (valid && collect && sink !== DISCARD) mergeAnnotations(sink, local);
    return valid;
  }
}

function escapePointer(s) {
  if (typeof s !== 'string') s = String(s);
  // Keys almost never contain `~` or `/`; skip the two regex passes when so.
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x7e || c === 0x2f) return s.replace(/~/g, '~0').replace(/\//g, '~1');
  }
  return s;
}

function err(code, keyword, instancePath, schemaPath, params, message) {
  return { keyword, instancePath, schemaPath, params, message };
}

const { compileInterpreter } = require('./plan-compiler').install({
  Plan, NOERRORS, err, evalLeaf, evalLeafV, dataBits, escapePointer,
  deepEqual, multipleOfOk, cpAtLeast, cpAtMost,
  T_STRING, T_ARRAY, T_OBJECT, resolveRef, splitFragment, resolveUri,
});

function createInterpreter(schema, options) {
  return new Interpreter(schema, options);
}

module.exports = { createInterpreter };
