'use strict';

const assert = require('assert');
const { buildDataPositionMap } = require('../lib/data-positions');

const input = '{ "name": "M", "email": "not-an-email", "age": -3 }';
const map = buildDataPositionMap(input);

assert.strictEqual(map[''].byteOffset, 0);
assert.strictEqual(map['/name'].byteOffset, input.indexOf('"M"'));
assert.strictEqual(map['/name'].length, 3); // "M"
assert.strictEqual(map['/email'].byteOffset, input.indexOf('"not-an-email"'));
assert.strictEqual(map['/email'].length, '"not-an-email"'.length);
assert.strictEqual(map['/age'].byteOffset, input.indexOf('-3'));
assert.strictEqual(map['/age'].length, 2);

// Multi-line input
const multi = '{\n  "x": 1,\n  "y": [10, 20, 30]\n}\n';
const m2 = buildDataPositionMap(multi);
assert.strictEqual(m2['/y/1'].line, 3);
assert.strictEqual(m2['/y/1'].text, '  "y": [10, 20, 30]');

// Buffer input
const buf = Buffer.from(input, 'utf8');
const m3 = buildDataPositionMap(buf);
assert.strictEqual(m3['/email'].byteOffset, map['/email'].byteOffset);

console.log('ok: data-positions unit tests');
