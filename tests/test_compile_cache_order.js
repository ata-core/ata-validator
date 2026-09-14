'use strict';

// A schema must compile to the same engine whichever entry point touches it
// first. `isValidObject()` has a fast path that compiles the verdict function
// alone and seeds the shared compile cache with it; the error and combined
// functions are left null there because they have not been built yet. Reading
// a null as "this schema was declined" costs the error path its generated
// function for the life of the process, and every real server hits that order,
// because most documents are valid.
//
// The two orders run in separate processes. The compile cache is keyed on the
// schema string, so two validators in one process share an entry and the
// second would inherit whatever the first built.

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const CASES = {
  // The shape that first showed the cliff: enum and format beside plain
  // numeric and string bounds.
  builder: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1, maxLength: 64 },
        email: { type: 'string', format: 'email' },
        role: { enum: ['admin', 'user'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'name', 'email', 'role'],
    },
    valid: { id: 1, name: 'a', email: 'a@b.co', role: 'admin' },
    invalid: { id: 0, name: '', email: 'nope', role: 'root' },
  },
  refs: {
    schema: {
      type: 'object',
      $defs: { pos: { type: 'integer', minimum: 0 } },
      properties: { a: { $ref: '#/$defs/pos' }, b: { $ref: '#/$defs/pos' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    valid: { a: 1, b: 2 },
    invalid: { a: -1, b: -2, c: 3 },
  },
  nested: {
    schema: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: { type: 'object', properties: { n: { type: 'number', maximum: 10 } }, required: ['n'] },
        },
      },
      required: ['rows'],
    },
    valid: { rows: [{ n: 1 }, { n: 2 }] },
    invalid: { rows: [{ n: 99 }, {}] },
  },
};

if (process.argv[2] === 'child') {
  const { Validator } = require('..');
  const c = CASES[process.argv[3]];
  const v = new Validator(c.schema);
  if (process.argv[4] === 'accept-first') v.isValidObject(c.valid);
  const r = v.validate(c.invalid);
  process.stdout.write(JSON.stringify({ engine: v.engine(), valid: r.valid, errors: r.errors }));
  process.exit(0);
}

function run (name, order) {
  const res = spawnSync(process.execPath, [__filename, 'child', name, order], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  assert.strictEqual(res.status, 0, `child ${name}/${order} exited ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

let checked = 0;
for (const name of Object.keys(CASES)) {
  const first = run(name, 'errors-first');
  const warmed = run(name, 'accept-first');

  assert.strictEqual(
    warmed.engine, first.engine,
    `${name}: engine() is "${warmed.engine}" when a valid document was validated first and "${first.engine}" when it was not. ` +
    'The verdict-only compile seeded the cache with null error and combined functions and the full compile read them as declined.');
  assert.strictEqual(first.engine, 'codegen', `${name}: expected this schema to compile, got "${first.engine}"`);
  assert.deepStrictEqual(warmed.errors, first.errors, `${name}: the errors differ between the two orders`);
  assert.strictEqual(warmed.valid, false);
  checked++;
}

console.log(`ok: ${checked} schemas compile to the same engine whichever entry point runs first`);
