'use strict';

// A stable content hash for a schema, so a compiled artifact can say which
// schema it came from and a build can detect staleness by comparing hashes
// instead of embedding its own. The hash is over a canonical JSON form
// (object keys sorted at every level), so the same schema hashes the same
// however its keys were ordered, and it is FNV-1a with two independent
// bases, 16 hex characters. This is an integrity aid, not a security
// boundary: it detects drift, it does not authenticate anything.

function canonical (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    if (value[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ':' + canonical(value[k]));
  }
  return '{' + parts.join(',') + '}';
}

function fnv1a (str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function schemaHash (schema) {
  const text = canonical(schema);
  const a = fnv1a(text, 0x811c9dc5);
  const b = fnv1a(text, 0xcbf29ce4);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

module.exports = { schemaHash };
