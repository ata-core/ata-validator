'use strict';
// lib/validator-full.js and lib/engine-full.js are lib/validator-small.js and
// lib/engine-small.js with the groups wired in from their modules
// (scripts/gen-validator-full.js), for the full 2.0 entries; they must not
// drift. And loading the plugin's core beside a full entry leaves the full
// entry's groups in place.
const assert = require('assert');
const fs = require('fs');
const { render, file, renderEngine, engineFile } = require('../scripts/gen-validator-full.js');
assert.strictEqual(fs.readFileSync(file, 'utf8'), render(), 'lib/validator-full.js differs from lib/validator-small.js; run node scripts/gen-validator-full.js');
assert.strictEqual(fs.readFileSync(engineFile, 'utf8'), renderEngine(), 'lib/engine-full.js differs from lib/engine-small.js; run node scripts/gen-validator-full.js');
const full = require('../lib/validator-full.js').Validator;
const core = require('../lib/validator-small.js').Validator;
const s = { type: 'array', items: { type: 'string', format: 'date' }, uniqueItems: true, anyOf: [{ minItems: 1 }] };
assert.deepStrictEqual(new full(s).validate(['2020-01-01', '2020-01-01']).errors.map((e) => e.keyword), ['uniqueItems'], 'the full entry keeps its groups');
assert.strictEqual(new full(s).validate(['x']).errors[0].keyword, 'format');
assert.strictEqual(new full(s).validate([]).errors[0].keyword, 'anyOf');
assert.strictEqual(new full({ $schema: 'http://json-schema.org/draft-07/schema#', items: [{ type: 'string' }] }).validate([1]).valid, false, 'draft-07 rewritten');
assert.deepStrictEqual(new full({ properties: { a: { default: 1 } } }).validate({}), { valid: true, data: { a: 1 }, errors: [] }, 'defaults filled');
assert.throws(() => new core(s).validate([]), /^Error: ata2: /, 'the core still refuses what it was not given');
console.log('ok: lib/validator-full.js matches lib/validator-small.js, and the full entry keeps its groups beside the core');
