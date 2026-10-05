import Ajv, { type ErrorObject } from "ajv";
const ajv = new Ajv();
export function errs(e: ErrorObject[] | null | undefined) { return ajv.errorsText(e); }
