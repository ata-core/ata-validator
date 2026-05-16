// Type-level tests for the generic Validator<T> public API.
// Run via tests/test_typed_validator_runner.js, which executes tsc --noEmit.
// Runtime behavior of Validator is covered by existing JS tests; this file
// only asserts that the published .d.ts types behave correctly under strict
// TypeScript.
//
// Spec: docs/superpowers/specs/2026-05-16-typed-validator-design.md

import { Type, type Static } from '@sinclair/typebox';
import { Validator } from '../index.js';

// --- Scenario 1: TypeBox-authored schema ---

const UserSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1 }),
  email: Type.String({ format: 'email' }),
});

type User = Static<typeof UserSchema>;

const userValidator = new Validator<User>(UserSchema);

declare const maybeUser: unknown;

// Predicate must narrow `unknown` to `User`
if (userValidator.isValidObject(maybeUser)) {
  const _id: number = maybeUser.id;
  const _name: string = maybeUser.name;
  const _email: string = maybeUser.email;
}

// Outside the narrowing branch, maybeUser remains unknown — member access must error
// @ts-expect-error -- maybeUser is unknown here, no .id access
const _outsideAccess = maybeUser.id;

// validate() must return a discriminated union with typed data on valid branch
const r = userValidator.validate(maybeUser);
if (r.valid) {
  const _idFromResult: number = r.data.id;
  const _nameFromResult: string = r.data.name;
} else {
  // errors always present
  const _errLen: number = r.errors.length;
  // data is `never` (effectively undefined) on invalid branch — cannot assign to User
  // @ts-expect-error
  const _badData: User = r.data;
}

// Without narrowing on r.valid, r.data has type `User | undefined`; .id must error in strict mode
// @ts-expect-error -- r.data may be undefined without checking r.valid
const _directId: number = r.data.id;

// --- Scenario 2: hand-written JSON Schema literal + hand-typed interface ---

interface Order {
  orderId: string;
  total: number;
  paid: boolean;
}

const orderSchema = {
  type: 'object',
  properties: {
    orderId: { type: 'string', minLength: 1 },
    total: { type: 'number', minimum: 0 },
    paid: { type: 'boolean' },
  },
  required: ['orderId', 'total', 'paid'],
} as const;

const orderValidator = new Validator<Order>(orderSchema);

declare const maybeOrder: unknown;

if (orderValidator.isValidObject(maybeOrder)) {
  const _orderId: string = maybeOrder.orderId;
  const _total: number = maybeOrder.total;
  const _paid: boolean = maybeOrder.paid;
}

const orderResult = orderValidator.validate(maybeOrder);
if (orderResult.valid) {
  const _orderFromResult: Order = orderResult.data;
}

// --- Scenario 3: Standard Schema V1 bridge composition ---

interface Profile {
  username: string;
  age: number;
}

const profileSchema = {
  type: 'object',
  properties: {
    username: { type: 'string', minLength: 3 },
    age: { type: 'integer', minimum: 0 },
  },
  required: ['username', 'age'],
} as const;

const profileValidator = new Validator<Profile>(profileSchema);

// The ~standard interface should be present and typed
const std = profileValidator['~standard'];

const _version: 1 = std.version;
const _vendor: 'ata-validator' = std.vendor;

declare const profileInput: unknown;
const stdResult = std.validate(profileInput);

// Standard Schema V1 result shape: { value: unknown } | { issues: [...] }
if ('issues' in stdResult) {
  const _issuesLen: number = stdResult.issues.length;
} else {
  // .value is unknown per the spec; consumers narrow at their level
  const _stdValue: unknown = stdResult.value;
}
