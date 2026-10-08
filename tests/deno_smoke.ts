// Runs under Deno in CI: the package from this checkout answers through the
// generated engine, and again with dynamic code refused the way Deno Deploy
// refuses it, through the interpreted engine. `deno run -A tests/deno_smoke.ts`.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Validator } = require("../index.js");
const { toStandaloneModule } = require("../build.js");

const schema = { type: "object", required: ["a"], properties: { a: { type: "integer", minimum: 1 }, e: { type: "string", format: "email" } } };
const v = new Validator(schema);
const r = v.validate({ a: 0, e: "nope" });
if (v.engine() !== "codegen") throw new Error("expected the generated engine, got " + v.engine());
if (!v.validate({ a: 1 }).valid || r.valid) throw new Error("verdicts");
if (r.errors.map((e: { code: string }) => e.code).join(",") !== "ATA2003,ATA3001") throw new Error("codes " + JSON.stringify(r.errors));
if (!v.validateJSON('{"a":2}').valid || v.validateJSON('{"a":"x"}').valid || !v.isValidJSON('{"a":3}')) throw new Error("text path");
const src: string = toStandaloneModule(v, { format: "esm", onePass: true });
if (!src.includes("_vC")) throw new Error("one-pass module");

const F = globalThis.Function;
(globalThis as { Function: unknown }).Function = function () { throw new EvalError("blocked"); };
let blocked: string;
try {
  const w = new Validator({ type: "array", items: { type: "number", maximum: 3 }, uniqueItems: true });
  blocked = w.engine();
  if (!w.validate([1, 2]).valid || w.validate([1, 4]).valid || w.validate([1, 1]).errors[0].code !== "ATA2012") throw new Error("blocked verdicts");
} finally {
  (globalThis as { Function: unknown }).Function = F;
}
console.log(`ok: Deno ${Deno.version.deno}, generated engine answers, and with dynamic code refused the ${blocked} engine answers`);
