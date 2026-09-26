'use strict';

// The copy behind parse(): shared by the parse() export of an ahead-of-time
// module (lib/aot-impl.js) and the runtime's Validator#parse (index.js). It
// lives apart from the module emitter so the runtime can use it without
// pulling the emitter, and the safe-regex source it embeds, into a browser
// bundle.

const { compileToJSCodegen, unevalContributions } = require('./js-compiler');

// Emit an expression that rebuilds `access` from the properties the schema
// declares, dropping everything else. This is the sanitising counterpart to
// removeAdditional: instead of enumerating the input and deleting the keys
// that do not belong, it reads only the keys that do. That is O(schema)
// rather than O(input), it leaves the caller's object untouched, and it keeps
// one hidden class instead of walking the object through a transition per
// delete.
//
// Returns null when the clone cannot be proven exact, and the module then
// simply has no parse(). Declining is recoverable; a sanitiser that quietly
// drops a property the schema allows is not.
// Resolve a local JSON pointer ('#', '#/$defs/x', draft-7 '#/definitions/x',
// any '#/...' path) against the schema root. Returns null for anything else:
// external documents, anchors, URNs. Those stay with the runtime engines.
function resolveLocalPointer(root, ref) {
  if (ref === '#') return root;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let cur = root;
  for (const raw of ref.slice(2).split('/')) {
    let seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
      try { seg = decodeURIComponent(seg); } catch (_) { return null; }
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return null;
    }
    cur = cur[seg];
  }
  return cur;
}

// Inline local, acyclic $refs before the clone proof runs, so a generated
// schema ($defs + $ref, the shape every schema generator emits) can still get
// a parse(). Only a node that is exactly a $ref plus annotations is replaced;
// a $ref with a constraining sibling, a cycle, an unresolvable target or an
// external reference is left in place, and emitClone declines it as before.
// The walk never mutates its input and never descends into data positions
// (default, const, enum, examples), where an object holding a "$ref" key is
// a value, not a schema.
const _INLINE_ANNOTATIONS = new Set(['$ref', 'title', 'description', '$comment', 'examples', 'deprecated', 'readOnly', 'writeOnly', 'default']);
const _INLINE_DATA_KEYS = new Set(['default', 'const', 'enum', 'examples']);
function inlineRefsForClone(root) {
  const state = { budget: 512 };
  // `inRef` marks content brought in from behind a reference. The runtime's
  // useDefaults fills a default written next to the $ref, and does not fill
  // defaults written inside the referenced definition, so the inlined copy
  // keeps the first and drops the second. parse() must stay exactly as
  // generous as validate(); a parse that fills more is a disagreement, not a
  // feature.
  const walk = (node, active, inRef) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n) => walk(n, active, inRef));
    let cur = node;
    let entered = false;
    let siblingDefault;
    while (cur && typeof cur === 'object' && !Array.isArray(cur) && typeof cur.$ref === 'string') {
      for (const k of Object.keys(cur)) if (!_INLINE_ANNOTATIONS.has(k)) return node;
      if (active.has(cur.$ref) || state.budget-- <= 0) return node;
      const target = resolveLocalPointer(root, cur.$ref);
      if (!target || typeof target !== 'object' || Array.isArray(target)) return node;
      if (!entered && !inRef && cur.default !== undefined) siblingDefault = cur.default;
      active = new Set(active);
      active.add(cur.$ref);
      cur = target;
      entered = true;
    }
    const strip = inRef || entered;
    const out = {};
    for (const k of Object.keys(cur)) {
      if (strip && k === 'default') continue;
      const v = cur[k];
      if (_INLINE_DATA_KEYS.has(k) || k === '$defs' || k === 'definitions') { out[k] = v; continue; }
      out[k] = walk(v, active, strip);
    }
    if (siblingDefault !== undefined) out.default = siblingDefault;
    return out;
  };
  return walk(root, new Set(), false);
}

const PROTO_KEY_NAMES = new Set([...Object.getOwnPropertyNames(Object.prototype), '__proto__']);

