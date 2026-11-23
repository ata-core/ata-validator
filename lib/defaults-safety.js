'use strict';

// Whether the defaults pass can change the verdict of a schema, worked out
// from the schema alone, for the buffer APIs. The native walker reads the
// bytes as they came, without the defaults validate() fills first, so a
// validator with defaults answers its buffer APIs through validate()
// (lib/validator-core.js _installBufferApis) unless this says filling them
// cannot change any answer. Routing every such validator cost isValid(buffer)
// about 3.6 times its time on a schema with defaults.
//
// A default only adds a name to an object that lacks it: `properties[k]`
// with a `default`, in a schema the pass applies to that object (through
// `properties`, `items`, `additionalProperties`, a `$ref` into the same
// document and `allOf`, lib/defaults.js). Filling it changes no answer when,
// among every schema that may apply to the same object:
//   - none requires `k` (the native walker would refuse what validate()
//     accepts once `k` is filled);
//   - none counts names (minProperties, maxProperties) or closes the object
//     to `k` (additionalProperties false or a schema, without `k` among its
//     own properties);
//   - none compares the object as a whole (enum, const) or chooses between
//     branches (anyOf, oneOf, not, if/then/else), which may read `k`;
//   - the default meets every `properties[k]` among them, checked by the
//     interpreted engine, when that subschema refers to nothing outside
//     itself;
// and nothing above compares whole values (an object enum or const, or
// uniqueItems, anywhere). Which schemas may apply to the same object is read
// generously: every schema joined to another through allOf, anyOf, oneOf,
// not, if, then, else or a `$ref` counts as applying wherever the other does.
// Where any of this cannot be read (a `$ref` this does not resolve, a default
// that is itself an object or an array, a subschema that refers elsewhere),
// the answer is "can change", which keeps the validator on validate(): the
// answer may be too careful, never too bold.

const APPLY_HERE = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'];
const BRANCHING = new Set(['anyOf', 'oneOf', 'not', 'if', 'then', 'else']);
const SUB_MAPS = ['properties', '$defs', 'definitions'];
const SUB_ONE = ['items', 'additionalProperties'];

function localTarget(doc, ref) {
  if (typeof ref !== 'string' || ref[0] !== '#') return undefined;
  if (ref === '#') return doc;
  if (ref[1] !== '/') return undefined;
  let t = doc;
  for (let seg of ref.slice(2).split('/')) {
    try { seg = decodeURIComponent(seg); } catch { return undefined; }
    seg = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (t === null || typeof t !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(t, seg)) {
      const alias = seg === 'definitions' ? '$defs' : seg === '$defs' ? 'definitions' : null;
      if (alias === null || !Object.prototype.hasOwnProperty.call(t, alias)) return undefined;
      seg = alias;
    }
    t = t[seg];
  }
  return t !== null && typeof t === 'object' ? t : undefined;
}

// Whether a value is a plain JSON scalar (null, a string, a finite number, a
// boolean): the only defaults checked here.
const scalar = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

// Whether an array's items can only be scalars, which no default reaches:
// uniqueItems over them compares nothing a default fills.
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null']);
function scalarItems(items) {
  if (items === null || typeof items !== 'object' || Array.isArray(items)) return false;
  const t = items.type;
  if (typeof t === 'string') return SCALAR_TYPES.has(t);
  if (Array.isArray(t)) return t.length > 0 && t.every((x) => SCALAR_TYPES.has(x));
  return Array.isArray(items.enum) && items.enum.every(scalar);
}

// Whether a subschema has a default below itself (its own is not counted).
// A property named `default` counts as one too, which errs the safe way.
function defaultBelow(s) {
  if (s === null || typeof s !== 'object') return false;
  for (const k of Object.keys(s)) {
    if (k === 'default' || k === 'enum' || k === 'const' || k === 'examples') continue;
    const v = s[k];
    if (v === null || typeof v !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(v, 'default') || defaultBelow(v)) return true;
  }
  return false;
}

// Whether a subschema holds a `$ref` (or a dynamic one) anywhere.
function refers(s) {
  if (s === null || typeof s !== 'object') return false;
  if (Array.isArray(s)) return s.some(refers);
  for (const k of Object.keys(s)) {
    if (k === '$ref' || k === '$dynamicRef' || k === '$recursiveRef') return true;
    if (k === 'enum' || k === 'const' || k === 'default' || k === 'examples') continue;
    if (refers(s[k])) return true;
  }
  return false;
}

