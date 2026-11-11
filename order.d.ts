// ata-validator/order: a list of errors in schema declaration order, the
// order `new Validator(schema)` reports them in.
export function ordered<E extends { schemaPath: string }>(schema: object | boolean, errors: E[]): E[];
