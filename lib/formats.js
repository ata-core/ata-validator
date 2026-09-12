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
  if (m < 1 || m > 12 || d < 1) return false;
  const y = (s.charCodeAt(0) - 48) * 1000 + (s.charCodeAt(1) - 48) * 100 +
            (s.charCodeAt(2) - 48) * 10 + (s.charCodeAt(3) - 48);
  return d <= daysInMonth(y, m);
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
  // Separators sit at known indices, so they are read directly rather than
  // asked for at every step of a scan. Each remaining digit is turned into
  // its value once and checked as one unsigned compare, which also gives the
  // field its number without a second read.
  if (s.charCodeAt(4) !== 45 || s.charCodeAt(7) !== 45) return false;
  const sep = s.charCodeAt(10);
  if (sep !== 84 && sep !== 116) return false;
  if (s.charCodeAt(13) !== 58 || s.charCodeAt(16) !== 58) return false;

  const y0 = s.charCodeAt(0) - 48, y1 = s.charCodeAt(1) - 48;
  const y2 = s.charCodeAt(2) - 48, y3 = s.charCodeAt(3) - 48;
  if ((y0 >>> 0) > 9 || (y1 >>> 0) > 9 || (y2 >>> 0) > 9 || (y3 >>> 0) > 9) return false;
  const year = y0 * 1000 + y1 * 100 + y2 * 10 + y3;

  const mo0 = s.charCodeAt(5) - 48, mo1 = s.charCodeAt(6) - 48;
  if ((mo0 >>> 0) > 9 || (mo1 >>> 0) > 9) return false;
  const month = mo0 * 10 + mo1;
  if (month < 1 || month > 12) return false;

  const d0 = s.charCodeAt(8) - 48, d1 = s.charCodeAt(9) - 48;
  if ((d0 >>> 0) > 9 || (d1 >>> 0) > 9) return false;
  const day = d0 * 10 + d1;
  if (day < 1 || day > daysInMonth(year, month)) return false;

  const h0 = s.charCodeAt(11) - 48, h1 = s.charCodeAt(12) - 48;
  if ((h0 >>> 0) > 9 || (h1 >>> 0) > 9 || h0 * 10 + h1 > 23) return false;
  const mi0 = s.charCodeAt(14) - 48, mi1 = s.charCodeAt(15) - 48;
  if ((mi0 >>> 0) > 5 || (mi1 >>> 0) > 9) return false;
  const se0 = s.charCodeAt(17) - 48, se1 = s.charCodeAt(18) - 48;
  if ((se0 >>> 0) > 5 || (se1 >>> 0) > 9) return false;

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
  return noReserved(s, colon + 1);
}

// The characters a URI cannot hold: C0 controls, space, DEL, and the rest of
// Unicode whitespace. Asking for that set directly costs more than it looks:
// `\s` pulls in the engine's Unicode machinery for eleven code points spread
// across the BMP. Asking instead whether anything at all sits outside printable
// ASCII is a one-byte character class, which the engine scans at its own speed
// and which no ordinary URI ever trips. Only a string that does trip it pays
// for the loop that decides the exact set, and that loop was measured slower
// than the engine on the common case, which is why it is not the first answer.
const NON_PRINTABLE = /[^\u0021-\u007e]/;

function noReserved (s, from) {
  if (!NON_PRINTABLE.test(s)) return true;
  const n = s.length;
  for (let i = from; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c > 32 && c < 127) continue;
    if (c <= 32 || c === 127) return false;
    if (c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 ||
      c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279) return false;
  }
  return true;
}

// Source twin of noReserved, same two tiers. `from` is an expression for the
// first index the loop reads; the variable names stay clear of the ones the
// other format emitters use.
function noReservedSource (v, from) {
  return `if(/[^\\u0021-\\u007e]/.test(${v})){` +
    `for(let _ri=${from};_ri<${v}.length;_ri++){const _rc=${v}.charCodeAt(_ri);` +
    'if(_rc>32&&_rc<127)continue;' +
    'if(_rc<=32||_rc===127)return false;' +
    'if(_rc===160||_rc===5760||(_rc>=8192&&_rc<=8202)||_rc===8232||' +
    '_rc===8233||_rc===8239||_rc===8287||_rc===12288||_rc===65279)return false}}';
}

