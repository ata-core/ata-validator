'use strict';

// Format predicates that read the string once, with no regular expression
// and no allocation. Each has a twin that emits the same check as source for
// the code generator; tests/test_formats_single_pass.js holds the two
// together and fuzzes both against the regular-expression forms they replaced.
// Measured, interleaved medians: date 45.7 to 14.2 ns, ipv4 54.5 to 27.1 ns.
// uuid was tried the same way and measured 57.3 against 59.4 ns: V8's regular
// expression for a fixed-length hex pattern is already that fast, so it stays.

function isDigit (c) { return c >= 48 && c <= 57; }

function date (s) {
  if (s.length !== 10) return false;
  for (let i = 0; i < 10; i++) {
    const c = s.charCodeAt(i);
    if (i === 4 || i === 7) { if (c !== 45) return false; } else if (!isDigit(c)) return false;
  }
  const m = (s.charCodeAt(5) - 48) * 10 + (s.charCodeAt(6) - 48);
  const d = (s.charCodeAt(8) - 48) * 10 + (s.charCodeAt(9) - 48);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

// Four decimal octets, no leading zeros, no empty octets, nothing else.
function ipv4 (s) {
  const n = s.length;
  if (n < 7 || n > 15) return false;
  let octets = 0, value = 0, digits = 0;
  for (let i = 0; i <= n; i++) {
    const c = i < n ? s.charCodeAt(i) : 46;
    if (c === 46) {
      if (digits === 0 || value > 255) return false;
      octets++; value = 0; digits = 0;
      if (octets > 4) return false;
    } else if (isDigit(c)) {
      if (digits === 1 && value === 0) return false;
      value = value * 10 + (c - 48); digits++;
      if (digits > 3) return false;
    } else return false;
  }
  return octets === 4;
}

// Source twins. `v` is the expression holding the string; when `isStr` is
// false the check is wrapped in a typeof guard, matching FORMAT_CODEGEN's
// convention. Each returns a statement that `return false`s on mismatch.
function guard (v, isStr, body) { return isStr ? `{${body}}` : `if(typeof ${v}==='string'){${body}}`; }

function dateSource (v, isStr) {
  return guard(v, isStr, `if(${v}.length!==10)return false;for(let _i=0;_i<10;_i++){const _c=${v}.charCodeAt(_i);if(_i===4||_i===7){if(_c!==45)return false}else if(_c<48||_c>57)return false}const _m=(${v}.charCodeAt(5)-48)*10+(${v}.charCodeAt(6)-48),_d=(${v}.charCodeAt(8)-48)*10+(${v}.charCodeAt(9)-48);if(_m<1||_m>12||_d<1||_d>31)return false`);
}

function ipv4Source (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n<7||_n>15)return false;let _o=0,_val=0,_dg=0;for(let _i=0;_i<=_n;_i++){const _c=_i<_n?${v}.charCodeAt(_i):46;if(_c===46){if(_dg===0||_val>255)return false;_o++;_val=0;_dg=0;if(_o>4)return false}else if(_c>=48&&_c<=57){if(_dg===1&&_val===0)return false;_val=_val*10+(_c-48);_dg++;if(_dg>3)return false}else return false}if(_o!==4)return false`);
}

module.exports = { date, ipv4, dateSource, ipv4Source };
