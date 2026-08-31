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

// RFC 3339 date-time, read once. The form this replaces ran a regular
// expression for the shape and then `Date.parse` for the calendar, which
// builds a date object to answer a question about the string. Everything the
// parse rejected is checked here directly: month, the day count for that month
// in that year, and the ranges of the clock and the offset.
function daysInMonth (year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function twoDigits (s, i) {
  return (s.charCodeAt(i) - 48) * 10 + (s.charCodeAt(i + 1) - 48);
}

function dateTime (s) {
  const n = s.length;
  // The shortest accepted form is 2026-08-31T12:00:00Z
  if (n < 20) return false;
  for (let i = 0; i < 19; i++) {
    const c = s.charCodeAt(i);
    if (i === 4 || i === 7) { if (c !== 45) return false; continue; }
    if (i === 10) { if (c !== 84 && c !== 116) return false; continue; }
    if (i === 13 || i === 16) { if (c !== 58) return false; continue; }
    if (c < 48 || c > 57) return false;
  }

  const year = (s.charCodeAt(0) - 48) * 1000 + (s.charCodeAt(1) - 48) * 100 +
    (s.charCodeAt(2) - 48) * 10 + (s.charCodeAt(3) - 48);
  const month = twoDigits(s, 5);
  if (month < 1 || month > 12) return false;
  const day = twoDigits(s, 8);
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (twoDigits(s, 11) > 23) return false;
  if (twoDigits(s, 14) > 59) return false;
  if (twoDigits(s, 17) > 59) return false;

  let i = 19;
  if (s.charCodeAt(i) === 46) {
    i++;
    const start = i;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c < 48 || c > 57) break;
      i++;
    }
    if (i === start) return false;
  }

  const c = s.charCodeAt(i);
  if (c === 90 || c === 122) return i === n - 1;
  if (c !== 43 && c !== 45) return false;
  if (n - i !== 6) return false;
  if (!isDigit(s.charCodeAt(i + 1)) || !isDigit(s.charCodeAt(i + 2))) return false;
  if (s.charCodeAt(i + 3) !== 58) return false;
  if (!isDigit(s.charCodeAt(i + 4)) || !isDigit(s.charCodeAt(i + 5))) return false;
  if (twoDigits(s, i + 1) > 23) return false;
  if (twoDigits(s, i + 4) > 59) return false;
  return true;
}

// Four decimal octets, no leading zeros, no empty octets, nothing else.
// Also used for the dotted tail of an IPv4-mapped IPv6 address, which is why
// the work is done over a range rather than a whole string: taking a slice for
// it would allocate on a path that exists to avoid allocating.
function ipv4 (s) {
  return ipv4Range(s, 0, s.length);
}

function ipv4Range (s, from, to) {
  const n = to - from;
  if (n < 7 || n > 15) return false;
  let octets = 0, value = 0, digits = 0;
  for (let i = from; i <= to; i++) {
    const c = i < to ? s.charCodeAt(i) : 46;
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

// RFC 4291 address: up to eight groups of one to four hex digits, at most one
// run of "::" standing in for the zero groups, and an optional dotted IPv4
// tail in the last position, which counts as two groups. The forms this
// replaces were a character-class test plus two `split(':')` calls, which
// allocated twice and accepted things like "12345::1"; they also disagreed
// with each other about an IPv4 tail. Answers match Node's own `net.isIPv6`,
// which the test uses as its oracle.
function ipv6 (s) {
  const n = s.length;
  if (n < 2 || n > 45) return false;

  let end = n;
  let groups = 0;
  // A dot can only belong to a trailing IPv4 address, which fills two groups.
  const dot = s.indexOf('.');
  if (dot !== -1) {
    const lastColon = s.lastIndexOf(':', dot);
    if (lastColon === -1) return false;
    if (!ipv4Range(s, lastColon + 1, n)) return false;
    end = lastColon + 1;   // keep the colon: the group scan ends on it
    groups = 2;
  }

  let compressed = false;
  let digits = 0;
  let i = 0;

  if (s.charCodeAt(0) === 58 && s.charCodeAt(1) !== 58) return false;

  while (i < end) {
    const c = s.charCodeAt(i);
    if (c === 58) {
      if (digits > 0) { groups++; digits = 0; }
      if (i + 1 < n && s.charCodeAt(i + 1) === 58) {
        if (compressed) return false;
        compressed = true;
        i += 2;
        if (i < n && s.charCodeAt(i) === 58) return false;
        continue;
      }
      i++;
      // A single colon must have something on both sides, and the group scan
      // ending on a colon only happens when an IPv4 tail follows it.
      if (i === end && end === n) return false;
      continue;
    }
    if (isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)) {
      if (++digits > 4) return false;
      i++;
      continue;
    }
    return false;
  }
  if (digits > 0) groups++;

  if (groups > 8) return false;
  return compressed ? groups < 8 : groups === 8;
}

// Labels of letters, digits and hyphens, each 1 to 63 characters, none
// starting or ending with a hyphen, joined by single dots, 253 characters at
// most. Same answers as the expression it replaces, read once.
function hostname (s) {
  const n = s.length;
  if (n === 0 || n > 253) return false;
  let labelLength = 0;
  let previous = 46; // a dot, so a leading hyphen is refused like a leading dot
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 46) {
      if (labelLength === 0 || previous === 45) return false;
      labelLength = 0;
      previous = c;
      continue;
    }
    const alnum = isDigit(c) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
    if (!alnum && c !== 45) return false;
    if (c === 45 && previous === 46) return false; // label starts with a hyphen
    if (++labelLength > 63) return false;
    previous = c;
  }
  return labelLength !== 0 && previous !== 45;
}

