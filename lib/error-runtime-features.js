'use strict';

// The parts of the shared error runtime a set of schemas needs, and the
// table of error codes it carries. Pure functions over schemas, kept apart
// from lib/error-runtime.js, which reads the library's files with fs, so a
// browser bundle can use these without it (see lib/error-runtime.browser.js).

// The parts a build can leave out when none of its schemas needs them. The
// decision is made on the schemas the runtime walks (as embedded, see
// runtimeFeatures) and errs toward keeping a part: a key with that name
// anywhere, even inside an enum value, keeps it. A part left out is replaced
// by a stub that throws, which a schema without that keyword cannot reach.
const OPTIONAL = {
  formats: { keys: ['format'], stub: 'module.exports = {};' },
  'safe-regex': { keys: ['pattern', 'patternProperties'], stub: "module.exports = { compileSafe() { throw new Error('ata error runtime: built without the pattern engine'); } };" },
  defaults: { keys: ['default'], stub: "module.exports = { buildDefaultsApplier() { throw new Error('ata error runtime: built without the defaults pass'); } };" },
  // IDNA2008 (lib/idna.js, lib/idna-impl.js), which only a `hostname` with a
  // reserved label and an `idn-hostname` reach (lib/formats.js): kept where
  // one of those names is a string value anywhere in a schema, wherever it
  // sits. With every format it was 3.4 KB gzipped of a runtime whose schemas
  // had an email and a date.
  idna: { values: ['hostname', 'idn-hostname', 'idn-email'], stub: "module.exports = { __ataIdna() { throw new Error('ata error runtime: built without IDNA'); } };" },
  'unique-items': { keys: ['uniqueItems', 'enum', 'const'], stub: "function no() { throw new Error('ata error runtime: built without deep equality'); }\nmodule.exports = { allDistinct: no, duplicatePair: no, _deq: no };" },
};

// Which optional parts these schemas need: { formats, 'safe-regex',
// 'unique-items', ... } as booleans. A part is named by keys or, for idna,
// by string values.
function runtimeFeatures(schemas) {
  const keys = new Set();
  const values = new Set();
  const seen = new Set();
  const walk = (n) => {
    if (n === null || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) { if (typeof x === 'string') values.add(x); else walk(x); } return; }
    for (const k of Object.keys(n)) { keys.add(k); if (typeof n[k] === 'string') values.add(n[k]); else walk(n[k]); }
  };
  for (const s of schemas) walk(s);
  const out = {};
  for (const [part, { keys: ks, values: vs }] of Object.entries(OPTIONAL)) out[part] = ks !== undefined ? ks.some((k) => keys.has(k)) : vs.some((v) => values.has(v));
  return out;
}

function codeTable() {
  const { byKw, byFmt } = require('./error-code-of');
  return { byKw, byFmt };
}

module.exports = { OPTIONAL, runtimeFeatures, codeTable };
