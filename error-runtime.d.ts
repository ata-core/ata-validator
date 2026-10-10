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

/** The ata-validator version this runtime belongs to. */
export const ataVersion: string;
