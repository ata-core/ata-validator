'use strict';

// Chainable schema builder. Each `t.X(...)` returns a plain JSON Schema
// object, so the output drops straight into `new Validator(...)`,
// `defineSchema`, `Infer<S>`, and the AOT pipeline with no adapter. The
// builder is pure: no runtime state, no class instances, no closures held
// across calls.
//
// Optionality is carried by a Symbol-keyed marker that JSON Schema
// consumers (including ata's own codegen) never see, because they iterate
// `Object.keys`, which excludes Symbol keys. `t.object` reads the marker
// to compute `required` and strips it from the emitted property schema.

const OPTIONAL = Symbol.for('ata.t.optional');
const { attach: attachRefine } = require('./refine');

function string(opts) {
  return Object.assign({ type: 'string' }, opts);
}

function number(opts) {
  return Object.assign({ type: 'number' }, opts);
}

function integer(opts) {
  return Object.assign({ type: 'integer' }, opts);
}

function boolean() {
  return { type: 'boolean' };
}

function nul() {
  return { type: 'null' };
}

function literal(value) {
  return { const: value };
}

function constant(value) {
  return { const: value };
}

function enumOf(values) {
  return { enum: values };
}

function array(items, opts) {
  return Object.assign({ type: 'array', items }, opts);
}

function tuple(items, opts) {
  // JSON Schema 2020-12 uses `prefixItems` for tuples. `items: false`
  // closes the tail, and a default `minItems` matching the tuple length
  // enforces "exactly N elements" so the runtime check matches the
  // TypeScript tuple type that `Infer<S>` produces. A caller can override
  // either bound through `opts`.
  return Object.assign(
    { type: 'array', prefixItems: items, items: false, minItems: items.length },
    opts,
  );
}

function record(values, opts) {
  return Object.assign({ type: 'object', additionalProperties: values }, opts);
}

function object(properties, opts) {
  const props = {};
  const required = [];
  const keys = Object.keys(properties);
  for (const key of keys) {
    const schema = properties[key];
    if (schema && schema[OPTIONAL] === true) {
      const { [OPTIONAL]: _drop, ...rest } = schema;
      props[key] = rest;
    } else {
      props[key] = schema;
      required.push(key);
    }
  }
  const out = { type: 'object', properties: props };
  if (required.length) out.required = required;
  return Object.assign(out, opts);
}

function optional(schema) {
  // Brand the schema so the parent `t.object` can detect it. The Symbol
  // key is invisible to Object.keys / JSON.stringify and to ata's codegen,
  // so a standalone `t.optional(t.string())` still validates as a string
  // if passed directly to `new Validator(...)`.
  return Object.assign({}, schema, { [OPTIONAL]: true });
}

function union(schemas) {
  return { anyOf: schemas };
}

function intersect(schemas) {
  return { allOf: schemas };
}

function ref(pointer) {
  return { $ref: pointer };
}

function any() {
  return {};
}

function unknown() {
  return {};
}

function never() {
  return { not: {} };
}

function refine(schema, check, opts) {
  // Attach an async/sync refinement. The schema stays plain JSON Schema for
  // structural validation; the refinement is carried on a Symbol key and only
  // runs via validateAsync()/parseAsync(). Compose by wrapping again.
  return attachRefine(schema, check, opts);
}

function assertObjectSchema(schema, fn) {
  if (!schema || typeof schema !== 'object' || schema.type !== 'object' ||
      !schema.properties || typeof schema.properties !== 'object') {
    throw new Error(`t.${fn}: expected an object schema with properties`);
  }
}

// Copy every top-level keyword except the two the combinator recomputes.
function cloneMeta(schema) {
  const out = {};
  for (const key of Object.keys(schema)) {
    if (key !== 'properties' && key !== 'required') out[key] = schema[key];
  }
  return out;
}

function pick(schema, keys) {
  assertObjectSchema(schema, 'pick');
  const keep = new Set(keys);
  const props = {};
  for (const key of Object.keys(schema.properties)) {
    if (keep.has(key)) props[key] = schema.properties[key];
  }
  const required = (schema.required || []).filter((key) => keep.has(key));
  const out = Object.assign(cloneMeta(schema), { properties: props });
  if (required.length) out.required = required;
  return out;
}

function omit(schema, keys) {
  assertObjectSchema(schema, 'omit');
  const drop = new Set(keys);
  const props = {};
  for (const key of Object.keys(schema.properties)) {
    if (!drop.has(key)) props[key] = schema.properties[key];
  }
  const required = (schema.required || []).filter((key) => !drop.has(key));
  const out = Object.assign(cloneMeta(schema), { properties: props });
  if (required.length) out.required = required;
  return out;
}

function partial(schema) {
  assertObjectSchema(schema, 'partial');
  return Object.assign(cloneMeta(schema), { properties: schema.properties });
}

function requiredOf(schema, keys) {
  assertObjectSchema(schema, 'required');
  const propKeys = Object.keys(schema.properties);
  let required;
  if (keys === undefined) {
    required = propKeys.slice();
  } else {
    const known = new Set(propKeys);
    required = Array.from(new Set([...(schema.required || []), ...keys])).filter((k) => known.has(k));
  }
  const out = Object.assign(cloneMeta(schema), { properties: schema.properties });
  if (required.length) out.required = required;
  return out;
}

function recursive(build, opts) {
  // Single fixed def name; nesting t.recursive inside itself is unsupported
  // (both layers would claim '#/$defs/self') and documented as such.
  const self = { $ref: '#/$defs/self' };
  const body = build(self);
  return Object.assign({ $ref: '#/$defs/self', $defs: { self: body } }, opts);
}

function composite(schemas, opts) {
  const props = {};
  const requiredSet = new Set();
  for (const schema of schemas) {
    assertObjectSchema(schema, 'composite');
    for (const key of Object.keys(schema.properties)) props[key] = schema.properties[key];
    for (const key of schema.required || []) requiredSet.add(key);
  }
  const required = Array.from(requiredSet).filter((key) => key in props);
  const out = { type: 'object', properties: props };
  if (required.length) out.required = required;
  return Object.assign(out, opts);
}

module.exports = {
  string,
  number,
  integer,
  boolean,
  null: nul,
  literal,
  const: constant,
  enum: enumOf,
  array,
  tuple,
  record,
  object,
  optional,
  union,
  intersect,
  ref,
  any,
  unknown,
  never,
  refine,
  OPTIONAL,
  assertObjectSchema,
  cloneMeta,
  pick,
  omit,
  partial,
  required: requiredOf,
  composite,
  recursive,
};
