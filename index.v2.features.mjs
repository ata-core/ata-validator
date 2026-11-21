// 2.0 features a page registers with Validator.use(), work in progress (feat/v2-entry).
import em from './lib/features/error-messages.js';
import ms from './lib/features/metaschemas.js';
export const errorMessages = em.errorMessages;
export const metaschemas = ms.metaschemas;
import mu from './lib/features/mutators.js';
export const coerceTypes = mu.coerceTypes;
export const removeAdditional = mu.removeAdditional;
import cg from './lib/features/codegen.js';
export const codegen = cg.codegen;
import re from './lib/features/rich-errors.js';
export const richErrors = re.richErrors;
import vb from './lib/features/verbose.js';
export const verbose = vb.verbose;
// The schema-decided groups (lib/groups.js), which the full entries register.
import fo from './lib/features/formats.js';
import ur from './lib/features/uri.js';
import d7 from './lib/features/draft7.js';
import df from './lib/features/defaults.js';
import uq from './lib/features/unique-items.js';
import bc from './lib/features/branch-collapse.js';
export const formats = fo.formats;
export const uri = ur.uri;
export const draft7 = d7.draft7;
export const defaults = df.defaults;
export const uniqueItems = uq.uniqueItems;
export const branchCollapse = bc.branchCollapse;
import small from './lib/validator-small.js';
// Every feature by the name the Validator registers it under.
const ALL = { errorMessage: em.errorMessages, metaschemas: ms.metaschemas, coerceTypes: mu.coerceTypes, removeAdditional: mu.removeAdditional, codegen: cg.codegen, richErrors: re.richErrors, verbose: vb.verbose, formats: fo.formats, uri: ur.uri, draft7: d7.draft7, defaults: df.defaults, uniqueItems: uq.uniqueItems, branchCollapse: bc.branchCollapse };
// The features a Validator built from `schema` with `options`, and given
// `schemas` through addSchema(), needs registered: the names of this
// module's exports, for the build plugin to import from it beside
// index.v2.core.mjs. Asked by the same code that refuses a schema at run
// time, so a Validator with exactly these features takes the schema, and one
// without any of them refuses it. Throws where any Validator would refuse
// the schema for another reason.
// _build runs with every feature handed to each question that says yes, and
// stops before it builds the engine.
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
