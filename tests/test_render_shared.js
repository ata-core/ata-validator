'use strict';

const assert = require('assert');
const { pathToDotted, truncateLine } = require('../lib/render-shared');

// JSON pointer → dotted
assert.strictEqual(pathToDotted(''), 'body');
assert.strictEqual(pathToDotted('/'), 'body');
assert.strictEqual(pathToDotted('/email'), 'body.email');
assert.strictEqual(pathToDotted('/users/0/email'), 'body.users[0].email');
assert.strictEqual(pathToDotted('/items/3/~1path/value'), 'body.items[3]["/path"].value');
assert.strictEqual(pathToDotted('/has-dash'), 'body["has-dash"]');
assert.strictEqual(pathToDotted('/with space'), 'body["with space"]');
assert.strictEqual(pathToDotted('/~0tilde'), 'body["~tilde"]');

// Truncation
assert.strictEqual(truncateLine('short', 100), 'short');
assert.strictEqual(truncateLine('x'.repeat(50), 10), 'xxxxxxxxx…');

console.log('ok: render-shared unit tests');
