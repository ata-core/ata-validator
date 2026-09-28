'use strict';

// parse() for the full package: a generated function that copies the keys the
// schema declares, behind the generated verdict. The refusals every build
// shares stay in validator-core.js; this is the part that needs the code
// generator, so ata-validator/lite does not carry it.

const cloneEmit = require('./clone-emit');

module.exports = function buildParse (self, decline, extended) {
  const { cloneExprFor } = cloneEmit;
  const expr = cloneExprFor(self._schemaObj);
  if (!expr) return decline('the set of keys to keep cannot be proven from the schema');
  let copy;
  try {
    // eslint-disable-next-line no-new-func
    copy = new Function('data', 'return ' + expr);
  } catch {
    return decline('code generation is not allowed here');
  }
  self._ensureCompiled();
  const verdict = extended ? (d) => self.isValidObject(d) : self._jsFn;
  if (typeof self._jsFn !== 'function') return decline('the schema has no generated verdict function');
  return (data) => {
    if (!verdict(data)) {
      const e = new Error('validation failed');
      e.name = 'AtaValidationError';
      let target = data;
      if (self._mutatesInput) {
        try { target = structuredClone(data); } catch { target = data; }
      }
      e.errors = self.validate(target).errors;
      throw e;
    }
    return copy(data);
  };
};
