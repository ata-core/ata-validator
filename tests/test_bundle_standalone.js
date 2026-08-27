'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { Validator } = require('..');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function loadBundle(src) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-bundle-')), 'bundle.js');
  fs.writeFileSync(file, src);
  delete require.cache[file];
  return require(file);
}

console.log('\nata bundleStandalone tests\n');

const cases = [
  ['bundleStandalone: the error path sees the schema the validator compiled', () => {
    // The boolean function comes from the validator, which compiles a prepared
    // schema. The error function used to be compiled from the caller's
    // original, so anything that prepared the schema applied to one path and
    // not the other. With assertFormat: false the bundle reported a `format`
    // error the caller had turned off, and only when some other keyword failed
    // first, which is what made it quiet.
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { e: { type: 'string', format: 'email' } },
      required: ['e'],
    };
    const opts = { assertFormat: false };
    const instance = { e: 'not-an-email', extra: 1 };

    const expected = new Validator(schema, opts).validate(instance)
      .errors.map((e) => e.keyword).sort();

    for (const build of ['bundleStandalone', 'bundleCompact']) {
      const validators = loadBundle(Validator[build]([schema], opts));
      const got = validators[0](instance).errors.map((e) => e.keyword).sort();
      assert(
        JSON.stringify(got) === JSON.stringify(expected),
        `${build} reported ${JSON.stringify(got)}, runtime reported ${JSON.stringify(expected)}`,
      );
    }
  }],
  ['bundleStandalone: hoisted anyOf branch helpers are emitted', () => {
    // Issue #24: bundle output referenced `_af1_b0` without its definition
    // because the codegen preamble (where hoisted anyOf/oneOf branch fns
    // live) was being dropped from the bundle, only format closures kept.
    const schemas = [
      { type: 'string', enum: ['a'], $id: 'v2', $schema: 'http://json-schema.org/draft-07/schema' },
      {
        type: 'object',
        properties: { kind: { $ref: 'v2#' } },
        required: ['kind'],
        additionalProperties: false,
        $id: 'v1',
        $schema: 'http://json-schema.org/draft-07/schema',
      },
      {
        allOf: [
          { type: 'object', properties: { kind: { $ref: 'v2#' } }, additionalProperties: false },
          { anyOf: [{ required: ['kind'] }] },
        ],
        $id: 'v1ag',
        $schema: 'http://json-schema.org/draft-07/schema',
      },
      {
        oneOf: [{ $ref: 'v1#' }],
        $id: 'v0',
        $schema: 'http://json-schema.org/draft-07/schema',
      },
    ];

    const src = Validator.bundleStandalone(schemas);
    const validators = loadBundle(src);

    assert(validators[2]({ kind: 'a' }).valid === true, 'v1ag should accept {kind:"a"}');
    assert(validators[2]({}).valid === false, 'v1ag should reject {} (anyOf branch)');
    assert(validators[2]({ kind: 'b' }).valid === false, 'v1ag should reject {kind:"b"}');
    assert(validators[0]('a').valid === true, 'v2 should accept "a"');
    assert(validators[0]('b').valid === false, 'v2 should reject "b"');
    assert(validators[3]({ kind: 'a' }).valid === true, 'v0 oneOf should accept {kind:"a"}');
    assert(validators[3]({ kind: 'b' }).valid === false, 'v0 oneOf should reject {kind:"b"}');
  }],

  ['bundleStandalone: verbose mode keeps hoisted helpers too', () => {
    const schemas = [
      {
        anyOf: [{ type: 'string' }, { type: 'number' }],
        $id: 'sv',
        $schema: 'http://json-schema.org/draft-07/schema',
      },
    ];
    const src = Validator.bundleStandalone(schemas, { verbose: true });
    const validators = loadBundle(src);
    assert(validators[0]('x').valid === true, 'verbose bundle should accept string');
    assert(validators[0](1).valid === true, 'verbose bundle should accept number');
    const fail = validators[0](true);
    assert(fail.valid === false, 'verbose bundle should reject boolean');
  }],
];

for (const [name, fn] of cases) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
