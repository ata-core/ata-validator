// ata-validator/ir: the schema compiler built on one definition per keyword.
// front() turns a schema into procedures of a small IR (lib/ir/README.md);
// emitIR()/specialize() write a JavaScript module that imports its helpers
// from ata-validator/kernels; compile() in run.mjs builds closures from the
// same IR, without eval. A schema outside what the IR covers throws an error
// whose message starts with "ir:", so a caller can fall back.
export { front, normalize } from './front.mjs'
export { emitIR, specialize } from './emit.mjs'
export { compile as compileClosures, compileIR } from './run.mjs'
