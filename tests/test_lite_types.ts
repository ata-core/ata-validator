// Type-level tests for ata-validator/lite: it exports the same Validator and
// one-shot functions as the full package, with the same inference, and not
// the tools it leaves out. Compiled (no emit) by
// tests/test_typed_validator_runner.js.

import { Validator, validate, defineSchema, version } from '../lite.js';
import * as lite from '../lite.js';

const User = defineSchema({
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
  },
  required: ['id'],
});

const v = new Validator(User);
const r = v.validate({ id: 1 });
if (r.valid) {
  const id: number = r.data.id;
  const name: string | undefined = r.data.name;
  void id; void name;
} else {
  const keyword: string = r.errors[0].keyword;
  void keyword;
}

const one = validate(User, { id: 2 });
if (one.valid) {
  const id: number = one.data.id;
  void id;
}

const ok: boolean = v.isValidObject({ id: 3 });
const s: string = version();
void ok; void s;

// @ts-expect-error toTypeScript is not part of lite
lite.toTypeScript;
// @ts-expect-error the renderers are not part of lite
lite.renderPretty;
