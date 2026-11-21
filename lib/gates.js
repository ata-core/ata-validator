'use strict';

// The questions the plugin's core (lib/validator-small.js) asks of a schema before
// it builds the engine: which of the schema-decided groups (lib/groups.js) the
// engine will read, from the JSON text of the schema and of every registered
// document. featuresFor() (index.v2.features.mjs) asks the same. The full
// entries register every group and so never ask, and do not carry this file;
// without it a group missing is still refused, where the engine builds the
// node that needs it.
//
// A question may answer yes where the group turns out to have nothing to do,
// never no where it has: a schema refused for a group it would not have used
// costs an import, one validated without a group it needed is a silent
// acceptance. A schema whose JSON text does not show a keyword (one that is
// not enumerable) is caught where the engine builds it.

const { refuse } = require('./groups');

const URI_FORMATS = new Set('uri uri-reference iri iri-reference'.split(' '));
const FORMATS = new Set('email date date-time time duration uuid ipv4 ipv6 hostname regex json-pointer relative-json-pointer uri-template idn-email idn-hostname'.split(' '));
// The group a format name needs, or null for a name no group checks.
const formatGroup = (name) => URI_FORMATS.has(name) ? 'uri' : FORMATS.has(name) ? 'formats' : null;
// The core's format table before any group is registered: each built-in
// name refuses, naming its group, where a check is first called.
function stubTable () {
  const t = {};
  for (const n of URI_FORMATS) t[n] = () => refuse('uri');
  for (const n of FORMATS) t[n] = () => refuse('formats');
  return t;
}

const FORMAT_RE = /"format":("(?:[^"\\]|\\.)*")/g;
const has = Object.hasOwn;

// The groups the JSON text of a schema the engine reads says it needs, added
// to `out`. `user` is the formats option: a format it supplies needs no group.
function textNeeds (text, user, out) {
  if (text.includes('"format":"')) {
    FORMAT_RE.lastIndex = 0;
    for (let m; (m = FORMAT_RE.exec(text)) !== null;) {
      const name = JSON.parse(m[1]);
      if (user !== null && has(user, name) && typeof user[name] === 'function') continue;
      const g = formatGroup(name);
      if (g !== null) out.add(g);
    }
  }
  if (text.includes('"uniqueItems":true')) out.add('uniqueItems');
  if (text.includes('"anyOf":[') || text.includes('"oneOf":[')) out.add('branchCollapse');
  return out;
}

// The text of a registered document, read once per document object.
const texts = new WeakMap();
function docText (doc) {
  if (doc === null || typeof doc !== 'object') return '';
  let t = texts.get(doc);
  if (t === undefined) texts.set(doc, (t = JSON.stringify(doc) || ''));
  return t;
}

module.exports = { textNeeds, docText, formatGroup, stubTable, FORMATS, URI_FORMATS };
