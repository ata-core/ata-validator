// ata-validator/features: featuresFor(), the features a schema needs on the
// 2.0 Validator, by the names ata-validator/features/<name> exports them
// under. It carries the two features its answer depends on (draft7, which
// rewrites a schema before the other questions are asked of it, and the
// meta-schemas a schema can reference) and none of the others. Work in
// progress; not in the published package until 2.0.
import small from '../lib/validator-small.js';
import d7 from '../lib/features/draft7.js';
import ms from '../lib/features/metaschemas.js';

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
  return [...got];
}
