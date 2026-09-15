import { toStandaloneModule } from 'ata-validator/build'
import { writeFileSync } from 'node:fs'
const Body = {
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 64 },
    email: { type: 'string', format: 'email' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'email'],
}
writeFileSync('src/gen/body.mjs', toStandaloneModule(Body))
