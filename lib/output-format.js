'use strict';

// The standardised output format from draft 2019-09 and 2020-12.
//
// ata reports errors in its own shape, the one consumers and the compat entry
// expect. The specification also defines an output format of its own, with
// `keywordLocation`, `absoluteKeywordLocation` and `instanceLocation`, and the
// official test suite has a small set of tests for it under `output-tests/`.
// This produces that shape from a validation, so those tests can be run and so
// a caller that wants spec output can have it.
//
// `flag` and `basic` are implemented. `detailed` and `verbose` are not: they
// need the full applicator tree, including the subschemas that passed, which
// the engines do not keep. The v1 `list` format is not implemented either; it
// is still moving, and the suite's own v1 output schema does not yet define it.
//
// Annotations are collected only when validation succeeded. That is not a
// shortcut: a subschema that fails contributes no annotations, and the output
// is rooted at the root schema, so a failing root drops all of them.

// Keywords whose value is the annotation they produce.
const METADATA_KEYWORDS = [
  'title', 'description', 'default', 'deprecated', 'readOnly', 'writeOnly',
  'examples', 'format', 'contentEncoding', 'contentMediaType', 'contentSchema',
];

function pointerSegment (s) {
  return String(s).replace(/~/g, '~0').replace(/\//g, '~1');
}

// The root $id, which absoluteKeywordLocation is resolved against.
function baseUri (schema) {
  if (schema && typeof schema === 'object' && typeof schema.$id === 'string') {
    return schema.$id.split('#')[0];
  }
  return null;
}

function unitFor (error, base) {
  const keywordLocation = typeof error.schemaPath === 'string' && error.schemaPath.charAt(0) === '#'
    ? error.schemaPath.slice(1)
    : (error.schemaPath || '');
  const unit = {
    valid: false,
    keywordLocation,
    instanceLocation: error.instancePath || '',
  };
  if (base) unit.absoluteKeywordLocation = base + '#' + keywordLocation;
  if (typeof error.message === 'string') unit.error = error.message;
  return unit;
}

// Walk the schema beside the instance, collecting metadata annotations from
// the subschemas that applied. Only reached when the whole validation passed,
// so every applicator followed here is one that succeeded, except the
// alternatives of anyOf/oneOf/if, which are checked before being followed.
function collectAnnotations (schema, data, keywordLocation, instanceLocation, base, out, isValid, depth) {
  if (schema === true || schema === false || schema === null || typeof schema !== 'object' || depth > 64) return;

  for (const kw of METADATA_KEYWORDS) {
    if (Object.prototype.hasOwnProperty.call(schema, kw)) {
      const unit = {
        valid: true,
        keywordLocation: keywordLocation + '/' + kw,
        instanceLocation,
        annotation: schema[kw],
      };
      if (base) unit.absoluteKeywordLocation = base + '#' + keywordLocation + '/' + kw;
      out.push(unit);
    }
  }

  const down = (sub, kwSeg, value, instSeg) => collectAnnotations(
    sub, value, keywordLocation + kwSeg, instanceLocation + (instSeg || ''), base, out, isValid, depth + 1,
  );

  if (schema.properties && data !== null && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of Object.keys(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        down(schema.properties[key], '/properties/' + pointerSegment(key), data[key], '/' + pointerSegment(key));
      }
    }
  }
  if (Array.isArray(schema.prefixItems) && Array.isArray(data)) {
    for (let i = 0; i < schema.prefixItems.length && i < data.length; i++) {
      down(schema.prefixItems[i], '/prefixItems/' + i, data[i], '/' + i);
    }
  }
  if (schema.items && typeof schema.items === 'object' && Array.isArray(data)) {
    const start = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
    for (let i = start; i < data.length; i++) down(schema.items, '/items', data[i], '/' + i);
  }
  if (Array.isArray(schema.allOf)) {
    for (let i = 0; i < schema.allOf.length; i++) down(schema.allOf[i], '/allOf/' + i, data, '');
  }
  for (const kw of ['anyOf', 'oneOf']) {
    if (Array.isArray(schema[kw])) {
      for (let i = 0; i < schema[kw].length; i++) {
        if (isValid(schema[kw][i], data)) down(schema[kw][i], '/' + kw + '/' + i, data, '');
      }
    }
  }
  if (schema.if !== undefined) {
    const taken = isValid(schema.if, data);
    if (taken && schema.then !== undefined) down(schema.then, '/then', data, '');
    if (!taken && schema.else !== undefined) down(schema.else, '/else', data, '');
  }
}

// Produce spec output for `data` under `validator`.
//   format: 'flag' | 'basic' (default 'basic')
function toOutput (validator, data, opts) {
  const format = (opts && opts.format) || 'basic';
  const result = validator.validate(data);
  if (format === 'flag') return { valid: result.valid };
  if (format !== 'basic') {
    throw new Error(`toOutput: unsupported format "${format}". Supported: "flag", "basic".`);
  }

  const schema = validator._schemaObj !== undefined ? validator._schemaObj : validator._rawSchema;
  const base = baseUri(schema);
  const out = { valid: result.valid };

  if (!result.valid) {
    const errors = [];
    for (const e of result.errors) errors.push(unitFor(e, base));
    out.errors = errors;
    return out;
  }

  const annotations = [];
  const isValid = (sub, value) => {
    try { return new validator.constructor(sub).isValidObject(value); } catch { return false; }
  };
  collectAnnotations(schema, data, '', '', base, annotations, isValid, 0);
  if (annotations.length) out.annotations = annotations;
  return out;
}

module.exports = { toOutput, METADATA_KEYWORDS };