function emitClone(node, access, depth) {
  if (!node || typeof node !== 'object') return null;
  if (depth > 12) return null;
  // Only plain object nodes are cloneable, and only when the schema names
  // every property it keeps. A $ref means the set of allowed keys is not
  // this node's to decide. In-place applicators (allOf, anyOf, oneOf,
  // if/then/else) are admitted under the same proof the unevaluated* error
  // generators use: every property name they contribute must already be
  // declared in this node's own `properties`, so they constrain values but
  // never widen the key set. `not` never widens it. `unevaluatedProperties`
  // is admitted only as `false` under that proof, where it is exactly
  // `additionalProperties: false`.
  if (node.$ref || node.patternProperties || node.additionalProperties === true) {
    return null;
  }
  // additionalProperties as a schema is the record shape (z.record and every
  // generator's map type): the key set is open by declaration, so keeping
  // every key is exact, and every undeclared value is rebuilt against that
  // one schema. That is a proof, not a guess, so it is admitted. What stays
  // out: applicators next to a record (a branch could constrain some keys'
  // values beyond the record schema, and the rebuild would ignore it), and
  // `additionalProperties: true`, where the value is unconstrained and this
  // pass only copies what it can name. An open object with no
  // `additionalProperties` at all also stays out, for the original reason:
  // validate() accepts its unknown keys, so a parse() that strips them would
  // silently drop allowed data, and one that keeps them raw would not be a
  // sanitiser.
  const apSchema = (node.additionalProperties && typeof node.additionalProperties === 'object')
    ? node.additionalProperties
    : null;
  if (apSchema) {
    if (node.unevaluatedProperties !== undefined) return null;
    if (node.allOf || node.anyOf || node.oneOf || node.if || node.then || node.else ||
        node.dependentSchemas !== undefined || node.dependencies !== undefined ||
        node.$dynamicRef !== undefined || node.$recursiveRef !== undefined) return null;
  }
  if (node.unevaluatedProperties !== undefined && node.unevaluatedProperties !== false) return null;
  if (node.type !== 'object') return null;
  if (!node.properties && !apSchema) return null;
  const keys = node.properties ? Object.keys(node.properties) : [];
  if (keys.length === 0 && !apSchema) return null;
  if (node.allOf || node.anyOf || node.oneOf || node.if || node.then || node.else ||
      node.unevaluatedProperties === false) {
    if (node.$dynamicRef !== undefined || node.$recursiveRef !== undefined ||
        node.dependentSchemas !== undefined || node.dependencies !== undefined) return null;
    const names = new Set();
    const state = { prefix: 0 };
    for (const k of ['allOf', 'anyOf', 'oneOf']) {
      if (node[k] !== undefined) {
        if (!Array.isArray(node[k])) return null;
        for (const b of node[k]) if (!unevalContributions(b, 'props', names, state, 0)) return null;
      }
    }
    for (const k of ['if', 'then', 'else']) {
      if (node[k] !== undefined && !unevalContributions(node[k], 'props', names, state, 0)) return null;
    }
    for (const n of names) if (!Object.prototype.hasOwnProperty.call(node.properties, n)) return null;
  }
  const required = new Set(Array.isArray(node.required) ? node.required : []);

  const fixed = [];
  const conditional = [];
  for (const key of keys) {
    const prop = node.properties[key];
    if (!prop || typeof prop !== 'object') return null;
    if (prop.$ref) return null;
    // A property that is required and carries a default is the one place the
    // runtime and a raw-input validation disagree: the runtime fills the
    // default before checking `required`, so `{}` validates there and would
    // throw here. Declining keeps parse() exactly as strict as validate().
    if (required.has(key) && prop.default !== undefined) return null;
    // A default the property's own schema rejects would make parse() hand
    // back a document validate() refuses: the runtime fills defaults before
    // validating, so it catches the bad default, and a raw-input check here
    // never sees it. Probe the default at emit time and decline when it does
    // not hold, or when the subschema cannot be compiled to check it.
    if (prop.default !== undefined) {
      let probe = null;
      try { probe = compileToJSCodegen(prop, null, null); } catch (_) { probe = null; }
      if (!probe || !probe(prop.default)) return null;
    }
    const read = `${access}[${JSON.stringify(key)}]`;
    const value = emitValueExpr(prop, read, depth);
    if (value === null) return null;
    // A plain `"__proto__":` in an object literal is the prototype slot, not
    // a property; `["__proto__"]:` is a property. Only that key is written as
    // a computed one: a literal with computed keys cannot use the engine's
    // literal boilerplate and is built key by key, which made the copy cost
    // about as much as the validation in front of it.
    if (required.has(key)) fixed.push(key === '__proto__' ? `[${JSON.stringify(key)}]: ${value}` : `${JSON.stringify(key)}: ${value}`);
    else conditional.push({ key, value, dflt: prop.default });
  }
  if (fixed.length === 0 && conditional.length === 0 && !apSchema) return null;

  const tmp = `_c${depth}`;
  // The record loop: every key of the input that is not a declared property
  // is kept, its value rebuilt against the additionalProperties schema. The
  // input is already validated, so every such value satisfies that schema;
  // the rebuild only strips inside it. Defaults under a record value are
  // dropped before emission because the runtime's useDefaults does not fill
  // them there, and parse() must equal validate().data, not improve on it.
  let recordLoop = '';
  if (apSchema) {
    const kVar = `_k${depth}`;
    const vVar = `_v${depth}`;
    const valueExpr = emitValueExpr(stripDefaultsDeep(apSchema), vVar, depth);
    if (valueExpr === null) return null;
    let skip = '';
    let declSet = '';
    if (keys.length > 8) {
      declSet = `const _d${depth} = new Set(${JSON.stringify(keys)}); `;
      skip = `if (_d${depth}.has(${kVar})) continue; `;
    } else if (keys.length > 0) {
      skip = `if (${keys.map((k) => `${kVar} === ${JSON.stringify(k)}`).join(' || ')}) continue; `;
    }
    // The key comes from the input, so it can be the string "__proto__" (an
    // own key only JSON.parse writes); assignment would hit the prototype
    // setter, so that one key goes through defineProperty.
    recordLoop = ` ${declSet}for (const ${kVar} of Object.keys(${access})) { ${skip}const ${vVar} = ${access}[${kVar}]; if (${kVar} === "__proto__") Object.defineProperty(${tmp}, ${kVar}, { value: ${valueExpr}, writable: true, enumerable: true, configurable: true }); else ${tmp}[${kVar}] = ${valueExpr}; }`;
  }

  const literal = `{ ${fixed.join(', ')} }`;
  if (conditional.length === 0 && !recordLoop) return literal;
  // Optional properties are added only when present, so the result never
  // gains a key the input did not have.
  const adds = conditional
    .map(({ key, value, dflt }) => {
      // Object.hasOwn, not `in`: `in` also answers for what the instance
      // inherits, so a property named `constructor` would copy the inherited
      // function into the output that validate().data does not carry. And a
      // key named `__proto__` cannot be written by assignment, which hits
      // the prototype setter; defineProperty writes an own key.
      const assign = key === '__proto__'
        ? `Object.defineProperty(${tmp}, ${JSON.stringify(key)}, { value: ${value}, writable: true, enumerable: true, configurable: true });`
        : `${tmp}[${JSON.stringify(key)}] = ${value};`;
      // The same own-property test the generators emit, since Object.hasOwn
      // is not inlined: `in`, then the prototype, then hasOwnProperty only
      // for an object that is not an ordinary one.
      const k = JSON.stringify(key);
      const own = PROTO_KEY_NAMES.has(key)
        ? `Object.prototype.hasOwnProperty.call(${access}, ${k})`
        : `(${k} in ${access} && (${access}.__proto__ === Object.prototype || Object.prototype.hasOwnProperty.call(${access}, ${k})))`;
      const set = `if (${own}) ${assign}`;
      // The default is emitted as a literal inside the call, so an object or
      // array default is a fresh value on every parse, never shared state.
      if (dflt === undefined) return set;
      const setDflt = key === '__proto__'
        ? `Object.defineProperty(${tmp}, ${JSON.stringify(key)}, { value: ${JSON.stringify(dflt)}, writable: true, enumerable: true, configurable: true });`
        : `${tmp}[${JSON.stringify(key)}] = ${JSON.stringify(dflt)};`;
      return `${set} else ${setDflt}`;
    })
    .join(' ');
  return `(function(){ const ${tmp} = ${literal}; ${adds}${recordLoop} return ${tmp}; })()`;
}

