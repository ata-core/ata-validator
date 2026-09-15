'use strict';

// A schema-directed scanner: it answers the verdict from the JSON text without
// building the document. `JSON.parse` is three quarters of the cost of a real
// request, so a validator that only has to say yes or no should not pay it.
//
// The scanner is a second JSON reader, which is the dangerous part. Two rules
// keep it honest:
//
//   1. Anything it is not sure about it declines. `compileScanner` returns null
//      for a schema outside the supported set, and a compiled scanner returns
//      BAIL at runtime for a document shape it cannot answer (a duplicate key,
//      an escaped property name, a subtree deeper than it will walk). The
//      caller then parses and validates as before. Declining costs a little
//      speed; guessing costs a silently accepted document.
//   2. Every check that needs the decoded value gets the decoded value. The
//      scanner materialises that one scalar, never the document around it, and
//      hands it to the same compiled check the validator itself runs. So
//      `format`, `pattern`, `const` and `enum` cannot drift from the validator:
//      they are the validator.
//
// tests/test_scanner_differential.js holds the scanner and `validate()` to the
// same verdict on the whole official suite plus a malformed-JSON corpus, and
// counts disagreements, not bails.

const { compileToJSCodegen } = require('./js-compiler');

const VALID = 1;
const INVALID = 0;
const BAIL = -1;

// A nested schema emits nested code, so depth is source size. Past this the
// scanner is not worth the function it would build.
const MAX_SCHEMA_DEPTH = 12;
// `seen` is a bitmask, so this is how many distinct property names one object
// node may name before the scanner declines.
const MAX_PROPS = 30;

// Read structurally, straight out of the text.
const STRUCTURAL = new Set([
  'type', 'properties', 'required', 'additionalProperties',
  'minProperties', 'maxProperties', 'items', 'minItems', 'maxItems',
]);

// Constrain one scalar. Answered by the validator's own compiled check over
// the materialised scalar, or inline where the scan already has the number.
const LEAF = new Set([
  'minLength', 'maxLength', 'pattern', 'format', 'const', 'enum',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
]);

// No bearing on the verdict. `default` is deliberately not here: defaults are
// filled in before validation, so a missing property with a default is a
// property the scanner never sees and `validate()` does. A schema carrying one
// is declined.
const IGNORED = new Set([
  'title', 'description', '$comment', 'examples', 'deprecated',
  'readOnly', 'writeOnly', '$schema', '$defs', 'definitions', '$vocabulary',
]);

// `$id` and `$anchor` move the base a reference resolves against, and the
// scanner resolves references itself. Rather than reimplement base-URI
// resolution, it declines any document that carries one below the root, which
// is where every historical silent acceptance in `$ref` handling has lived.
const BASE_CHANGING = new Set(['$id', '$anchor', '$dynamicAnchor', '$dynamicRef']);

// A reference is inlined, so a fan-out of them is emitted source. This caps it.
const MAX_NODES = 400;

const KINDS = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

// Declining is the safe answer, and it is also the thing worth measuring: the
// reason travels with the throw so a caller can ask what the scanner cannot do
// yet, rather than guessing at coverage.
const DECLINE = Symbol('decline');
let declineReason = null;
function decline(reason) { declineReason = reason || 'unknown'; throw DECLINE; }

const WS = 'while(c===32||c===10||c===9||c===13){c=s.charCodeAt(++i);}';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// The set of JSON kinds this node can accept, from `type` alone.
function typeSet(schema) {
  const t = schema.type;
  if (t === undefined) return null; // any
  const list = Array.isArray(t) ? t : [t];
  const out = new Set();
  for (const name of list) {
    if (typeof name !== 'string' || !KINDS.includes(name)) decline('type:' + String(name));
    out.add(name);
  }
  if (out.size === 0) decline('type:empty');
  return out;
}

function allows(types, kind) {
  if (types === null) return true;
  if (kind === 'number') return types.has('number') || types.has('integer');
  return types.has(kind);
}

// Only `integer` and not `number`: the scan has to reject 1.5.
function integerOnly(types) {
  return types !== null && types.has('integer') && !types.has('number');
}

function compileLeaf(keys, schema, ctx) {
  const sub = {};
  for (const k of keys) sub[k] = schema[k];
  const fn = compileToJSCodegen(sub, null, ctx.userFormats);
  if (typeof fn !== 'function') decline('leaf:' + keys.join('+'));
  ctx.helpers.push(fn);
  return '_h[' + (ctx.helpers.length - 1) + ']';
}

