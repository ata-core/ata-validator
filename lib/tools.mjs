// The package's tools as ES modules, one import each, for the entries a
// bundler reads (index.browser.mjs, index.edge.mjs): an application that
// imports only Validator leaves TypeScript generation, the renderers, the
// output format, the retry message and the schema description out of its
// bundle. Through index.js they load on first call instead, which a bundler
// cannot see, so it kept all of them.
import tsGen from './ts-gen.js';
import renderPrettyMod from './render-pretty.js';
import renderCompactMod from './render-compact.js';
import outputFormat from './output-format.js';
import retryMessage from './retry-message.js';
import describe from './describe-schema.js';
import renderJsonMod from './render-json.js';

export function toTypeScript (...a) { return tsGen.toTypeScript(...a); }
export function renderPretty (...a) { return renderPrettyMod.renderPretty(...a); }
export function renderCompact (...a) { return renderCompactMod.renderCompact(...a); }
export function toOutput (...a) { return outputFormat.toOutput(...a); }
export function toRetryMessage (...a) { return retryMessage.toRetryMessage(...a); }
export function describeSchema (...a) { return describe.describeSchema(...a); }
export function renderJSON (...a) { return renderJsonMod.renderJSON(...a); }
