import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Validator } = require("../index.js");
const { Compile } = await import("typebox/compile");

const schema = {
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    active: { type: 'boolean' },
  },
  required: ['id', 'name', 'email', 'age', 'active'],
}
const invalidDoc = { id: -1, name: '', email: 'bad', age: 200, active: 'yes' }

const ataV = new Validator(schema)
const tbV = Compile(schema)
for(let i=0;i<100000;i++){ataV.isValidObject(invalidDoc);tbV.Check(invalidDoc)}

const N = 5_000_000
let s,e

s = process.hrtime.bigint()
for(let i=0;i<N;i++) ataV.isValidObject(invalidDoc)
e = Number(process.hrtime.bigint()-s)
console.log("ata isValid(invalid):   " + (e/N).toFixed(1) + " ns  (boolean only)")

s = process.hrtime.bigint()
for(let i=0;i<N;i++) tbV.Check(invalidDoc)
e = Number(process.hrtime.bigint()-s)
console.log("typebox Check(invalid): " + (e/N).toFixed(1) + " ns  (boolean only)")

s = process.hrtime.bigint()
for(let i=0;i<N;i++) ataV.validate(invalidDoc)
e = Number(process.hrtime.bigint()-s)
console.log("ata validate(invalid):  " + (e/N).toFixed(1) + " ns  (with error details)")
