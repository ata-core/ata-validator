'use strict';
// The linear-time pattern engine (lib/safe-regex.js), for the 2.0 Validator:
// Validator.use(patterns). A `pattern` or patternProperties name that the
// platform RegExp runs in linear time (plainLinear, lib/interpreter-core.js)
// or that uses a Unicode property escape runs on the RegExp without it; any
// other needs it, and a schema with one is refused without it, never matched
// on a RegExp that can backtrack.
module.exports = { patterns: Object.freeze({ name: 'patterns', compileSafe: require('../safe-regex').compileSafe }) };
