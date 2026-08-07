'use strict';

// The package version, exported as a plain string so neither the default nor
// the browser entry has to `require('./package.json')`. Bundling package.json
// would drag dependency strings into browser builds even though the runtime
// never touches them.
//
// Kept in lockstep with package.json by `tests/test_version_sync.js`.

module.exports = '1.5.1';
