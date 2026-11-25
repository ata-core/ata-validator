'use strict';
// Standard Schema V1 (`~standard`) for the plugin's 2.0 core:
// Validator.use(standardSchema). The full entries carry it built in. On the
// core without it, reading `~standard` throws "ata2: standardSchema,
// Validator.use(standardSchema)" rather than returning undefined.
// featuresFor() never names it: a schema does not say whether its validator
// is handed to a Standard Schema consumer (a form library, a router). The
// build plugin registers it where its own reading of the code finds one.
const { standardSchemaFor } = require('../standard-schema');
const raw = (self) => self._rawSchema;
const run = (self, value) => self.validate(value);
module.exports = { standardSchema: Object.freeze({ name: 'standardSchema', of: (v) => standardSchemaFor(v, raw, run) }) };
