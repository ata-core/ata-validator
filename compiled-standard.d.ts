// ata-validator/compiled-standard: the compiled-module wrapper for a validator
// a bundler plugin sees handed to Standard Schema consumers only.
import type { StandardSchemaV1Props } from './index.js';
import type { CompiledModule } from './compiled.js';

export function bareStandard<T = unknown>(mod: CompiledModule, schema: object | boolean, useDefaults?: boolean): { '~standard': StandardSchemaV1Props<T> };
