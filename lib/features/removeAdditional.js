'use strict';
// removeAdditional for the 2.0 Validator: Validator.use(removeAdditional).
// Keys are matched against patternProperties with the 2.0 engine's pattern
// compile (lib/engine-shared-core.js, the interpreted engine's code). The
// feature registers on the full entries too, which have no patterns feature
// to register, so it carries the linear pattern engine (lib/safe-regex.js)
// itself: a page that removes keys carries it as before.
const { buildRemover } = require('../mutators');
const { compilePattern } = require('../engine-shared-core');
const safe = require('../safe-regex');
module.exports = { removeAdditional: Object.freeze({ name: 'removeAdditional', build: (schema) => buildRemover(schema, (src) => compilePattern(src, safe)) }) };