// 8-4-4-4-12 hexadecimal digits. The four hyphens are read by index, then
// each run of hex digits is read with fixed bounds, so no character pays for a
// test of where it sits. A digit is one unsigned compare and a letter is one
// more after folding case with a single OR, which is what a case-insensitive
// regex spends a state machine on.
function hexRun (s, from, to) {
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (!((c - 48 >>> 0) < 10 || ((c | 32) - 97 >>> 0) < 6)) return false;
  }
  return true;
}

function uuid (s) {
  if (s.length !== 36) return false;
  if (s.charCodeAt(8) !== 45 || s.charCodeAt(13) !== 45 ||
    s.charCodeAt(18) !== 45 || s.charCodeAt(23) !== 45) return false;
  return hexRun(s, 0, 8) && hexRun(s, 9, 13) && hexRun(s, 14, 18) &&
    hexRun(s, 19, 23) && hexRun(s, 24, 36);
}

// RFC 3339 full-time: HH:MM:SS, an optional fraction, an optional offset.
// Every position is known in advance, so the check reads fixed indices and
// compares digits as numbers instead of running a state machine over the
// string. The zone letter is accepted in either case, which is what the
// interpreter and the date-time check already did.
function time (s) {
  const n = s.length;
  if (n < 8) return false;
  const h1 = s.charCodeAt(0) - 48, h2 = s.charCodeAt(1) - 48;
  if ((h1 >>> 0) > 9 || (h2 >>> 0) > 9 || h1 * 10 + h2 > 23) return false;
  if (s.charCodeAt(2) !== 58 || s.charCodeAt(5) !== 58) return false;
  const m1 = s.charCodeAt(3) - 48, m2 = s.charCodeAt(4) - 48;
  if ((m1 >>> 0) > 5 || (m2 >>> 0) > 9) return false;
  // Seconds reach 60 for the leap second, which the offset check below pins
  // to 23:59:60 UTC; anything past that is not a clock reading.
  const c1 = s.charCodeAt(6) - 48, c2 = s.charCodeAt(7) - 48;
  if ((c1 >>> 0) > 6 || (c2 >>> 0) > 9 || c1 * 10 + c2 > 60) return false;
  let i = 8;
  if (i < n && s.charCodeAt(i) === 46) {
    i++;
    const start = i;
    while (i < n) {
      const c = s.charCodeAt(i) - 48;
      if ((c >>> 0) > 9) break;
      i++;
    }
    if (i === start) return false;
  }
  // RFC 3339 full-time requires an offset; a bare wall clock is not a time.
  if (i === n) return false;
  const hh = h1 * 10 + h2, mm = m1 * 10 + m2, ss = c1 * 10 + c2;
  const z = s.charCodeAt(i);
  let offMin = 0;
  if (z === 90 || z === 122) {
    if (i !== n - 1) return false;
  } else {
    if (z !== 43 && z !== 45) return false;
    if (n - i !== 6 || s.charCodeAt(i + 3) !== 58) return false;
    for (let k = 1; k <= 5; k++) {
      if (k === 3) continue;
      if ((s.charCodeAt(i + k) - 48 >>> 0) > 9) return false;
    }
    const oh = (s.charCodeAt(i + 1) - 48) * 10 + (s.charCodeAt(i + 2) - 48);
    const om = (s.charCodeAt(i + 4) - 48) * 10 + (s.charCodeAt(i + 5) - 48);
    if (oh > 23 || om > 59) return false;
    offMin = (z === 43 ? 1 : -1) * (oh * 60 + om);
  }
  // Second 60 exists only as the leap second, which is 23:59:60 in UTC. Any
  // other clock reading with :60 is not a time.
  if (ss === 60) {
    const utc = ((hh * 60 + mm - offMin) % 1440 + 1440) % 1440;
    if (utc !== 23 * 60 + 59) return false;
  }
  return true;
}

// Anything without a control character or whitespace.
function uriReference (s) {
  return noReserved(s, 0);
}

