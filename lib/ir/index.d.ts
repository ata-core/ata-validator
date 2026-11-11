// ata-validator/ir: the IR compiler's two backends and the table backend.
// Experimental within 1.x (docs/STABILITY.md); docs/ir.md describes them.
import { JSONSchema, ValidationResult } from '../../index';
import { Plan } from '../kernels/plan';

/** Options both backends take. */
export interface IROptions {
  /** ata's rich error shape (default true), or the plain one. */
  richErrors?: boolean;
  /** Fill defaults (default true). */
  useDefaults?: boolean;
  /** Assert `format` (default true). */
  assertFormat?: boolean;
  /** Other documents a `$ref` may name, by `$id`. */
  schemas?: JSONSchema[] | Record<string, JSONSchema>;
  /** The base URI the schema's references resolve against. */
  baseURI?: string;
}

/** Options `specialize` takes beyond IROptions. */
export interface SpecializeOptions extends IROptions {
  /** A function of the schema returning the body of a default fill as source, or null; `defaultsSource` from `ata-validator/build` is one. */
  fillSource?: (schema: JSONSchema) => string | null;
}

/** Options the closures take beyond IROptions: what a module cannot carry. */
export interface ClosureOptions extends IROptions {
  coerceTypes?: boolean | 'array';
  removeAdditional?: boolean | 'all' | 'failing';
  verbose?: boolean;
  abortEarly?: boolean;
  keywords?: Record<string, unknown>;
  formats?: Record<string, RegExp | ((value: string) => boolean)>;
}

/** Options the table backend takes: nothing else is accepted, and `tableModule` and `tablePlan` return null for any other option. */
export interface TableOptions {
  richErrors?: boolean;
  useDefaults?: boolean;
  assertFormat?: boolean;
}

/** What `compileClosures` builds: the two methods a compiled module exports. */
export interface CompiledClosures {
  isValid(data: unknown): boolean;
  validate(data: unknown): ValidationResult<unknown>;
}

/** Writes a JavaScript module that imports its helpers from `ata-validator/kernels`. */
export function specialize(schema: JSONSchema, options?: SpecializeOptions): string;

/** Builds the validator as closures in memory, with no `eval` or `new Function`. */
export function compileClosures(schema: JSONSchema, options?: ClosureOptions): CompiledClosures;

/** Writes the schema as a plan of steps for the interpreter in `ata-validator/kernels`, or null where the table backend does not cover it. */
export function tableModule(schema: JSONSchema, options?: TableOptions): string | null;
/**
 * The closure backend: the schema as calls that build one closure per node, for a browser bundle of several forms.
 * Plain errors only: `richErrors` must be `false`. Covers objects, arrays and value keywords; returns null for
 * anything else (references, branches, a default to fill), and the caller writes the plan or the module instead.
 */
export function closureModule(schema: JSONSchema, options: { richErrors: false; assertFormat?: boolean; useDefaults?: false }): string | null;

/** The same plan as JSON, for `fromPlan` in `ata-validator/plan`, or null where the table backend does not cover the schema. */
export function tablePlan(schema: JSONSchema, options?: TableOptions): Plan | null;

export const PLAN_VERSION: 1;
