'use strict';

// ata-validator under Bun's ahead-of-time compiler, where Bun resolves the
// `"aot"` export condition: the same package, with validators on the
// interpreted engine by default, which is compiled with the program, rather
// than on code made at run time, which is not (lib/aot-mark.js).
require('./lib/aot-mark.js');
module.exports = require('./index.js');
