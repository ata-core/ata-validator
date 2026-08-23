'use strict';

// The buffer APIs (isValid, countValid, batchIsValid, isValidNDJSON,
// isValidParallel, isValidPrepadded, and isValidJSON above the simdjson
// threshold) answer from the native engine's own walker, which is not the
// engine validate() uses. Measured over the official suite, the two disagreed
// on 245 of 2222 cases, and 195 of those were the native walker accepting a
// document validate() rejects. A buffer API that is faster and sometimes
// wrong in the accepting direction is not a fast path, it is a hole.
//
// This module decides, once per schema, whether the native walker can be
// trusted for it. When it cannot, the buffer APIs are replaced with versions
// that parse the bytes and call validate(), so every entry point gives the
// same verdict. The list below is the set of shapes where the suite showed
// the walker disagreeing, each with the reason. It is deliberately a list of
// shapes rather than a count: a new disagreement is a new entry here, with
// tests/test_buffer_path_parity.js holding the total at zero.

// Keywords the native walker does not implement, or implements differently
// enough to disagree on the suite.
const UNSUPPORTED_KEYWORDS = new Set([
  'contains', 'minContains', 'maxContains',
  'unevaluatedProperties', 'unevaluatedItems',
  'dependencies', 'dependentSchemas', 'dependentRequired',
  'propertyNames', 'patternProperties',
]);

// Formats the native checkers answer differently from the JS ones.
const DIVERGENT_FORMATS = new Set(['hostname', 'date-time', 'time', 'uri-reference', 'duration']);

const SUBSCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'];
const SUBSCHEMA_NODES = [
  'items', 'additionalItems', 'additionalProperties', 'contains', 'propertyNames', 'not',
  'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems',
  'allOf', 'anyOf', 'oneOf', 'prefixItems',
];

function walk(schema, depth) {
  if (schema === true || schema === false) {
    // A boolean root is answered wrong by the walker; nested booleans are
    // handled where they appear (items and prefixItems below).
    return depth === 0;
  }
  if (schema === null || typeof schema !== 'object') return false;
  if (Array.isArray(schema)) {
    for (const s of schema) if (walk(s, depth + 1)) return true;
    return false;
  }
  for (const key of Object.keys(schema)) {
    const v = schema[key];
    if (UNSUPPORTED_KEYWORDS.has(key)) return true;
    // Cross-document references: the native engine has no registry of
    // external schemas, and embedded $id changes the base URI in ways its
    // resolver gets wrong.
    if (key === '$ref' && typeof v === 'string' && !v.startsWith('#')) return true;
    if (key === '$id' && depth > 0) return true;
    // An empty enum rejects everything; the walker accepts everything.
    if (key === 'enum' && Array.isArray(v) && v.length === 0) return true;
    if (key === 'format' && DIVERGENT_FORMATS.has(v)) return true;
    // Unicode property escapes: RE2 cannot parse them and the walker then
    // skips the pattern instead of failing.
    if (key === 'pattern' && typeof v === 'string' && /\\[pP]\{/.test(v)) return true;
    // Tuple forms: prefixItems and the draft-07 array form of items are
    // checked against the wrong positions by the walker.
    if (key === 'prefixItems') return true;
    if ((key === 'items' || key === 'additionalItems') && (typeof v === 'boolean' || Array.isArray(v))) return true;

    if (SUBSCHEMA_MAPS.includes(key)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const k of Object.keys(v)) if (walk(v[k], depth + 1)) return true;
      }
    } else if (SUBSCHEMA_NODES.includes(key)) {
      if (walk(v, depth + 1)) return true;
    }
  }
  return false;
}

// True when the buffer APIs must answer through validate() for this schema.
function bufferNeedsSlowPath(schema, schemaMap) {
  if (walk(schema, 0)) return true;
  if (schemaMap && schemaMap.size > 0) {
    for (const s of schemaMap.values()) if (walk(s, 1)) return true;
  }
  return false;
}

function toText(input, name) {
  if (typeof input === 'string') return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('utf8');
  throw new TypeError(`${name}() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().`);
}

// Replaces the instance's buffer APIs with versions that parse and call
// validate(). Installed after compilation, so `validator.validate` is final.
function installSlowBufferApis(validator) {
  const isValidText = (text) => {
    let value;
    try { value = JSON.parse(text); } catch { return false; }
    return validator.validate(value).valid;
  };
  validator.isValid = (input) => isValidText(toText(input, 'isValid'));
  validator.isValidJSON = (jsonStr) => isValidText(jsonStr);
  validator.isValidPrepadded = (paddedBuffer, jsonLength) =>
    isValidText(Buffer.from(paddedBuffer.buffer, paddedBuffer.byteOffset, jsonLength).toString('utf8'));
  const ndjson = (input, name) => {
    const lines = toText(input, name).split('\n');
    const out = [];
    for (const line of lines) {
      if (line === '') continue; // the native loop skips zero-length lines only
      out.push(isValidText(line));
    }
    return out;
  };
  validator.isValidNDJSON = (input) => ndjson(input, 'isValidNDJSON');
  validator.isValidParallel = (input) => ndjson(input, 'isValidParallel');
  validator.countValid = (input) => {
    let n = 0;
    for (const ok of ndjson(input, 'countValid')) if (ok) n++;
    return n;
  };
  validator.batchIsValid = (buffers) => {
    let n = 0;
    for (const b of buffers) {
      if (!(b instanceof Uint8Array)) throw new TypeError('batchIsValid() requires Buffer or Uint8Array elements');
      if (isValidText(toText(b, 'batchIsValid'))) n++;
    }
    return n;
  };
}

module.exports = { bufferNeedsSlowPath, installSlowBufferApis };
