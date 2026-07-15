/**
 * bench_fastify_aot_vs_ajv.mjs
 *
 * Fastify route validation: ata-AOT vs ata-runtime vs AJV (Fastify default).
 *
 * Three configs, run sequentially with identical schema, payload, warmup, and
 * measurement duration. Each config starts a fresh server, warms up 3s, then
 * measures 10s, then stops the server cleanly before the next run.
 *
 * Config A: AJV — Fastify default (no setValidatorCompiler)
 * Config B: ata-runtime — setValidatorCompiler with new Validator(schema) per route
 * Config C: ata-AOT — pre-compiled standalone .mjs, no schema compilation at request time
 */

import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cpus } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const BENCH_DIR = __dirname;

const req         = createRequire(join(BENCH_DIR, 'package.json'));
const { Validator } = req(join(ROOT, 'index.js'));
const aot           = req(join(ROOT, 'lib', 'aot.js'));
const Fastify       = req('fastify');
const autocannon    = req('autocannon');

// ---------------------------------------------------------------------------
// Schema and payload
// ---------------------------------------------------------------------------

const schema = {
  type: 'object',
  properties: {
    id:    { type: 'integer', minimum: 1 },
    name:  { type: 'string',  minLength: 1, maxLength: 100 },
    email: { type: 'string',  format: 'email' },
    role:  { type: 'string',  enum: ['admin', 'member', 'viewer'] },
    tags:  { type: 'array',   items: { type: 'string' }, maxItems: 10 },
  },
  required: ['id', 'name', 'email', 'role'],
  additionalProperties: false,
};

const payload = JSON.stringify({
  id:    42,
  name:  'Alice Example',
  email: 'alice@example.com',
  role:  'admin',
  tags:  ['frontend', 'lead'],
});

// ---------------------------------------------------------------------------
// Autocannon helper
// ---------------------------------------------------------------------------

function runAutocannon(port, duration) {
  return new Promise((resolve, reject) => {
    autocannon({
      url:         'http://127.0.0.1:' + port + '/users',
      method:      'POST',
      headers:     { 'content-type': 'application/json' },
      body:        payload,
      duration,
      connections: 50,
      pipelining:  1,
    }, (err, result) => {
      if (err) reject(err);
      else     resolve(result);
    });
  });
}

// ---------------------------------------------------------------------------
// Run one config: start server, warmup 3s, measure 10s, stop server
// ---------------------------------------------------------------------------

async function runConfig(label, buildApp, port) {
  process.stderr.write(`  [${label}] starting server on port ${port}...\n`);
  const app = await buildApp();
  await app.listen({ port, host: '127.0.0.1' });

  process.stderr.write(`  [${label}] warmup (3s)...\n`);
  await runAutocannon(port, 3); // throw away

  process.stderr.write(`  [${label}] measuring (10s)...\n`);
  const result = await runAutocannon(port, 10);

  await app.close();
  process.stderr.write(`  [${label}] done.\n`);
  return result;
}

// ---------------------------------------------------------------------------
// Config builders
// ---------------------------------------------------------------------------

function buildAjvApp() {
  const app = Fastify({ logger: false });
  app.post('/users', { schema: { body: schema } }, async () => ({ ok: true }));
  return app;
}

function buildRuntimeApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(({ schema: s }) => {
    const v = new Validator(s);
    return (data) => {
      const r = v.validate(data);
      return r.valid ? { value: data } : { error: new Error(r.errors[0].message) };
    };
  });
  app.post('/users', { schema: { body: schema } }, async () => ({ ok: true }));
  return app;
}

async function buildAotApp(compiledValidate) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(() => {
    // The compiled validate function is pre-bound to our schema.
    // We ignore the inline schema since compiled module and route schema match.
    return (data) => {
      const r = compiledValidate(data);
      return r.valid ? { value: data } : { error: new Error(r.errors[0].message) };
    };
  });
  app.post('/users', { schema: { body: schema } }, async () => ({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function fmtReqs(n) {
  return n.toLocaleString('en-US');
}

function fmtMs(n) {
  return n.toFixed(2) + ' ms';
}

function fmtMBs(n) {
  return (n / 1024 / 1024).toFixed(2) + ' MB/s';
}

function fmtRatio(val, base) {
  const r = val / base;
  return r >= 1 ? r.toFixed(2) + '×' : '0.' + (r * 100).toFixed(0) + '×';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

process.stderr.write('Fastify route validation benchmark: AOT vs runtime vs AJV\n');
process.stderr.write('Each config: 3s warmup + 10s measurement, 50 connections\n\n');

// Pre-compile AOT module once before any servers start
process.stderr.write('Pre-compiling AOT module...\n');
const v = new Validator(schema);
const aotSrc = aot.toStandaloneModule(v, { format: 'esm' });
if (!aotSrc) {
  process.stderr.write('ERROR: toStandaloneModule returned null — cannot run AOT config\n');
  process.exit(1);
}
const aotFile = join(tmpdir(), 'ata_bench_fastify_aot.mjs');
writeFileSync(aotFile, aotSrc);
const aotMod = await import(aotFile);
const compiledValidate = aotMod.validate;
process.stderr.write('AOT module ready.\n\n');

// Run configs sequentially on separate ports to avoid conflicts
const resultAjv     = await runConfig('AJV (Fastify default)', () => buildAjvApp(),          13600);
const resultRuntime = await runConfig('ata-runtime',           () => buildRuntimeApp(),       13601);
const resultAot     = await runConfig('ata-AOT',               () => buildAotApp(compiledValidate), 13602);

// ---------------------------------------------------------------------------
// Build output table
// ---------------------------------------------------------------------------

const rows = [
  { label: 'AJV (Fastify default)', res: resultAjv },
  { label: 'ata-runtime',           res: resultRuntime },
  { label: 'ata-AOT',               res: resultAot },
];

const ajvReqs = resultAjv.requests.average;
const cpu = cpus()[0]?.model?.trim() || 'unknown CPU';
const nodeVer = process.version;
const date = new Date().toISOString().slice(0, 10);

const lines = [];
lines.push('## Fastify route validation: ata-AOT vs ata-runtime vs AJV');
lines.push('');
lines.push('| Config | req/sec | latency avg | latency p99 | throughput |');
lines.push('|---|---|---|---|---|');
for (const { label, res } of rows) {
  lines.push(
    `| ${label} | ${fmtReqs(res.requests.average)} | ${fmtMs(res.latency.average)} | ${fmtMs(res.latency.p99)} | ${fmtMBs(res.throughput.average)} |`
  );
}
lines.push('');

const runtimeRatio = (resultRuntime.requests.average / ajvReqs).toFixed(2);
const aotRatio     = (resultAot.requests.average / ajvReqs).toFixed(2);
lines.push(`Ratio (vs AJV baseline): ata-runtime ${runtimeRatio}× faster, ata-AOT ${aotRatio}× faster.`);
lines.push('');
lines.push(`Methodology: Fastify 5.x in-process, autocannon 50 connections, 10s measurement after 3s warmup, valid POST body. Hardware: ${cpu}, Node ${nodeVer}.`);
lines.push('');
lines.push(`*Measured on ${date}*`);

const output = lines.join('\n');
process.stdout.write('\n' + output + '\n');

// ---------------------------------------------------------------------------
// Save to baselines/
// ---------------------------------------------------------------------------

const baselineFile = join(BENCH_DIR, 'baselines', '2026-05-09-fastify-aot.md');
writeFileSync(baselineFile, output + '\n');
process.stderr.write('\nBaseline saved to: ' + baselineFile + '\n');
