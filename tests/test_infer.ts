// Type-level tests for Infer<S>. Compiled (no emit) by
// tests/test_typed_validator_runner.js. Any unexpected type error, or an
// unsatisfied @ts-expect-error, fails the run.

import { defineSchema, type Infer } from '../index.js';

// Exact-type equality helper.
type Expect<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// --- primitives ---
const _str: Expect<Infer<{ type: 'string' }>, string> = true;
const _num: Expect<Infer<{ type: 'number' }>, number> = true;
const _int: Expect<Infer<{ type: 'integer' }>, number> = true;
const _bool: Expect<Infer<{ type: 'boolean' }>, boolean> = true;
const _null: Expect<Infer<{ type: 'null' }>, null> = true;
void _str; void _num; void _int; void _bool; void _null;

// --- type array -> union ---
const _typeArr: Expect<Infer<{ type: ['string', 'null'] }>, string | null> = true;
void _typeArr;

// --- const and enum ---
const _const: Expect<Infer<{ const: 'x' }>, 'x'> = true;
const _enum: Expect<Infer<{ enum: ['a', 'b'] }>, 'a' | 'b'> = true;
void _const; void _enum;

// --- object: required vs optional ---
const userSchema = defineSchema({
  type: 'object',
  properties: { id: { type: 'integer' }, name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
  required: ['id', 'name'],
});
type User = Infer<typeof userSchema>;
const _user: Expect<User, { id: number; name: string; tags?: string[] }> = true;
void _user;

// --- array of objects ---
const _arr: Expect<Infer<{ type: 'array'; items: { type: 'number' } }>, number[]> = true;
void _arr;

// --- bare array (no items) ---
const _bareArr: Expect<Infer<{ type: 'array' }>, unknown[]> = true;
void _bareArr;

// --- out of scope falls back to unknown (never an error) ---
const _ref: Expect<Infer<{ $ref: 'other#' }>, unknown> = true;
const _anyOf: Expect<Infer<{ anyOf: [{ type: 'string' }, { type: 'number' }] }>, unknown> = true;
void _ref; void _anyOf;
