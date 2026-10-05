// require('ajv') in a comment is not an import
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile({ type: 'string', format: 'email' });
module.exports = (x) => validate(x) || ajv.errorsText(validate.errors);
const note = "import Ajv from 'ajv' inside a string is not an import either";
