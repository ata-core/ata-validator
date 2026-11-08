'use strict';

// Browser and edge builds leave the IDNA2008 checks out (2.7 KB gzipped): a
// hostname is held to the letters-digits-hyphens rule alone and an
// `idn-hostname` is not checked, as before 1.64.0, unless the page imports
// `ata-validator/idna`, which registers lib/idna-impl.js here. The code
// generator writes this function's source into the code it builds in the
// page, so it finds the registration the same way.
function __ataIdna () {
  const real = globalThis[Symbol.for('ata-validator.idna')];
  return typeof real === 'function' ? real() : { hostnameLabels: () => true, idnHostname: () => true };
}

module.exports = { __ataIdna };
