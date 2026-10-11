'use strict';

// Dialect detection.
//
// Only the v1 dialect is distinguished here, and only because v1 changes
// behavior that is otherwise identical to 2020-12: the bookending requirement
// for `$dynamicRef` is removed. Everything else ata does under 2020-12 is
// unchanged under v1, so a schema that declares no `$schema` keeps the
// existing default rather than being guessed at.
//
// The official test suite states the dialect as `https://json-schema.org/v1`.
// The meta-schema in the specification repository carries the dated
// `https://json-schema.org/v1/2026`. Both name the same dialect, and
// `draft/next` is the name the same work carried before the stable release was
// numbered, so all three are accepted.
const V1_DIALECTS = new Set([
  'https://json-schema.org/v1',
  'https://json-schema.org/v1/schema',
  'https://json-schema.org/v1/2026',
  'https://json-schema.org/draft/next/schema',
]);

function isV1Dialect(schema) {
  if (typeof schema !== 'object' || schema === null) return false;
  if (typeof schema.$schema !== 'string') return false;
  // A trailing '#' is an empty fragment naming the same document.
  const uri = schema.$schema.endsWith('#') ? schema.$schema.slice(0, -1) : schema.$schema;
  return V1_DIALECTS.has(uri);
}

// The earlier dialects by their meta-schema URIs. draftCode is asked of every
// schema, so it lives here, in a file every validator loads, and the
// normalizers in draft7.js load only for a schema that declares one of these.
// draft-06 is read through the draft-07 rules (see draft7.js).
const DRAFT7_SCHEMAS = new Set([
  'http://json-schema.org/draft-07/schema#',
  'http://json-schema.org/draft-07/schema',
  'http://json-schema.org/draft-06/schema#',
  'http://json-schema.org/draft-06/schema',
]);
const DRAFT6_SCHEMAS = new Set([
  'http://json-schema.org/draft-06/schema#',
  'http://json-schema.org/draft-06/schema',
]);
const DRAFT2019_SCHEMAS = new Set([
  'https://json-schema.org/draft/2019-09/schema',
  'https://json-schema.org/draft/2019-09/schema#',
]);

// 0 for 2020-12 and later, 1 draft-07, 2 draft-06, 3 2019-09.
function draftCode(uri) {
  if (typeof uri !== 'string') return 0;
  if (DRAFT6_SCHEMAS.has(uri)) return 2;
  if (DRAFT7_SCHEMAS.has(uri)) return 1;
  if (DRAFT2019_SCHEMAS.has(uri)) return 3;
  return 0;
}

module.exports = { isV1Dialect, V1_DIALECTS, DRAFT7_SCHEMAS, DRAFT6_SCHEMAS, DRAFT2019_SCHEMAS, draftCode };
