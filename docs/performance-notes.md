# Where ata does work it does not need to

An honest account of measured waste in ata's own code, kept here so it is written
down rather than rediscovered.

Measured on 2026-08-27 against 1.8.0, on one machine (darwin arm64, Node 25.2.1),
pure JS engine unless a row says otherwise. Every number was run. Nothing is
estimated, and where only one shape was measured it says so, because a single shape
is how the buffer claim in item 6 got published.

Ordered by how much is being spent, not by how interesting the fix is.

---

## 1. Half of construction went to proving nothing needed changing (fixed)

`_normalizeCallerSchema` ran on the root schema and on every registered schema,
and did the same three things every time, whatever the schema looked like:

```js
const str = JSON.stringify(s)          // serialize
const copy = _deepCloneWithSymbols(s)  // clone
if (needsDraft7) normalizeDraft7(copy, true)
normalizeNullable(copy)
return JSON.stringify(copy) === str ? s : copy   // serialize again to compare
```

Two full serializations and a deep clone, to decide whether anything changed. For a
modern 2020-12 schema with no `nullable` and no draft-07 keyword the answer is always
no, and all of it was thrown away.

Every question the normalizers ask is of the form "does this key appear anywhere in
the tree", and one traversal answers all of them at once. `lib/schema-scan.js` walks
the schema once and returns a bitmask; `needsNormalization` reads it and the clone
happens only for the schemas that need it.

| shape | before | after | |
|---|---|---|---|
| no registry, 10 fields | 18.5 µs | 4.6 µs | 4.0x |
| no registry, 50 fields | 66.9 µs | 11.9 µs | 5.6x |
| no registry, 200 fields | 236.0 µs | 40.2 µs | 5.9x |
| 10 registered, 10 fields | 122.6 µs | 11.7 µs | 10.5x |
| 10 registered, 50 fields | 551.5 µs | 60.4 µs | 9.1x |
| 50 registered, 50 fields | 2570 µs | 260 µs | 9.9x |

The win is larger with a registry because every registered schema paid the same
price. A server registering fifty schemas starts in a quarter of a millisecond
instead of two and a half.

The answer is also remembered against the schema object, which is what
`_identityCache` already does for whole compiled validators. A server building one
validator per route over a shared registry hands the same registry objects to every
one of them, so without the cache fifty routes over twenty shared schemas scanned
those twenty a thousand times:

| | before | after | |
|---|---|---|---|
| 50 routes, 20-schema shared registry, boot | 20.66 ms | 0.111 ms | 186x |

Median of seven interleaved runs. The benchmark asserts that all fifty validators
still accept and reject correctly before it times anything, since a boot that
produces nothing would be very fast.

The scan walks every object-valued key rather than the list of subschema keywords the
normalizers recurse through, so it is a superset of what they visit. It can report
work where there is none, which costs one clone, and cannot miss work there is, which
would hand an un-normalized schema to the engines and be silently wrong.
`tests/test_schema_scan.js` asserts that direction over all 2344 schemas in the
suite, and asserts the property has teeth by breaking the scan on purpose and
checking that the broken one is caught.

Across the suite the scan reports work on 335 schemas where normalization changes
334. One unnecessary clone in 2344.

### What the measurement got wrong first

The saving predicted here was about 660 µs, from timing a clone and two
serializations in isolation. The real saving is 2310 µs. The gap is item 2a: the
clone is much dearer than the proxy used to estimate it.

## 2a. The clone itself is 4.7x dearer than it needs to be

`_deepCloneWithSymbols` builds each object with `Object.create(null)`, then
`Object.defineProperty` for every key, then `Object.setPrototypeOf` back. On the same
132 KB registry:

| | |
|---|---|
| `_deepCloneWithSymbols` as written | 1190 µs |
| the same clone with plain assignment | 251 µs |

The null prototype looks deliberate: it is what stops a schema with a `__proto__` key
from reaching a setter during the copy. That is worth keeping. The
`Object.defineProperty` per key on top of it may be redundant, since an object with a
null prototype has no inherited setter for assignment to reach, but this is
prototype-pollution-adjacent code and the reasoning has to be checked rather than
assumed.

Item 1 took this off the path for almost every schema. It is still on the path for
the schemas that genuinely need normalizing, for `assertFormat: false`, and for the
vocabulary pass.

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

The figures in item 1 are this table. Before the scan, a validator with fifty
registered schemas cost 2.4 ms to construct before a single document was validated.
Cold start is the thing ata sells on edge runtimes, so that number mattered more than
the attention it had had. It is now 0.26 ms. Item 2 is what is left.

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

Items 1 and 6 are done.

Item 2a next, if the prototype reasoning holds up. It is a contained change with a
measured 4.7x on a path that item 1 made rare but did not remove.

Item 5 is the most interesting and the least ready. There is no proposal worth trying
until someone can explain why both columns degrade past 256 validators, and the last
attempt in that area was reverted after being measured.
