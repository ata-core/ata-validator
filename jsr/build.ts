/**
 * The ahead-of-time compiler, `ata-validator/build` on npm: turns a schema
 * into a standalone JavaScript module that imports nothing, through
 * `toStandaloneModule`, `bundleStandalone` and the other build entries.
 *
 * ```ts
 * import { Validator } from "jsr:@ata/validator";
 * import { toStandaloneModule } from "jsr:@ata/validator/build";
 *
 * const source = toStandaloneModule(new Validator(schema), { format: "esm" });
 * ```
 *
 * @module
 */
export * from "npm:ata-validator@1.47.0/build";
