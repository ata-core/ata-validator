'use strict';

// Schema -> the description to put in a model's prompt.
//
// Everyone hand-writes a prose description of the shape they want and keeps it
// next to a schema that enforces something slightly different. The two drift,
// quietly, because nothing checks one against the other. This derives the
// first from the second.
//
// It is not a style preference. Measured on one model, first attempt only, 30
// documents, no retry:
//
//   nothing but the task                    0 of 30 valid
//   a field list written by hand            0 of 30
//   a careful description written by hand   0 of 30
//   this                                   23 of 30
//
// The careful hand-written one failed on exactly two fields, in all 30 cases:
// the two whose values are an internal vocabulary. A person writes "the
// settlement status, uppercase with underscores" because a person describes
// fields. Those values cannot be described, only listed, and a generator lists
// them.
//
// Scope follows lib/ts-gen.js, which walks the same shapes: properties and
// required, arrays, enum and const, oneOf/anyOf/allOf, and $ref into local
// $defs. Anything else is described as `any` rather than guessed at.

const MAX_DEPTH = 12;

function lit (v) {
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

function resolveRef (schema, defs) {
  const m = typeof schema.$ref === 'string' && schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
  if (m && defs && defs[m[1]]) return defs[m[1]];
  return null;
}

// The constraints worth stating to a model, in the order a reader wants them:
// what it is, then which values, then how big.
function constraintsOf (s) {
  const out = [];
  if (Array.isArray(s.enum)) out.push('one of ' + s.enum.map(lit).join(', '));
  else if (s.const !== undefined) out.push('exactly ' + lit(s.const));
  else if (s.type) out.push(Array.isArray(s.type) ? s.type.join(' or ') : s.type);

  if (typeof s.format === 'string') out.push(s.format + ' format');
  if (typeof s.pattern === 'string') out.push('matching ' + s.pattern);

  const range = (min, max, unit) => {
    if (min !== undefined && max !== undefined) out.push(`${min} to ${max}${unit}`);
    else if (min !== undefined) out.push(`at least ${min}${unit}`);
    else if (max !== undefined) out.push(`at most ${max}${unit}`);
  };
  range(s.minLength, s.maxLength, ' characters');
  range(s.minimum, s.maximum, '');
  range(s.minItems, s.maxItems, ' items');
  if (s.exclusiveMinimum !== undefined) out.push('greater than ' + s.exclusiveMinimum);
  if (s.exclusiveMaximum !== undefined) out.push('less than ' + s.exclusiveMaximum);
  if (typeof s.multipleOf === 'number') out.push(multipleOfPhrase(s.multipleOf));
  if (s.uniqueItems === true) out.push('all items different');
  if (typeof s.description === 'string' && s.description) out.push(s.description);
  return out;
}

// `multipleOf: 0.01` is how a schema says "money". A model acts on "rounded to
// 2 decimal places" and does not reliably act on "a multiple of 0.01": in the
// measurement behind this file, that one phrase was most of the gap between
// this output and a careful description written by a person.
function multipleOfPhrase (m) {
  if (m > 0 && m < 1) {
    const places = Math.round(Math.log10(1 / m));
    if (Math.abs(Math.pow(10, -places) - m) < Number.EPSILON * 8) {
      return `rounded to ${places} decimal place${places === 1 ? '' : 's'}`;
    }
  }
  return 'a multiple of ' + m;
}

function isObjectSchema (s) {
  return s && typeof s === 'object' && s.properties && typeof s.properties === 'object';
}

function describeObjectBody (schema, depth, defs, lines) {
  const pad = '  '.repeat(depth);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const [key, sub] of Object.entries(schema.properties)) {
    describeNode(sub, key + (required.has(key) ? '' : ' (optional)'), depth, defs, lines);
  }
  for (const key of required) {
    if (!(key in schema.properties)) lines.push(`${pad}${key}: required, any`);
  }
  if (schema.additionalProperties === false) lines.push(`${pad}no other fields`);
}

function describeNode (schema, label, depth, defs, lines) {
  const pad = '  '.repeat(depth);
  if (schema === true || schema === undefined) { lines.push(`${pad}${label}: any`); return; }
  if (schema === false) { lines.push(`${pad}${label}: nothing is allowed here`); return; }
  if (typeof schema !== 'object' || schema === null || depth > MAX_DEPTH) {
    lines.push(`${pad}${label}: any`);
    return;
  }

  const target = schema.$ref ? resolveRef(schema, defs) : null;
  if (target) { describeNode(target, label, depth, defs, lines); return; }

  // allOf is the intersection, so its parts describe the same value.
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    const merged = Object.assign({}, schema);
    delete merged.allOf;
    for (const part of schema.allOf) {
      const resolved = part && part.$ref ? resolveRef(part, defs) || part : part;
      if (resolved && typeof resolved === 'object') Object.assign(merged, resolved, {
        properties: Object.assign({}, merged.properties, resolved.properties),
        required: [].concat(merged.required || [], resolved.required || []),
      });
    }
    if (!merged.properties) delete merged.properties;
    if (!merged.required || !merged.required.length) delete merged.required;
    describeNode(merged, label, depth, defs, lines);
    return;
  }

  const alternatives = schema.oneOf || schema.anyOf;
  if (Array.isArray(alternatives) && alternatives.length) {
    lines.push(`${pad}${label}: one of the following shapes`);
    alternatives.forEach((alt, i) => describeNode(alt, `option ${i + 1}`, depth + 1, defs, lines));
    return;
  }

  if (isObjectSchema(schema)) {
    const own = constraintsOf(schema).filter((c) => c !== 'object');
    lines.push(`${pad}${label}: object${own.length ? ` (${own.join(', ')})` : ''}`);
    describeObjectBody(schema, depth + 1, defs, lines);
    return;
  }

  const rawItems = schema.items;
  if (schema.type === 'array' && rawItems && typeof rawItems === 'object') {
    const items = rawItems.$ref ? resolveRef(rawItems, defs) || rawItems : rawItems;
    const own = constraintsOf(schema).filter((c) => c !== 'array');
    const bounds = own.length ? ` (${own.join(', ')})` : '';
    // An item that is itself an object gets its fields listed underneath. One
    // that is a scalar reads better on the same line than as a nested entry
    // called "item".
    if (isObjectSchema(items)) {
      lines.push(`${pad}${label}: array${bounds}, each item is an object:`);
      describeObjectBody(items, depth + 1, defs, lines);
      return;
    }
    if (items.oneOf || items.anyOf || items.allOf) {
      lines.push(`${pad}${label}: array${bounds}, each item is:`);
      describeNode(items, 'item', depth + 1, defs, lines);
      return;
    }
    const inner = constraintsOf(items).join(', ') || 'any';
    lines.push(`${pad}${label}: array${bounds} of ${inner}`);
    return;
  }

  lines.push(`${pad}${label}: ${constraintsOf(schema).join(', ') || 'any'}`);
}

// describeSchema(schema, opts) -> string
//   opts.name  what to call the top level (default 'output')
function describeSchema (schema, opts) {
  const name = (opts && opts.name) || 'output';
  const defs = (schema && (schema.$defs || schema.definitions)) || null;
  const lines = [];
  describeNode(schema, name, 0, defs, lines);
  return lines.join('\n');
}

module.exports = { describeSchema };
