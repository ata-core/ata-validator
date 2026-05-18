# ata Error Codes

Stable registry of `ATA####` codes emitted by ata-validator. Each section is the target of `https://ata-validator.com/e/<code>`.

## type

### ATA1001: value has wrong type

Keyword: `type`

**Cause.** The value at this path is not one of the types listed in the schema's `type` keyword. For `type: ["string", "null"]`, anything that isn't a string or null trips this.

**Fix.** Send a value that matches one of the allowed types, or widen `type` to cover what you're sending. If a JSON string would coerce cleanly to the expected type (e.g. `"42"` for `integer`), set `coerceTypes: true` on the Validator.

### ATA1002: value is not an object

Keyword: `type`

**Cause.** The schema requires `type: "object"` but the value was a primitive, array, or null.

**Fix.** Wrap the data in an object, or change the schema if a primitive was actually intended.

## shape

### ATA7001: object missing required property

Keyword: `required`

**Cause.** A property listed in `required` is absent from the object.

**Fix.** Add the missing property to the data, or remove it from `required` if it should be optional. When a present property has a name close to the missing one (e.g. `emial` vs `email`), ata attaches a `did you mean` suggestion to the error.

### ATA7002: object has property not allowed by schema

Keyword: `additionalProperties`

**Cause.** With `additionalProperties: false`, the object carries a key not declared in `properties` or `patternProperties`.

**Fix.** Remove the stray key, declare it in `properties`, or set `additionalProperties: true` if extra keys are acceptable. Use `removeAdditional: true` on the Validator to strip unknown keys silently instead of erroring.

### ATA7003: object has unevaluated property

Keyword: `unevaluatedProperties`

**Cause.** With `unevaluatedProperties: false`, the property wasn't accounted for by any composed branch (`allOf`/`anyOf`/`oneOf`). Unlike `additionalProperties`, this looks across composition.

**Fix.** Declare the property in one of the composed branches, or remove it from the data.

### ATA7004: array has unevaluated items

Keyword: `unevaluatedItems`

**Cause.** Like ATA7003 but for arrays. With `unevaluatedItems: false`, a position in the array wasn't covered by `items`, `prefixItems`, or any composed branch.

**Fix.** Cover the position with `items` or `prefixItems`, declare it in a composed branch, or shorten the array.

### ATA7005: dependentRequired property missing

Keyword: `dependentRequired`

**Cause.** The schema requires a property to be present whenever another is set (e.g. `dependentRequired: { creditCard: ["billingAddress"] }`), and the trigger is set without the dependent.

**Fix.** Add the dependent property, or remove the trigger from the data.

### ATA7006: property name violates schema

Keyword: `propertyNames`

**Cause.** A property name fails the `propertyNames` sub-schema. Usually a pattern, length, or format constraint on the key itself.

**Fix.** Rename the offending keys to match the rule, or relax the `propertyNames` schema.

### ATA7007: array does not contain a matching item

Keyword: `contains`

**Cause.** `contains` requires at least one element to match a sub-schema, and none did. With `minContains` set, the count is also enforced.

**Fix.** Add an element that satisfies the `contains` sub-schema, or relax the constraint.

## constraint

### ATA2001: string shorter than minLength

Keyword: `minLength`

**Cause.** String length is below `minLength`. Length is counted in Unicode code points, not bytes.

**Fix.** Lengthen the string, or lower `minLength`.

### ATA2002: string longer than maxLength

Keyword: `maxLength`

**Cause.** String length exceeds `maxLength`. Counted in code points.

**Fix.** Shorten the string, or raise `maxLength`.

### ATA2003: number below minimum

Keyword: `minimum`

**Cause.** The number is below the inclusive `minimum`.

**Fix.** Send a number ≥ `minimum`, or lower the bound. Use `exclusiveMinimum` if the bound itself should be excluded.

### ATA2004: number above maximum

Keyword: `maximum`

**Cause.** The number is above the inclusive `maximum`.

**Fix.** Send a number ≤ `maximum`, or raise the bound.

### ATA2005: number not above exclusiveMinimum

Keyword: `exclusiveMinimum`

**Cause.** The number equals or is below `exclusiveMinimum`, which must be strictly exceeded.

**Fix.** Send a strictly greater number, or switch to `minimum` if the bound should be inclusive.

### ATA2006: number not below exclusiveMaximum

Keyword: `exclusiveMaximum`

**Cause.** The number equals or is above `exclusiveMaximum`, which must be strictly under.

**Fix.** Send a strictly smaller number, or switch to `maximum` if the bound should be inclusive.

### ATA2007: number not a multiple of expected divisor

Keyword: `multipleOf`

