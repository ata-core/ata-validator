// Type-checked by tests/test_entry_types.js with Node's resolution: the root
// import is the Node entry (index.d.ts), and `ata-validator/v1` is the same.
import { Validator, validate, compile, version } from 'ata-validator'
import ata from 'ata-validator'
import { Validator as V1, validate as validate1 } from 'ata-validator/v1'
import { richErrors } from 'ata-validator/features/richErrors'
import { verbose } from 'ata-validator/features/verbose'

// Validator.use() is declared on the Node entry and returns the class.
const C: typeof Validator = Validator.use(richErrors, verbose)
const v = new C({ type: 'string' } as const, { engine: 'interpreter', strictSchema: 'log', keywords: {} })
const r = v.validate('a')
if (r.valid) { const s: string = r.data; void s }
const b: boolean = v.isValid('"a"')
const one = validate({ type: 'number' }, 1)
const same: typeof Validator = V1
const two = validate1({ type: 'number' }, 1)
void b; void one; void same; void two; void compile; void version; void ata