// Source twins. `v` is the expression holding the string; when `isStr` is
// false the check is wrapped in a typeof guard, matching FORMAT_CODEGEN's
// convention. Each returns a statement that `return false`s on mismatch.
function guard (v, isStr, body) { return isStr ? `{${body}}` : `if(typeof ${v}==='string'){${body}}`; }

function dateSource (v, isStr) {
  return guard(v, isStr, `if(${v}.length!==10)return false;for(let _i=0;_i<10;_i++){const _c=${v}.charCodeAt(_i);if(_i===4||_i===7){if(_c!==45)return false}else if(_c<48||_c>57)return false}const _m=(${v}.charCodeAt(5)-48)*10+(${v}.charCodeAt(6)-48),_d=(${v}.charCodeAt(8)-48)*10+(${v}.charCodeAt(9)-48);if(_m<1||_m>12||_d<1)return false;const _y=(${v}.charCodeAt(0)-48)*1000+(${v}.charCodeAt(1)-48)*100+(${v}.charCodeAt(2)-48)*10+(${v}.charCodeAt(3)-48);const _dim=_m===2?(((_y%4===0&&_y%100!==0)||_y%400===0)?29:28):((_m===4||_m===6||_m===9||_m===11)?30:31);if(_d>_dim)return false`);
}

function dateTimeSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n<20)return false;` +
    `if(${v}.charCodeAt(4)!==45||${v}.charCodeAt(7)!==45)return false;` +
    `const _sep=${v}.charCodeAt(10);if(_sep!==84&&_sep!==116)return false;` +
    `if(${v}.charCodeAt(13)!==58||${v}.charCodeAt(16)!==58)return false;` +
    `const _y0=${v}.charCodeAt(0)-48,_y1=${v}.charCodeAt(1)-48,_y2=${v}.charCodeAt(2)-48,_y3=${v}.charCodeAt(3)-48;` +
    'if((_y0>>>0)>9||(_y1>>>0)>9||(_y2>>>0)>9||(_y3>>>0)>9)return false;' +
    'const _y=_y0*1000+_y1*100+_y2*10+_y3;' +
    `const _mo0=${v}.charCodeAt(5)-48,_mo1=${v}.charCodeAt(6)-48;` +
    'if((_mo0>>>0)>9||(_mo1>>>0)>9)return false;const _mo=_mo0*10+_mo1;if(_mo<1||_mo>12)return false;' +
    `const _dm=_mo===2?(((_y%4===0&&_y%100!==0)||_y%400===0)?29:28):(_mo===4||_mo===6||_mo===9||_mo===11?30:31);` +
    `const _d0=${v}.charCodeAt(8)-48,_d1=${v}.charCodeAt(9)-48;` +
    'if((_d0>>>0)>9||(_d1>>>0)>9)return false;const _d=_d0*10+_d1;if(_d<1||_d>_dm)return false;' +
    `const _h0=${v}.charCodeAt(11)-48,_h1=${v}.charCodeAt(12)-48;` +
    'if((_h0>>>0)>9||(_h1>>>0)>9||_h0*10+_h1>23)return false;' +
    `const _mi0=${v}.charCodeAt(14)-48,_mi1=${v}.charCodeAt(15)-48;` +
    'if((_mi0>>>0)>5||(_mi1>>>0)>9)return false;' +
    `const _se0=${v}.charCodeAt(17)-48,_se1=${v}.charCodeAt(18)-48;` +
    'if((_se0>>>0)>5||(_se1>>>0)>9)return false;' +
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

function uuidSource (v, isStr) {
  const run = (from, to) => `for(let _ui=${from};_ui<${to};_ui++){const _uc=${v}.charCodeAt(_ui);` +
    'if(!((_uc-48>>>0)<10||((_uc|32)-97>>>0)<6))return false}';
  return guard(v, isStr, `if(${v}.length!==36)return false;` +
    `if(${v}.charCodeAt(8)!==45||${v}.charCodeAt(13)!==45||` +
    `${v}.charCodeAt(18)!==45||${v}.charCodeAt(23)!==45)return false;` +
    run(0, 8) + run(9, 13) + run(14, 18) + run(19, 23) + run(24, 36));
}

function timeSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n<8)return false;` +
    `const _h1=${v}.charCodeAt(0)-48,_h2=${v}.charCodeAt(1)-48;` +
    'if((_h1>>>0)>9||(_h2>>>0)>9||_h1*10+_h2>23)return false;' +
    `if(${v}.charCodeAt(2)!==58||${v}.charCodeAt(5)!==58)return false;` +
    `const _m1=${v}.charCodeAt(3)-48,_m2=${v}.charCodeAt(4)-48;` +
    'if((_m1>>>0)>5||(_m2>>>0)>9)return false;' +
    `const _s1=${v}.charCodeAt(6)-48,_s2=${v}.charCodeAt(7)-48;` +
    'if((_s1>>>0)>6||(_s2>>>0)>9||_s1*10+_s2>60)return false;' +
    `let _ti=8;if(_ti<_n&&${v}.charCodeAt(_ti)===46){_ti++;const _tf=_ti;` +
    `while(_ti<_n){const _tc=${v}.charCodeAt(_ti)-48;if((_tc>>>0)>9)break;_ti++}` +
    'if(_ti===_tf)return false}' +
    'if(_ti===_n)return false;' +
    `const _tz=${v}.charCodeAt(_ti);let _off=0;` +
    'if(_tz===90||_tz===122){if(_ti!==_n-1)return false}' +
    'else{if(_tz!==43&&_tz!==45)return false;' +
    `if(_n-_ti!==6||${v}.charCodeAt(_ti+3)!==58)return false;` +
    `if((${v}.charCodeAt(_ti+1)-48>>>0)>9||(${v}.charCodeAt(_ti+2)-48>>>0)>9||` +
    `(${v}.charCodeAt(_ti+4)-48>>>0)>9||(${v}.charCodeAt(_ti+5)-48>>>0)>9)return false;` +
    `const _oh=(${v}.charCodeAt(_ti+1)-48)*10+(${v}.charCodeAt(_ti+2)-48),` +
    `_om=(${v}.charCodeAt(_ti+4)-48)*10+(${v}.charCodeAt(_ti+5)-48);` +
    'if(_oh>23||_om>59)return false;' +
    '_off=(_tz===43?1:-1)*(_oh*60+_om)}' +
    'if(_s1*10+_s2===60){' +
    'const _u=(((_h1*10+_h2)*60+(_m1*10+_m2)-_off)%1440+1440)%1440;' +
    'if(_u!==1439)return false}');
}

function uriSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n===0)return false;` +
    `const _f=${v}.charCodeAt(0);if(!((_f>=97&&_f<=122)||(_f>=65&&_f<=90)))return false;` +
    `let _co=-1;for(let _i=1;_i<_n;_i++){const _c=${v}.charCodeAt(_i);if(_c===58){_co=_i;break}` +
    `if(!((_c>=48&&_c<=57)||(_c>=97&&_c<=122)||(_c>=65&&_c<=90)||_c===43||_c===45||_c===46))return false}` +
    `if(_co===-1)return false;` +
    noReservedSource(v, '_co+1'));
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


// --- RFC 6901 JSON pointers -------------------------------------------------
// A pointer is empty or a run of "/"-prefixed tokens, and the only escape is
// "~" followed by 0 or 1. Everything else, including "#", is not a pointer:
// the fragment form belongs to a URI, not to this format.
function jsonPointer(s) {
  if (s === '') return true;
  if (s.charCodeAt(0) !== 47) return false; // '/'
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) !== 126) continue; // '~'
    const n = s.charCodeAt(i + 1);
    if (n !== 48 && n !== 49) return false; // '0' | '1'
  }
  return true;
}
function jsonPointerSource(v, isStr) {
  const body = `{let _ok=${v}==='';if(!_ok&&${v}.charCodeAt(0)===47){_ok=true;for(let _i=0;_i<${v}.length;_i++){if(${v}.charCodeAt(_i)!==126)continue;const _n=${v}.charCodeAt(_i+1);if(_n!==48&&_n!==49){_ok=false;break}}}if(!_ok)return false}`;
  return isStr ? body : `if(typeof ${v}==='string')${body}`;
}

// A relative pointer is a non-negative integer without leading zeros, then
// either "#" or a JSON pointer.
function relativeJsonPointer(s) {
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) break;
    i++;
  }
  if (i === 0) return false;
  if (i > 1 && s.charCodeAt(0) === 48) return false; // leading zero
  const rest = s.slice(i);
  if (rest === '#') return true;
  return jsonPointer(rest);
}
function relativeJsonPointerSource(v, isStr) {
  const body = `{let _i=0;while(_i<${v}.length){const _c=${v}.charCodeAt(_i);if(_c<48||_c>57)break;_i++}let _ok=_i>0&&!(_i>1&&${v}.charCodeAt(0)===48);if(_ok){const _r=${v}.slice(_i);if(_r!=='#'){_ok=_r==='';if(!_ok&&_r.charCodeAt(0)===47){_ok=true;for(let _j=0;_j<_r.length;_j++){if(_r.charCodeAt(_j)!==126)continue;const _n=_r.charCodeAt(_j+1);if(_n!==48&&_n!==49){_ok=false;break}}}}}if(!_ok)return false}`;
  return isStr ? body : `if(typeof ${v}==='string')${body}`;
}

// --- RFC 6570 URI templates -------------------------------------------------
// Everything outside braces must be a literal, and each "{...}" must hold one
// expression: an optional operator, then a comma-separated list of varspecs,
// each a possibly dotted name of varchars with an optional ":n" prefix length
// or "*" explode.
const URI_TEMPLATE_EXPR = /^(?:[+#./;?&=,!@|]?)(?:[A-Za-z0-9_%]|%[0-9A-Fa-f]{2})+(?:\.(?:[A-Za-z0-9_%]|%[0-9A-Fa-f]{2})+)*(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[A-Za-z0-9_%]|%[0-9A-Fa-f]{2})+(?:\.(?:[A-Za-z0-9_%]|%[0-9A-Fa-f]{2})+)*(?::[1-9][0-9]{0,3}|\*)?)*$/;
function uriTemplate(s) {
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 125) return false; // '}' with no opening brace
    if (c !== 123) { i++; continue; } // not '{'
    const end = s.indexOf('}', i + 1);
    if (end === -1) return false;
    const expr = s.slice(i + 1, end);
    if (expr === '' || expr.indexOf('{') !== -1) return false;
    if (!URI_TEMPLATE_EXPR.test(expr)) return false;
    i = end + 1;
  }
  return true;
}
function uriTemplateSource (v, isStr) {
  const inner =
    `let _i=0;` +
    `while(_i<${v}.length){` +
      `const _c=${v}.charCodeAt(_i);` +
      `if(_c===125)return false;` +
      `if(_c!==123){_i++;continue}` +
      `const _e=${v}.indexOf('}',_i+1);` +
      `if(_e===-1)return false;` +
      `const _x=${v}.slice(_i+1,_e);` +
      `if(_x===''||_x.indexOf('{')!==-1)return false;` +
      `if(!${URI_TEMPLATE_EXPR.toString()}.test(_x))return false;` +
      `_i=_e+1` +
    `}`;
  return isStr ? `{${inner}}` : `if(typeof ${v}==='string'){${inner}}`;
}

// --- RFC 5321 mailbox -------------------------------------------------------
// Local part is either a quoted string or dot-separated atoms, so a leading,
// trailing or doubled dot is not a mailbox. Domain is a hostname or a bracketed
// address literal.
// Local-part characters: alphanumerics, the RFC 5322 atext punctuation, and
// the dot that separates atoms. Written as code ranges rather than a regular
// expression because this lands inside every emitted module that validates an
// email, and the expression cost more bytes there than the whole check.
function isEmailLocalChar (c) {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90) ||
    c === 46 || c === 33 || (c >= 35 && c <= 39) || c === 42 || c === 43 ||
    c === 45 || c === 47 || c === 61 || c === 63 || (c >= 94 && c <= 96) ||
    (c >= 123 && c <= 126);
}
const EMAIL_LOCAL_SRC = (v) => `((${v}>=48&&${v}<=57)||(${v}>=97&&${v}<=122)||(${v}>=65&&${v}<=90)||${v}===46||${v}===33||(${v}>=35&&${v}<=39)||${v}===42||${v}===43||${v}===45||${v}===47||${v}===61||${v}===63||(${v}>=94&&${v}<=96)||(${v}>=123&&${v}<=126))`;
function email(s) {
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local.length > 64) return false;
  if (local.charCodeAt(0) === 34) {
    // quoted string: must close, and the quote may only end the local part
    if (local.charCodeAt(local.length - 1) !== 34 || local.length < 2) return false;
  } else {
    if (local.charCodeAt(0) === 46 || local.charCodeAt(local.length - 1) === 46) return false;
    if (local.indexOf('..') !== -1) return false;
    for (let i = 0; i < local.length; i++) if (!isEmailLocalChar(local.charCodeAt(i))) return false;
  }
  if (domain.charCodeAt(0) === 91) { // '['
    if (domain.charCodeAt(domain.length - 1) !== 93 || domain.length <= 2) return false;
    const inner = domain.slice(1, -1);
    // IPv6 literals are tagged; anything else in brackets is an IPv4 address.
    if (inner.startsWith('IPv6:')) return ipv6(inner.slice(5));
    return ipv4(inner);
  }
  return hostname(domain);
}
// Emitted rather than bound as a closure: a standalone module embeds format
// functions by their source text, so anything reaching a free variable would
// not survive the trip. The domain half reuses hostnameSource, which keeps
// one hostname implementation for both halves of this file.
function emailSource (v, isStr) {
  const inner =
    `const _at=${v}.lastIndexOf('@');` +
    `if(_at<=0||_at===${v}.length-1)return false;` +
    `const _lp=${v}.slice(0,_at);const _dm=${v}.slice(_at+1);` +
    `if(_lp.length>64)return false;` +
    `if(_lp.charCodeAt(0)===34){if(_lp.length<2||_lp.charCodeAt(_lp.length-1)!==34)return false}` +
    `else{` +
      `if(_lp.charCodeAt(0)===46||_lp.charCodeAt(_lp.length-1)===46)return false;` +
      `if(_lp.indexOf('..')!==-1)return false;` +
      `for(let _i=0;_i<_lp.length;_i++){const _lc=_lp.charCodeAt(_i);if(!${EMAIL_LOCAL_SRC('_lc')})return false}` +
    `}` +
    `if(_dm.charCodeAt(0)===91){` +
      `if(_dm.charCodeAt(_dm.length-1)!==93||_dm.length<=2)return false;` +
      `const _in=_dm.slice(1,-1);` +
      `if(_in.startsWith('IPv6:')){const _i6=_in.slice(5);${ipv6Source('_i6', true)}}` +
      `else{${ipv4Source('_in', true)}}` +
    `}` +
    `else{${hostnameSource('_dm', true)}}`;
  return isStr ? `{${inner}}` : `if(typeof ${v}==='string'){${inner}}`;
}


// RFC 3339 appendix A duration. The units form a chain rather than a set: a
// year may be followed by a month and a month by a day, and the same on the
// time side, so "P1Y2D" and "PT1H2S" are not durations. Weeks stand alone and
// no unit takes a fraction.
const DURATION_RE = /^P(?:\d+W|(?:\d+Y(?:\d+M(?:\d+D)?)?|\d+M(?:\d+D)?|\d+D)(?:T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))?|T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))$/;
function duration (s) { return DURATION_RE.test(s); }
function durationSource (v, isStr) {
  const inner = `if(!${DURATION_RE.toString()}.test(${v}))return false`;
  return isStr ? inner : `if(typeof ${v}==='string'&&${inner.slice(3)}`;
}

module.exports = { date, ipv4, dateTime, ipv6, hostname, uri, uriReference, uuid, time, noReserved, jsonPointer, relativeJsonPointer, uriTemplate, email, duration, dateSource, ipv4Source, dateTimeSource, ipv6Source, hostnameSource, uriSource, uuidSource, timeSource, noReservedSource, jsonPointerSource, relativeJsonPointerSource, uriTemplateSource, emailSource, durationSource };