// Only a pointer into the document being compiled. Anything with a scheme, a
// path or an anchor is somebody else's document or somebody else's base, and
// the scanner has no registry and no resolver.
function resolveLocalRef(root, ref) {
  if (typeof ref !== 'string') decline('$ref:not-string');
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) decline('$ref:not-local');
  let node = root;
  for (const rawToken of ref.slice(2).split('/')) {
    const token = decodeURIComponent(rawToken).split('~1').join('/').split('~0').join('~');
    if (node === null || typeof node !== 'object') decline('$ref:unresolved');
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(token)) decline('$ref:unresolved');
      node = node[Number(token)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(node, token)) decline('$ref:unresolved');
      node = node[token];
    }
    if (node === undefined) decline('$ref:unresolved');
  }
  return node;
}

function compileScanner(schema, options) {
  const opts = options || {};
  const ctx = {
    uid: 0, helpers: [], userFormats: opts.userFormats || null,
    root: schema, refStack: [], nodes: 0,
  };
  declineReason = null;
  let body;
  try {
    const out = [];
    out.push('var len=s.length,i=0,c=s.charCodeAt(0);');
    out.push(WS);
    emitValue(schema, ctx, out, 0);
    out.push(WS);
    out.push('if(i<len)return 0;');
    out.push('return 1;');
    body = out.join('\n');
  } catch (e) {
    if (e === DECLINE) {
      if (opts.onDecline) opts.onDecline(declineReason);
      return null;
    }
    throw e;
  }
  let fn;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function('_h', '_r', 'return function scan(s){\n' + body + '\n}')(ctx.helpers, require('./scan-runtime'));
  } catch {
    return null; // a runtime without code generation has no scanner, by design
  }
  return { scan: fn, source: body, helpers: ctx.helpers.length };
}

function emitValue(schema, ctx, out, depth) {
  if (depth > MAX_SCHEMA_DEPTH) decline('depth');
  if (schema === true) { emitSkip(out); return; }
  if (schema === false) { out.push('return 0;'); return; }
  if (!isPlainObject(schema)) decline('schema-not-object');
  if (++ctx.nodes > MAX_NODES) decline('too-many-nodes');
  for (const k of Object.keys(schema)) {
    if (BASE_CHANGING.has(k) && !(k === '$id' && depth === 0)) decline('base-changing:' + k);
  }

  // A reference is inlined. Draft 7 lets `$ref` override its siblings and 2020-12
  // applies both, so a reference with any sibling that bears on the verdict is
  // declined rather than read under one dialect's rule and compiled under the
  // other's. A reference that re-enters one already being expanded describes a
  // recursive document, which does not fit in a finite emitted function.
  if (schema.$ref !== undefined) {
    for (const k of Object.keys(schema)) {
      if (k !== '$ref' && !IGNORED.has(k)) decline('$ref:sibling:' + k);
    }
    const ref = schema.$ref;
    if (ctx.refStack.includes(ref)) decline('$ref:recursive');
    const target = resolveLocalRef(ctx.root, ref);
    ctx.refStack.push(ref);
    emitValue(target, ctx, out, depth);
    ctx.refStack.pop();
    return;
  }

  const present = [];
  for (const k of Object.keys(schema)) {
    // A root `$id` names the document. It does not move the base a
    // fragment-only pointer resolves against, which is the only kind of
    // reference the scanner follows, so it carries no meaning here.
    if (k === '$id' && depth === 0) continue;
    if (IGNORED.has(k)) continue;
    if (STRUCTURAL.has(k) || LEAF.has(k)) { present.push(k); continue; }
    decline('keyword:' + k);
  }

  const types = typeSet(schema);
  const has = (k) => present.includes(k);

  // const and enum over a composite would need the whole subtree as a value,
  // which is the materialisation the scanner exists to avoid.
  // A composite value would have to be compared as a whole, which is the
  // materialisation the scanner exists to avoid. An empty `enum` admits
  // nothing, so it bars composites too: the test is that the keyword is
  // present, not that it lists anything.
  let compositeAllowed = true;
  if (has('const') || has('enum')) {
    compositeAllowed = false;
    const listed = [];
    if (has('const')) listed.push(schema.const);
    if (has('enum')) {
      if (!Array.isArray(schema.enum)) decline('enum:not-array');
      for (const v of schema.enum) listed.push(v);
    }
    for (const v of listed) if (v !== null && typeof v === 'object') decline('const/enum:composite');
  }

  const branches = [];

  if (allows(types, 'object')) {
    if (!compositeAllowed) branches.push(['c===123', ['return 0;']]);
    else {
      const b = [];
      emitObject(schema, ctx, b, depth);
      branches.push(['c===123', b]);
    }
  }
  if (allows(types, 'array')) {
    if (!compositeAllowed) branches.push(['c===91', ['return 0;']]);
    else {
      const b = [];
      emitArray(schema, ctx, b, depth);
      branches.push(['c===91', b]);
    }
  }
  if (allows(types, 'string')) {
    const b = [];
    emitString(schema, ctx, b);
    branches.push(['c===34', b]);
  }
  if (allows(types, 'number')) {
    const b = [];
    emitNumber(schema, ctx, b, types);
    branches.push(['c===45||(c>=48&&c<=57)', b]);
  }
  if (allows(types, 'boolean')) {
    const b = [];
    emitLiteral(schema, ctx, b, 'boolean');
    branches.push(['c===116||c===102', b]);
  }
  if (allows(types, 'null')) {
    const b = [];
    emitLiteral(schema, ctx, b, 'null');
    branches.push(['c===110', b]);
  }

  if (branches.length === 0) { out.push('return 0;'); return; }
  const parts = [];
  for (let k = 0; k < branches.length; k++) {
    parts.push((k === 0 ? 'if(' : 'else if(') + branches[k][0] + '){');
    parts.push(branches[k][1].join('\n'));
    parts.push('}');
  }
  parts.push('else return 0;');
  out.push(parts.join('\n'));
}

