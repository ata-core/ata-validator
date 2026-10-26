// ata-validator/compiled-bare: the smallest compiled-module wrappers, for a
// validator a bundler plugin sees used only through direct method calls.
import type { ValidationResult } from './index.js';
import type { CompiledModule } from './compiled.js';

export function bareVerdict(mod: CompiledModule, useDefaults?: boolean): { isValidObject(data: unknown): boolean };
export function barePlain<T = unknown>(mod: CompiledModule, useDefaults?: boolean): { validate(data: unknown): ValidationResult<T>; isValidObject(data: unknown): data is T };
