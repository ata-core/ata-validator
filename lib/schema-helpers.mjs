// The ES form of lib/schema-helpers.js, for the ES entries. Those entries read
// each core name through a call marked pure, so a module that imports only
// `defineSchema` leaves the validator core out of its bundle; a destructuring
// `export const { ... } = core` was kept whole, and a form whose validator the
// build plugin had compiled away still shipped the runtime through it. The core
// holds no copy, so a bundle carries the helpers once.
// tests/test_define_schema_bundle.js covers both forms.

// Identity at run time: it gives an inline schema its JSONSchema type
// (index.d.ts) for autocomplete and value checks while authoring.
export function defineSchema (schema) {
  return schema;
}

// Written in by @ata-project/unplugin from a TypeScript type at build time. A
// call that reaches run time was not replaced, and a loud error beats an
// empty schema that accepts everything.
export function schemaOf () {
  throw new Error('schemaOf<T>() is replaced at build time by @ata-project/unplugin (with ts-json-schema-generator installed); it has no run-time form. Write the JSON Schema, or build with the plugin.');
}
