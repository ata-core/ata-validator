'use strict';

// The package for runtimes that cannot run generated code: Cloudflare Workers
// (the `workerd` export condition) and Vercel Edge (`edge-light`) refuse
// `new Function`, so the code generator in the full package could only ever
// fail there and fall back. This entry leaves it out and answers through the
// interpreted engine, as the full package does in those runtimes: the same
// names, the same verdicts and errors, a bundle about half the size. Modules
// from `ata build` and Validator.bundle() load as they do in a browser bundle
// (lib/aot.browser.js); the emitters are not here, as they are not there.
const core = require('./lib/validator-core.js');
core._registerAot(() => require('./lib/aot.browser.js'));

module.exports = require('./lib/public-api.js');
