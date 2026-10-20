'use strict';

// How a module written ahead of time hands out its errors in the order the
// runtime does: schema declaration order (sortErrorsBySchemaOrder in
// lib/rejections.js). A module used to return them in the order its collector
// found them, which put `additionalProperties` before `properties` and
// `format` before `pattern`, and behind a reference a definition's `required`
// before its `properties`; the first error of a field could differ from the
// runtime's.
//
// The runtime orders by the ordinal of each error's schema path and breaks
// ties by the path's rank, and comparing ranks alone gives the same order
// (lib/schema-order.js). Two ways to know them in a module:
//
// - Without a reference, the collector writes each error site's ordinal into
//   the error (`_o`, noteOrdinal in lib/js-compiler-errors.js) and no two
//   paths share one, so a stable sort by it is the runtime's order.
// - With one, an error behind a shared definition has its path built when the
//   definition runs and carries no ordinal, and paths through a `$ref` share
//   the ordinal of the `$ref`. The module ranks each path itself with
//   lib/schema-order.js's own functions, embedded as their text so module and
//   runtime rank with one source, over the schema's skeleton: its schema
//   objects with every key, subschemas kept, every other value 0, which ranks
//   every path an error can name exactly as the schema does.
//
// Node only, at build time: it reads the library's own files.
const fs = require('fs');
const path = require('path');

const _files = new Map();
function take(file, names) {
  let src = _files.get(file);
  if (src === undefined) { src = fs.readFileSync(path.join(__dirname, file), 'utf8'); _files.set(file, src); }
  return names.map((n) => {
    const m = new RegExp('^function ' + n + ' ?\\([^]*?^}$', 'm').exec(src);
    if (m === null) throw new Error('aot-order: lib/' + file + ' has no top-level function ' + n);
    return m[0].replace(/^\s*\/\/.*\n/gm, '');
  }).join('\n');
}

// Keywords whose value is a schema, an array of schemas, or an object of them:
// the only places an error's schema path goes below a schema object.
const ONE = new Set(['additionalProperties', 'additionalItems', 'items', 'contains', 'propertyNames', 'if', 'then', 'else', 'not', 'unevaluatedItems', 'unevaluatedProperties']);
const LIST = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items']);
const MAP = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);

function skeleton(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return 0;
  const out = {};
  for (const k of Object.keys(node)) {
    const v = node[k];
    let s = 0;
    if (k === '$ref' && typeof v === 'string') s = v;
    else if (Array.isArray(v) && LIST.has(k)) s = v.map(skeleton);
    else if (MAP.has(k) && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      s = {};
      for (const name of Object.keys(v)) Object.defineProperty(s, name, { value: Array.isArray(v[name]) ? 0 : skeleton(v[name]), enumerable: true, writable: true, configurable: true });
    } else if (ONE.has(k) && v !== null && typeof v === 'object') s = skeleton(v);
    Object.defineProperty(out, k, { value: s, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function hasReference(schemaObj) {
  const text = JSON.stringify(schemaObj);
  return text.includes('"$ref"') || text.includes('"$dynamicRef"') || text.includes('"$recursiveRef"');
}

// Whether the collector should write ordinals into the errors: only where the
// module sorts by them.
function wantsOrdinals(schemaObj) { return !hasReference(schemaObj); }

// The sort, by a key per error, stable as the runtime's insertion sort is, and
// the copies the caller gets, without the ordinal; a collapsed error's branch
// errors are ordered and copied the same way.
const ORDER = (key, cmp) => `function _ataOrder(list) {
  const n = list.length, out = new Array(n), keys = new Array(n);
  let prev = ${key === '_o' ? '0' : 'null'};
  for (let i = 0; i < n; i++) {
    const src = list[i];
    const { _o, ...e } = src;
    if (Array.isArray(e.branchErrors)) e.branchErrors = _ataOrder(e.branchErrors);
    let k = ${key === '_o' ? "typeof src._o === 'number' ? src._o : prev" : '_ataRank(src.schemaPath)'};
    prev = k;
    let j = i - 1;
    while (j >= 0 && ${cmp}) { keys[j + 1] = keys[j]; out[j + 1] = out[j]; j--; }
    keys[j + 1] = k;
    out[j + 1] = e;
  }
  return out;
}
`;

// Source declaring `_ataOrder(errors)`: the errors sorted as the runtime sorts
// them, without their ordinals.
function orderDecl(schemaObj) {
  if (!hasReference(schemaObj)) return ORDER('_o', 'keys[j] > k');
  const sk = JSON.stringify(skeleton(schemaObj));
  return `const _ataSkeleton = JSON.parse(${JSON.stringify(sk).replace(/</g, '\\u003c')});
const _keyIndexCache = new WeakMap();
const _rankCache = new WeakMap();
const _documents = new WeakMap();
const CONFLICT = null;
${take('schema-order.js', ['keyIndex', 'unescapePointerSegment', 'rankFor', 'computeRank', 'localTarget'])}
function _ataRank(p) { return rankFor(_ataSkeleton, p); }
function _ataAfter(a, b) {
  if (a === null || b === null) return false;
  const m = Math.min(a.length, b.length);
  for (let i = 0; i < m; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return a.length > b.length;
}
${ORDER('rank', '_ataAfter(keys[j], k)')}`;
}

module.exports = { orderDecl, wantsOrdinals };
