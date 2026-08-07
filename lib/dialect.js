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

module.exports = { isV1Dialect, V1_DIALECTS };
