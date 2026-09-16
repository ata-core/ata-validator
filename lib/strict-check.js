'use strict';

// The authoring-time check behind `strictSchema`. A mistyped keyword is the
// one schema mistake that fails open: `maxLenght` is not an error to any
// JSON Schema dialect, it is an annotation, so the intended constraint is
// simply absent and previously invalid data starts validating. A validator
// cannot make that safe at validation time. It can be loud about it when the
// schema is compiled, which is what this is.
//
// The known-keyword list is not written out here. Each vendored meta-schema's
// `properties` are precisely its dialect's keywords, so the list comes from
// the specification documents in `metaschemas.js` rather than from a copy
// someone keeps in step. The union across vendored dialects is used, not the
// schema's own dialect: a draft-07 keyword in a 2020-12 schema is a real
// authoring question but not a fail-open one, and a union cannot produce a
// false positive on a valid document.

const { METASCHEMAS } = require('./metaschemas');
const { levenshtein } = require('./levenshtein');

// Keywords ata implements beyond the official vocabularies.
const ATA_KEYWORDS = ['nullable', 'errorMessage', 'propertyDependencies', 'discriminator'];

let SPEC_KEYWORDS = null;
function specKeywords() {
  if (SPEC_KEYWORDS === null) {
    SPEC_KEYWORDS = new Set(ATA_KEYWORDS);
    for (const doc of METASCHEMAS.values()) {
      if (doc && doc.properties) for (const k of Object.keys(doc.properties)) SPEC_KEYWORDS.add(k);
    }
  }
  return SPEC_KEYWORDS;
}

// Where subschemas live, so the walk knows a key under `properties` is a
// property name and a key directly on a schema object is a keyword.
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_SINGLE = new Set([
  'items', 'additionalItems', 'additionalProperties', 'unevaluatedProperties',
  'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else',
  'contentSchema',
]);
// Values that are data, never schemas, however object-shaped they look.
const DATA_VALUED = new Set(['enum', 'const', 'default', 'examples', 'required', 'type', '$vocabulary']);

function nearest(word, known) {
  let best = null;
  let bestD = Infinity;
  for (const k of known) {
    // A candidate further away than half the word is noise, not a typo.
    const d = levenshtein(word, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD > 0 && bestD <= 2 && best !== null ? best : null;
}

function resolveLocalPointer(root, ref) {
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(token) || Number(token) >= node.length) return false;
      node = node[Number(token)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(node, token)) return false;
      node = node[token];
    }
  }
  return node !== undefined;
}

/**
 * Walks a schema and reports the authoring mistakes the validator would
 * otherwise ignore. Returns an array of { path, message }, empty when clean.
 *
 * `userKeywords` are names registered through the `keywords` option, and
 * `x-` prefixed names pass without comment: they are the conventional
 * extension namespace and rejecting them would flag real documents.
 */
function checkSchemaStrict(root, options) {
  const known = specKeywords();
  const user = options && options.userKeywords ? options.userKeywords : null;
  const problems = [];
  const seen = new Set();

  function isKnown(key) {
    if (known.has(key)) return true;
    if (user && (Array.isArray(user) ? user.includes(key) : Object.prototype.hasOwnProperty.call(user, key))) return true;
    if (key.startsWith('x-')) return true;
    return false;
  }

  function walkSchema(node, path) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const key of Object.keys(node)) {
      const value = node[key];
      const at = path + '/' + key;
      if (!isKnown(key)) {
        const hint = nearest(key, known);
        problems.push({
          path: at,
          message: hint
            ? `unknown keyword "${key}" (did you mean "${hint}"?)`
            : `unknown keyword "${key}"`,
        });
        continue;
      }
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/') && !resolveLocalPointer(root, value)) {
        problems.push({ path: at, message: `$ref "${value}" does not resolve in this document` });
        continue;
      }
      if (DATA_VALUED.has(key)) continue;
      if (SCHEMA_MAPS.has(key)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          for (const name of Object.keys(value)) walkSchema(value[name], at + '/' + name.replace(/~/g, '~0').replace(/\//g, '~1'));
        }
      } else if (SCHEMA_LISTS.has(key)) {
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) walkSchema(value[i], at + '/' + i);
      } else if (SCHEMA_SINGLE.has(key)) {
        // draft-07 lets `items` be an array of schemas.
        if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) walkSchema(value[i], at + '/' + i); }
        else walkSchema(value, at);
      } else if (key === 'dependencies') {
        // draft-07: each value is either a schema or an array of names.
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          for (const name of Object.keys(value)) {
            if (!Array.isArray(value[name])) walkSchema(value[name], at + '/' + name);
          }
        }
      }
    }
  }

  walkSchema(root, '#');
  return problems;
}

module.exports = { checkSchemaStrict };
