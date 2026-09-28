// ata-validator/compiled: the wrapper a bundler plugin puts in place of
// `new Validator(schema)` for a schema known at build time.
import type { ValidationResult } from './index.js';

export interface CompiledModule {
  validate(data: unknown): { valid: boolean; errors: unknown[] };
  isValid(data: unknown): boolean;
}

export interface CompiledValidator<T = unknown> {
  validate(data: unknown): ValidationResult<T>;
  isValidObject(data: unknown): data is T;
  validateJSON(json: string): { valid: boolean; errors: unknown[] };
  isValidJSON(json: string): boolean;
}

export function fromCompiled<T = unknown>(mod: CompiledModule, schema: object): CompiledValidator<T>;