function defaultsCannotChangeVerdict(root, schemaMap, Validator) {
  if (root === null || typeof root !== 'object') return true;
  if (schemaMap && schemaMap.size > 0) return false;
  const nodes = [];
  const index = new Map(); // schema object -> node index
  const parent = [];       // union-find over nodes joined by APPLY_HERE and $ref
  let wholeValueCompare = false;
  let unreadable = false;

  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const branched = new Set(); // nodes reached through a branching keyword, or holding one

  const visit = (s) => {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) return -1;
    const hit = index.get(s);
    if (hit !== undefined) return hit;
    const i = nodes.length;
    nodes.push(s); index.set(s, i); parent.push(i);
    if (Array.isArray(s.enum) && s.enum.some((v) => v !== null && typeof v === 'object')) wholeValueCompare = true;
    if (s.const !== null && typeof s.const === 'object') wholeValueCompare = true;
    if (s.uniqueItems === true && !scalarItems(s.items)) wholeValueCompare = true;
    for (const k of SUB_MAPS) {
      const m = s[k];
      if (m && typeof m === 'object' && !Array.isArray(m)) for (const n of Object.keys(m)) visit(m[n]);
    }
    for (const k of SUB_ONE) if (s[k] && typeof s[k] === 'object') { if (Array.isArray(s[k])) s[k].forEach(visit); else visit(s[k]); }
    for (const k of APPLY_HERE) {
      const v = s[k];
      if (v === undefined) continue;
      for (const m of Array.isArray(v) ? v : [v]) {
        const j = visit(m);
        if (j < 0) continue;
        union(i, j);
        if (BRANCHING.has(k)) { branched.add(i); branched.add(j); }
      }
    }
    if (typeof s.$ref === 'string') {
      const t = localTarget(root, s.$ref);
      if (t === undefined) unreadable = true;
      else { const j = visit(t); if (j >= 0) union(i, j); }
    }
    if (s.$dynamicRef !== undefined || s.$recursiveRef !== undefined) unreadable = true;
    return i;
  };
  visit(root);
  if (unreadable) return false;

  // Schemas applied to one object apply their `properties[k]` to its value at
  // `k`, all of them together, and their `items` to its elements: those are
  // one group too. `additionalProperties` may meet any name, so it joins every
  // `properties` value of its group. Repeated until nothing joins.
  for (let changed = true; changed;) {
    changed = false;
    const byGroup = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const g = find(i);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(i);
    }
    const join = (a, b) => { if (a >= 0 && b >= 0 && find(a) !== find(b)) { union(a, b); changed = true; } };
    for (const members of byGroup.values()) {
      if (members.length < 2 && !nodes[members[0]].additionalProperties) continue;
      const atName = new Map();
      let firstItems = -1;
      const values = [];
      const extra = [];
      for (const i of members) {
        const s = nodes[i];
        const p = s.properties;
        if (p && typeof p === 'object' && !Array.isArray(p)) {
          for (const k of Object.keys(p)) {
            const j = index.has(p[k]) ? index.get(p[k]) : -1;
            if (j < 0) continue;
            values.push(j);
            if (atName.has(k)) join(atName.get(k), j); else atName.set(k, j);
          }
        }
        if (s.items && typeof s.items === 'object' && !Array.isArray(s.items)) {
          const j = index.has(s.items) ? index.get(s.items) : -1;
          if (firstItems < 0) firstItems = j; else join(firstItems, j);
        }
        if (s.additionalProperties && typeof s.additionalProperties === 'object') {
          const j = index.has(s.additionalProperties) ? index.get(s.additionalProperties) : -1;
          if (j >= 0) extra.push(j);
        }
      }
      for (const a of extra) for (const v of values) join(a, v);
      for (let x = 1; x < extra.length; x++) join(extra[0], extra[x]);
    }
  }

  // The names each group of schemas fills, and what the group asks of them.
  const fills = new Map(); // group -> [[name, default, subschema]]
  for (const s of nodes) {
    const p = s.properties;
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    for (const k of Object.keys(p)) {
      const sub = p[k];
      if (sub && typeof sub === 'object' && Object.prototype.hasOwnProperty.call(sub, 'default')) {
        const g = find(index.get(s));
        if (!fills.has(g)) fills.set(g, []);
        fills.get(g).push([k, sub.default]);
      }
    }
  }
  if (fills.size === 0) return true;
  if (wholeValueCompare) return false;

  const groups = new Map(); // group -> its schemas
  for (let i = 0; i < nodes.length; i++) {
    const g = find(i);
    if (!fills.has(g)) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  }
  for (const [g, names] of fills) {
    const members = groups.get(g);
    for (const i of members) {
      const s = nodes[i];
      if (branched.has(i)) return false;
      if (s.minProperties !== undefined || s.maxProperties !== undefined) return false;
      if (s.enum !== undefined || s.const !== undefined) return false;
    }
    for (const [k, value] of names) {
      // An object or an array is checked as a scalar is, but only where no
      // default below would be filled into it as well.
      const plain = scalar(value);
      if (!plain && JSON.stringify(value) === undefined) return false;
      for (const i of members) {
        const s = nodes[i];
        if (Array.isArray(s.required) && s.required.includes(k)) return false;
        const own = s.properties && typeof s.properties === 'object' && Object.prototype.hasOwnProperty.call(s.properties, k);
        if (!own && s.additionalProperties !== undefined && s.additionalProperties !== true) return false;
        if (own) {
          const sub = s.properties[k];
          if (sub === false) return false;
          if (sub === true || sub === null || typeof sub !== 'object') continue;
          if (refers(sub)) return false;
          if (!plain && defaultBelow(sub)) return false;
          let ok;
          try { ok = new Validator(sub, { engine: 'interpreter', useDefaults: false }).validate(value).valid; } catch { return false; }
          if (!ok) return false;
        }
      }
    }
  }
  return true;
}

// The question as the Node entry sets it on the core (index.js), for
// a validator with a preprocess pass before its buffer APIs take the native
// walker: defaults only, none of which can change a verdict. coerceTypes and
// removeAdditional change values and names, and always count. Only the Node
// entry asks, where the addon can load; package.json's browser field leaves
// this module out of a page, and the edge and lite entries do not name it.
function keepsVerdict(v, Validator) {
  const o = v._options || {};
  if (o.coerceTypes || o.removeAdditional) return false;
  return defaultsCannotChangeVerdict(v._schemaObj, v._schemaMap, Validator);
}

module.exports = { defaultsCannotChangeVerdict, keepsVerdict };
