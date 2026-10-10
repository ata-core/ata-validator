/**
 * A JSON Schema validator for Deno: `Validator`, the compiled entries and
 * the Standard Schema interface, re-exported from the npm package of the
 * same version. Where dynamic code is refused, on Deno Deploy for one, the
 * validator runs its interpreted engine with the same answers.
 *
 * ```ts
 * import { Validator } from "jsr:@ata/validator";
 *
 * const user = new Validator({
 *   type: "object",
 *   required: ["email"],
 *   properties: { email: { type: "string", format: "email" } },
 * });
 * const result = user.validate(JSON.parse(body));
 * if (!result.valid) console.log(result.errors[0].message);
 * ```
 *
 * @module
 */
export * from "npm:ata-validator@1.49.0";
export { default } from "npm:ata-validator@1.49.0";
