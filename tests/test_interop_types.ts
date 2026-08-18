// Type-level tests for the interop surface other tools consume: the Standard
// Schema property, boolean schemas, and vendor keywords on the `t` builder.
// Compiled (no emit) by tests/test_typed_validator_runner.js. Any unexpected
// type error, or an unsatisfied @ts-expect-error, fails the run.

import { Validator } from '../index.js';
import { t } from '../t.js';

const userValidator = new Validator({
  type: 'object',
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
  },
  required: ['id', 'name'],
});

// --- Standard Schema: consumers infer the output type ---
// A Standard Schema consumer (Fastify, tRPC, TanStack) reads the output type
// off `~standard.types`, so a validator built from a schema literal must carry
// its inferred data type there rather than `unknown`.

type StandardOutput = NonNullable<(typeof userValidator)['~standard']['types']>['output'];

const _out: StandardOutput = { id: 1, name: 'ada' };
void _out;

// @ts-expect-error -- output is the inferred data type, so a wrong field errors
const _outBad: StandardOutput = { id: 'one', name: 'ada' };
void _outBad;

// The validate() result on the success branch carries the same type.
declare const unknownValue: unknown;
const standardResult = userValidator['~standard'].validate(unknownValue);
if ('value' in standardResult) {
  const _id: number = standardResult.value.id;
  const _name: string = standardResult.value.name;
  void _id;
  void _name;
}

// --- Boolean schemas ---
// `true` accepts every instance and `false` rejects every instance. Both are
// valid JSON Schema documents and both work at runtime, so both must type.

const acceptAll = new Validator(true);
const _acceptAll: boolean = acceptAll.isValidObject({ anything: 1 });
void _acceptAll;

const rejectAll = new Validator(false);
const _rejectAll: boolean = rejectAll.isValidObject({ anything: 1 });
void _rejectAll;

declare const unknownSchema: object | boolean;
const fromUnknownSchema = new Validator(unknownSchema);
const _fromUnknown: boolean = fromUnknownSchema.isValidObject(unknownValue);
void _fromUnknown;

// --- Vendor keywords on the builder ---
// Custom keywords (@ata-project/keywords and anything else outside the spec)
// are legal on a schema, so the builder options must carry them without a cast.

const dateSchema = t.object({}, { instanceof: 'Date' });
void dateSchema;

const taggedString = t.string({ minLength: 1, 'x-internal': true });
void taggedString;

const taggedArray = t.array(t.number(), { typeof: 'object' });
void taggedArray;
