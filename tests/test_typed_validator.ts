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
