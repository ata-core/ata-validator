'use strict';

// Loaded first by index.aot.js and index.aot.mjs, the entries Bun resolves
// through the `"aot"` export condition when it compiles a program ahead of
// time: every Validator made after this takes the interpreted engine by
// default (see aotHost in lib/validator-core.js).
require('./validator-core')._markAotHost();