// The value dispatch shared by declared properties and the record loop. A
// value is copyable only when the emitter can name everything that may live
// under it: a primitive holds nothing, an object with declared properties or
// a record schema is rebuilt the same way, an array of primitives has
// nowhere to hide a key. A $ref, a composition or an untyped node could all
// carry keys this code cannot see, and copying the reference would smuggle
// them into a value that claims to be sanitised, so the caller declines the
// whole clone instead.
// Drop every schema-position `default` in a subtree, leaving data positions
// (const, enum, examples) untouched. Used on a record's value schema, where
// the runtime's useDefaults fills nothing.
function stripDefaultsDeep(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(stripDefaultsDeep);
  const out = {};
  for (const k of Object.keys(node)) {
    if (k === 'default') continue;
    out[k] = _INLINE_DATA_KEYS.has(k) ? node[k] : stripDefaultsDeep(node[k]);
  }
  return out;
}

const _CLONE_PRIMITIVE = new Set(['string', 'number', 'integer', 'boolean', 'null']);
function emitValueExpr(prop, read, depth) {
  if (!prop || typeof prop !== 'object') return null;
  if (prop.$ref) return null;
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  if (types.every((t) => _CLONE_PRIMITIVE.has(t))) return read;
  const isRecordable = (s) => s.properties ||
    (s.additionalProperties && typeof s.additionalProperties === 'object');
  if (prop.type === 'object' && isRecordable(prop)) {
    return emitClone(prop, read, depth + 1);
  }
  if (prop.type === 'array' && prop.items && typeof prop.items === 'object' &&
      !Array.isArray(prop.items)) {
    const it = prop.items;
    const itemTypes = Array.isArray(it.type) ? it.type : [it.type];
    if (itemTypes.every((t) => _CLONE_PRIMITIVE.has(t))) return read;
    if (it.type === 'object' && isRecordable(it)) {
      const el = '_e' + depth;
      const inner = emitClone(it, el, depth + 1);
      if (!inner) return null;
      return `${read}.map((${el}) => (${inner}))`;
    }
  }
  return null;
}

// The copy as an expression over `data`, or null where the kept key set is
// not provable.
function cloneExprFor(schema) {
  if (!schema || typeof schema !== 'object') return null;
  return emitClone(inlineRefsForClone(schema), 'data', 0);
}

module.exports = { cloneExprFor, emitClone, inlineRefsForClone, stripDefaultsDeep, resolveLocalPointer };
