// Browser ESM entry, for bundlers: the validator core, with each tool imported
// on its own (see lib/tools.mjs) so that the tools an application does not
// import stay out of its bundle. The native addon is stubbed by the
// package.json "browser" field.
//
// The code generator is not in the page's bundle. Every schema starts on the
// interpreted engine, which gives the same answers; a validator that gets hot
// (lib/validator-core.js, TIER_CALLS) loads the generator through the dynamic
// import below, which bundlers split into a chunk of its own, and rebuilds
// itself on generated code. A page that wants generated code from the first
// call imports 'ata-validator/codegen' once.
import core from './lib/validator-core.js';
import tiering from './lib/tiering.js';
import { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON } from './lib/tools.mjs';

core._registerTiering(tiering.createTiering(() => import('./lib/codegen-engine.js')));

export const { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, defineSchema } = core;
export { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
export default { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, toTypeScript, defineSchema, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
