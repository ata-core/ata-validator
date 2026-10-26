'use strict';

// Every RFC 4291 text form of an IPv6 address as one expression: eight groups,
// or a "::" standing for one or more groups of zeros with up to seven groups
// around it, the last 32 bits optionally a dotted quad. ipv6() in lib/formats.js
// is the fast check; this is the short one, which an email address literal in a
// compiled module carries instead of the parser (2.2 KB of every module that
// checks an email). tests/test_ipv6_expression.js holds the two to the same
// answer.
const IPV6_RE = (() => {
  // A dotted quad, as lib/formats.js reads one.
  const v4 = require('./formats').IPV4.source.slice(1, -1);
  const h = '[0-9A-Fa-f]{1,4}';
  const alts = [`(?:${h}:){7}${h}`, `(?:${h}:){6}${v4}`];
  for (let k = 0; k <= 7; k++) {
    const left = k === 0 ? '' : `(?:${h}:){${k - 1}}${h}`;
    alts.push(k === 7 ? `${left}::` : `${left}::(?:(?:${h}:){0,${6 - k}}${h})?`);
    if (k <= 5) alts.push(`${left}::(?:(?:${h}:){0,${5 - k}})?${v4}`);
  }
  return new RegExp(`^(?:${alts.join('|')})$`);
})();

// `_in` is the text between the brackets; the check returns false from the
// function it is written into when the literal is not an address.
let _src = null;
module.exports = () => _src || (_src =
  `if((_in.charCodeAt(0)|32)===105&&(_in.charCodeAt(1)|32)===112&&(_in.charCodeAt(2)|32)===118&&_in.charCodeAt(3)===54&&_in.charCodeAt(4)===58){const _i6=_in.slice(5);if(_i6.length>45||!${IPV6_RE}.test(_i6))return false}` +
  `else if(_in.length>15||!${require('./formats').IPV4}.test(_in))return false`);
module.exports.IPV6_RE = IPV6_RE;
