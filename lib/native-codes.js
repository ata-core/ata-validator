'use strict';

// A module of its own so the browser build, which has no native engine
// (lib/native-load.browser.js), maps it to lib/native-codes.browser.js and
// carries no table for ordinals that never reach it.

const { codeFor } = require('./error-codes');

// The native engine reports its own `error_code` enum from include/ata.h as an
// ordinal. Nothing outside the addon should ever see one: an error that came
// from there carries the same public code and keyword as the same failure from
// the JavaScript engines. Ordinals are positional, so this table follows the
// enum's declaration order and `tests/test_native_error_codes.js` fails if the
// two drift apart.
const NATIVE_KEYWORDS = [
  null,                     // 0 ok
  '__parse__',              // 1 invalid_json
  '__compile__',            // 2 invalid_schema
  'type',                   // 3 type_mismatch
  'required',               // 4 required_property_missing
  'additionalProperties',   // 5 additional_property_not_allowed
  'enum',                   // 6 enum_mismatch
  'const',                  // 7 const_mismatch
  'minimum',                // 8 minimum_violation
  'maximum',                // 9 maximum_violation
  'exclusiveMinimum',       // 10 exclusive_minimum_violation
  'exclusiveMaximum',       // 11 exclusive_maximum_violation
  'minLength',              // 12 min_length_violation
  'maxLength',              // 13 max_length_violation
  'pattern',                // 14 pattern_mismatch
  'format',                 // 15 format_mismatch
  'minItems',               // 16 min_items_violation
  'maxItems',               // 17 max_items_violation
  'uniqueItems',            // 18 unique_items_violation
  'minProperties',          // 19 min_properties_violation
  'maxProperties',          // 20 max_properties_violation
  'multipleOf',             // 21 multiple_of_violation
  'allOf',                  // 22 all_of_failed
  'anyOf',                  // 23 any_of_failed
  'oneOf',                  // 24 one_of_failed
  'not',                    // 25 not_failed
  '$ref',                   // 26 ref_not_found
  'if',                     // 27 if_then_else_failed
  '__depth__',              // 28 depth_exceeded
]

// Keyword and public code for a native ordinal, or null when the ordinal is
// outside the enum, which would mean the addon is newer than this table.
function fromNative (ordinal, format) {
  if (typeof ordinal !== 'number' || !Number.isInteger(ordinal)) return null
  const keyword = NATIVE_KEYWORDS[ordinal]
  if (!keyword) return null
  // codeFor('format') answers with the first format code, which names a
  // specific format. Without knowing which format failed, the generic one is
  // the honest answer.
  // The walker stopped at its depth limit and rejected the document. No
  // public code names that: the APIs that ask the walker route schemas deep or
  // recursive enough to reach it to validate() first (lib/buffer-gate.js), so
  // it is the generic failure.
  if (keyword === '__depth__') return { keyword, code: 'ATA9000' }
  const code = keyword === 'format'
    ? (format ? codeFor('format', format) || 'ATA3099' : 'ATA3099')
    : codeFor(keyword) || 'ATA9001'
  return { keyword, code }
}

module.exports = { fromNative, NATIVE_KEYWORDS };
