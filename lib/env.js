'use strict'

// The one place the package reads an environment variable. Everything the
// package honours is listed here: the diagnostic switches the generators
// read, the engine override, and NODE_ENV for the CLI's source-map default.
// Read at the call, not at load, so a test or a host that sets one after
// requiring the package is still heard; absent `process` (a browser) every
// read is undefined.
function env (name) {
  return typeof process !== 'undefined' && process.env ? process.env[name] : undefined
}

module.exports = { env }
