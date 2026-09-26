'use strict';

// Generated source from interpreter plans: the verdict function.
//
// The interpreted engine is the reference every other engine is tested
// against, and its Plan is a schema node with every keyword resolved once.
// lib/plan-compiler.js turns plans into closures; this turns them into source,
// deciding at compile time exactly what plan-compiler decides, and calling the
// same helpers (deepEqual, the code point bounds, multipleOfOk, the format
// functions and compiled patterns the plan already holds), so the answers
// cannot drift the way three hand-written generators did.
//
// The scope is deliberately narrow for now: value-level keywords, properties
// and additionalProperties, prefixItems and items, and the in-place
// applicators. Everything else, references, unevaluated*, contains,
// propertyNames, patternProperties, dependentSchemas, custom keywords, makes
// the compiler return null. It never emits a function with a keyword missing.

const { createInterpreter, _planInternals: I } = require('./interpreter');
const { Plan, deepEqual, cpAtLeast, cpAtMost, multipleOfOk, T_STRING, T_NUMBER, T_INTEGER, T_BOOLEAN, T_NULL, T_OBJECT, T_ARRAY } = I;

const DECLINE = Symbol('plan-source.decline');
const ALL_TYPES = T_STRING | T_NUMBER | T_INTEGER | T_BOOLEAN | T_NULL | T_OBJECT | T_ARRAY;

// The own-property test the generators use; see ownKeyExpr in js-compiler.js.
const HELPERS = 'const _hop=Object.prototype.hasOwnProperty;';

const PROTO_NAMES = new Set([...Object.getOwnPropertyNames(Object.prototype), '__proto__']);

function isPrimitive(x) {
  return x === null || typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && isFinite(x));
}

function lit(x) {
  return JSON.stringify(x);
}

function createCtx() {
  return { n: 0, argNames: [], argVals: [], fns: [], fnFor: new Map() };
}

// A value the emitted code needs by reference: a function, a RegExp, a list.
function arg(ctx, value) {
  const i = ctx.argVals.indexOf(value);
  if (i !== -1) return ctx.argNames[i];
  const name = '_a' + ctx.argVals.length;
  ctx.argNames.push(name);
  ctx.argVals.push(value);
  return name;
}

function local(ctx) {
  return '_v' + ctx.n++;
}

// JSON Schema type bits, exactly as dataBits() assigns them: a non-finite
// number has no type, so it matches neither number nor integer.
function typeTest(mask, v) {
  const parts = [];
  if (mask & T_STRING) parts.push(`typeof ${v}==='string'`);
  if (mask & T_NUMBER) parts.push(`(typeof ${v}==='number'&&isFinite(${v}))`);
  else if (mask & T_INTEGER) parts.push(`Number.isInteger(${v})`);
  if (mask & T_BOOLEAN) parts.push(`typeof ${v}==='boolean'`);
  if (mask & T_NULL) parts.push(`${v}===null`);
  if ((mask & T_OBJECT) && (mask & T_ARRAY)) parts.push(`(typeof ${v}==='object'&&${v}!==null)`);
  else if (mask & T_OBJECT) parts.push(`(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`);
  else if (mask & T_ARRAY) parts.push(`Array.isArray(${v})`);
  return parts.length ? parts.join('||') : 'false';
}

// `plain` names a local holding `v.__proto__===Object.prototype`, read once per
// object. With the key a constant at the `in`, the engine keeps the check
// monomorphic; through a shared helper the key is a parameter and it is not.
function ownTest(v, key, plain) {
  const k = lit(key);
  return PROTO_NAMES.has(key) ? `_hop.call(${v},${k})` : `(${plain}?${k} in ${v}:_hop.call(${v},${k}))`;
}

const K_NUM = T_NUMBER | T_INTEGER;
// The body under a guard for one kind of value, given what the type check
// already established: unconditional when the value can only be that kind,
// nothing at all when it cannot be.
function guarded(known, kind, cond, body) {
  if (!body) return '';
  if ((known & kind) === 0) return '';
  if ((known & ~kind) === 0) return body;
  return `if(${cond}){${body}}`;
}

