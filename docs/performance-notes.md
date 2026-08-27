# Where ata does work it does not need to

An honest account of measured waste in ata's own code, kept here so it is written
down rather than rediscovered.

Measured on 2026-08-27 against 1.8.0, on one machine (darwin arm64, Node 25.2.1),
pure JS engine unless a row says otherwise. Every number was run. Nothing is
estimated, and where only one shape was measured it says so, because a single shape
is how the buffer claim in item 6 got published.

Ordered by how much is being spent, not by how interesting the fix is.

---

## 1. Half of construction goes to proving nothing needed changing

`_normalizeCallerSchema` runs on the root schema and on every registered schema. It
does the same three things every time, whatever the schema looks like:

```js
const str = JSON.stringify(s)          // serialize
const copy = _deepCloneWithSymbols(s)  // clone
if (needsDraft7) normalizeDraft7(copy, true)
normalizeNullable(copy)
return JSON.stringify(copy) === str ? s : copy   // serialize again to compare
```

Two full serializations and a deep clone, to decide whether anything changed. For a
modern 2020-12 schema with no `nullable` and no draft-07 keyword, the answer is
always no, and all of it is thrown away.

With a 132 KB registry of 50 schemas at 50 fields each:

| | |
|---|---|
| `new Validator(schema, { schemas })` | 2518 µs |
| the clone plus two serializations, across the registry | 662 µs |
| one structural walk that answers the same question | 139 µs |

So roughly a quarter of construction is this, and it is about five times dearer than
it needs to be. A single walk looking for `nullable` or a draft-07-only keyword tells
you whether to bother, and the clone then happens only for the schemas that need it.

The walk timed above is a rough one written for the measurement, not a proposed
implementation. It has to agree exactly with what `normalizeDraft7` and
`normalizeNullable` actually touch, or it will skip a schema that needed work, which
is the silent-acceptance failure this codebase cares most about. That agreement is
the whole difficulty, and a differential test over the suite has to come before the
optimization, not after it.

## 2. The registry is serialized again for the cache key

`compileCacheKey` walks the schema map and serializes every entry:

```js
for (const [id, s] of schemaMap) parts.push(id + '=' + JSON.stringify(s))
```

On the same registry that is another 221 µs, on top of the two serializations per
schema in item 1. The content genuinely has to be in the key, since two validators
can share a root schema and an `$id` while pointing that `$id` at different
documents, so this is not wrong. It is just the third and fourth time the same bytes
are produced during one construction.

Whatever caches the normalized form should be able to hand back its serialization
too, so the string is produced once and reused.

## 3. Construction cost, for reference

Linear in the schema, and roughly the product with the registry:

| fields | registered schemas | construction |
|---|---|---|
| 10 | 0 | 19 µs |
| 50 | 0 | 61 µs |
| 200 | 0 | 210 µs |
| 10 | 10 | 112 µs |
| 10 | 50 | 506 µs |
| 50 | 50 | 2427 µs |

2.4 ms before a single document is validated. That is a cold-start number, and cold
start is the thing ata sells on edge runtimes, so it is worth more attention than it
has had. Items 1 and 2 are most of the addressable part.

## 4. The serialized schema is scanned seven times

At compile time `this._schemaStr.includes(...)` runs seven times over the whole
serialized schema, at index.js lines 825, 851, 931, 932, 1208, 1209 and 1212, looking
for `json-schema.org/draft`, `$dynamicRef`, `$dynamicAnchor`, `unevaluatedProperties`,
`unevaluatedItems` and `propertyDependencies`.

This one is not measured. It is bounded by schema size and happens once per compile,
so on the numbers in item 3 it is unlikely to be the biggest term. It is listed
because it is obviously redundant, not because it is known to be expensive. One pass
could answer all seven, or the structural walk from item 1 could answer them on its
way past. Worth measuring before touching; it may not be worth the change.

## 5. Dispatch cost appears once there are many validators

The gap between `validate()` and `isValidObject()` is not the result object. In
isolation it is 4 to 5 ns. It grows with the number of distinct compiled validators
in play:

