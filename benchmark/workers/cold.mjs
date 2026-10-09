// Fresh process to the first validation result, per approach, with code
// generation blocked the way Workers block it. Medians of 11. The import is
// most of it, which is why bundle size matters more than per-call speed on a
// runtime that starts an isolate often.
import { execFileSync } from 'node:child_process'
const probes = {
  'ata-compiled': `const m = await import('./gen/user.compiled.mjs'); if (!m.validate(doc).valid) throw 1`,
  'ata-runtime': `const { Validator } = await import('ata-validator/lite'); const v = new Validator(schema); if (!v.validate(doc).valid) throw 1`,
  cfworker: `const { Validator } = await import('@cfworker/json-schema'); const v = new Validator(schema, '2020-12', false); if (!v.validate(doc).valid) throw 1`,
  'ajv-standalone': `const { default: validate } = await import('./gen/ajv-standalone.cjs'); if (!validate(doc)) throw 1`,
  'ajv-runtime': `const { default: Ajv } = await import('ajv/dist/2020.js'); const { default: addFormats } = await import('ajv-formats'); const ajv = new Ajv(); addFormats(ajv); if (!ajv.compile(schema)(doc)) throw 1`,
}
const head = `const t0 = performance.now(); const { readFileSync } = await import('node:fs'); const schema = JSON.parse(readFileSync('user.schema.json', 'utf8')); const doc = { email: 'ada@example.com', name: 'Ada', age: 36 };`
console.log('| approach | fresh process to the first validation |'); console.log('|---|---|')
for (const [name, body] of Object.entries(probes)) {
  const runs = []
  for (let i = 0; i < 11; i++) {
    try {
      const out = execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', `${head} try { ${body} } catch (e) { console.log('THROW ' + (e && e.name)); process.exit(0) } console.log((performance.now() - t0).toFixed(2))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (out.startsWith('THROW')) { runs.push(out); break }
      runs.push(parseFloat(out))
    } catch { runs.push('crash'); break }
  }
  if (typeof runs[0] === 'string') { console.log(`| ${name} | ${runs[0]} |`); continue }
  runs.sort((a, b) => a - b); console.log(`| ${name} | ${runs[5].toFixed(2)} ms |`)
}
