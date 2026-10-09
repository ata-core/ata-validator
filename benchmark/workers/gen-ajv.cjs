// The default validator's standalone mode: the compiled validator as source,
// so it runs where new Function does not. Same schema, formats included.
const Ajv = require('ajv/dist/2020')
const addFormats = require('ajv-formats')
const standaloneCode = require('ajv/dist/standalone').default
const fs = require('fs')
const schema = JSON.parse(fs.readFileSync('user.schema.json', 'utf8'))
for (const esm of [true, false]) {
  const ajv = new Ajv({ code: { source: true, esm }, allErrors: false })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  const file = esm ? 'gen/ajv-standalone.mjs' : 'gen/ajv-standalone.cjs'
  fs.writeFileSync(file, standaloneCode(ajv, validate))
  console.log('ajv standalone:', file, fs.statSync(file).size, 'bytes')
}
