'use strict';

// Browser twin of lib/aot.js, wired by the package.json `browser` field. The
// emitters write module source for a bundler or the filesystem, which is build
// tooling, not something a page does; leaving them out keeps their code and
// the embedded safe-regex engine source out of the browser bundle. Loading a
// bundle somebody already built is a runtime act, so that one works here too.

function unavailable(name) {
  return function () {
    throw new Error(
      name + '() is not in the default browser bundle. ' +
      "Import it from 'ata-validator/aot', which works in the browser too; " +
      'pages that never emit code stay free of the emitters this way.'
    );
  };
}

function loadBundle(Validator, mods, schemas, opts) {
  return schemas.map((schema, i) => {
    if (mods[i]) return Validator.fromStandalone(mods[i], schema, opts);
    return new Validator(schema, opts);
  });
}

module.exports = {
  toStandalone: unavailable('toStandalone'),
  toStandaloneModule: unavailable('toStandaloneModule'),
  bundle: unavailable('bundle'),
  bundleStandalone: unavailable('bundleStandalone'),
  bundleCompact: unavailable('bundleCompact'),
  loadBundle,
};
