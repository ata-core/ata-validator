// ESM edge entry (see index.edge.js): the core without the code generator,
// for Cloudflare Workers and Vercel Edge, with each tool imported on its own
// (lib/tools.mjs) so the ones an application does not import stay out of its
// bundle.
import core from './lib/validator-core.js';
import aotBrowser from './lib/aot.browser.js';
import { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON } from './lib/tools.mjs';

core._registerAot(() => aotBrowser);

export const { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, defineSchema } = core;
export { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
export default { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, toTypeScript, defineSchema, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
