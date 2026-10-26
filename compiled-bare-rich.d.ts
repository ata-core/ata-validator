// ata-validator/compiled-bare-rich: the compiled-bare wrapper for a validator
// a bundler plugin sees only called, that reads ata's own errors.
import type { ValidationResult } from './index.js';
import type { CompiledModule } from './compiled.js';

export function bareRich<T = unknown>(mod: CompiledModule, schema: object | boolean, useDefaults?: boolean): { validate(data: unknown): ValidationResult<T>; isValidObject(data: unknown): data is T };
