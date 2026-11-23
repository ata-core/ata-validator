// ata-validator/features: featuresFor(), the features a schema needs on the
// 2.0 Validator, by the names ata-validator/features/<name> exports them
// under. It carries the two features its answer depends on (draft7, which
// rewrites a schema before the other questions are asked of it, and the
// meta-schemas a schema can reference) and none of the others. Work in
// progress; not in the published package until 2.0.
import small from '../lib/validator-small.js';
import d7 from '../lib/features/draft7.js';
import ms from '../lib/features/metaschemas.js';
import groups from '../lib/groups.js';
import { OWN, PART, PARTS, GROUP, SHARE } from './format-sizes.mjs';

// What _build is handed for each feature a question asks for. It stops
// before it builds the engine, so a feature whose code only runs after that
// is a stand-in: the passes it builds and the functions it hands over are
// not called.
const NONE = () => null;
const ALL = {
  draft7: d7.draft7, metaschemas: ms.metaschemas,
  defaults: { buildDefaultsApplier: NONE }, coerceTypes: { build: NONE }, removeAdditional: { build: NONE },
  errorMessage: {}, verbose: {}, richErrors: {}, codegen: {}, formats: {}, uri: {}, uniqueItems: {}, branchCollapse: {}, patterns: {},
  patternFallback: { attach: NONE },
};

// The features a Validator built from `schema` with `options`, and given
// `schemas` through addSchema(), needs registered. Asked by the same code
// that refuses a schema at run time (lib/validator-small.js), so a
// Validator with exactly these features takes the schema, and one without
// any of them refuses it. Throws where any Validator would refuse the schema
// for another reason. It never names standardSchema (`~standard`): no schema
// says whether its validator reaches a Standard Schema consumer, so the
// caller that hands it to one (the build plugin, from its reading of the
// code) registers standardSchema itself.
export function featuresFor (schema, options, schemas) {
  const got = new Set();
  small._probe({ all: ALL, got });
  try {
    const v = new small.Validator(schema, options);
    if (schemas) for (const s of schemas) v.addSchema(s);
    v._build();
  } finally { small._probe(null); }
  return joinFeatures([...got]);
}

// The smallest list of features that covers every check the given lists
// register, for a page with several validators: featuresFor() of each joined.
// A group in any list stays (it registers every check it holds, and which of
// them its schema read is not known here), and the per-name features it holds
// go. Each family of formats without its group present is then decided
// again for the joined set: its names one by one, or its group, whichever
// adds fewer bytes by format-sizes.mjs (measured by scripts/gen-format-sizes.js).
// featuresFor() answers through it, so for one schema
// joinFeatures(featuresFor(s)) is featuresFor(s).
const URI = new Set(['uri', 'uri-reference', 'iri', 'iri-reference'].map(groups.featureOf));
const ORDER = groups.NAMES.map(groups.featureOf);
export function joinFeatures (...sets) {
  const rest = []; const fm = new Set(); const forced = new Set();
  for (const set of sets) {
    for (const n of set) {
      if (Object.hasOwn(OWN, n)) fm.add(n);
      else if (n === 'formats' || n === 'uri') forced.add(n);
      else if (!rest.includes(n)) rest.push(n);
    }
  }
  const fam = { formats: [], uri: [] };
  for (const n of ORDER) if (fm.has(n)) fam[URI.has(n) ? 'uri' : 'formats'].push(n);
  // Every choice of group or names per family, the families a present group
  // fixes left fixed; ties go to the names.
  let best = null;
  for (const gf of forced.has('formats') ? [true] : fam.formats.length ? [false, true] : [false]) {
    for (const gu of forced.has('uri') ? [true] : fam.uri.length ? [false, true] : [false]) {
      const one = (gf ? [] : fam.formats).concat(gu ? [] : fam.uri);
      const parts = new Set(); let n = 0;
      for (const f of one) { n += OWN[f]; for (const p of PARTS[f]) parts.add(p); }
      for (const p of parts) n += PART[p];
      if (one.length) n -= SHARE * (one.length + parts.size - 1);
      n += gf && gu ? GROUP.both : gf ? GROUP.formats : gu ? GROUP.uri : 0;
      const pick = (gf ? ['formats'] : []).concat(gu ? ['uri'] : [], one);
      if (best === null || n < best[0]) best = [n, pick];
    }
  }
  return rest.concat(best[1]);
}
