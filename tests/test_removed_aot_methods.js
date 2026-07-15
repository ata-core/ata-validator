'use strict';

// Removed in 1.0 (deprecated in 0.22): the instance AOT methods are gone.
// The build entry and Validator statics are the supported surface.

const assert = require('assert');
const { Validator } = require('..');
const { toStandaloneModule } = require('../build.js');

const v = new Validator({ type: 'object', properties: { name: { type: 'string' } } });

assert.strictEqual(typeof v.toStandalone, 'undefined', 'toStandalone removed in 1.0');
assert.strictEqual(typeof v.toStandaloneModule, 'undefined', 'toStandaloneModule removed in 1.0');

const src = toStandaloneModule(v, { format: 'cjs' });
assert.ok(src && src.length > 0, 'build entry replacement works');

console.log('test_removed_aot_methods: ok');
