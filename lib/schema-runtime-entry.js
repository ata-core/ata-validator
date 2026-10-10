'use strict';

// The runtime a schema module (`ata build --mode schema`) imports: the verdict
// and the errors both come from the interpreted engine walking the embedded
// schema, so a module is its schema and a few lines. Smaller and quicker to
// load than generated code, slower per check once warm; see docs/API.md.
// One interpreter per schema answers both, so the schema is prepared once.
// It loads lib/interpreter.js, which brings the plan compiler for schemas
// used often (TIER in lib/interpreter-core.js).
const { createInterpreter } = require('./interpreter');
const { errorsOf, interpreterOptions } = require('./error-runtime-entry');

// A registry is the array of schemas a build writes beside schema modules
// whose schemas reference each other by `$id` (ata-registry.mjs). It becomes
// one Map, id to schema, shared by every module of the build.
const _maps = new WeakMap();
function registryMap(registry) {
  let map = _maps.get(registry);
  if (map === undefined) {
    map = new Map();
    for (const s of registry) map.set(s.$id, s);
    _maps.set(registry, map);
  }
  return map;
}

// options.registry and options.id: the module's schema is the registry entry
// with that `$id`, and its references resolve against the registry.
function createValidator(schema, codeOf, options) {
  const opts = interpreterOptions(options);
  if (options && options.registry) {
    const map = registryMap(options.registry);
    if (schema === null || schema === undefined) schema = map.get(options.id);
    opts.schemaMap = map;
    opts.flat = false;
    require('./schema-order').registerDocuments(schema, map);
  }
  const interp = createInterpreter(schema, opts);
  return {
    isValid: (data) => interp.isValid(data),
    errors: (data) => errorsOf(interp, schema, codeOf, data),
  };
}

module.exports = { createValidator };
