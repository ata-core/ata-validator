# What `new Function` costs on Workers

The harness behind the post of the same name on altinmert.co.

The same four-field schema (user.schema.json, from the Hono starter) validated
five ways in one Worker, plus a route that validates nothing as the floor.

- `npm install`, then `node gen-ajv.cjs` and
  `NODE_ENV=production npx ata compile user.schema.json -o gen/user.compiled.mjs --format esm --no-types --no-source`
- `node size.mjs`: bundle per approach, esbuild the way wrangler bundles
- `npx wrangler dev --port 8789` then `PORT=8789 node load.mjs`: per request through workerd
- `node --disallow-code-generation-from-strings micro.mjs`: per validation under the Workers restriction
- `node cold.mjs`: fresh process to the first validation, same restriction

Results on 2026-10-09, Apple M4 Pro, Node 25.2.1, wrangler 4.149.0 (workerd),
ata-validator 1.48.0, ajv 8.20.0 with ajv-formats 3.0.1, @cfworker/json-schema 4.1.1,
hono 4.13.13, are in results.md.