// A scheme followed by a colon, and no control characters or spaces after it.
// Two expressions became one pass: the scheme is read from the front and the
// rest of the string is scanned once for characters a URI cannot hold.
function uri (s) {
  const n = s.length;
  if (n === 0) return false;
  const first = s.charCodeAt(0);
  if (!((first >= 97 && first <= 122) || (first >= 65 && first <= 90))) return false;
  let colon = -1;
  for (let i = 1; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 58) { colon = i; break; }
    // scheme characters: letters, digits, "+", "-", "."
    if (!(isDigit(c) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90) ||
      c === 43 || c === 45 || c === 46)) return false;
  }
  if (colon === -1) return false;
  return !RESERVED.test(s);
}

// Anything without a control character or whitespace. Kept as one expression
// because it has to match the whole of Unicode whitespace, not just ASCII.
const RESERVED = /[\s\u0000-\u001f\u007f]/;

function uriReference (s) {
  return !RESERVED.test(s);
}

// Source twins. `v` is the expression holding the string; when `isStr` is
// false the check is wrapped in a typeof guard, matching FORMAT_CODEGEN's
// convention. Each returns a statement that `return false`s on mismatch.
function guard (v, isStr, body) { return isStr ? `{${body}}` : `if(typeof ${v}==='string'){${body}}`; }

function dateSource (v, isStr) {
  return guard(v, isStr, `if(${v}.length!==10)return false;for(let _i=0;_i<10;_i++){const _c=${v}.charCodeAt(_i);if(_i===4||_i===7){if(_c!==45)return false}else if(_c<48||_c>57)return false}const _m=(${v}.charCodeAt(5)-48)*10+(${v}.charCodeAt(6)-48),_d=(${v}.charCodeAt(8)-48)*10+(${v}.charCodeAt(9)-48);if(_m<1||_m>12||_d<1||_d>31)return false`);
}

function dateTimeSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n<20)return false;for(let _i=0;_i<19;_i++){const _c=${v}.charCodeAt(_i);if(_i===4||_i===7){if(_c!==45)return false;continue}if(_i===10){if(_c!==84&&_c!==116)return false;continue}if(_i===13||_i===16){if(_c!==58)return false;continue}if(_c<48||_c>57)return false}` +
    `const _y=(${v}.charCodeAt(0)-48)*1000+(${v}.charCodeAt(1)-48)*100+(${v}.charCodeAt(2)-48)*10+(${v}.charCodeAt(3)-48);` +
    `const _mo=(${v}.charCodeAt(5)-48)*10+(${v}.charCodeAt(6)-48);if(_mo<1||_mo>12)return false;` +
    `const _dm=_mo===2?(((_y%4===0&&_y%100!==0)||_y%400===0)?29:28):(_mo===4||_mo===6||_mo===9||_mo===11?30:31);` +
    `const _d=(${v}.charCodeAt(8)-48)*10+(${v}.charCodeAt(9)-48);if(_d<1||_d>_dm)return false;` +
    `if((${v}.charCodeAt(11)-48)*10+(${v}.charCodeAt(12)-48)>23)return false;` +
    `if((${v}.charCodeAt(14)-48)*10+(${v}.charCodeAt(15)-48)>59)return false;` +
    `if((${v}.charCodeAt(17)-48)*10+(${v}.charCodeAt(18)-48)>59)return false;` +
    `let _i2=19;if(${v}.charCodeAt(19)===46){_i2=20;const _st=_i2;while(_i2<_n){const _c2=${v}.charCodeAt(_i2);if(_c2<48||_c2>57)break;_i2++}if(_i2===_st)return false}` +
    `const _tz=${v}.charCodeAt(_i2);` +
    `if(_tz===90||_tz===122){if(_i2!==_n-1)return false}` +
    `else{if(_tz!==43&&_tz!==45)return false;if(_n-_i2!==6)return false;` +
    `const _oh=${v}.charCodeAt(_i2+1),_oh2=${v}.charCodeAt(_i2+2),_om=${v}.charCodeAt(_i2+4),_om2=${v}.charCodeAt(_i2+5);` +
    `if(_oh<48||_oh>57||_oh2<48||_oh2>57||_om<48||_om>57||_om2<48||_om2>57)return false;` +
    `if(${v}.charCodeAt(_i2+3)!==58)return false;` +
    `if((_oh-48)*10+(_oh2-48)>23)return false;if((_om-48)*10+(_om2-48)>59)return false}`);
}

function hostnameSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n===0||_n>253)return false;let _ll=0,_pv=46;` +
    `for(let _i=0;_i<_n;_i++){const _c=${v}.charCodeAt(_i);` +
    `if(_c===46){if(_ll===0||_pv===45)return false;_ll=0;_pv=_c;continue}` +
    `const _an=(_c>=48&&_c<=57)||(_c>=97&&_c<=122)||(_c>=65&&_c<=90);` +
    `if(!_an&&_c!==45)return false;` +
    `if(_c===45&&_pv===46)return false;` +
    `if(++_ll>63)return false;_pv=_c}` +
    `if(_ll===0||_pv===45)return false`);
}

function uriSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n===0)return false;` +
    `const _f=${v}.charCodeAt(0);if(!((_f>=97&&_f<=122)||(_f>=65&&_f<=90)))return false;` +
    `let _co=-1;for(let _i=1;_i<_n;_i++){const _c=${v}.charCodeAt(_i);if(_c===58){_co=_i;break}` +
    `if(!((_c>=48&&_c<=57)||(_c>=97&&_c<=122)||(_c>=65&&_c<=90)||_c===43||_c===45||_c===46))return false}` +
    `if(_co===-1)return false;` +
    `if(/[\\s\\u0000-\\u001f\\u007f]/.test(${v}))return false`);
}

function ipv6Source (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n<2||_n>45)return false;let _end=_n,_g=0;` +
    `const _dot=${v}.indexOf('.');` +
    `if(_dot!==-1){const _lc=${v}.lastIndexOf(':',_dot);if(_lc===-1)return false;` +
    `{const _f=_lc+1,_t=_n,_ln=_t-_f;if(_ln<7||_ln>15)return false;let _o=0,_val=0,_dg=0;` +
    `for(let _i=_f;_i<=_t;_i++){const _c=_i<_t?${v}.charCodeAt(_i):46;` +
    `if(_c===46){if(_dg===0||_val>255)return false;_o++;_val=0;_dg=0;if(_o>4)return false}` +
    `else if(_c>=48&&_c<=57){if(_dg===1&&_val===0)return false;_val=_val*10+(_c-48);_dg++;if(_dg>3)return false}` +
    `else return false}if(_o!==4)return false}` +
    `_end=_lc+1;_g=2}` +
    `let _cp=false,_dg2=0,_i2=0;` +
    `if(${v}.charCodeAt(0)===58&&${v}.charCodeAt(1)!==58)return false;` +
    `while(_i2<_end){const _c2=${v}.charCodeAt(_i2);` +
    `if(_c2===58){if(_dg2>0){_g++;_dg2=0}` +
    `if(_i2+1<_n&&${v}.charCodeAt(_i2+1)===58){if(_cp)return false;_cp=true;_i2+=2;if(_i2<_n&&${v}.charCodeAt(_i2)===58)return false;continue}` +
    `_i2++;if(_i2===_end&&_end===_n)return false;continue}` +
    `if((_c2>=48&&_c2<=57)||(_c2>=97&&_c2<=102)||(_c2>=65&&_c2<=70)){if(++_dg2>4)return false;_i2++;continue}` +
    `return false}` +
    `if(_dg2>0)_g++;if(_g>8)return false;if(_cp){if(_g>=8)return false}else if(_g!==8)return false`);
}

function ipv4Source (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n<7||_n>15)return false;let _o=0,_val=0,_dg=0;for(let _i=0;_i<=_n;_i++){const _c=_i<_n?${v}.charCodeAt(_i):46;if(_c===46){if(_dg===0||_val>255)return false;_o++;_val=0;_dg=0;if(_o>4)return false}else if(_c>=48&&_c<=57){if(_dg===1&&_val===0)return false;_val=_val*10+(_c-48);_dg++;if(_dg>3)return false}else return false}if(_o!==4)return false`);
}

module.exports = { date, ipv4, dateTime, ipv6, hostname, uri, uriReference, dateSource, ipv4Source, dateTimeSource, ipv6Source, hostnameSource, uriSource };
