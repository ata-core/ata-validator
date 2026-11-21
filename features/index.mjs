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
  errorMessage: {}, verbose: {}, richErrors: {}, codegen: {}, formats: {}, uri: {}, uniqueItems: {}, branchCollapse: {},
};

// The features a Validator built from `schema` with `options`, and given
// `schemas` through addSchema(), needs registered. Asked by the same code
// that refuses a schema at run time (lib/validator-small.js), so a
// Validator with exactly these features takes the schema, and one without
// any of them refuses it. Throws where any Validator would refuse the schema
// for another reason.
export function featuresFor (schema, options, schemas) {
  const got = new Set();
  small._probe({ all: ALL, got });
  try {
    const v = new small.Validator(schema, options);
    if (schemas) for (const s of schemas) v.addSchema(s);
    v._build();
  } finally { small._probe(null); }
  return smaller([...got]);
}

// The formats a schema needs, as the per-name features or as the formats and
// uri groups, whichever adds fewer bytes to a page (format-sizes.mjs, measured
// by scripts/gen-format-sizes.js). Either registers every check the schema
// reads; a page that registers both carries the checks twice, so a caller
// joining the answers for several schemas keeps the groups and drops the
// per-name features they hold.
const URI = new Set(['uri', 'uri-reference', 'iri', 'iri-reference'].map(groups.featureOf));
function smaller (names) {
  const fm = names.filter((n) => Object.hasOwn(OWN, n));
  if (fm.length === 0) return names;
  const parts = new Set();
  let one = 0;
  for (const n of fm) { one += OWN[n]; for (const p of PARTS[n]) parts.add(p); }
  for (const p of parts) one += PART[p];
  one -= SHARE * (fm.length + parts.size - 1);
  const u = fm.some((n) => URI.has(n)), f = fm.some((n) => !URI.has(n));
  const g = u && f ? ['formats', 'uri'] : u ? ['uri'] : ['formats'];
  if (GROUP[u && f ? 'both' : u ? 'uri' : 'formats'] >= one) return names;
  return names.filter((n) => !Object.hasOwn(OWN, n)).concat(g);
}
