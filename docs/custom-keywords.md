# Custom keywords

JSON Schema lets a schema carry keywords the vocabulary does not define, and
says they are annotations: a validator ignores them. Sometimes a project needs
one of them to validate. The `keywords` option registers such keywords on a
validator, and `addKeyword` does the same on the compat class.

```javascript
const { Validator } = require('ata-validator')

const v = new Validator(
  { properties: { title: { type: 'string', maxWords: 5 } } },
  {
    keywords: {
      maxWords: {
        type: 'string',
        compile: (n) => (s) => s.split(/\s+/).length <= n,
      },
    },
  },
)

v.validate({ title: 'one two three four five six' })
// {
//   valid: false,
//   errors: [{
//     keyword: 'maxWords',
//     instancePath: '/title',
//     schemaPath: '#/properties/title/maxWords',
//     params: { keyword: 'maxWords' },
//     message: 'must pass "maxWords" keyword validation',
//   }],
// }
```

## Definitions

A definition is an object with one of three forms, or a bare function, which
is short for the `validate` form.

| Form | Called | Returns |
|------|--------|---------|
| `validate(value, data, parentSchema)` | once per value | `true` when the value passes |
| `compile(value, parentSchema)` | once per schema node | a function `(data) => boolean` |
| `macro(value, parentSchema)` | once per schema node | a schema |

`value` is what the schema wrote next to the keyword, `data` is the value being
validated, and `parentSchema` is the schema object that carries the keyword.

`type` limits which values the keyword sees: a definition with
`type: 'number'` is skipped for strings, objects and everything else, so it is
safe next to `type: ['number', 'string']` and never has to guard against the
wrong input. Without `type`, the function sees every value. `type` may also be
a list.

A `macro` returns a schema that is applied in place, in addition to the node's
other constraints. Its errors carry the keyword's path
(`#/properties/n/range/maximum`), and the keyword reports an error of its own
when the returned schema fails, so a consumer reading `keyword` sees both the
concrete failure and the keyword that caused it.

```javascript
new Validator(
  { properties: { n: { type: 'number', range: [1, 5] } } },
  { keywords: { range: { macro: ([min, max]) => ({ minimum: min, maximum: max }) } } },
).validate({ n: 9 }).errors.map((e) => e.keyword)
// ['maximum', 'range']
```

## Errors

A failing keyword reports one error with the keyword's name, the instance
path, the schema path ending in the keyword, `params: { keyword }` and the
message `must pass "<name>" keyword validation`.

A `validate` function, or the function `compile` returns, can replace that
with its own errors by leaving them on itself before returning `false`. Each
entry may set `message`, `params`, `keyword` and `schemaPath`; `instancePath`
is filled in. The array is cleared after every call, so nothing leaks into
the next one.

```javascript
const atLeast = {
  validate: function check(limit, data) {
    if (data >= limit) return true
    check.errors = [{ message: `must be at least ${limit}`, params: { limit } }]
    return false
  },
}
```

## What a custom keyword changes

A schema that uses a registered keyword runs on the interpreted engine, the
same engine that answers where code generation is blocked. That is what keeps
`anyOf`, `oneOf`, `not`, `if`, `$ref` and the other applicators correct around
the custom check: a keyword inside one `anyOf` branch does not fail the whole
schema when another branch passes, and a keyword under `not` is inverted. The
verdict paths (`isValidObject`, `isValidJSON`) run the same engine and agree
with `validate()`.

The interpreted engine is slower than the generated code the default path
runs. A schema that registers keywords but does not use any of them takes the
ordinary path and is not affected.

A custom keyword is a function, and a standalone module built ahead of time
imports nothing, so there is no way to carry it. `bundleStandalone` and the
other emitters refuse a schema that uses one instead of emitting a module
that would silently ignore the keyword. Keep custom keywords on the runtime
API, or express the constraint with the schema vocabulary and compile that.

A definition that has none of `validate`, `compile` or `macro` throws when the
validator is constructed. In particular the code-generating form the default
validator's class offers (`code`) is not supported, and a definition that
only has it is refused rather than accepted as a keyword that checks nothing.
A keyword named after a JSON Schema keyword is refused too.

## The compat class

`ata-validator/compat` accepts the same definitions through `addKeyword`, in
the shapes the reference class takes: `addKeyword({ keyword, type, validate })`,
`addKeyword(name, definition)`, and `addKeyword(name)` alone to declare a
keyword that checks nothing. `errors: true` on a definition is accepted; the
function's own errors are read whether or not it is set. The `metaSchema`
field is accepted and not applied: the keyword's value is not validated
against it.
