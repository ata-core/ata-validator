'use strict';

const { schemaUsesKeywords } = require('./keywords');

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
  'propertyNames', 'patternProperties', 'propertyDependencies',
]);

// Formats the native engine checks by the same rules as lib/formats.js,
// held to the same answers by tests/test_native_formats.js. Every other
// format name goes through validate(): the native engine has no check for
// it and would let any string pass. This was a list of the divergent ones,
// which missed every format the engine does not know (json-pointer, iri,
// uri-template, regex and the rest) and a caller's own formats.
const NATIVE_FORMATS = new Set(['email', 'date', 'uri', 'uuid', 'ipv4', 'ipv6', 'hostname']);

const SUBSCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'];
const SUBSCHEMA_NODES = [
  'items', 'additionalItems', 'additionalProperties', 'contains', 'propertyNames', 'not',
  'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems',
  'allOf', 'anyOf', 'oneOf', 'prefixItems',
];

// Where RE2 and ECMA-262 give different answers for the same pattern. RE2's
// `\s` is the ASCII whitespace alone, so it misses U+00A0, U+2028, U+3000 and
// U+FEFF, which ECMA-262 counts, and its `.` matches a carriage return and the
// line and paragraph separators, which ECMA-262's does not. `^\S+$` accepted
// "a\u2028b" on the native text path while validate() rejected it. Any `\s`
// or `\S`, and any `.` outside a class that is not escaped, sends the schema to
// the JS path.
function re2Diverges(pattern) {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      const e = pattern[i + 1];
      if (e === 's' || e === 'S') return true;
      i++;
      continue;
    }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '.') return true;
  }
  return false;
}

// The walker gives up past a depth of its own (100 schema frames, about 50
// levels of data under a recursive schema) and rejects the document there. A
// schema that refers back into itself, or that is nested that deep, can reach
// it with a document validate() accepts, so it is answered through validate(),
// which has no such limit.
const NATIVE_DEPTH = 40;

// Whether a `$ref` into this document leads back to a schema it is inside.
function refersBack(root) {
  const { localRef } = require('./defaults.js');
  const done = new Set();
  const onPath = new Set();
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return false;
    if (onPath.has(node)) return true;
    if (done.has(node)) return false;
    onPath.add(node);
    let back = false;
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (key === '$ref' && typeof v === 'string' && v.startsWith('#')) back = visit(localRef(root, v));
      else if (key !== 'enum' && key !== 'const' && key !== 'default' && key !== 'examples' && v !== null && typeof v === 'object') back = visit(v);
      if (back) break;
    }
    onPath.delete(node);
    done.add(node);
    return back;
  };
  return visit(root);
}

function walk(schema, depth, userFormats) {
  if (depth > NATIVE_DEPTH) return true;
  if (schema === true || schema === false) {
    // A boolean root is answered wrong by the walker; nested booleans are
    // handled where they appear (items and prefixItems below).
    return depth === 0;
  }
  if (schema === null || typeof schema !== 'object') return false;
  if (Array.isArray(schema)) {
    for (const s of schema) if (walk(s, depth + 1, userFormats)) return true;
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
    if (key === 'format' && (!NATIVE_FORMATS.has(v) || (userFormats && Object.prototype.hasOwnProperty.call(userFormats, v)))) return true;
    // Unicode property escapes: RE2 cannot parse them and the walker then
    // skips the pattern instead of failing.
    if (key === 'pattern' && typeof v === 'string' && /\\[pP]\{/.test(v)) return true;
    if (key === 'pattern' && typeof v === 'string' && re2Diverges(v)) return true;
    // Tuple forms: prefixItems and the draft-07 array form of items are
    // checked against the wrong positions by the walker.
    if (key === 'prefixItems') return true;
    if ((key === 'items' || key === 'additionalItems') && (typeof v === 'boolean' || Array.isArray(v))) return true;

    if (SUBSCHEMA_MAPS.includes(key)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const k of Object.keys(v)) if (walk(v[k], depth + 1, userFormats)) return true;
      }
    } else if (SUBSCHEMA_NODES.includes(key)) {
      if (walk(v, depth + 1, userFormats)) return true;
    }
  }
  return false;
}

// True when the buffer APIs must answer through validate() for this schema.
// `keywords` is the validator's normalized custom keyword map, if any: the
// native walker knows nothing about those, so a schema using one is routed
// through validate() like the other shapes here. `userFormats` is the
// validator's `formats` option: a format it defines, even under a built-in
// name, is a check only the JS engines run.
function bufferNeedsSlowPath(schema, schemaMap, keywords, userFormats) {
  if (keywords && schemaUsesKeywords(schema, keywords)) return true;
  if (walk(schema, 0, userFormats)) return true;
  if (refersBack(schema)) return true;
  if (schemaMap && schemaMap.size > 0) {
    for (const s of schemaMap.values()) if (walk(s, 1, userFormats)) return true;
  }
  return false;
}

function toText(input, name) {
  if (typeof input === 'string') return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('utf8');
  throw new TypeError(`${name}() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().`);
}

// Replaces the instance's buffer APIs with versions that decode the bytes and
// ask isValidJSON(), which answers as validate() does on the parsed value and
// reads text the scanner covers without parsing it (a small document went from
// 350 to 155 ns without the addon). Its own native route is behind this same
// gate, so a schema routed here never reaches the walker through it.
function installSlowBufferApis(validator) {
  const isValidText = (text) => validator.isValidJSON(text);
  validator.isValid = (input) => isValidText(toText(input, 'isValid'));
  // The length is the caller's, so it is held to the buffer: a view past its
  // end read the bytes of whatever shared the pool, and answered on them.
  validator.isValidPrepadded = (paddedBuffer, jsonLength) => {
    if (!(paddedBuffer instanceof Uint8Array) || !Number.isInteger(jsonLength) || jsonLength < 0 || jsonLength > paddedBuffer.byteLength) return false;
    return isValidText(Buffer.from(paddedBuffer.buffer, paddedBuffer.byteOffset, jsonLength).toString('utf8'));
  };
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
