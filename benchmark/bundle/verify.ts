// Every bundle must actually reject a bad body. If a bundler eliminated the
// validation because nothing observed it, the size table would be measuring
// nothing, so this runs the built artefacts rather than the sources.
const good = { id: 1, name: 'Apple', email: 'a@b.co', tags: ['x'] }
const bad  = { id: 0, name: '', email: 'nope' }
for (const name of ['none', 'valibot', 'typebox', 'ata', 'ata-aot', 'zod']) {
  const mod = await import(`./out/${name}.js`)
  const app = mod.default
  const call = async (body: unknown) => (await app.fetch(new Request('http://x/u', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))).status
  const g = await call(good), b = await call(bad)
  console.log(name.padEnd(9), 'good ->', g, ' bad ->', b, (name === 'none' ? (b === 200 ? '(no validation, as intended)' : 'UNEXPECTED') : (g === 200 && b === 400 ? 'validates' : 'BROKEN OR TREE-SHAKEN')))
}