// Value-level keywords, in compileLeafV's order and with its meaning.
function emitLeaf(ctx, P, v, known) {
  let out = '';
  if (P.hasType) out += `if(!(${typeTest(P.typeMask, v)}))return false;`;
  if (P.enum !== null) {
    const vals = P.enum;
    if (vals.length === 0) out += 'return false;';
    else if (vals.every(isPrimitive)) out += `if(!(${vals.map((x) => `${v}===${lit(x)}`).join('||')}))return false;`;
    else {
      const a = arg(ctx, vals);
      const de = arg(ctx, deepEqual);
      const i = local(ctx);
      out += `{let ${i}=0;for(;${i}<${a}.length;${i}++)if(${de}(${a}[${i}],${v}))break;if(${i}===${a}.length)return false}`;
    }
  }
  if (P.hasConst) {
    out += isPrimitive(P.const)
      ? `if(${v}!==${lit(P.const)})return false;`
      : `if(!${arg(ctx, deepEqual)}(${arg(ctx, P.const)},${v}))return false;`;
  }
  if (P.hasNumber) {
    let n = '';
    if (P.minimum !== undefined) n += `if(${v}<${lit(P.minimum)})return false;`;
    if (P.maximum !== undefined) n += `if(${v}>${lit(P.maximum)})return false;`;
    if (P.exclusiveMinimum !== undefined) n += `if(${v}<=${lit(P.exclusiveMinimum)})return false;`;
    if (P.exclusiveMaximum !== undefined) n += `if(${v}>=${lit(P.exclusiveMaximum)})return false;`;
    if (P.multipleOf !== undefined) n += `if(!${arg(ctx, multipleOfOk)}(${v},${lit(P.multipleOf)}))return false;`;
    out += guarded(known, K_NUM, `typeof ${v}==='number'&&isFinite(${v})`, n);
  }
  if (P.hasString) {
    let s = '';
    if (P.minLength !== undefined) s += `if(!${arg(ctx, cpAtLeast)}(${v},${lit(P.minLength)}))return false;`;
    if (P.maxLength !== undefined) s += `if(!${arg(ctx, cpAtMost)}(${v},${lit(P.maxLength)}))return false;`;
    if (P.pattern !== null) s += `if(!${arg(ctx, P.pattern)}.test(${v}))return false;`;
    if (P.formatFn !== null) s += `if(!${arg(ctx, P.formatFn)}(${v}))return false;`;
    out += guarded(known, T_STRING, `typeof ${v}==='string'`, s);
  }
  if (P.minItems !== undefined || P.maxItems !== undefined || P.uniqueItems) {
    let a = '';
    if (P.minItems !== undefined) a += `if(${v}.length<${lit(P.minItems)})return false;`;
    if (P.maxItems !== undefined) a += `if(${v}.length>${lit(P.maxItems)})return false;`;
    if (P.uniqueItems) {
      const de = arg(ctx, deepEqual);
      const i = local(ctx), j = local(ctx);
      a += `for(let ${i}=0;${i}<${v}.length;${i}++)for(let ${j}=${i}+1;${j}<${v}.length;${j}++)if(${de}(${v}[${i}],${v}[${j}]))return false;`;
    }
    out += guarded(known, T_ARRAY, `Array.isArray(${v})`, a);
  }
  return out;
}

// The object-level keywords of a node, value-level and structural together, so
// the prototype of the object is read once for all of them.
function emitObjectLeaf(ctx, P, v, plain) {
  let o = '';
  if (P.required !== null || P.minProperties !== undefined || P.maxProperties !== undefined || P.dependentRequired !== null) {
    if (P.required !== null) for (const k of P.required) o += `if(!${ownTest(v, k, plain)})return false;`;
    if (P.minProperties !== undefined) o += `if(Object.keys(${v}).length<${lit(P.minProperties)})return false;`;
    if (P.maxProperties !== undefined) o += `if(Object.keys(${v}).length>${lit(P.maxProperties)})return false;`;
    if (P.dependentRequired !== null) {
      for (const [key, deps] of P.dependentRequired) {
        o += `if(${ownTest(v, key, plain)}){${deps.map((dep) => `if(!${ownTest(v, dep, plain)})return false;`).join('')}}`;
      }
    }
  }
  return o;
}

// A subschema asked for a verdict of its own (a branch of anyOf/oneOf, the
// subject of not/if) becomes a named function, emitted once per plan.
function branchFn(ctx, node) {
  if (node === true) return '_t';
  if (node === false) return '_f';
  let name = ctx.fnFor.get(node);
  if (name !== undefined) return name;
  name = '_b' + ctx.fnFor.size;
  ctx.fnFor.set(node, name);
  const body = emitNode(ctx, node, 'd');
  ctx.fns.push(`function ${name}(d){${body}return true}`);
  return name;
}

