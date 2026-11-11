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
checks and formats, patternProperties, propertyNames, items, prefixItems,
contains, allOf, anyOf, oneOf, `$ref`, not, if, dependentRequired,
dependentSchemas and propertyDependencies. Anything else (a `$ref` to another document, unevaluated
keywords, dynamic references, another option) returns `null`, and the
caller writes the module instead.
A default the specialized fill declines (under additionalProperties or a
pattern schema, or in a cycle) is filled by the shared pass, which the
module imports and a plan names, loaded only then. `@ata-project/unplugin` chooses
between the two for a whole application by which bundle is smaller.

### The closure backend

`closureModule(schema, { richErrors: false })` writes the schema as calls that
build one closure per schema node when the module loads. A page carries the
closures' kernels once and each form as a line of calls. It is for a bundle of
several forms: on twenty signup-like forms, minified and gzipped, 3.4 KB
against 5.0 KB for their plans and 8.6 KB for written modules, and a valid
form is checked in 237 ns against 643 ns for a plan (82 ns for a written
module, which stays the fastest and, for a single form, the smallest).

```js
import { closureModule } from 'ata-validator/ir'

const source = closureModule(schema, { richErrors: false })
// import {cObj,cRun,cVal,fmt_email_s} from "ata-validator/kernels"
// export const{isValid,validate}=cRun(cObj("tpr",["email",cVal([0,1,4,[fmt_email_s,"email"]])],1))
```

It takes plain errors only, and what forms are made of: objects (`type`,
`properties`, `required`, `additionalProperties: false`), arrays (`items`,
`minItems`, `maxItems`, `uniqueItems`) and values (`type`, `enum` and `const`
of primitives, the string and number keywords, formats). The errors are the
`Validator`'s with `richErrors: false`, every field, in the same order.
Anything else (a reference, `anyOf`, a default to fill, rich errors) returns
`null`, and the caller writes the plan or the module instead.
`tests/test_ir_closures.mjs` holds every module it writes to the module
writer's answers on the official suite and on generated forms.

### Choosing a backend

`pickModules(schemas, options, size)` chooses for a whole application: it
writes every schema each way and takes plans or closures only where their
sources are smaller than the written modules by more than the backend's
runtime costs a bundle. `size` is the gzipped length of a text, which the
caller supplies (`(s) => zlib.gzipSync(s).length` in Node), so the function
loads where there is no zlib. It returns the backend and, for each schema,
the source and the backend that wrote it; a schema the chosen backend does
not take is written as a module beside the others.

```js
import zlib from 'node:zlib'
import { pickModules } from 'ata-validator/ir'

const { backend, sources } = pickModules(schemas, { richErrors: false }, (s) => zlib.gzipSync(s).length)
```

One form stays a written module. The costs are set from 142 sets of 1 to 7
generated forms bundled each way: above them the chosen backend was the
smaller bundle every time; below them some sets would have been smaller too
and stay written modules. `tests/test_ir_pick.mjs` bundles a few sets and
holds the choice to never being the larger bundle.

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
