// ata-validator/compiled-verdict: the wrapper a bundler plugin puts in place of
// `new Validator(schema)` for a schema known at build time, when the code only
// asks for a boolean. No error pipeline is included.
import type { CompiledModule, CompiledOptions } from './compiled.js';

export interface CompiledVerdictValidator<T = unknown> {
  isValidObject(data: unknown): data is T;
  isValidJSON(json: string): boolean;
}

export function fromCompiledVerdict<T = unknown>(mod: Pick<CompiledModule, 'isValid'>, schema: object, options?: CompiledOptions): CompiledVerdictValidator<T>;
