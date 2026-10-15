'use strict';

// Where tsc is. TypeScript up to 6 ships `lib/tsc.js` and exports it;
// TypeScript 7 exports only its `bin/tsc`, a Node script, so a test that
// resolved `typescript/lib/tsc.js` stopped at ERR_PACKAGE_PATH_NOT_EXPORTED.
// Either file runs under process.execPath.
const path = require('path');

let TSC_JS;
try {
  TSC_JS = require.resolve('typescript/lib/tsc.js');
} catch {
  const pkgPath = require.resolve('typescript/package.json');
  const bin = require(pkgPath).bin;
  TSC_JS = path.join(path.dirname(pkgPath), typeof bin === 'string' ? bin : bin.tsc);
}

module.exports = { TSC_JS };
