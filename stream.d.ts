import { Validator, ValidationError } from './index';

/** Options of a record stream. */
export interface StreamOptions {
  /** How the body carries its records: one JSON document per line, a JSON array, or decided from the first non-blank character (default). */
  format?: 'ndjson' | 'array' | 'auto';
  /** Stop at the first record that fails (default true); false sees every record and lists every failure. */
  stopOnFirst?: boolean;
  /** Called with each record that passed, parsed, and its index from zero. */
  onRecord?: (record: unknown, index: number) => void;
}

/** One record's failure: its index from zero and the errors validate() gives for it, or a parse error with keyword `__parse__`. */
export interface RecordFailure {
  valid: false;
  record: number;
  errors: ValidationError[];
}

/** What end() returns: whether every record passed, how many were read, and the failures seen. */
export interface StreamResult {
  valid: boolean;
  records: number;
  errors: RecordFailure[];
}

/** A record stream: feed chunks as they arrive, get the first failure the moment its record is complete. */
export class RecordStream {
  constructor(validator: Validator<unknown>, opts?: StreamOptions);
  /** Records read so far. */
  readonly records: number;
  /** Failures so far. */
  readonly failures: RecordFailure[];
  /** True once the stream stopped, at a failure or at end(). */
  readonly done: boolean;
  /** Feed a chunk. Returns null while every record so far passes, or the first failure. */
  push(chunk: string | Uint8Array): RecordFailure | null;
  /** Close the input. An unfinished record or an unclosed array is a parse failure. */
  end(): StreamResult;
}

export function streamValidator(validator: Validator<unknown>, opts?: StreamOptions): RecordStream;

/**
 * Read an async source (a Node Readable, a Web ReadableStream, any iterable of
 * chunks) through a record stream. At the first failure the source is stopped:
 * a Node stream is destroyed, a Web stream's reader cancelled.
 */
export function validateStream(validator: Validator<unknown>, source: AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array> | ReadableStream<Uint8Array | string>, opts?: StreamOptions): Promise<StreamResult>;

export const PARSE_KEYWORD: '__parse__';