// Any JSON value, validated as JSON and stepped over.
function emitSkip(out) {
  out.push('{var _j=_r.skipValue(s,i);if(_j===-2)return -1;if(_j<0)return 0;i=_j;c=s.charCodeAt(i);}');
}

// Leaves `_p<n>` just past the opening quote, `_e<n>` at the closing one,
// `_x<n>` set when the span carries an escape, `_u<n>` the UTF-16 length when
// one was asked for. `i` ends just past the string and `c` is in step.
function emitStringSpan(ctx, out, n, wantLen) {
  out.push('var _p' + n + '=++i,_x' + n + '=0' + (wantLen ? ',_u' + n + '=0,_hs' + n + '=0' : '') + ';');
  out.push('for(;;){c=s.charCodeAt(i);');
  out.push('if(c===34)break;');
  out.push('if(c===92){var _q' + n + '=s.charCodeAt(i+1);');
  out.push('if(_q' + n + '===117){if(!_r.hex4(s,i+2))return 0;i+=6;_x' + n + '=1;' + (wantLen ? '_u' + n + '++;' : '') + 'continue;}');
  out.push('if(_q' + n + '===34||_q' + n + '===92||_q' + n + '===47||_q' + n + '===98||_q' + n + '===102||_q' + n + '===110||_q' + n + '===114||_q' + n + '===116){i+=2;_x' + n + '=1;' + (wantLen ? '_u' + n + '++;' : '') + 'continue;}');
  out.push('return 0;}');
  out.push('if(!(c>=32))return 0;');
  // One wraparound compare says whether this unit is a high surrogate, which is
  // the only case where counting units is not counting characters.
  out.push('i++;' + (wantLen ? '_u' + n + '++;if(((c-55296)>>>0)<1024)_hs' + n + '=1;' : ''));
  out.push('}');
  out.push('var _e' + n + '=i;c=s.charCodeAt(++i);');
}

function emitString(schema, ctx, out) {
  const n = ctx.uid++;
  const inlineLen = schema.minLength !== undefined || schema.maxLength !== undefined;
  if (schema.minLength !== undefined && typeof schema.minLength !== 'number') decline('minLength:not-number');
  if (schema.maxLength !== undefined && typeof schema.maxLength !== 'number') decline('maxLength:not-number');
  const delegated = [];
  for (const k of ['pattern', 'format', 'const', 'enum']) if (schema[k] !== undefined) delegated.push(k);

  emitStringSpan(ctx, out, n, inlineLen);
  if (inlineLen) {
    // minLength and maxLength count Unicode code points. Counting code units
    // while scanning is right for every span that carries neither an escape
    // nor a surrogate, which is almost all of them; for the rest the string is
    // materialised and the validator's own length check answers, so there is
    // one definition of "characters" and the scanner does not hold a copy.
    const lenKeys = [];
    if (schema.minLength !== undefined) lenKeys.push('minLength');
    if (schema.maxLength !== undefined) lenKeys.push('maxLength');
    const lf = compileLeaf(lenKeys, schema, ctx);
    out.push('if(_x' + n + '||_hs' + n + '){if(!' + lf + '(_r.span(s,_p' + n + ',_e' + n + ',_x' + n + ')))return 0;}');
    out.push('else{');
    if (schema.minLength !== undefined) out.push('if(_u' + n + '<' + schema.minLength + ')return 0;');
    if (schema.maxLength !== undefined) out.push('if(_u' + n + '>' + schema.maxLength + ')return 0;');
    out.push('}');
  }
  if (delegated.length > 0) {
    // `const` and `enum` may list non-strings; the compiled check answers that
    // for the materialised string exactly as it would for a parsed one.
    const f = compileLeaf(delegated, schema, ctx);
    out.push('if(!' + f + '(_r.span(s,_p' + n + ',_e' + n + ',_x' + n + ')))return 0;');
  }
}

