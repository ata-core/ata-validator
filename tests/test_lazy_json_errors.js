'use strict';

// validateJSON must not pay for diagnostics nobody reads.
//
// validate(data) has been lazy since 1.9.0: the rejection it returns computes
// sorting, enrichment, suggestions and frames on first access to `.errors`, so a
// caller that reads `.valid` pays nothing for them. validateJSON(text) did all
// of it eagerly instead. On a 50 KB invalid config that was 585 microseconds for
// a caller reading a boolean, against 153 for the same validator with
// richErrors off, so about 430 microseconds of work whose output was discarded.
//
// The assertions here are on observable side effects, not on timing: enrichment
// needs a value tree, and on the default path validating the text needs no
// JSON.parse at all, so counting parses of the document is a deterministic
// witness for whether the diagnostic layer ran.

const assert = require('node:assert');
const { Validator } = require('..');

const SCHEMA = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    sections: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                weight: { type: 'number', minimum: 0 },
                nested: { type: 'object', properties: { retries: { type: 'integer', maximum: 10 } } },
              },
            },
          },
        },
      },
    },
  },
};

function makeConfig (bad) {
  const cfg = { version: bad ? 'nope' : '1.0.0', sections: {} };
  for (let s = 0; s < 20; s++) {
    const entries = [];
    for (let i = 0; i < 20; i++) entries.push({ id: 'e' + i, weight: i, nested: { retries: 3 } });
    cfg.sections['s' + s] = { entries };
  }
  if (bad) cfg.sections.s0.entries[0].nested.retries = 99;
  return JSON.stringify(cfg, null, 2);
}

const RAW_BAD = makeConfig(true);
const RAW_GOOD = makeConfig(false);

// Count parses of the document itself. Small parses (a sliced value, a schema)
// are not the document and do not count.
const realParse = JSON.parse;
function countingParses (fn) {
  let n = 0;
  JSON.parse = function (text) {
    if (typeof text === 'string' && text.length > 1000) n++;
    return realParse.apply(this, arguments);
  };
  try { return { value: fn(), parses: n } } finally { JSON.parse = realParse }
}

// --- reading the verdict must not build the diagnostic layer ----------------
{
  const v = new Validator(SCHEMA);
  v.validateJSON(RAW_BAD); // warm every lazy path before counting

  const verdict = countingParses(() => v.validateJSON(RAW_BAD).valid);
  assert.strictEqual(verdict.value, false, 'the verdict is still correct');
  assert.strictEqual(verdict.parses, 0, 'reading .valid parses the document zero times');

  const ok = countingParses(() => v.validateJSON(RAW_GOOD).valid);
  assert.strictEqual(ok.value, true, 'a valid document is still valid');
  assert.strictEqual(ok.parses, 0, 'and costs no parse either');

  console.log('ok: reading the verdict builds no diagnostics');
}

// --- reading the errors still gets everything, unchanged --------------------
{
  const v = new Validator(SCHEMA);
  const r = v.validateJSON(RAW_BAD);
  const errs = r.errors;

  assert.ok(errs.length >= 2, `expected the real errors, got ${errs.length}`);
  const byPath = Object.fromEntries(errs.map((e) => [e.instancePath, e]));
  const version = byPath['/version'];
  assert.ok(version, 'the /version error is present');
  assert.strictEqual(version.keyword, 'pattern');
  assert.ok(version.code, 'enrichment ran: it carries a code');
  assert.ok(version.docUrl, 'and a docUrl');
  assert.ok(version.received !== undefined, 'and the received value');
  assert.ok(version.dataFrame && version.dataFrame.line > 0, 'and a source frame with a line');

  const deep = byPath['/sections/s0/entries/0/nested/retries'];
  assert.ok(deep, 'the deep error is present');
  assert.ok(deep.dataFrame.line > 1, 'framed on its own line');

  // Reading twice must not recompute into a different shape.
  assert.strictEqual(JSON.stringify(r.errors), JSON.stringify(errs), 'the errors are memoized');

  console.log('ok: reading the errors still gets enrichment, frames and codes');
}

// --- the lazy result behaves like a plain result -----------------------------
{
  const v = new Validator(SCHEMA);
  const r = v.validateJSON(RAW_BAD);

  assert.strictEqual(r.valid, false, '.valid reads without touching errors');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(r)),
    { valid: false, errors: JSON.parse(JSON.stringify(r.errors)) },
    'JSON.stringify of the result carries the errors',
  );
  assert.strictEqual(v.isValidJSON(RAW_BAD), false, 'isValidJSON agrees');
  assert.strictEqual(v.isValidJSON(RAW_GOOD), true);

  // A valid document has no errors array to speak of, same as before.
  const good = v.validateJSON(RAW_GOOD);
  assert.strictEqual(good.valid, true);
  assert.deepStrictEqual(good.errors, [], 'a valid result carries an empty errors array');

  console.log('ok: the lazy result behaves like a plain one');
}

// --- a syntax error is not a validation error --------------------------------
{
  const v = new Validator(SCHEMA);
  const r = v.validateJSON('{"version": ');
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.errors.length, 1, 'one error for a broken document');
  assert.ok(/syntax|invalid JSON/i.test(r.errors[0].keyword + ' ' + r.errors[0].message), `got ${JSON.stringify(r.errors[0])}`);

  console.log('ok: a syntax error still reports once');
}
