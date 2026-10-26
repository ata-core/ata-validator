// ata-validator/compiled-object: ata-validator/compiled without the JSON text
// entry points, for code that reads errors but never calls validateJSON().
import type { ValidationResult } from './index.js';
import type { CompiledModule, CompiledOptions } from './compiled.js';

export interface CompiledObjectValidator<T = unknown> {
  validate(data: unknown): ValidationResult<T>;
  isValidObject(data: unknown): data is T;
}

export function fromCompiledObject<T = unknown>(mod: CompiledModule, schema: object, options?: CompiledOptions): CompiledObjectValidator<T>;
