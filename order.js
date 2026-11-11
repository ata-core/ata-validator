'use strict';

// ata-validator/order: a list of errors in schema declaration order, the
// order `new Validator(schema)` reports them in. A module written for
// ata-validator/compiled-plain imports it when its own program cannot order
// every list it reports; a page whose modules all can does not carry it.
const { sortErrorsByRank } = require('./lib/error-sort-rank');

module.exports = { ordered: (schema, errors) => sortErrorsByRank(schema, errors) };
