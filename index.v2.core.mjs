// The target the build plugin (@ata-project/unplugin) rewrites an import of
// the 2.0 browser entry to: the small Validator with no schema-decided group
// registered. The plugin adds Validator.use() of exactly the features
// featuresFor() (index.v2.features.mjs) names for the schemas it reads. Not a
// user entry: a schema that needs a group this module was not given is
// refused with "ata2: <feature>, Validator.use(<feature>)".
import small from './lib/validator-small.js';
export const Validator = small.Validator;
