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

// --- anyOf / oneOf -> union ---
const _anyOf: Expect<Infer<{ anyOf: [{ type: 'string' }, { type: 'number' }] }>, string | number> = true;
const _oneOf: Expect<Infer<{ oneOf: [{ type: 'boolean' }, { type: 'null' }] }>, boolean | null> = true;
void _anyOf; void _oneOf;

// --- allOf -> intersection ---
const _allOf: Expect<
  Infer<{ allOf: [
    { type: 'object'; properties: { a: { type: 'number' } }; required: ['a'] },
    { type: 'object'; properties: { b: { type: 'string' } }; required: ['b'] },
  ] }>,
  { a: number; b: string }
> = true;
void _allOf;

// --- prefixItems -> tuple ---
const _tuple: Expect<
  Infer<{ type: 'array'; prefixItems: [{ type: 'string' }, { type: 'number' }] }>,
  [string, number]
> = true;
void _tuple;

// --- $ref to local $defs / definitions resolves by name ---
const refSchema = defineSchema({
  $defs: {
    Point: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    },
  },
  type: 'object',
  properties: { start: { $ref: '#/$defs/Point' } },
  required: ['start'],
});
const _ref: Expect<Infer<typeof refSchema>, { start: { x: number; y: number } }> = true;
void _ref;

const defsSchema = defineSchema({
  definitions: { Id: { type: 'integer' } },
  type: 'object',
  properties: { id: { $ref: '#/definitions/Id' } },
  required: ['id'],
});
const _defs: Expect<Infer<typeof defsSchema>, { id: number }> = true;
void _defs;

// --- $ref nested inside array items ---
const listSchema = defineSchema({
  $defs: { Item: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  type: 'array',
  items: { $ref: '#/$defs/Item' },
});
const _list: Expect<Infer<typeof listSchema>, { id: number }[]> = true;
void _list;

// --- recursive $ref resolves to a real (non-any) recursive type ---
const treeSchema = defineSchema({
  $defs: {
    Node: {
      type: 'object',
      properties: { value: { type: 'number' }, children: { type: 'array', items: { $ref: '#/$defs/Node' } } },
      required: ['value'],
    },
  },
  $ref: '#/$defs/Node',
});
type Tree = Infer<typeof treeSchema>;
const _treeOk: Tree = { value: 1, children: [{ value: 2, children: [{ value: 3 }] }] };
void _treeOk;
// @ts-expect-error value must be number (proves the type is real, not `any`)
const _treeBad: Tree = { value: 'nope' };
void _treeBad;

// --- external / unresolvable $ref still falls back to unknown (never an error) ---
const _extRef: Expect<Infer<{ $ref: 'other#' }>, unknown> = true;
void _extRef;

import { Validator } from '../index.js';

const v = new Validator(defineSchema({
  type: 'object',
  properties: { id: { type: 'integer' }, name: { type: 'string' } },
  required: ['id', 'name'],
}));

const r = v.validate({});
if (r.valid) {
  const _idNarrow: number = r.data.id;
  const _nameNarrow: string = r.data.name;
  void _idNarrow; void _nameNarrow;
}

// Explicit type parameter still works (fallback overload).
const vExplicit = new Validator<{ a: boolean }>({ type: 'object' });
const rx = vExplicit.validate({});
if (rx.valid) { const _a: boolean = rx.data.a; void _a; }

// String schema falls back to unknown data.
const vStr = new Validator('{"type":"object"}');
const rs = vStr.validate({});
if (rs.valid) { const _u: unknown = rs.data; void _u; }
