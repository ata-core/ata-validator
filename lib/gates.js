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

const { NAMES, featureOf } = require('./groups');
const { onPlatform } = require('./engine-shared-core');

const FORMAT_RE = /"format":("(?:[^"\\]|\\.)*")/g;
const has = Object.hasOwn;

// The features the JSON text of a schema the engine reads says it needs,
// added to `out`. `user` is the formats option: a format it supplies needs no
// feature. `got` holds the checks registered, or is false where every name
// is asked for (featuresFor()). `doc` is the schema the text is of, where
// the patterns feature is to be asked for (needsLinear), or false.
function textNeeds (text, user, out, got, doc) {
  if (text.includes('"format":"')) {
    FORMAT_RE.lastIndex = 0;
    for (let m; (m = FORMAT_RE.exec(text)) !== null;) {
      const name = JSON.parse(m[1]);
      if (!NAMES.includes(name) || (user !== null && has(user, name) && typeof user[name] === 'function') || (got && got[name])) continue;
      out.add(featureOf(name));
    }
  }
  if (text.includes('"uniqueItems":true')) out.add('uniqueItems');
  if (text.includes('"anyOf":[') || text.includes('"oneOf":[')) out.add('branchCollapse');
  if (doc && text.includes('"pattern') && needsLinear(doc)) out.add('patterns');
  return out;
}

// Whether a schema has a `pattern`, or a patternProperties name, that the
// platform RegExp does not take. onPlatform is the test compilePattern itself
// makes (lib/engine-shared-core.js), so a pattern this passes runs on the
// RegExp and one it names finds the linear engine registered. Every object in
// the schema is read, not the keywords' places only: a reference can make any
// of them a schema. A `pattern` in a value (`const`, `default`) answers yes
// where nothing needs the engine, which costs a page an import, never an
// answer. One the text does not show (not enumerable) is refused where the
// engine compiles it. The schema's JSON text has just been written, so it
// holds no cycle, and the walk recurses over own keys with no set of nodes
// seen and no list of values per node: on pi's nine benchmark schemas those
// cost a cold first build about 0.6 ms.
function needsLinear (n) {
  if (!n || typeof n !== 'object') return false;
  const pp = n.patternProperties;
  if ((typeof n.pattern === 'string' && !onPlatform(n.pattern)) || (pp && typeof pp === 'object' && Object.keys(pp).some((k) => !onPlatform(k)))) return true;
  for (const k in n) if (has(n, k) && needsLinear(n[k])) return true;
  return false;
}

// The text of a registered document, read once per document object.
const texts = new WeakMap();
function docText (doc) {
  if (doc === null || typeof doc !== 'object') return '';
  let t = texts.get(doc);
  if (t === undefined) texts.set(doc, (t = JSON.stringify(doc) || ''));
  return t;
}

module.exports = { textNeeds, docText, NAMES, featureOf };