**Cause.** The number is not divisible by `multipleOf`. Floating-point rounding is handled with a small epsilon, so `0.1 + 0.2` against `multipleOf: 0.1` works.

**Fix.** Send a multiple of the divisor, or change `multipleOf`.

### ATA2008: array shorter than minItems

Keyword: `minItems`

**Cause.** Array length is below `minItems`.

**Fix.** Add elements, or lower `minItems`.

### ATA2009: array longer than maxItems

Keyword: `maxItems`

**Cause.** Array length exceeds `maxItems`.

**Fix.** Drop elements, or raise `maxItems`.

### ATA2010: object has fewer than minProperties

Keyword: `minProperties`

**Cause.** The object's key count is below `minProperties`.

**Fix.** Add keys, or lower `minProperties`.

### ATA2011: object has more than maxProperties

Keyword: `maxProperties`

**Cause.** The object's key count exceeds `maxProperties`.

**Fix.** Drop keys, or raise `maxProperties`.

### ATA2012: array has duplicate items

Keyword: `uniqueItems`

**Cause.** `uniqueItems: true` is set and two or more elements compare equal under deep equality (object key order doesn't matter).

**Fix.** Deduplicate the array, or drop the `uniqueItems` constraint.

### ATA2013: string does not match pattern

Keyword: `pattern`

**Cause.** The string doesn't match the schema's `pattern` regex. Patterns run under ECMA-262 semantics, with an re2 safety fallback for runaway patterns.

**Fix.** Adjust the data, or fix the regex. Test patterns in a small Node REPL before shipping; backslashes inside JSON strings need to be escaped twice.

## format

### ATA3001: value does not match format "email"

Keyword: `format` (format: `email`)

**Cause.** The string fails ata's RFC 5322 email checker. Common failure modes: missing `@`, no dot in the domain, multiple `@`, or whitespace inside the local part.

**Fix.** Send a valid email. If your domain accepts a looser definition, override with `formats: { email: () => true }` on the Validator (or with a stricter custom function).

### ATA3002: value does not match format "date"

Keyword: `format` (format: `date`)

**Cause.** The string is not a valid `YYYY-MM-DD` calendar date. ata validates the calendar, not just the pattern, so `2026-02-30` fails.

**Fix.** Use ISO 8601 calendar form. If you meant to include a time, switch the schema to `format: "date-time"`.

### ATA3003: value does not match format "date-time"

Keyword: `format` (format: `date-time`)

**Cause.** The string is not a valid RFC 3339 / ISO 8601 date-time (e.g. `2026-05-18T14:30:00Z`).

**Fix.** Use the `T` separator between date and time, and include a timezone (`Z` or `+HH:MM`).

### ATA3004: value does not match format "time"

Keyword: `format` (format: `time`)

**Cause.** The string is not a valid RFC 3339 time (e.g. `14:30:00`, optionally with fractional seconds or timezone).

**Fix.** Use 24-hour `HH:MM:SS`. Add `.sss` for sub-second precision and `Z`/`±HH:MM` for timezone if needed.

### ATA3005: value does not match format "uri"

Keyword: `format` (format: `uri`)

**Cause.** The string is not an absolute URI. It needs a scheme (`https://`, `mailto:`, etc.).

**Fix.** Include the scheme, or relax the schema to `uri-reference` if relative paths are acceptable.

### ATA3006: value does not match format "uri-reference"

Keyword: `format` (format: `uri-reference`)

**Cause.** The string is not a valid URI reference. Covers both absolute and relative URIs but still rejects illegal characters and malformed percent-encoding.

**Fix.** Encode reserved characters properly, or strip them.

### ATA3007: value does not match format "ipv4"

Keyword: `format` (format: `ipv4`)

**Cause.** The string is not dotted-decimal IPv4 (four 0-255 octets separated by dots).

**Fix.** Send a literal IPv4. To accept either IPv4 or IPv6, use `oneOf` with two branches.

### ATA3008: value does not match format "ipv6"

Keyword: `format` (format: `ipv6`)

**Cause.** The string is not a valid IPv6 literal. Both full and `::`-compressed forms are accepted.

**Fix.** Send a well-formed IPv6. Square-bracket-wrapped forms from URLs (`[::1]`) need to be unwrapped first.

### ATA3009: value does not match format "uuid"

Keyword: `format` (format: `uuid`)

**Cause.** The string is not in the canonical UUID layout `8-4-4-4-12` lowercase hex.

**Fix.** Use the canonical form. Uppercase UUIDs from older libraries should be lowercased before validation; the nil UUID (`00000000-0000-0000-0000-000000000000`) is accepted.

### ATA3010: value does not match format "hostname"

Keyword: `format` (format: `hostname`)

**Cause.** The string is not a valid DNS hostname per RFC 1123.

**Fix.** Use label-separated names like `api.example.com`. Each label must be 1-63 alphanumerics or hyphens, and the total length must not exceed 253.

### ATA3099: value does not match user-defined format

Keyword: `format`

**Cause.** A custom format checker registered via the Validator's `formats` option returned `false` for this value.

**Fix.** Send a value the checker accepts, or adjust the checker. The `params.format` field on the error names which format fired.

## enum

### ATA6001: value is not one of the allowed enum values

Keyword: `enum`

**Cause.** The value doesn't deep-equal any entry in `enum`. ata also runs a bounded Levenshtein check against string enums; if a suggestion is attached, that's the likely intended value.

**Fix.** Pick a value from the enum, or add the value to the schema if it should be allowed.

### ATA6002: value does not equal const

Keyword: `const`

**Cause.** The value doesn't deep-equal the schema's `const`.

**Fix.** Send the constant, or relax to `enum` if multiple values should be accepted.

## composition

### ATA4001: value matched 0 of N oneOf variants

Keyword: `oneOf`

**Cause.** None of the `oneOf` branches accepted the data. ata picks the closest-scoring branch (lowest error count, weighted by keyword severity) and surfaces its errors as nested context under `branchErrors`.

**Fix.** Resolve the errors in the closest branch, or adjust the data to match a different branch. Add a `title` to each branch schema to get readable variant names in the error output.

### ATA4002: value matched more than one oneOf variant

Keyword: `oneOf`

**Cause.** `oneOf` requires exactly one match; the data satisfied two or more branches. Usually a sign the branches are not actually mutually exclusive.

**Fix.** Tighten the branches with a discriminator field or mutually exclusive constraints. If multiple matches are fine, switch to `anyOf`.

### ATA4003: value matched none of the anyOf variants

Keyword: `anyOf`

**Cause.** Every `anyOf` branch rejected the data. ata reports the closest match the same way `ATA4001` does for `oneOf`.

**Fix.** Resolve the closest branch's errors, or add a new branch covering the shape you're sending.

### ATA4004: value failed one or more allOf branches

Keyword: `allOf`

**Cause.** `allOf` requires every branch to pass; at least one rejected the data. Unlike `oneOf`/`anyOf`, ata does not collapse, each failing branch's errors surface independently with their own codes.

**Fix.** Resolve each branch's errors individually.

### ATA4005: value matched a forbidden schema

Keyword: `not`

**Cause.** A `not` schema accepted the data, which violates the constraint.

**Fix.** Change the data so the inner schema rejects it, or drop the `not` if the constraint isn't needed.

### ATA4006: value violated then/else branch

Keyword: `if`

**Cause.** An `if`/`then`/`else` schema: the `if` matched but `then` rejected, or `if` didn't match and `else` rejected.

**Fix.** Satisfy the active branch, or revisit the `if` clause if the wrong branch is being selected.

## ref

### ATA5001: $ref could not be resolved

Keyword: `$ref`

**Cause.** A `$ref` points to a schema id ata doesn't know about. Most often a typo, a missing `addSchema` call, or a `$ref` to a remote URL ata cannot fetch.

**Fix.** Register the referenced schema via `new Validator(main, { schemas: [referenced] })` or `addSchema(...)`. ata does not fetch remote refs at runtime; mirror them locally first.

### ATA5002: recursive $ref cycle detected at validate time

Keyword: `$ref`

**Cause.** A self-referencing schema produced a cycle that wasn't caught at compile time. Mostly happens with `$dynamicRef` and certain recursive `oneOf` patterns.

**Fix.** Add a termination condition (a discriminator, a depth limit, a non-recursive base case), or restructure to break the cycle.

## system

### ATA9000: validation failed (abortEarly)

Keyword: `__abort_early__`

**Cause.** The Validator was constructed with `abortEarly: true`, which deliberately skips detailed error collection to maximize throughput. This stub means "validation failed; rerun without `abortEarly` for details".

**Fix.** This is not a bug. To get detailed errors, send the same data through a Validator constructed without `abortEarly`. The two can coexist: keep `abortEarly` on the hot path, run a non-abortEarly instance for diagnostics.

### ATA9001: input is not valid JSON

Keyword: `__parse__`

**Cause.** `validateJSON()` was called with a string or Buffer that doesn't parse. The message includes the parser's position.

**Fix.** Fix the JSON syntax at the reported offset. If the input is already a parsed object, call `validate()` (or `validateObject()`) instead.

### ATA9002: schema failed to compile

Keyword: `__compile__`

**Cause.** The schema passed to `new Validator(schema)` or `ata compile` is structurally invalid: malformed JSON Schema, unsupported keyword combination, or broken `$ref`.

**Fix.** Address the issue in the schema. The error message and source frame point at the offending location.
