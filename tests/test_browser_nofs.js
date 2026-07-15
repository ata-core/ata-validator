// Browser/edge safety: bundle the browser entry the way a real bundler does
// (platform=browser, node builtins external), then run it with `fs`/`path`
// stubbed empty, as they are in a browser or Cloudflare Workers. Importing ata
// and the runtime operations must not touch the filesystem. Regression test for
// the safe-regex embed that read a file at module load (broke browser bundles
// from 0.17.3).

const esbuild = require("esbuild");
const Module = require("module");
const path = require("path");

const browserEntry = path.join(__dirname, "..", "index.browser.mjs");

const result = esbuild.buildSync({
  stdin: {
    contents: `
      import { Validator, toTypeScript } from ${JSON.stringify(browserEntry)}
      const schema = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
      const v = new Validator(schema)
      globalThis.__ATA_RESULT = {
        valid: v.validate({ id: 1 }).valid,
        invalid: v.validate({}).valid,
        hasCode: !!Validator.bundleStandalone([schema]),
        tsOK: toTypeScript(schema, { name: 'X' }).includes('interface X'),
      }
    `,
    resolveDir: __dirname,
    loader: "js",
  },
  bundle: true,
  platform: "browser",
  format: "cjs",
  external: ["fs", "path", "pkg-prebuilds"],
  write: false,
  logLevel: "error",
});

const code = result.outputFiles[0].text;

// Simulate the browser: node builtins resolve to empty objects (no readFileSync).
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "fs" || request === "path" || request === "pkg-prebuilds") return {};
  return origLoad.call(this, request, ...rest);
};

let failed = 0;
const check = (cond, msg) => {
  if (!cond) { console.log(`  FAIL  ${msg}`); failed++; } else { console.log(`  PASS  ${msg}`); }
};

try {
  const m = new Module("ata-browser-bundle");
  m._compile(code, path.join(__dirname, "ata-browser-bundle.cjs"));
} catch (e) {
  console.log(`  FAIL  bundle crashed at init (a browser would break): ${e.message}`);
  Module._load = origLoad;
  process.exit(1);
} finally {
  Module._load = origLoad;
}

const r = globalThis.__ATA_RESULT;
check(r && r.valid === true, "validates a valid object without fs");
check(r && r.invalid === false, "rejects an invalid object without fs");
check(r && r.hasCode === true, "bundleStandalone (no pattern) works without fs");
check(r && r.tsOK === true, "toTypeScript works without fs");

console.log(`\n${failed === 0 ? "ok" : "FAILED"}: ata bundles for the browser and runs without fs`);
process.exit(failed > 0 ? 1 : 0);
