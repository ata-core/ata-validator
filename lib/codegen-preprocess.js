'use strict';

// The defaults, coercion and removal pass as generated source, which runs
// about twelve times faster than the closure mutators in validator-core.js.
// Part of the code generator, so ata-validator/lite takes the closures.

// Emit the in-place strip for one schema node and everything under its
// `properties`. Scope matches collectRemovals(): object properties only, so
// the two paths keep the same answer.
// Each level's code, its own removal loop and its children's, sits inside the
// guard for that level. A child used to be guarded only on itself, so its
// access expression read through a parent that could be absent or null:
// `{ c: { properties: { d: { additionalProperties: false } } } }` threw a
// TypeError from validate({}) whenever the optional `c` was missing.
function emitRemovals(node, access, lines, depth, seen) {
  if (!node || typeof node !== 'object' || !node.properties) return;
  if (seen.has(node)) return;
  seen.add(node);
  const keys = Object.keys(node.properties);
  const body = [];
  // With no declared property every key is additional, as the interpreted
  // engine's remover has it; this pass used to skip such a node entirely.
  if (node.additionalProperties === false) {
    const kv = '_k' + depth;
    const checks = keys.map((k) => `${kv}!==${JSON.stringify(k)}`).join('&&');
    body.push(keys.length > 0
      ? `for(var ${kv} in ${access})if(${checks})delete ${access}[${kv}]`
      : `for(var ${kv} in ${access})delete ${access}[${kv}]`);
  }
  for (const key of keys) {
    const prop = node.properties[key];
    if (prop && typeof prop === 'object' && prop.properties) {
      emitRemovals(prop, `${access}[${JSON.stringify(key)}]`, body, depth + 1, seen);
    }
  }
  seen.delete(node);
  if (body.length === 0) return;
  if (depth === 0) lines.push(...body);
  else lines.push(`if(${access}!==null&&typeof ${access}==='object'&&!Array.isArray(${access})){${body.join('\n')}}`);
}

// Generate a fast preprocess function via codegen instead of closure arrays
function buildPreprocessCodegen(schema, options) {
  if (typeof schema !== 'object' || schema === null || !schema.properties) return null;
  const lines = [];
  const props = schema.properties;

  // removeAdditional: strip unknown keys at every level the schema describes,
  // not just the top one. The closure path below (collectRemovals) always
  // recursed; this one did not, so the same schema and the same document got
  // opposite verdicts depending on whether the runtime allowed code
  // generation, and the codegen answer was the one that disagreed with both
  // the interpreter and the default validator this aims to match.
  if (options.removeAdditional) {
    emitRemovals(schema, 'd', lines, 0, new Set());
  }

  // coerceTypes: inline per property
  if (options.coerceTypes) {
    for (const [key, prop] of Object.entries(props)) {
      if (!prop || typeof prop !== 'object' || !prop.type) continue;
      // Coercion writes with plain assignment, which for a key named
      // __proto__ rewrites the prototype instead. The raw value still goes
      // through validation, so skipping is a refusal to coerce, not a hole.
      if (key === '__proto__') continue;
      const t = Array.isArray(prop.type) ? null : prop.type;
      if (!t) continue;
      const k = JSON.stringify(key);
      if (t === 'integer') {
        lines.push(`if(typeof d[${k}]==='string'){var _n=Number(d[${k}]);if(d[${k}]!==''&&Number.isInteger(_n))d[${k}]=_n}`);
        lines.push(`if(typeof d[${k}]==='boolean')d[${k}]=d[${k}]?1:0`);
      } else if (t === 'number') {
        lines.push(`if(typeof d[${k}]==='string'){var _n=Number(d[${k}]);if(d[${k}]!==''&&!isNaN(_n))d[${k}]=_n}`);
        lines.push(`if(typeof d[${k}]==='boolean')d[${k}]=d[${k}]?1:0`);
      } else if (t === 'string') {
        lines.push(`if(typeof d[${k}]==='number'||typeof d[${k}]==='boolean')d[${k}]=String(d[${k}])`);
      } else if (t === 'boolean') {
        lines.push(`if(d[${k}]==='true'||d[${k}]==='1')d[${k}]=true`);
        lines.push(`if(d[${k}]==='false'||d[${k}]==='0')d[${k}]=false`);
      } else if (t === 'array' && options.coerceTypes === 'array') {
        lines.push(`if(${k} in d&&d[${k}]!==undefined&&!Array.isArray(d[${k}]))d[${k}]=[d[${k}]]`);
      }
    }
  }

  // defaults: inline per property
  if (options.useDefaults !== false) {
    for (const [key, prop] of Object.entries(props)) {
      if (prop && typeof prop === 'object' && prop.default !== undefined) {
        const k = JSON.stringify(key);
        const def = JSON.stringify(prop.default);
        // Assignment to a key named __proto__ hits the prototype setter
        // instead of creating a property; defineProperty writes an own key.
        lines.push(key === '__proto__'
          ? `if(!Object.hasOwn(d,${k}))Object.defineProperty(d,${k},{value:${def},writable:true,enumerable:true,configurable:true})`
          : `if(!Object.hasOwn(d,${k}))d[${k}]=${def}`);
      }
    }
  }

  if (lines.length === 0) return null;
  // Data may legitimately be null or a non-object (e.g. a `['object','null']`
  // schema), so the per-property mutations must not run on it.
  lines.unshift(`if(d===null||typeof d!=='object')return`);
  try {
    return new Function('d', lines.join('\n'));
  } catch {
    return null;
  }
}

module.exports = buildPreprocessCodegen;
