// The defaults pass is imported on its own and built behind a pure call: a
// bundle that never calls createDefaults leaves lib/defaults.js out (it was
// 1.6 KB gzipped of every bundle with a compact module).
import core from './lib/error-runtime-core.js';
import defaults from './lib/defaults.js';
export const { createErrors, compileSafe, uriWalk, ataVersion } = core;
export const createDefaults = /* @__PURE__ */ (() => (schema) => defaults.buildDefaultsApplier(schema) || function () {})();
export default /* @__PURE__ */ (() => ({ createErrors, compileSafe, uriWalk, createDefaults, ataVersion }))();
