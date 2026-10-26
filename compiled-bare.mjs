// ata-validator/compiled-bare as an ES module of its own rather than a
// re-export of the CommonJS file: a bundler then has no CommonJS interop to
// add, which was more than half of the bundled size (662 to 315 bytes
// gzipped). The same functions as lib/compiled-bare.js;
// tests/test_compiled_bare.js holds the two to the same answers.

const EMPTY_ERRORS = Object.freeze([]);
const VERDICT_DISAGREES = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({ keyword: 'validation', instancePath: '', schemaPath: '#', params: Object.freeze({}), message: 'schema validation failed' })]),
});

function verdictOf(mod, useDefaults) {
  const fill = useDefaults !== false && typeof mod.applyDefaults === 'function' ? mod.applyDefaults : null;
  return fill ? (d) => { fill(d); return mod.isValid(d); } : mod.isValid;
}

export function bareVerdict(mod, useDefaults) {
  return { isValidObject: verdictOf(mod, useDefaults) };
}

export function barePlain(mod, useDefaults) {
  const isValid = verdictOf(mod, useDefaults);
  const errFn = mod.validate;
  return {
    validate(data) {
      if (isValid(data)) return { valid: true, data, errors: EMPTY_ERRORS };
      const r = errFn(data);
      return r && r.valid === false ? { valid: false, errors: r.errors } : VERDICT_DISAGREES;
    },
    isValidObject: isValid,
  };
}

export default { bareVerdict, barePlain };
