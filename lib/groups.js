'use strict';

// What the engines of the 2.0 Validator read of the schema-decided groups:
// the format checks, enum and const equality, the uniqueItems duplicate
// search and the anyOf/oneOf collapse, as the plugin's core
// (lib/validator-small.js) sets them from the groups registered there, read
// where a node is built, never per call. The full entries' engine
// (lib/engine-full.js) reads the modules themselves and not this file. A group the
// core was not given is refused where a node needs it.
//
//   formats        the built-in format checks but the URI ones
//   uri            uri, uri-reference, iri, iri-reference
//   draft7         the draft-07, draft-06, draft-04 and 2019-09 rewrites, and
//                  assertFormat: false
//   defaults       filling in `default`
//   uniqueItems    the duplicate search
//   branchCollapse the error a failed anyOf or oneOf reports
const G = { table: {}, eq: null, dup: null, distinct: null, collapse: null };
const refuse = (name) => { throw new Error('ata2: ' + name + ', Validator.use(' + name + ')'); };
// The built-in check for a format name, or null (an unknown format is an
// annotation). The core's table holds a refusal for each built-in name whose
// group it was not given.
const builtinFormat = (name) => { const f = G.table[name]; return typeof f === 'function' && Object.hasOwn(G.table, name) ? f : null; };
module.exports = { G, refuse, builtinFormat };
