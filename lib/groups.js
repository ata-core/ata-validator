'use strict';

// The schema-decided groups of the 2.0 Validator (lib/validator-small.js):
// code a page carries only for a schema that needs it, registered with
// Validator.use(). This file is what the core knows of them without their
// code: the names they answer to, the questions that say whether a schema
// needs one, and the pieces the engines read from those registered.
//
//   formats        the built-in format checks but the URI ones (lib/formats-core.js)
//   uri            uri, uri-reference, iri, iri-reference (lib/uri-checks.js)
//   draft7         the draft-07, draft-06, draft-04 and 2019-09 rewrites, and
//                  assertFormat: false (lib/draft7.js)
//   defaults       filling in `default` (lib/defaults.js)
//   uniqueItems    the duplicate search (lib/unique-dup.js)
//   branchCollapse the error a failed anyOf or oneOf reports (lib/branch-collapse.js)
//
// The engines refuse a node that needs a group not registered where they
// build it (builtinFormat, refuse). The questions asked before that, of the
// schema's text, are lib/gates.js, which only the plugin's core carries.

const URI_FORMATS = new Set('uri uri-reference iri iri-reference'.split(' '));
const FORMATS = new Set('email date date-time time duration uuid ipv4 ipv6 hostname regex json-pointer relative-json-pointer uri-template idn-email idn-hostname'.split(' '));

// What the engines read of the registered groups, set when one is registered
// (lib/validator-small.js) and read where a node is built, never per call.
// `table` holds the checks of the format groups registered.
const G = { table: {}, dup: null, distinct: null, collapse: null };

const refuse = (name) => { throw new Error('ata2: ' + name + ', Validator.use(' + name + ')'); };

// The group a format name needs, or null for a name no group checks (an
// unknown format, an annotation).
const formatGroup = (name) => URI_FORMATS.has(name) ? 'uri' : FORMATS.has(name) ? 'formats' : null;

// The check for a built-in format the engines build, from the table, or the
// refusal naming the group it needs.
function builtinFormat (name) {
  const fn = G.table[name];
  if (typeof fn === 'function' && Object.hasOwn(G.table, name)) return fn;
  const g = formatGroup(name);
  return g === null ? null : refuse(g);
}

module.exports = { G, refuse, formatGroup, builtinFormat, FORMATS, URI_FORMATS };
