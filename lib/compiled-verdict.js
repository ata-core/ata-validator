'use strict';

// The verdict half of lib/compiled.js: isValidObject() and isValidJSON(),
// answered as a Validator with default options answers them, defaults filled
// in first. A bundler plugin puts this in place of `new Validator(schema)`
// when the code only ever asks for a boolean, so the error pipeline (the
// rejection classes, enrichment, suggestions, JSON positions) stays out of the
// bundle. Anything that reads errors needs ata-validator/compiled.

const { prepare, parse } = require('./compiled-common');

function fromCompiledVerdict(mod, schema, options) {
  const { isValid } = prepare(mod, schema, options, 'fromCompiledVerdict');
  return {
    isValidObject(data) {
      return isValid(data);
    },
    isValidJSON(text) {
      const p = parse(text);
      return p.error ? false : isValid(p.value);
    },
  };
}

module.exports = { fromCompiledVerdict };
