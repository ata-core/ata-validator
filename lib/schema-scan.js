'use strict';

// One walk of a schema, answering in a single integer the questions that are
// currently answered by doing work and looking at the result.
//
// `_normalizeCallerSchema` decides whether a schema needs normalizing by
// serializing it, cloning it, normalizing the clone and serializing again to
// compare. Two serializations and a deep copy, on every schema, to find out
// that a modern schema needs nothing. The questions the normalizers actually
// ask are all of the form "does this key appear anywhere in the tree", and one
// traversal answers all of them at once. Daniel Lemire's rule from the C++
// side, a layer up: do not do the work to find out whether the work is needed.
//
// The walk deliberately descends through **every** object-valued key, not the
// list of subschema keywords the normalizers recurse through. That makes it a
// superset of what they visit, so it can report work where there is none, but
// never miss work there is. A false positive costs one clone. A false negative
// would hand an un-normalized schema to the engines, which is the silent
// acceptance this codebase treats as its worst failure. `tests/test_schema_scan.js`
// pins the direction of that error against the whole suite.

// One bit per question. Kept small and explicit; a schema which trips none of
// them scans to 0 and can skip normalization entirely.
const NULLABLE = 1 << 0;         // `nullable`, which normalizeNullable folds into `type`
const REF_SIBLINGS = 1 << 1;     // a draft-07 `$ref` carrying keywords which are ignored
const ANCHOR_ID = 1 << 2;        // a fragment-only `$id`, which is an anchor in draft-07
const DEFINITIONS = 1 << 3;      // `definitions`, renamed to `$defs`
const DEPENDENCIES = 1 << 4;     // `dependencies`, split into two keywords
const TUPLE_ITEMS = 1 << 5;      // array-valued `items`, split into `prefixItems`

// Everything only draft-07 normalization acts on. A schema of another dialect
// can carry these without them meaning anything, so they are read together
// with whether the document is draft-07 at all.
const DRAFT7_WORK = REF_SIBLINGS | ANCHOR_ID | DEFINITIONS | DEPENDENCIES | TUPLE_ITEMS;

// Copied from the normalizer rather than shared, so that a change there which
// forgets this file shows up as a differential test failure rather than as a
// silently wider scan. The test asserts the two agree.
const REF_SIBLINGS_KEPT = new Set([
  '$ref', '$defs', 'definitions', '$schema', '$comment',
  'title', 'description', 'examples', 'default', 'readOnly', 'writeOnly',
]);
const ANCHOR_ID_RE = /^#[A-Za-z][A-Za-z0-9_.:-]*$/;

// The answer depends only on the object, so it is remembered against it. A
// server building one validator per route over a shared registry hands the
// same registry objects to every one of them: fifty routes over twenty shared
// schemas scanned those twenty a thousand times. Identity caching is what
// `_identityCache` already does for whole compiled validators.
//
// This assumes a schema is not mutated after being handed to a Validator,
// which is already true of everything else here: the compile cache, the
// identity cache and the schema map would all be stale too.
const CACHE = new WeakMap();

function scan(schema) {
  if (typeof schema !== 'object' || schema === null) return 0;
  const hit = CACHE.get(schema);
  if (hit !== undefined) return hit;

  let bits = 0;
  const seen = new Set();

  const walk = (node) => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i]);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);

    if ('nullable' in node) bits |= NULLABLE;
    if (node.definitions !== undefined && node.$defs === undefined) bits |= DEFINITIONS;
    if (node.dependencies !== undefined) bits |= DEPENDENCIES;
    if (Array.isArray(node.items)) bits |= TUPLE_ITEMS;
    if (typeof node.$id === 'string' && ANCHOR_ID_RE.test(node.$id)) bits |= ANCHOR_ID;

    // `Object.keys` rather than `for...in`: the prototype chain has nothing
    // to contribute here, and walking it is the slower path in V8.
    const keys = Object.keys(node);
    if (typeof node.$ref === 'string') {
      for (let i = 0; i < keys.length; i++) {
        if (!REF_SIBLINGS_KEPT.has(keys[i])) { bits |= REF_SIBLINGS; break; }
      }
    }
    // Every key, not just the subschema keywords, so this cannot miss a place
    // the normalizers would reach.
    for (let i = 0; i < keys.length; i++) walk(node[keys[i]]);
  };

  walk(schema);
  CACHE.set(schema, bits);
  return bits;
}

// Would normalization change this schema? `isDraft7` says whether the draft-07
// rules apply at all, which the caller already knows.
function needsNormalization(schema, isDraft7) {
  const bits = scan(schema);
  if (bits & NULLABLE) return true;
  return isDraft7 ? (bits & DRAFT7_WORK) !== 0 : false;
}

module.exports = {
  scan,
  needsNormalization,
  NULLABLE,
  REF_SIBLINGS,
  ANCHOR_ID,
  DEFINITIONS,
  DEPENDENCIES,
  TUPLE_ITEMS,
  DRAFT7_WORK,
};
