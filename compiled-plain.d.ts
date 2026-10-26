// ata-validator/compiled-plain: the compiled-module wrapper for a Validator
// built with `richErrors: false`, for a module written with `plainErrors: true`.
import type { ValidationResult } from './index.js';
import type { CompiledModule } from './compiled.js';

export interface CompiledPlainValidator<T = unknown> {
  validate(data: unknown): ValidationResult<T>;
  isValidObject(data: unknown): data is T;
}

export interface CompiledPlainOptions {
  richErrors?: false;
  useDefaults?: boolean;
}

export function fromCompiledPlain<T = unknown>(mod: CompiledModule, schema: object, options?: CompiledPlainOptions): CompiledPlainValidator<T>;
