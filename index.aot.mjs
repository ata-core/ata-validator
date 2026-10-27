// ata-validator under Bun's ahead-of-time compiler; see index.aot.js. The mark
// is imported first, so it runs before the package and before any caller.
import './lib/aot-mark.js';
export * from './index.mjs';
export { default } from './index.mjs';
