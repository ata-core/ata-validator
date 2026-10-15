/** One error as a compact module reports it. */
export interface CompactError {
  code?: string;
  keyword: string;
  instancePath: string;
  schemaPath: string;
  params: Record<string, unknown>;
  message: string;
  docUrl?: string;
  [key: string]: unknown;
}

/**
 * The error function a compact module calls for a document its verdict
 * rejected: the errors the runtime Validator reports with
 * `richErrors: false`, in schema order, or null when it finds none.
 */
export function createErrors(schema: object, options?: { v1?: boolean }): (data: unknown) => CompactError[] | null;

/** The linear-time pattern engine compact modules share (the RegExp-like object it returns has `test`). */
export function compileSafe(source: string): { test(input: string): boolean };

/**
 * The RFC 3986 walk behind the `uri`, `uri-reference`, `iri` and
 * `iri-reference` formats, which compact modules share. `mode` bit 1 asks
 * for a scheme, bit 2 admits non-ASCII.
 */
export function uriWalk(input: string, mode: 0 | 1 | 2 | 3): boolean;

/** The ata-validator version this runtime belongs to. */
export const ataVersion: string;
