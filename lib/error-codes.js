'use strict';

// Single source of truth for ATA error codes.
// STABILITY: once a code is published, its keyword and category never change.
// Removal is forbidden; mark deprecated instead. Adding requires updating
// tests/error-codes.lock.json in the same PR.

const CODES = Object.freeze({
  // ATA1xxx — type / shape
  ATA1001: { keyword: 'type', category: 'type', headline: 'value has wrong type' },
  ATA1002: { keyword: 'type', category: 'type', headline: 'value is not an object' },

  // ATA2xxx — constraint
  ATA2001: { keyword: 'minLength', category: 'constraint', headline: 'string shorter than minLength' },
  ATA2002: { keyword: 'maxLength', category: 'constraint', headline: 'string longer than maxLength' },
  ATA2003: { keyword: 'minimum', category: 'constraint', headline: 'number below minimum' },
  ATA2004: { keyword: 'maximum', category: 'constraint', headline: 'number above maximum' },
  ATA2005: { keyword: 'exclusiveMinimum', category: 'constraint', headline: 'number not above exclusiveMinimum' },
  ATA2006: { keyword: 'exclusiveMaximum', category: 'constraint', headline: 'number not below exclusiveMaximum' },
  ATA2007: { keyword: 'multipleOf', category: 'constraint', headline: 'number not a multiple of expected divisor' },
  ATA2008: { keyword: 'minItems', category: 'constraint', headline: 'array shorter than minItems' },
  ATA2009: { keyword: 'maxItems', category: 'constraint', headline: 'array longer than maxItems' },
  ATA2010: { keyword: 'minProperties', category: 'constraint', headline: 'object has fewer than minProperties' },
  ATA2011: { keyword: 'maxProperties', category: 'constraint', headline: 'object has more than maxProperties' },
  ATA2012: { keyword: 'uniqueItems', category: 'constraint', headline: 'array has duplicate items' },
  ATA2013: { keyword: 'pattern', category: 'constraint', headline: 'string does not match pattern' },

  // ATA3xxx — format
  ATA3001: { keyword: 'format', format: 'email', category: 'format', headline: 'value does not match format "email"' },
  ATA3002: { keyword: 'format', format: 'date', category: 'format', headline: 'value does not match format "date"' },
  ATA3003: { keyword: 'format', format: 'date-time', category: 'format', headline: 'value does not match format "date-time"' },
  ATA3004: { keyword: 'format', format: 'time', category: 'format', headline: 'value does not match format "time"' },
  ATA3005: { keyword: 'format', format: 'uri', category: 'format', headline: 'value does not match format "uri"' },
  ATA3006: { keyword: 'format', format: 'uri-reference', category: 'format', headline: 'value does not match format "uri-reference"' },
  ATA3007: { keyword: 'format', format: 'ipv4', category: 'format', headline: 'value does not match format "ipv4"' },
  ATA3008: { keyword: 'format', format: 'ipv6', category: 'format', headline: 'value does not match format "ipv6"' },
  ATA3009: { keyword: 'format', format: 'uuid', category: 'format', headline: 'value does not match format "uuid"' },
  ATA3010: { keyword: 'format', format: 'hostname', category: 'format', headline: 'value does not match format "hostname"' },
  ATA3099: { keyword: 'format', category: 'format', headline: 'value does not match user-defined format' },

  // ATA4xxx — composition
  ATA4001: { keyword: 'oneOf', category: 'composition', headline: 'value matched 0 of N oneOf variants' },
  ATA4002: { keyword: 'oneOf', category: 'composition', headline: 'value matched more than one oneOf variant' },
  ATA4003: { keyword: 'anyOf', category: 'composition', headline: 'value matched none of the anyOf variants' },
  ATA4004: { keyword: 'allOf', category: 'composition', headline: 'value failed one or more allOf branches' },
  ATA4005: { keyword: 'not', category: 'composition', headline: 'value matched a forbidden schema' },
  ATA4006: { keyword: 'if', category: 'composition', headline: 'value violated then/else branch' },

  // ATA5xxx — refs
  ATA5001: { keyword: '$ref', category: 'ref', headline: '$ref could not be resolved' },
  ATA5002: { keyword: '$ref', category: 'ref', headline: 'recursive $ref cycle detected at validate time' },

  // ATA6xxx — enum/const
  ATA6001: { keyword: 'enum', category: 'enum', headline: 'value is not one of the allowed enum values' },
  ATA6002: { keyword: 'const', category: 'enum', headline: 'value does not equal const' },

  // ATA7xxx — required / additional / unevaluated
  ATA7001: { keyword: 'required', category: 'shape', headline: 'object missing required property' },
  ATA7002: { keyword: 'additionalProperties', category: 'shape', headline: 'object has property not allowed by schema' },
  ATA7003: { keyword: 'unevaluatedProperties', category: 'shape', headline: 'object has unevaluated property' },
  ATA7004: { keyword: 'unevaluatedItems', category: 'shape', headline: 'array has unevaluated items' },
  ATA7005: { keyword: 'dependentRequired', category: 'shape', headline: 'dependentRequired property missing' },
  ATA7006: { keyword: 'propertyNames', category: 'shape', headline: 'property name violates schema' },
  ATA7007: { keyword: 'contains', category: 'shape', headline: 'array does not contain a matching item' },

  // ATA9xxx — system
  ATA9000: { keyword: '__abort_early__', category: 'system', headline: 'validation failed (abortEarly)' },
  ATA9001: { keyword: '__parse__', category: 'system', headline: 'input is not valid JSON' },
  ATA9002: { keyword: '__compile__', category: 'system', headline: 'schema failed to compile' },
});

function get (code) {
  return CODES[code];
}

function all () {
  return Object.keys(CODES).sort();
}

// Reverse lookups, built once. codeFor runs per error on every failing
// validation, so walking the table there showed up as most of the cost of
// enriching a rejected payload. Insertion follows sorted code order, so the
// first writer wins and each keyword keeps the lowest code that carries it.
const BY_KEYWORD = new Map();
const BY_FORMAT = new Map();
for (const c of Object.keys(CODES).sort()) {
  const meta = CODES[c];
  if (!BY_KEYWORD.has(meta.keyword)) BY_KEYWORD.set(meta.keyword, c);
  if (meta.keyword === 'format' && meta.format && !BY_FORMAT.has(meta.format)) BY_FORMAT.set(meta.format, c);
}

// Map a (keyword, optional format) tuple back to a code. Used by the codegen
// integration to attach codes to existing error sites without rewriting them all.
function codeFor (keyword, format) {
  if (keyword === 'format' && format) {
    const hit = BY_FORMAT.get(format);
    return hit === undefined ? 'ATA3099' : hit;
  }
  const hit = BY_KEYWORD.get(keyword);
  return hit === undefined ? null : hit;
}

module.exports = { CODES, get, all, codeFor };
