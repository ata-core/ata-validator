'use strict';

// defineSchema and schemaOf outside the core; lib/schema-helpers.mjs says why.
function defineSchema (schema) {
  return schema;
}

function schemaOf () {
  throw new Error('schemaOf<T>() is replaced at build time by @ata-project/unplugin (with ts-json-schema-generator installed); it has no run-time form. Write the JSON Schema, or build with the plugin.');
}

module.exports = { defineSchema, schemaOf };
