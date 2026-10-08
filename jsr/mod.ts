// The JSR entry re-exports the npm package of the same version. The engine,
// its types and its tests live in the npm package; this file exists so that a
// Deno project can write `jsr:@ata/validator` and get the same thing, pinned
// to one version.
export * from "npm:ata-validator@1.47.0";
export { default } from "npm:ata-validator@1.47.0";
