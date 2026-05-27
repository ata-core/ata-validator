// Chainable builder for ata. Each function returns a plain JSON Schema
// literal, so `Infer<typeof X>` from the main entry resolves the inferred
// TypeScript type with no additional plumbing.
//
//   import { t } from 'ata-validator/t'
//   import { Validator, Infer } from 'ata-validator'
//
//   const User = t.object({
//     name: t.string({ minLength: 1 }),
//     age: t.integer({ minimum: 0 }),
//     email: t.optional(t.string({ format: 'email' })),
//   })
//   type User = Infer<typeof User>
//   // { name: string; age: number; email?: string }
//
//   const v = new Validator(User)  // schema is plain JSON Schema

import type { JSONSchema } from './index.js';

export declare const OPTIONAL: unique symbol;

export type TOptional<S> = S & { readonly [OPTIONAL]: true };

export type TSchema = JSONSchema;

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  description?: string;
  title?: string;
  default?: string;
  examples?: readonly string[];
}

export interface NumericOptions {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  description?: string;
  title?: string;
  default?: number;
  examples?: readonly number[];
}

export interface ArrayOptions {
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  description?: string;
  title?: string;
}

export interface ObjectOptions {
  additionalProperties?: boolean | JSONSchema;
  description?: string;
  title?: string;
}

export interface RecordOptions {
  minProperties?: number;
  maxProperties?: number;
  description?: string;
  title?: string;
}

// `Omit` against an `OPTIONAL`-branded schema collapses literal property types
// through the JSONSchema index signature, which breaks downstream `Infer`. The
// branded property is a Symbol key, so it doesn't intersect with any string
// index lookup; we leave it in place and just compute `RequiredKeys` from it.
// Infer reads `type`, `properties`, etc. and ignores extra phantom keys.

type RequiredKeysOf<T> = {
  [K in keyof T]: T[K] extends { readonly [OPTIONAL]: true } ? never : K;
}[keyof T];

type StrippedProperties<T> = { [K in keyof T]: T[K] };

export interface TString extends JSONSchema {
  type: 'string';
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  description?: string;
  title?: string;
  default?: string;
}

export interface TNumber extends JSONSchema {
  type: 'number';
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  description?: string;
  title?: string;
  default?: number;
}

export interface TInteger extends JSONSchema {
  type: 'integer';
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  description?: string;
  title?: string;
  default?: number;
}

export interface TBoolean extends JSONSchema { type: 'boolean' }
export interface TNull extends JSONSchema { type: 'null' }

export interface TLiteral<V extends string | number | boolean | null> extends JSONSchema { const: V }
export interface TEnum<V extends readonly (string | number | boolean | null)[]> extends JSONSchema { enum: V }

export interface TArray<S extends JSONSchema> extends JSONSchema {
  type: 'array';
  items: S;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface TTuple<S extends ReadonlyArray<JSONSchema>> extends JSONSchema {
  type: 'array';
  prefixItems: S;
  items: false;
  minItems?: number;
  maxItems?: number;
}

export interface TRecord<S extends JSONSchema> extends JSONSchema {
  type: 'object';
  additionalProperties: S;
  minProperties?: number;
  maxProperties?: number;
}

export interface TObject<T extends Record<string, JSONSchema>> extends JSONSchema {
  type: 'object';
  properties: StrippedProperties<T>;
  required: ReadonlyArray<Extract<RequiredKeysOf<T>, string>>;
  additionalProperties?: boolean | JSONSchema;
}

export interface TUnion<S extends ReadonlyArray<JSONSchema>> extends JSONSchema { anyOf: S }
export interface TIntersect<S extends ReadonlyArray<JSONSchema>> extends JSONSchema { allOf: S }
export interface TRef extends JSONSchema { $ref: string }
export interface TAny extends JSONSchema {}
export interface TNever extends JSONSchema { not: {} }

export interface TBuilder {
  string(opts?: StringOptions): TString;
  number(opts?: NumericOptions): TNumber;
  integer(opts?: NumericOptions): TInteger;
  boolean(): TBoolean;
  null(): TNull;

  literal<const V extends string | number | boolean | null>(value: V): TLiteral<V>;
  const<const V extends string | number | boolean | null>(value: V): TLiteral<V>;
  enum<const V extends readonly (string | number | boolean | null)[]>(values: V): TEnum<V>;

  array<S extends JSONSchema>(items: S, opts?: ArrayOptions): TArray<S>;
  tuple<const S extends ReadonlyArray<JSONSchema>>(items: S, opts?: ArrayOptions): TTuple<S>;
  record<S extends JSONSchema>(values: S, opts?: RecordOptions): TRecord<S>;

  object<const T extends Record<string, JSONSchema>>(properties: T, opts?: ObjectOptions): TObject<T>;
  optional<S extends JSONSchema>(schema: S): TOptional<S>;

  union<const S extends ReadonlyArray<JSONSchema>>(schemas: S): TUnion<S>;
  intersect<const S extends ReadonlyArray<JSONSchema>>(schemas: S): TIntersect<S>;
  ref(pointer: string): TRef;

  any(): TAny;
  unknown(): TAny;
  never(): TNever;
}

export declare const t: TBuilder;