function emitNumber(schema, ctx, out, types) {
  const n = ctx.uid++;
  for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
    if (schema[k] !== undefined && typeof schema[k] !== 'number') decline('bound:' + k + ':not-number');
  }
  const delegated = [];
  for (const k of ['multipleOf', 'const', 'enum']) if (schema[k] !== undefined) delegated.push(k);
  const intOnly = integerOnly(types);
  // `type: number` rejects a literal that overflows to Infinity, so the value
  // is needed whenever a type was named at all.
  const wantValue = delegated.length > 0
    || schema.minimum !== undefined || schema.maximum !== undefined
    || schema.exclusiveMinimum !== undefined || schema.exclusiveMaximum !== undefined
    || types !== null;

  out.push('var _np' + n + '=i,_v' + n + '=0,_ng' + n + '=0,_nd' + n + '=0,_pl' + n + '=1;');
  out.push('if(c===45){_ng' + n + '=1;c=s.charCodeAt(++i);}');
  out.push('if(c===48){_nd' + n + '=1;c=s.charCodeAt(++i);}');
  out.push('else if(c>=49&&c<=57){do{_v' + n + '=_v' + n + '*10+(c-48);_nd' + n + '++;c=s.charCodeAt(++i);}while(c>=48&&c<=57);}');
  out.push('else return 0;');
  out.push('if(c===46){_pl' + n + '=0;c=s.charCodeAt(++i);if(!(c>=48&&c<=57))return 0;do{c=s.charCodeAt(++i);}while(c>=48&&c<=57);}');
  out.push('if(c===101||c===69){_pl' + n + '=0;c=s.charCodeAt(++i);if(c===43||c===45)c=s.charCodeAt(++i);if(!(c>=48&&c<=57))return 0;do{c=s.charCodeAt(++i);}while(c>=48&&c<=57);}');
  if (wantValue) {
    // Digits accumulated during the scan are exact below 2^53; past that, and
    // for anything with a fraction or an exponent, the parser's own conversion
    // is the one that has to agree.
    out.push('if(_pl' + n + '===0||_nd' + n + '>15){_v' + n + '=+s.slice(_np' + n + ',i);}else if(_ng' + n + '){_v' + n + '=-_v' + n + ';}');
  }
  if (intOnly) out.push('if(_pl' + n + '===0&&!Number.isInteger(_v' + n + '))return 0;');
  if (types !== null) out.push('if(!isFinite(_v' + n + '))return 0;');
  if (schema.minimum !== undefined) out.push('if(!(_v' + n + '>=' + schema.minimum + '))return 0;');
  if (schema.maximum !== undefined) out.push('if(!(_v' + n + '<=' + schema.maximum + '))return 0;');
  if (schema.exclusiveMinimum !== undefined) out.push('if(!(_v' + n + '>' + schema.exclusiveMinimum + '))return 0;');
  if (schema.exclusiveMaximum !== undefined) out.push('if(!(_v' + n + '<' + schema.exclusiveMaximum + '))return 0;');
  if (delegated.length > 0) {
    const f = compileLeaf(delegated, schema, ctx);
    out.push('if(!' + f + '(_v' + n + '))return 0;');
  }
}

