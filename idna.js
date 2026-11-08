'use strict';

// IDNA2008 for the `hostname` and `idn-hostname` formats in a browser or edge
// bundle, which leaves them out by default (lib/idna.browser.js): import this
// before building validators. Node, Bun and Deno have them without it.
const { __ataIdna } = require('./lib/idna-impl.js');

globalThis[Symbol.for('ata-validator.idna')] = __ataIdna;
