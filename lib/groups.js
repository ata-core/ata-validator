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
//   format<Name>   the check of one format name (formatDateTime for
//                  date-time), registered as part of formats or uri
//   draft7         the draft-07, draft-06, draft-04 and 2019-09 rewrites, and
//                  assertFormat: false
//   defaults       filling in `default`
//   uniqueItems    the duplicate search
//   branchCollapse the error a failed anyOf or oneOf reports
//   patterns       the linear pattern engine (lib/safe-regex.js), for a pattern
//                  the platform RegExp does not take (lib/engine-shared-core.js)
const G = { table: {}, eq: null, dup: null, distinct: null, collapse: null, safe: null };
const refuse = (name) => { throw new Error('ata2: ' + name + ', Validator.use(' + name + ')'); };
// Every built-in format name. Each is checked by a feature of its own named
// from it (formatDateTime for date-time: ata-validator/features/formatDateTime,
// lib/features/formatDateTime.js); the formats and uri features hold several.
const NAMES = 'email date date-time time duration uuid ipv4 ipv6 hostname regex json-pointer relative-json-pointer uri-template idn-email idn-hostname uri uri-reference iri iri-reference'.split(' ');
const featureOf = (name) => ('format-' + name).replace(/-./g, (m) => m[1].toUpperCase());
// The check registered for a format name (G.table holds those of every
// feature the core was given), or null for a name no feature checks (an
// unknown format is an annotation). A built-in name whose check was not
// registered is refused where the node is built, naming its feature.
const builtinFormat = (name) => { const f = G.table[name]; return typeof f === 'function' && Object.hasOwn(G.table, name) ? f : NAMES.includes(name) ? refuse(featureOf(name)) : null; };
module.exports = { G, refuse, builtinFormat, NAMES, featureOf };
