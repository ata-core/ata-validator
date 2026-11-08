'use strict';

// IDNA2008 for the `hostname` and `idn-hostname` formats (lib/idna-impl.js).
// A file of its own so a browser or edge bundle can leave the checks out
// (package.json `browser`, lib/idna.browser.js) and take them back with
// `import 'ata-validator/idna'`, which loads lib/idna-impl.js by its own name.
module.exports = require('./idna-impl');
