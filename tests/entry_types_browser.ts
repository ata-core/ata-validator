// Type-checked by tests/test_entry_types.js with the `browser` condition, and
// again with `workerd`: the root import is a 2.0 entry (index.v2.d.ts), one
// export, and `ata-validator/v1` is the 1.x Validator with everything on it.
import { Validator, type ValidatorOptions, type Feature } from 'ata-validator'
// @ts-expect-error: the 2.0 entries export Validator only
import { validate } from 'ata-validator'
import { Validator as V1, validate as validate1, compile } from 'ata-validator/v1'
import { richErrors } from 'ata-validator/features/richErrors'
import { metaschemas } from 'ata-validator/features/metaschemas'

const features: Feature[] = [richErrors, metaschemas]
const C: typeof Validator = Validator.use(...features)
const opts: ValidatorOptions = { verbose: true, richErrors: false, formats: { x: (s) => s === 'x' }, schemas: [{ $id: 'urn:a' }], abortEarly: true, assertFormat: false, useDefaults: false, baseURI: 'urn:b', coerceTypes: true, removeAdditional: true }
const v = new C({ type: 'object', properties: { n: { type: 'number' } }, required: ['n'] } as const, opts)
const r = v.validate({ n: 1 })
if (r.valid) { const n: number = r.data.n; void n } else { const m: string = r.errors[0].message; void m }
const ok: boolean = v.isValidObject({}) && v.isValidJSON('{}') && v.validateJSON('{}').valid
v.addSchema({ $id: 'urn:c' })
const std = v['~standard'].validate
// @ts-expect-error: an option the 2.0 Validator refuses
new Validator({}, { engine: 'interpreter' })
// @ts-expect-error: keywords is on the Node entry and ata-validator/v1
new Validator({}, { keywords: {} })
// @ts-expect-error: the buffer methods are not on the 2.0 Validator
v.isValid('{}')
// @ts-expect-error: nor the bundle statics
Validator.fromStandalone
// The 1.x Validator, by its own subpath.
const old = new V1({ type: 'string' }, { engine: 'interpreter', keywords: {} })
const b: boolean = old.isValid('"a"')
const one = validate1({ type: 'number' }, 1)
void ok; void std; void b; void one; void compile; void validate