// true, false and null carry no information the scan has to read, so whether
// const or enum admits them is settled while the scanner is built.
function emitLiteral(schema, ctx, out, kind) {
  const delegated = [];
  for (const k of ['const', 'enum']) if (schema[k] !== undefined) delegated.push(k);
  let allowTrue = true, allowFalse = true, allowNull = true;
  if (delegated.length > 0) {
    const sub = {};
    for (const k of delegated) sub[k] = schema[k];
    const fn = compileToJSCodegen(sub, null, ctx.userFormats);
    if (typeof fn !== 'function') decline('literal-leaf');
    allowTrue = fn(true) === true;
    allowFalse = fn(false) === true;
    allowNull = fn(null) === true;
  }
  if (kind === 'null') {
    if (!allowNull) { out.push('return 0;'); return; }
    out.push('if(s.charCodeAt(i+1)!==117||s.charCodeAt(i+2)!==108||s.charCodeAt(i+3)!==108)return 0;');
    out.push('i+=4;c=s.charCodeAt(i);');
    return;
  }
  out.push('if(c===116){' + (allowTrue ? '' : 'return 0;') + 'if(s.charCodeAt(i+1)!==114||s.charCodeAt(i+2)!==117||s.charCodeAt(i+3)!==101)return 0;i+=4;}');
  out.push('else{' + (allowFalse ? '' : 'return 0;') + 'if(s.charCodeAt(i+1)!==97||s.charCodeAt(i+2)!==108||s.charCodeAt(i+3)!==115||s.charCodeAt(i+4)!==101)return 0;i+=5;}');
  out.push('c=s.charCodeAt(i);');
}

function emitArray(schema, ctx, out, depth) {
  const n = ctx.uid++;
  for (const k of ['minItems', 'maxItems']) {
    if (schema[k] !== undefined && typeof schema[k] !== 'number') decline('itemsCount:' + k + ':not-number');
  }
  const items = schema.items;
  if (items !== undefined && !isPlainObject(items) && typeof items !== 'boolean') decline('items:tuple');
  const wantCount = schema.minItems !== undefined || schema.maxItems !== undefined;

  out.push('c=s.charCodeAt(++i);');
  if (wantCount) out.push('var _n' + n + '=0;');
  out.push(WS);
  out.push('if(c!==93){for(;;){');
  if (items === undefined || items === true) emitSkip(out);
  else emitValue(items, ctx, out, depth + 1);
  if (wantCount) {
    out.push('_n' + n + '++;');
    if (schema.maxItems !== undefined) out.push('if(_n' + n + '>' + schema.maxItems + ')return 0;');
  }
  out.push(WS);
  out.push('if(c===44){c=s.charCodeAt(++i);' + WS + 'continue;}');
  out.push('if(c===93)break;');
  out.push('return 0;}}');
  out.push('c=s.charCodeAt(++i);');
  if (schema.minItems !== undefined) {
    if (wantCount) out.push('if(_n' + n + '<' + schema.minItems + ')return 0;');
  }
}

// One object member's value. A value that fails does not end the scan: JSON
// lets a name repeat and the parser keeps the last one, so the member the
// parser would have judged may still be ahead. The failure is recorded, the
// value is stepped over, and scanning continues; a repeat of any name already
// seen bails, and an object that reaches its closing brace with a recorded
// failure and no repeat is invalid.
//
// Every `return 0` inside the member becomes that record, which is also how
// the rule reaches nested objects: an inner object's own verdict is a value
// failure at the level above it.
function emitMember(sub, ctx, out, depth, objId) {
  const lines = [];
  emitValue(sub, ctx, lines, depth + 1);
  const body = lines.join('\n');
  if (!body.includes('return 0;')) { out.push(body); return; }
  const label = '_mb' + (ctx.uid++);
  out.push('var _vs' + label + '=i;');
  out.push(label + ':{');
  out.push(body.split('return 0;').join('{_f' + objId + '=2;break ' + label + ';}'));
  out.push('}');
  // Resync from where the value started: a scan that stopped partway through
  // one cannot say where it ends, and the skipper can.
  out.push('if(_f' + objId + '===2){_f' + objId + '=1;i=_r.skipValue(s,_vs' + label + ');if(i<0)return 0;c=s.charCodeAt(i);}');
}