| distinct validators | validate | isValidObject | difference |
|---|---|---|---|
| 1 | 21.2 ns | 15.5 ns | 5.7 ns |
| 16 | 14.8 ns | 11.2 ns | 3.6 ns |
| 64 | 17.6 ns | 11.7 ns | 5.9 ns |
| 256 | 42.8 ns | 16.1 ns | 26.7 ns |
| 512 | 50.8 ns | 19.4 ns | 31.4 ns |

Both columns get worse past 256, and the gap between them grows about fivefold. This
is the same effect that killed the result-object optimization tried during the 1.7.x
work: a third generated function per schema made things worse at a hundred routes
even though it helped at thirty. More generated code objects, worse instruction
cache behaviour, and V8 giving up on call site caching sooner.

This matters for how ata is actually deployed. A server with 300 routes is past the
knee. There is no fix proposed here, only a shape of problem: per-schema generated
code is not free at scale, and an optimization measured on a handful of schemas can
be a regression on a real application. Anything tried here has to be measured at 256
and 512, not at 4.

## 6. A shipped claim was broader than its measurement (corrected)

The 1.7.4 changelog said rejecting through the buffer APIs "is now never dearer than
accepting". Measured:

| shape | accept | reject | ratio |
|---|---|---|---|
| small object, 2 fields | 129 ns | 278 ns | 2.16x |
| 1000 objects, bad element first | 14.4 µs | 3.2 µs | 0.23x |
| 1000 objects, bad element last | 14.1 µs | 14.4 µs | 1.02x |

The large-array rows hold up, and that is the shape the changelog measured. The small
object does not: rejecting still costs a bit over twice accepting, because there is no
bulk of parsing for an early exit to save. The improvement was real, the sentence
generalized past it.

The changelog entry has been narrowed to the shapes it was measured on. Making the
small-object reject path as cheap as accept is still open.

## 7. ata's defaults do more work than its peers' defaults

Not waste, but it distorts every comparison, so it belongs on the list.

ata asserts `format` and applies `default` out of the box. ajv needs the `ajv-formats`
package and `useDefaults: true` for the same behaviour, and schemasafe is likewise
opt-in. Across the suite:

| dialect | ata defaults | `assertFormat: false, useDefaults: false` | ratio |
|---|---|---|---|
| 2020-12 | 189 ns | 101 ns | 1.87x |
| draft-07 | 89 ns | 53 ns | 1.68x |

Any benchmark that writes `new Validator(schema)` and compares against a plain `new
Ajv()` is asking ata to do strictly more per call. Where third-party numbers show schemasafe ahead of ata by 1.27x on 2020-12 and ajv
ahead by 1.26x on draft-07, both gaps are smaller than this configuration difference.

That is a thing to check against a given benchmark's configuration, not a conclusion
about it. The defaults themselves are a deliberate choice that suits the web
frameworks ata targets, and changing them is not proposed here.

## 8. The other side of that coin

For the same reason, one asymmetry runs in ata's favour and should be said out loud
wherever the above is said. ata builds error objects lazily, on `.errors` access. A
benchmark that reads only `.valid` never pays for them, while an implementation that
collects errors eagerly does, on every failing case, and roughly half the suite is
failing cases.

That is a real design advantage rather than a configuration mismatch, but a
comparison that quietly benefits from it is no better than one that quietly suffers
from item 7. Whichever access pattern a published number describes should be stated
next to it.

## 9. Known gaps left in `$vocabulary`, deliberately

Shipped in 1.8.0 and written down in the README, listed here so they are not
rediscovered as bugs:

- A meta-schema that requires a vocabulary ata does not recognise does not make ata
  refuse the schema. The specification says an implementation must refuse. ata
  evaluates it with every keyword applied, which is what it did before the feature
  existed. Turning silent acceptance into a hard failure is its own decision.
- A separate document reached through `$ref` keeps its own keywords rather than
  inheriting the referring dialect. Only the document naming the meta-schema is
  filtered.

---

## What is worth doing

Item 1 first, and behind a differential test. It is the largest measured waste, the
fix is contained, and the risk sits in one place: a pre-check that disagrees with the
normalizers would skip a schema that needed work. That is the failure this codebase
treats as the worst kind, so the test comes before the optimization.

Item 6 is done.

Item 5 is the most interesting and the least ready. There is no proposal worth trying
until someone can explain why both columns degrade past 256 validators, and the last
attempt in that area was reverted after being measured.
