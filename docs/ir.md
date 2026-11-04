# The IR compiler

`ata-validator/ir` compiles a JSON Schema from one definition per keyword.
Each keyword's check, message, params and error enrichment are written once
(`lib/kernels`). A front end turns a schema into a small intermediate
representation and decides everything the schema fixes: messages, paths, the
checks a known type makes redundant, which nodes collect annotations, a
default fill of its own. Two backends read that representation without
knowing any keyword.

It is experimental within 1.x (see [STABILITY.md](STABILITY.md)). No entry of
this package uses it. `@ata-project/unplugin` compiles with it by default.

## Two backends

`specialize(schema, options)` writes a JavaScript module. The module exports
`isValid(data)` and `validate(data)`, which answer as the `Validator` does,
and imports its helpers from `ata-validator/kernels`, one export each, so a
page with several modules carries each helper once.

```js
import { specialize } from 'ata-validator/ir'

const source = specialize(schema, { richErrors: true })
// import {E,isObj,own,...} from "ata-validator/kernels"
// export function isValid(d){...}
// export function validate(d){...}
```

`compileClosures(schema, options)` builds closures in memory, without `eval`
or `new Function`, so it runs under a Content Security Policy that blocks code
generation.

```js
import { compileClosures } from 'ata-validator/ir'

const check = compileClosures(schema, { coerceTypes: true })
check.validate({ age: '42' })
```

Both take `richErrors`, `useDefaults`, `assertFormat`, `schemas` and
`baseURI`. The closures also take `coerceTypes`, `removeAdditional`,
`verbose`, `abortEarly`, schemas with `errorMessage`, and what a module
cannot carry, the caller's functions: `keywords` (including those that read
and change their data's context) and `formats`.

`specialize` writes its own default fill. Where it declines one (defaults
under `additionalProperties` or `patternProperties`, or behind a recursive
reference), the module carries the shared interpreted pass, unless the
caller passes `fillSource`, a function of the schema returning the body of
a fill as source or `null`. `defaultsSource` from `ata-validator/build` is
that function: the pass the `Validator` and the previous compiled modules
run, written into the module. On the 22 SchemaStore schemas it changes, a
valid document's check took 0.56 of the time at the geometric mean, faster
on 20 and slower on none (codeclimate 976 to 328 ns). It is not used with
`schemas`, whose documents the pass would not follow.

### The table backend

`tableModule(schema, options)` writes the schema as data instead of code: a
plan of steps that name the keyword descriptors and step handlers they use,
run by one interpreter in `ata-validator/kernels`. The module exports the
same `isValid` and `validate`, with the same verdicts and errors, every
field in order, rich or plain, and the same default fill. A bundle carries
the interpreter once and only the handlers its plans name, so a page with
many forms pays for each form about what its schema weighs: on six-field
order forms about 90 bytes gzipped a form, where a written module costs about
400. It is slower per call than written code (445 against 22 ns on a valid
order form), which a form submission does not notice and a server would.

```js
import { tableModule } from 'ata-validator/ir'

const source = tableModule(schema, { richErrors: false })
// import {maxLengthP,tClosed,tLeaf,tProps,tReq,tType,tablePlain} from "ata-validator/kernels"
// const P=[[[tType,"object"],[tProps,["name",1]],...]]
// export const{isValid,validate}=tablePlain(P)
```

`tablePlan(schema, options)` writes the same plan as JSON, for a page that
receives its schemas at run time: `fromPlan(plan)` from `ata-validator/plan`
reads it (plain errors) and `ata-validator/plan-rich` reads rich ones too.
A plan names kernels only in fixed places (a step's handler, a leaf's
descriptor, check and hint), resolved against a table with no prototype, so
a plan from the network cannot reach anything else; the schema's own values
stay data. Every step is checked when the plan is read, and one the writer
does not make is refused there. A plan is as trusted as a schema: it can
carry any pattern a schema can. It records the ata-validator that wrote it,
and reading one from another version warns once, since the page and the
server agree on every document only on the same version. The format checks and the error order load when a plan names
them. On 1298 suite groups and 3140 SchemaStore runs a plan over JSON
answers as the module writer does (`tests/test_ir_table.mjs`).

It takes `richErrors`, `useDefaults` and `assertFormat`, and the keywords
forms use: types, properties, required, additionalProperties, the leaf
checks and formats, items, prefixItems, allOf, anyOf, oneOf, `$ref`, not,
if and dependentRequired. Anything else (patternProperties, propertyNames,
contains, dependentSchemas, unevaluated keywords, dynamic references,
another option) returns `null`, and the caller writes the module instead. `@ata-project/unplugin` chooses
between the two for a whole application by which bundle is smaller.

## What it refuses

A schema or option outside what a backend covers throws an error whose
message starts with `ir:`. A caller falls back on that; the plugin keeps its
previous compiled module. The module writer refuses custom keywords, custom
formats, `errorMessage`, `coerceTypes`, `removeAdditional`, `verbose`,
`abortEarly`, and a v1 `$dynamicRef` that resolves only on the dynamic
scope. Both refuse `coerceTypes` or `removeAdditional` together with a
reference to a meta-schema.

## How it is checked

Both backends give the same verdicts and the same errors as the `Validator`,
every field in order, rich and plain:

- every group of the official test suite in six dialects (2020-12 384 of 384,
  2019-09 373, draft-07 258, draft-06 233, draft-04 160, v1 348; the module
  writer leaves 4 v1 groups to the closures), `tests/test_ir_suite.mjs`;
- 31,822 SchemaStore documents across all 492 schemas that ship samples;
- generated documents over every option and feature above,
  `tests/test_ir_differential.mjs` and `tests/test_ir_closure_features.mjs`;
- a minified browser bundle of the closures against the unbundled ones,
  `tests/test_ir_minified.mjs`.

## Where it differs

- Behind a `$ref` by URI to a resource in the same document, the `Validator`
  cannot place errors in schema order and keeps its own walk order. The IR
  keeps schema order. Two of the SchemaStore documents show it.
- An infinite number under a union type, or with no type, gets the numeric
  bounds; the `Validator` skips them there.
- Patterns run on the platform's RegExp. The `Validator` runs the patterns its
  linear-time engine accepts on that engine, so a pattern that backtracks
  badly costs more here on a hostile input.
