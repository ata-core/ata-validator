'use strict';

// The interpreted engine with its plan compiler. The engine itself is
// lib/interpreter-core.js; this file adds the closure-tree compiler that makes
// it fast, and is what everything except the shared error runtime loads.
const core = require('./interpreter-core');

core._setPlanCompiler(require('./plan-compiler').install);

module.exports = core;
