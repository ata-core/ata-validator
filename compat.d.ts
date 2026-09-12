import type { JSONSchema } from './index';

declare class Ata {
  constructor(opts?: Ata.Options);
  readonly opts: Ata.Options & { code: object };
  /** Errors from the last `validate()` or `validateSchema()` call. */
  errors: Ata.ErrorObject[] | null;

  compile<T = unknown>(schema: object | boolean): Ata.ValidateFunction<T>;
  compileAsync<T = unknown>(schema: object | boolean): Promise<Ata.ValidateFunction<T>>;
  validate(schemaKeyRef: object | boolean | string, data: unknown): boolean;

  addSchema(schema: object | object[], key?: string): this;
  addMetaSchema(schema: object, key?: string): this;
  getSchema<T = unknown>(keyRef: string): Ata.ValidateFunction<T> | undefined;
  removeSchema(schemaKeyRef?: object | string | RegExp): this;
  validateSchema(schema: object | boolean, throwOrLogError?: boolean): boolean;

  addFormat(name: string, format: Ata.Format): this;

  addKeyword(definition: Ata.KeywordDefinition): this;
  addKeyword(keyword: string, definition?: Omit<Ata.KeywordDefinition, 'keyword'>): this;
  addVocabulary(definitions: Array<string | Ata.KeywordDefinition>): this;
  getKeyword(keyword: string): Ata.KeywordDefinition | boolean;
  removeKeyword(keyword: string): this;

  errorsText(errors?: Ata.ErrorObject[] | null, options?: { separator?: string; dataVar?: string }): string;
}

declare namespace Ata {
  interface ErrorObject {
    instancePath: string;
    schemaPath: string;
    keyword: string;
    params: Record<string, unknown>;
    message: string;
    /** Present when `verbose: true`. */
    parentSchema?: unknown;
    /** Present on errors produced under `propertyNames`. */
    propertyName?: string;
    [extra: string]: unknown;
  }

  interface ValidateFunction<T = unknown> {
    (data: unknown): data is T;
    errors: ErrorObject[] | null;
    schema: object | boolean;
  }

  type Format =
    | RegExp
    | string
    | ((data: string) => boolean)
    | { type?: 'string' | 'number'; validate: RegExp | string | ((data: string) => boolean) };

  interface KeywordDefinition {
    keyword: string;
    /** JSON Schema type name(s) the keyword applies to. Other types pass. */
    type?: string | string[];
    /** Called per value. May leave error objects on itself (`fn.errors`). */
    validate?: (schema: unknown, data: unknown, parentSchema?: object) => boolean;
    /** Called once per schema node; the returned function runs per value. */
    compile?: (schema: unknown, parentSchema?: object) => (data: unknown) => boolean;
    /** Returns a schema applied in place of the keyword. */
    macro?: (schema: unknown, parentSchema?: object) => JSONSchema | boolean;
    errors?: boolean;
    [extra: string]: unknown;
  }

  interface Options {
    allErrors?: boolean;
    verbose?: boolean;
    coerceTypes?: boolean | 'array';
    useDefaults?: boolean | 'empty';
    removeAdditional?: boolean | 'all' | 'failing';
    validateFormats?: boolean;
    validateSchema?: boolean | 'log';
    formats?: Record<string, Format>;
    keywords?: KeywordDefinition[];
    schemas?: object[] | Record<string, object>;
    strict?: boolean | 'log';
    strictSchema?: boolean | 'log';
    strictTypes?: boolean | 'log';
    strictTuples?: boolean | 'log';
    strictRequired?: boolean | 'log';
    allowUnionTypes?: boolean;
    logger?: { log(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void } | false;
    loadSchema?: (uri: string) => Promise<object>;
    /** Refused: the constructor throws. */
    $data?: boolean;
    [extra: string]: unknown;
  }
}

export = Ata;
