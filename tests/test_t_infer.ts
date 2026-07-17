// Type-level tests for the `ata-validator/t` builder. Compiled (no emit)
// by tests/test_typed_validator_runner.js. The contract: builder output is
// plain JSON Schema, so `Infer<typeof X>` from the main entry produces the
// expected TS type without any builder-specific inference plumbing.

import { Validator, type Infer } from '../index.js';
import { t } from '../t.js';

type Expect<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// --- primitives ---
const _str: Expect<Infer<ReturnType<typeof t.string>>, string> = true;
const _num: Expect<Infer<ReturnType<typeof t.number>>, number> = true;
const _int: Expect<Infer<ReturnType<typeof t.integer>>, number> = true;
const _bool: Expect<Infer<ReturnType<typeof t.boolean>>, boolean> = true;
const _null: Expect<Infer<ReturnType<typeof t.null>>, null> = true;
void _str; void _num; void _int; void _bool; void _null;

// --- literal / enum ---
const lit = t.literal('admin');
type Lit = Infer<typeof lit>;
const _lit: Expect<Lit, 'admin'> = true;
void _lit;

const en = t.enum(['a', 'b'] as const);
type En = Infer<typeof en>;
const _en: Expect<En, 'a' | 'b'> = true;
void _en;

// --- object: required + optional ---
const user = t.object({
  id: t.integer(),
  name: t.string(),
  email: t.optional(t.string({ format: 'email' })),
  age: t.optional(t.integer({ minimum: 0 })),
});
type User = Infer<typeof user>;
const _user: Expect<User, { id: number; name: string; email?: string; age?: number }> = true;
void _user;

// --- nested objects and arrays ---
const post = t.object({
  id: t.integer(),
  author: t.object({
    name: t.string(),
    handle: t.optional(t.string()),
  }),
  tags: t.array(t.string()),
});
type Post = Infer<typeof post>;
const _post: Expect<
  Post,
  { id: number; author: { name: string; handle?: string }; tags: string[] }
> = true;
void _post;

// --- union (anyOf) ---
const status = t.union([t.literal('draft'), t.literal('published')]);
type Status = Infer<typeof status>;
const _status: Expect<Status, 'draft' | 'published'> = true;
void _status;

// --- tuple ---
const pair = t.tuple([t.string(), t.number()]);
type Pair = Infer<typeof pair>;
const _pair: Expect<Pair, [string, number]> = true;
void _pair;

// --- record ---
const headers = t.record(t.string());
type Headers = Infer<typeof headers>;
const _headers: Expect<Headers, Record<string, string>> = true;
void _headers;

// --- pick / omit ---
{
  const User = t.object({
    id: t.integer(),
    name: t.string(),
    email: t.optional(t.string()),
  });

  const IdName = t.pick(User, ['id', 'name']);
  type IdName = Infer<typeof IdName>;
  const _pick: Expect<IdName, { id: number; name: string }> = true;
  void _pick;

  const NoId = t.omit(User, ['id']);
  type NoId = Infer<typeof NoId>;
  const _omit: Expect<NoId, { name: string; email?: string }> = true;
  void _omit;

  // @ts-expect-error unknown key rejected at the type level
  t.pick(User, ['nope']);
}

// --- partial / required ---
const user2 = t.object({ id: t.integer(), email: t.optional(t.string()) });

const draft = t.partial(user2);
type Draft = Infer<typeof draft>;
const _partial: Expect<Draft, { id?: number; email?: string }> = true;
void _partial;

const strict = t.required(user2);
type Strict = Infer<typeof strict>;
const _required: Expect<Strict, { id: number; email: string }> = true;
void _required;

// --- composite ---
{
  const A = t.object({ id: t.integer(), tag: t.string() });
  const B = t.object({ tag: t.integer(), name: t.optional(t.string()) });
  const AB = t.composite([A, B]);
  type AB = Infer<typeof AB>;
  const _composite: Expect<AB, { id: number; tag: number; name?: string }> = true;
  void _composite;
}

// --- recursive ---
{
  const Node = t.recursive((self) => t.object({ value: t.integer(), next: t.optional(self) }));
  type Node = Infer<typeof Node>;
  type Assert<T extends true> = T;
  type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
  type _value = Assert<Equal<Node['value'], number>>;
  type _next = Assert<Equal<NonNullable<Node['next']>['value'], number>>;
  void (null as unknown as _value);
  void (null as unknown as _next);
}

// --- Validator constructor accepts builder output and narrows ---
const v = new Validator(user);
const r = v.validate({ id: 1, name: 'a' });
if (r.valid) {
  const _id: number = r.data.id;
  const _name: string = r.data.name;
  const _email: string | undefined = r.data.email;
  void _id; void _name; void _email;
}