function emitNode(ctx, node, v) {
  if (node === true) return '';
  if (node === false) return 'return false;';
  if (!(node instanceof Plan)) return '';
  const P = node;
  if (P.tracked || P.hasUnevaluated || P.hasCustom || P.macros !== null ||
      P.contains !== undefined || P.propertyNames !== undefined || P.patternProperties !== null ||
      P.dependentSchemas !== null || P.propertyDependencies !== null) {
    throw DECLINE;
  }
  const known = P.hasType ? P.typeMask : ALL_TYPES;
  let out = emitLeaf(ctx, P, v, known);

  if (P.prefixItems !== null || P.items !== undefined) {
    let a = '';
    if (P.prefixItems !== null) {
      P.prefixItems.forEach((child, i) => {
        const x = local(ctx);
        const body = emitNode(ctx, child, x);
        if (body) a += `if(${v}.length>${i}){const ${x}=${v}[${i}];${body}}`;
      });
    }
    if (P.items !== undefined) {
      const start = P.prefixItems !== null ? P.prefixItems.length : 0;
      const i = local(ctx);
      const x = local(ctx);
      const body = emitNode(ctx, P.items, x);
      if (body) a += `for(let ${i}=${start};${i}<${v}.length;${i}++){const ${x}=${v}[${i}];${body}}`;
    }
    out += guarded(known, T_ARRAY, `Array.isArray(${v})`, a);
  }

  const plain = local(ctx);
  let o = emitObjectLeaf(ctx, P, v, plain);
  if (P.properties !== null || P.additionalProperties !== undefined) {
    const declared = P.properties !== null ? [...P.properties.keys()] : [];
    if (P.properties !== null) {
      for (const [key, entry] of P.properties) {
        const x = local(ctx);
        const body = emitNode(ctx, entry.node, x);
        if (body) o += `if(${ownTest(v, key, plain)}){const ${x}=${v}[${lit(key)}];${body}}`;
      }
    }
    const ap = P.additionalProperties;
    if (ap !== undefined && ap !== true) {
      const k = local(ctx);
      let isDeclared = 'false';
      if (declared.length > 8) {
        const set = Object.create(null);
        for (const key of declared) set[key] = 1;
        isDeclared = `${arg(ctx, set)}[${k}]===1`;
      } else if (declared.length > 0) {
        isDeclared = declared.map((key) => `${k}===${lit(key)}`).join('||');
      }
      let apBody;
      if (ap === false) apBody = 'return false;';
      else {
        const x = local(ctx);
        const body = emitNode(ctx, ap, x);
        apBody = body ? `const ${x}=${v}[${k}];${body}` : '';
      }
      if (apBody) o += `for(const ${k} in ${v}){if(!${plain}&&!_hop.call(${v},${k}))continue;if(${isDeclared})continue;${apBody}}`;
    }
  }
  if (o) out += guarded(known, T_OBJECT, `typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})`, `const ${plain}=${v}.__proto__===Object.prototype;${o}`);

  if (P.allOf !== null) for (const child of P.allOf) out += emitNode(ctx, child, v);
  if (P.anyOf !== null) out += `if(!(${P.anyOf.map((c) => `${branchFn(ctx, c)}(${v})`).join('||')}))return false;`;
  if (P.oneOf !== null) {
    const c = local(ctx);
    out += `{let ${c}=0;${P.oneOf.map((b) => `if(${branchFn(ctx, b)}(${v})&&++${c}>1)return false;`).join('')}if(${c}!==1)return false}`;
  }
  if (P.not !== undefined) out += `if(${branchFn(ctx, P.not)}(${v}))return false;`;
  if (P.if !== undefined) {
    const t = P.then !== undefined ? emitNode(ctx, P.then, v) : '';
    const e = P.else !== undefined ? emitNode(ctx, P.else, v) : '';
    if (t || e) out += `if(${branchFn(ctx, P.if)}(${v})){${t}}else{${e}}`;
  }
  return out;
}

// Returns { fn, source } or null when the schema is outside what this emits.
function compileVerdict(schema, options) {
  let interp;
  try {
    interp = createInterpreter(schema, options || {});
  } catch {
    return null;
  }
  const ctx = createCtx();
  let body;
  try {
    body = emitNode(ctx, interp.rootNode, 'd');
  } catch (e) {
    if (e === DECLINE) return null;
    throw e;
  }
  const source = HELPERS + 'function _t(){return true}function _f(){return false}' +
    ctx.fns.join('') + `return function(d){${body}return true}`;
  let fn;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(...ctx.argNames, source)(...ctx.argVals);
  } catch {
    return null;
  }
  return { fn, source };
}

module.exports = { compileVerdict };