function emitObject(schema, ctx, out, depth) {
  const n = ctx.uid++;
  const props = schema.properties;
  if (props !== undefined && !isPlainObject(props)) decline('properties:not-object');
  const required = schema.required;
  if (required !== undefined && !Array.isArray(required)) decline('required:not-array');
  const ap = schema.additionalProperties;
  if (ap !== undefined && !isPlainObject(ap) && typeof ap !== 'boolean') decline('additionalProperties:shape');
  for (const k of ['minProperties', 'maxProperties']) {
    if (schema[k] !== undefined && typeof schema[k] !== 'number') decline('propCount:' + k + ':not-number');
  }
  const counting = schema.minProperties !== undefined || schema.maxProperties !== undefined;
  // A duplicate key is last-wins for the parser but two members for the scan,
  // so a count over a document that may repeat an unknown name is not the same
  // count. With `additionalProperties: false` every name is a known name and a
  // repeat bails, so the count is safe there and only there.
  if (counting && ap !== false) decline('min/maxProperties:open-object');

  const names = [];
  if (props) for (const k of Object.keys(props)) names.push(k);
  if (required) for (const k of required) {
    if (typeof k !== 'string') decline('required:not-string');
    if (!names.includes(k)) names.push(k);
  }
  if (names.length > MAX_PROPS) decline('too-many-properties');
  const bit = new Map();
  names.forEach((k, idx) => bit.set(k, 1 << idx));
  let reqMask = 0;
  if (required) for (const k of required) reqMask |= bit.get(k);

  out.push('c=s.charCodeAt(++i);');
  out.push('var _s' + n + '=0,_f' + n + '=0' + (counting ? ',_c' + n + '=0' : '') + ';');
  out.push(WS);
  out.push('if(c!==125){for(;;){');
  out.push(WS);
  out.push('if(c!==34)return 0;');
  const kn = ctx.uid++;
  emitStringSpan(ctx, out, kn, false);
  // A key written with an escape decodes to a name the raw span does not show,
  // so the dispatch below would read it as a different property.
  out.push('if(_x' + kn + ')return -1;');
  out.push(WS);
  out.push('if(c!==58)return 0;');
  out.push('c=s.charCodeAt(++i);');
  out.push(WS);
  if (counting) out.push('_c' + n + '++;');
  out.push('var _kl' + kn + '=_e' + kn + '-_p' + kn + ';');

  // Dispatch on the raw key span: switch on its length, then compare
  // characters. No substring is built, so a known name costs no allocation.
  const byLen = new Map();
  for (const name of names) {
    const len = name.length;
    if (!byLen.has(len)) byLen.set(len, []);
    byLen.get(len).push(name);
  }
  const additional = [];
  if (ap === false) {
    // An unknown name makes the object invalid however many times it appears,
    // so no later member can change this answer and the scan can stop here.
    additional.push('return 0;');
  } else if (ap === undefined || ap === true) {
    emitSkip(additional);
  } else {
    // A repeated unknown name is not tracked by the seen mask, and the parser
    // keeps the last one, so a failure here may be a failure the parser never
    // sees. Bail rather than guess.
    const lines = [];
    emitValue(ap, ctx, lines, depth + 1);
    additional.push(lines.join('\n').split('return 0;').join('return -1;'));
  }

  out.push('switch(_kl' + kn + '){');
  for (const [len, group] of byLen) {
    out.push('case ' + len + ':{');
    let first = true;
    for (const name of group) {
      const tests = [];
      for (let k = 0; k < name.length; k++) {
        tests.push('s.charCodeAt(_p' + kn + (k === 0 ? '' : '+' + k) + ')===' + name.charCodeAt(k));
      }
      out.push((first ? 'if(' : 'else if(') + (tests.length ? tests.join('&&') : 'true') + '){');
      first = false;
      out.push('if(_s' + n + '&' + bit.get(name) + ')return -1;');
      out.push('_s' + n + '|=' + bit.get(name) + ';');
      const sub = props && Object.prototype.hasOwnProperty.call(props, name) ? props[name] : undefined;
      if (sub === undefined) out.push(additional.join('\n'));
      else emitMember(sub, ctx, out, depth, n);
      out.push('}');
    }
    out.push('else{' + additional.join('\n') + '}');
    out.push('break;}');
  }
  out.push('default:{' + additional.join('\n') + '}}');

  out.push(WS);
  out.push('if(c===44){c=s.charCodeAt(++i);' + WS + 'continue;}');
  out.push('if(c===125)break;');
  out.push('return 0;}}');
  out.push('c=s.charCodeAt(++i);');
  out.push('if(_f' + n + ')return 0;');
  if (reqMask !== 0) out.push('if((_s' + n + '&' + reqMask + ')!==' + reqMask + ')return 0;');
  if (schema.minProperties !== undefined) out.push('if(_c' + n + '<' + schema.minProperties + ')return 0;');
  if (schema.maxProperties !== undefined) out.push('if(_c' + n + '>' + schema.maxProperties + ')return 0;');
}

module.exports = { compileScanner, VALID, INVALID, BAIL };
