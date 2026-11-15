// 2.0 browser entry, work in progress (feat/v2-entry): the small Validator only.
import small from './lib/validator-small.js';
import core from './lib/core/verdict.js';
// The verdict core's later parts (unevaluated*, $dynamicRef, large and rare
// object and array shapes, the second half) are a chunk of their own, loaded
// the first time a schema needs them; until then such a schema is answered
// by the small engine.
core._chunked(() => Promise.all([import('./lib/core/verdict-more.js'), import('./lib/core/verdict-full.js')]).then((ms) => ms.map((m) => m.default || m)));
export const Validator = small.Validator;
