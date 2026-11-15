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
const EXCLUSIVE_BOOL = 1 << 6;   // draft-04's boolean `exclusiveMinimum`/`exclusiveMaximum`
const ENCODED_REF = 1 << 7;      // a fragment `$ref` holding a percent escape, decoded by normalizeNullable's walk

// Questions compat asks of a schema it is about to compile, read on the same
// walk so that a document is not walked again for them. compat sets the keys
// and their bits (setExtraKeys); without compat the walk reads none.
let EXTRA = null;

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
// The walk without a record of seen nodes stops past these and starts again
// with one. Deeper than any schema in the suite or SchemaStore; a node count
// a shared subtree reached many times over would pass long before a tree did.
const FAST_DEPTH = 512, FAST_NODES = 200000;
const BAIL = {};

// The answer depends only on the object, so it is remembered against it. A
// server building one validator per route over a shared registry hands the
// same registry objects to every one of them: fifty routes over twenty shared
// schemas scanned those twenty a thousand times. Identity caching is what
// `_identityCache` already does for whole compiled validators.
//
// This assumes a schema is not mutated after being handed to a Validator,
// which is already true of everything else here: the compile cache, the
// identity cache and the schema map would all be stale too.
let CACHE = new WeakMap();

function scan(schema) {
  if (typeof schema !== 'object' || schema === null) return 0;
  const hit = CACHE.get(schema);
  if (hit !== undefined) return hit;

  let bits = 0;
  // The first walk keeps no record of the nodes it has seen: the answer is
  // an OR of bits, so a node met twice adds nothing, and a schema written as
  // JSON or as object literals is a tree that meets each node once. The set
  // was a third of the scan. A schema that shares or contains its own nodes
  // runs out of the walk's depth or node budget, and is walked again with
  // the set, as every schema was before.
  let seen = null, budget = FAST_NODES, depth = 0;

  const walk = (node) => {
    if (seen === null) {
      if (--budget < 0 || ++depth > FAST_DEPTH) throw BAIL;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const e = node[i];
        if (typeof e === 'object' && e !== null) walk(e);
      }
      depth--;
      return;
    }
    if (seen !== null) {
      if (seen.has(node)) return;
      seen.add(node);
    }

    // `Object.keys` rather than `for...in`: the prototype chain has nothing
    // to contribute here, and walking it is the slower path in V8.
    const keys = Object.keys(node);
    // One pass over the node's own names answers every question, each value
    // read once and walked from the same read. The questions were asked by
    // name, ten reads a node that missed on an object of yet another shape:
    // the scan was 17% of a small schema's compile and first check. A node
    // with another prototype is also asked by name, as before, so a keyword
    // it inherits is still seen.
    let defs = false, definitions = false, ref;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = node[k];
      switch (k) {
        case 'nullable': bits |= NULLABLE; break;
        case 'definitions': if (v !== undefined) definitions = true; break;
        case '$defs': if (v !== undefined) defs = true; break;
        case 'dependencies': if (v !== undefined) bits |= DEPENDENCIES; break;
        case 'items': if (Array.isArray(v)) bits |= TUPLE_ITEMS; break;
        case 'exclusiveMinimum': case 'exclusiveMaximum': if (typeof v === 'boolean') bits |= EXCLUSIVE_BOOL; break;
        case '$id': if (typeof v === 'string' && ANCHOR_ID_RE.test(v)) bits |= ANCHOR_ID; break;
        case '$ref': ref = v; break;
      }
      // Every key, not just the subschema keywords, so this cannot miss a
      // place the normalizers would reach.
      if (EXTRA !== null) {
        const b = EXTRA.get(k);
        if (b !== undefined) bits |= b;
      }
      if (typeof v === 'object' && v !== null) walk(v);
    }
    if (definitions && !defs) bits |= DEFINITIONS;
    if (Object.getPrototypeOf(node) !== Object.prototype) {
      if ('nullable' in node) bits |= NULLABLE;
      if (node.definitions !== undefined && node.$defs === undefined) bits |= DEFINITIONS;
      if (node.dependencies !== undefined) bits |= DEPENDENCIES;
      if (Array.isArray(node.items)) bits |= TUPLE_ITEMS;
      if (typeof node.exclusiveMinimum === 'boolean' || typeof node.exclusiveMaximum === 'boolean') bits |= EXCLUSIVE_BOOL;
      if (typeof node.$id === 'string' && ANCHOR_ID_RE.test(node.$id)) bits |= ANCHOR_ID;
      ref = node.$ref;
    }
    if (typeof ref === 'string') {
      if (ref[0] === '#' && ref.includes('%')) bits |= ENCODED_REF;
      for (let i = 0; i < keys.length; i++) {
        if (!REF_SIBLINGS_KEPT.has(keys[i])) { bits |= REF_SIBLINGS; break; }
      }
    }
    depth--;
  };

  try {
    walk(schema);
  } catch (e) {
    if (e !== BAIL) throw e;
    bits = 0;
    seen = new Set();
    walk(schema);
  }
  CACHE.set(schema, bits);
  return bits;
}

// Would normalization change this schema? `isDraft7` says whether the draft-07
// rules apply at all, which the caller already knows.
function needsNormalization(schema, isDraft7) {
  const bits = scan(schema);
  // The boolean form of the exclusive bounds is draft-04's, and it is
  // unambiguous wherever it appears: no later dialect gives a boolean any
  // meaning there. Percent-encoded fragments mean the same in every dialect
  // too. A fragment-only `$id` is folded into `$anchor` in every dialect, by
  // the walk that folds `nullable`. None is gated on the declared dialect.
  if (bits & (NULLABLE | EXCLUSIVE_BOOL | ENCODED_REF | ANCHOR_ID)) return true;
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
  EXCLUSIVE_BOOL,
  ENCODED_REF,
  DRAFT7_WORK,
};

// A schema scanned before the keys were set is scanned again: what was
// remembered for it does not answer the new questions.
function setExtraKeys(map) {
  EXTRA = map;
  CACHE = new WeakMap();
}
Object.defineProperty(module.exports, '_setExtraKeys', { value: setExtraKeys, enumerable: false });
