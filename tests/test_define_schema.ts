// Type-level tests for defineSchema() and the JSONSchema authoring type.
// Compiled (no emit) by tests/test_typed_validator_runner.js. Any unexpected
// type error, or an unsatisfied @ts-expect-error directive, fails the run.
// Runtime behavior of defineSchema is covered by tests/test_define_schema.js.

import { defineSchema, type JSONSchema } from '../index.js';

// --- Valid authoring: compiles clean, literal types preserved ---

const user = defineSchema({
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1 },
    role: { type: 'string', enum: ['admin', 'user'] },
  },
  required: ['id', 'name'],
});

// The `const` type parameter keeps `type` as the literal 'object', not string.
const _typeLiteral: 'object' = user.type;
void _typeLiteral;

// A schema can be annotated explicitly with the public type.
const explicit: JSONSchema = {
  type: 'array',
  items: { type: 'string' },
};
void explicit;

// Custom / vendor keywords are permitted (must not error).
const withVendor: JSONSchema = {
  type: 'object',
  'x-internal': true,
};
void withVendor;

// --- Invalid authoring: each must error on the offending keyword ---

const _badType: JSONSchema = {
  // @ts-expect-error -- `type` must be a JSON Schema type name, not a number
  type: 123,
};
void _badType;

const _badRequired: JSONSchema = {
  type: 'object',
  // @ts-expect-error -- `required` must be an array of strings
  required: 'id',
};
void _badRequired;

const _badNested: JSONSchema = {
  type: 'object',
  properties: {
    // @ts-expect-error -- nested schema `type` value is invalid
    id: { type: 42 },
  },
};
void _badNested;
