// The ESM entry Node itself resolves (the `module-sync` condition, Node 22.10
// and later). Importing index.js with an `import` statement makes Node run
// its CommonJS lexer over every module the package requires, to find named
// exports this file lists by hand anyway: 7.7 ms to load against 5.5 through
// require. Bundlers do not match `module-sync` and keep index.mjs, whose
// static import they can follow.
import { createRequire } from 'node:module';
const mod = createRequire(import.meta.url)('./index.js');
export const { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, toTypeScript, defineSchema, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON } = mod;
export default mod;
