'use strict';
// The uniqueItems duplicate search (lib/unique-dup.js), for the 2.0
// Validator: Validator.use(uniqueItems). The engines take it when they build
// a uniqueItems node, so a call reads no slot.
const { duplicatePair, allDistinct } = require('../unique-dup');
module.exports = { uniqueItems: Object.freeze({ name: 'uniqueItems', duplicatePair, allDistinct }) };
