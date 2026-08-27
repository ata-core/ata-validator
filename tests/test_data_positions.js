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

// Key spans: an object member records where its key token sits, so an error
// naming a property can point at the property instead of at its container.
{
  const text = '{\n  "alpha": 1,\n  "beta": [10, 20]\n}';
  const map = buildDataPositionMap(text);

  assert.strictEqual(map['/alpha'].keyLine, 2, 'alpha key on line 2');
  assert.strictEqual(map['/alpha'].keyCol, 3, 'alpha key starts at col 3');
  assert.strictEqual(map['/alpha'].keyLength, 7, 'alpha key token is 7 chars including quotes');
  assert.strictEqual(text.slice(map['/alpha'].keyOffset, map['/alpha'].keyOffset + map['/alpha'].keyLength), '"alpha"');

  assert.strictEqual(map['/beta'].keyLine, 3, 'beta key on line 3');
  assert.strictEqual(text.slice(map['/beta'].keyOffset, map['/beta'].keyOffset + map['/beta'].keyLength), '"beta"');

  // Array elements have no key of their own.
  assert.strictEqual(map['/beta/0'].keyOffset, undefined, 'array element has no key span');
  // Neither does the root.
  assert.strictEqual(map[''].keyOffset, undefined, 'root has no key span');

  console.log('ok: key spans recorded for object members');
}
