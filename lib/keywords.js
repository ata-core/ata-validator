'use strict';

// Custom keywords for `new Validator(schema, { keywords })`.
//
// A definition is one of:
//   fn                                    shorthand for { validate: fn }
//   { validate(value, data, parent) }     called per value
//   { compile(value, parent) -> fn }      called once per schema node, the
//                                         returned function per value
//   { macro(value, parent) -> schema }    the returned schema is applied in
//                                         place, and the keyword reports an
//                                         error of its own when it fails
// with optional `type`: a JSON Schema type name or a list of them. A typed
// keyword is skipped for data of any other type, which is what makes
// `{ type: 'number', ... }` safe next to `type: ['number', 'string']`.
//
// Schemas that use a registered keyword run on the interpreted engine, so
// every applicator around the custom check keeps its specification meaning.
// A function cannot be carried into a standalone module, so the ahead-of-time
// paths refuse these options instead of emitting a module that would ignore
// the keyword.

const RESERVED = new Set([
  '$id', '$schema', '$ref', '$defs', '$anchor', '$dynamicRef', '$dynamicAnchor',
  '$vocabulary', '$comment', 'definitions', 'type', 'enum', 'const',
  'properties', 'patternProperties', 'additionalProperties', 'required',
  'items', 'prefixItems', 'additionalItems', 'contains', 'allOf', 'anyOf',
  'oneOf', 'not', 'if', 'then', 'else', 'format', 'pattern',
  'unevaluatedProperties', 'unevaluatedItems', 'dependentSchemas',
  'dependentRequired', 'dependencies', 'propertyNames', 'propertyDependencies',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems',
  'minContains', 'maxContains', 'minProperties', 'maxProperties',
]);

// Normalize a caller's `{ name: def }` map into `{ name: { types, validate,
// compile, macro } }`. Throws on a definition that has no way to run, so a
// keyword that would otherwise be ignored is never accepted quietly.
function normalizeKeywords(defs) {
  if (!defs || typeof defs !== 'object') return null;
  const names = Object.keys(defs);
  if (names.length === 0) return null;
  const out = Object.create(null);
  for (const name of names) {
    const raw = defs[name];
    const def = typeof raw === 'function' ? { validate: raw } : raw;
    if (!def || typeof def !== 'object') {
      throw new Error(`keyword "${name}": definition must be a function or an object`);
    }
    if (RESERVED.has(name)) {
      throw new Error(`keyword "${name}" is a JSON Schema keyword and cannot be redefined`);
    }
    const hasValidate = typeof def.validate === 'function';
    const hasCompile = typeof def.compile === 'function';
    const hasMacro = typeof def.macro === 'function';
    if (!hasValidate && !hasCompile && !hasMacro) {
      throw new Error(
        `keyword "${name}": definition needs validate, compile or macro` +
        (typeof def.code === 'function' ? ' (code-generating keywords are not supported)' : ''),
      );
    }
    let types = null;
    if (def.type !== undefined) {
      types = Array.isArray(def.type) ? def.type.slice() : [def.type];
      for (const t of types) {
        if (typeof t !== 'string') throw new Error(`keyword "${name}": type must be a string or a list of strings`);
      }
    }
    out[name] = {
      name,
      types,
      validate: hasValidate ? def.validate : null,
      compile: hasCompile ? def.compile : null,
      macro: hasMacro ? def.macro : null,
    };
  }
  return out;
}

// Does the schema, or any subschema of it, use a registered keyword? Walks
// every object and array so keywords inside applicators and definitions are
// found too. Property names under `properties` are not keywords, so that map
// is descended into without reading its keys as keywords.
function schemaUsesKeywords(schema, keywords) {
  if (!keywords) return false;
  const seen = new Set();
  const walk = (node, keysAreNames) => {
    if (node === null || typeof node !== 'object') return false;
    if (seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) if (walk(item, false)) return true;
      return false;
    }
    for (const key of Object.keys(node)) {
      if (!keysAreNames && keywords[key] !== undefined) return true;
      const v = node[key];
      if (v !== null && typeof v === 'object') {
        if (walk(v, !keysAreNames && NAME_MAPS.has(key))) return true;
      }
    }
    return false;
  };
  return walk(schema, false);
}

// Maps whose keys are user-chosen names, not keywords.
const NAME_MAPS = new Set([
  'properties', 'patternProperties', '$defs', 'definitions',
  'dependentSchemas', 'dependentRequired', 'dependencies', 'propertyDependencies',
]);

module.exports = { normalizeKeywords, schemaUsesKeywords };
