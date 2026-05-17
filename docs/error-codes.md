# ata Error Codes

Stable registry of `ATA####` codes emitted by ata-validator. Each section is the target of `https://ata-validator.com/e/<code>`.

## type

### ATA1001 — value has wrong type

Keyword: `type`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA1002 — value is not an object

Keyword: `type`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

## shape

### ATA7001 — object missing required property

Keyword: `required`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA7002 — object has property not allowed by schema

Keyword: `additionalProperties`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA7003 — object has unevaluated property

Keyword: `unevaluatedProperties`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA7004 — array has unevaluated items

Keyword: `unevaluatedItems`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA7005 — dependentRequired property missing

Keyword: `dependentRequired`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA7006 — property name violates schema

Keyword: `propertyNames`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA7007 — array does not contain a matching item

Keyword: `contains`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

## constraint

### ATA2001 — string shorter than minLength

Keyword: `minLength`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2002 — string longer than maxLength

Keyword: `maxLength`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2003 — number below minimum

Keyword: `minimum`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2004 — number above maximum

Keyword: `maximum`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2005 — number not above exclusiveMinimum

Keyword: `exclusiveMinimum`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2006 — number not below exclusiveMaximum

Keyword: `exclusiveMaximum`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2007 — number not a multiple of expected divisor

Keyword: `multipleOf`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2008 — array shorter than minItems

Keyword: `minItems`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2009 — array longer than maxItems

Keyword: `maxItems`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2010 — object has fewer than minProperties

Keyword: `minProperties`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2011 — object has more than maxProperties

Keyword: `maxProperties`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2012 — array has duplicate items

Keyword: `uniqueItems`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA2013 — string does not match pattern

Keyword: `pattern`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

## format

### ATA3001 — value does not match format "email"

Keyword: `format` (format: `email`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3002 — value does not match format "date"

Keyword: `format` (format: `date`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3003 — value does not match format "date-time"

Keyword: `format` (format: `date-time`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3004 — value does not match format "time"

Keyword: `format` (format: `time`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3005 — value does not match format "uri"

Keyword: `format` (format: `uri`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3006 — value does not match format "uri-reference"

Keyword: `format` (format: `uri-reference`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3007 — value does not match format "ipv4"

Keyword: `format` (format: `ipv4`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3008 — value does not match format "ipv6"

Keyword: `format` (format: `ipv6`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3009 — value does not match format "uuid"

Keyword: `format` (format: `uuid`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3010 — value does not match format "hostname"

Keyword: `format` (format: `hostname`)

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA3099 — value does not match user-defined format

Keyword: `format`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

## enum

### ATA6001 — value is not one of the allowed enum values

Keyword: `enum`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA6002 — value does not equal const

Keyword: `const`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

## composition

### ATA4001 — value matched 0 of N oneOf variants

Keyword: `oneOf`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA4002 — value matched more than one oneOf variant

Keyword: `oneOf`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA4003 — value matched none of the anyOf variants

Keyword: `anyOf`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA4004 — value failed one or more allOf branches

Keyword: `allOf`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA4005 — value matched a forbidden schema

Keyword: `not`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA4006 — value violated then/else branch

Keyword: `if`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

## ref

### ATA5001 — $ref could not be resolved

Keyword: `$ref`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA5002 — recursive $ref cycle detected at validate time

Keyword: `$ref`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

## system

### ATA9000 — validation failed (abortEarly)

Keyword: `__abort_early__`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA9001 — input is not valid JSON

Keyword: `__parse__`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

### ATA9002 — schema failed to compile

Keyword: `__compile__`

**Cause.** _TODO — fill before release._

**Fix.** _TODO — fill before release._

