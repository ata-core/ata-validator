import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import ajvErrors from 'ajv-errors'

export const ajv = new Ajv2020({ allErrors: true })
addFormats(ajv); ajvErrors(ajv)
ajv.addKeyword({ keyword: 'range', type: 'number', code(cxt) { cxt.fail() } })
export const check = ajv.compile({ type: 'number', minimum: { $data: '1/min' } })
