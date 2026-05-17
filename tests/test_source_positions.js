'use strict';

const assert = require('assert');
const { buildPositionMap } = require('../lib/source-positions');

const schema = `{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 2 },
    "email": { "type": "string", "format": "email" }
  },
  "required": ["name", "email"]
}
`;

const map = buildPositionMap(schema);

// Root
assert.strictEqual(map[''].line, 1);
assert.strictEqual(map[''].col, 1);

// /type at line 2
assert.strictEqual(map['/type'].line, 2);

// /properties/name at line 4
assert.strictEqual(map['/properties/name'].line, 4);

// /properties/name/minLength at line 4
assert.strictEqual(map['/properties/name/minLength'].line, 4);

// /properties/email/format key position
assert.ok(map['/properties/email/format#key']);
assert.strictEqual(map['/properties/email/format#key'].line, 5);

// /required at line 7
assert.strictEqual(map['/required'].line, 7);

// /required/0 at line 7
assert.strictEqual(map['/required/0'].line, 7);

console.log('ok: source-positions unit tests');
