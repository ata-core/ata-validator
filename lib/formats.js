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
  if ((se0 >>> 0) > 6 || (se1 >>> 0) > 9 || se0 * 10 + se1 > 60) return false;

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
  const sec = se0 * 10 + se1;
  const hh = h0 * 10 + h1, mi = mi0 * 10 + mi1;
  let offMin = 0;
  if (c === 90 || c === 122) {
    if (i !== n - 1) return false;
  } else {
    if (c !== 43 && c !== 45) return false;
    if (n - i !== 6) return false;
    if (!isDigit(s.charCodeAt(i + 1)) || !isDigit(s.charCodeAt(i + 2))) return false;
    if (s.charCodeAt(i + 3) !== 58) return false;
    if (!isDigit(s.charCodeAt(i + 4)) || !isDigit(s.charCodeAt(i + 5))) return false;
    const oh = twoDigits(s, i + 1), om = twoDigits(s, i + 4);
    if (oh > 23 || om > 59) return false;
    offMin = (c === 43 ? 1 : -1) * (oh * 60 + om);
  }
  // Same rule as time(): second 60 is the leap second and exists only at
  // 23:59:60 UTC, whatever offset the string is written in.
  if (sec === 60) {
    const utc = ((hh * 60 + mi - offMin) % 1440 + 1440) % 1440;
    if (utc !== 1439) return false;
  }
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
// `from` and `to` let a caller check a hostname inside a larger string, which is
// how the email check reads its domain half without slicing it out.
function hostname (s, from, to) {
  const start = from === undefined ? 0 : from;
  const end = to === undefined ? s.length : to;
  const n = end - start;
  if (n === 0 || n > 253) return false;
  let labelLength = 0;
  let previous = 46; // a dot, so a leading hyphen is refused like a leading dot
  for (let i = start; i < end; i++) {
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

// Character classes as tables rather than comparison chains. Nine `===` tests
// per character more than doubled the cost of the scan they guarded, measured
// against the same loop doing a single range check; an indexed byte read costs
// the same whatever the class holds.
const URI_CHAR = new Uint8Array(128);
for (let i = 33; i < 127; i++) URI_CHAR[i] = 1;
// " < > \ ^ ` { | } are printable and still not allowed in a URI.
for (const c of [34, 60, 62, 92, 94, 96, 123, 124, 125]) URI_CHAR[c] = 0;
const HEX_CHAR = new Uint8Array(128);
for (let i = 48; i < 58; i++) HEX_CHAR[i] = 1;
for (let i = 97; i < 103; i++) HEX_CHAR[i] = 1;
for (let i = 65; i < 71; i++) HEX_CHAR[i] = 1;
// Scheme characters: letters, digits, "+", "-", ".".
const SCHEME_CHAR = new Uint8Array(128);
for (let i = 48; i < 58; i++) SCHEME_CHAR[i] = 1;
for (let i = 97; i < 123; i++) SCHEME_CHAR[i] = 1;
for (let i = 65; i < 91; i++) SCHEME_CHAR[i] = 1;
SCHEME_CHAR[43] = 1; SCHEME_CHAR[45] = 1; SCHEME_CHAR[46] = 1;

// A scheme followed by a colon, an optional authority, and no character a URI
// cannot hold anywhere after the colon.
//
// One walk answers all of it. The authority's landmarks, the last "@", the
// colons after it and whether a bracket appeared before it, are recorded while
// the characters are being checked, so the authority is never cut out of the
// string or scanned again. Reading it out with `slice` and asking the copy for
// `lastIndexOf` and two regular expressions allocated a string per URI, and a
// document carrying a handful of URLs paid that per field.
function uri (s) {
  const n = s.length;
  if (n === 0) return false;
  let c = s.charCodeAt(0);
  // A scheme opens with a letter, never a digit or a sign.
  if (c > 127 || SCHEME_CHAR[c] === 0 || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) return false;
  let colon = -1;
  for (let i = 1; i < n; i++) {
    c = s.charCodeAt(i);
    if (c === 58) { colon = i; break; }
    if (c > 127 || SCHEME_CHAR[c] === 0) return false;
  }
  if (colon === -1) return false;

  let i = colon + 1;
  let authEnd = n;
  if (s.charCodeAt(i) === 47 && s.charCodeAt(i + 1) === 47) {
    const authStart = i + 2;
    let at = -1, firstColon = -1, lastColon = -1, sawBracket = 0, bracketBeforeAt = 0;
    let hostStart = authStart;
    authEnd = -1;
    for (i = authStart; i < n; i++) {
      c = s.charCodeAt(i);
      if (c > 127 || URI_CHAR[c] === 0) return false;
      if (c === 47 || c === 63 || c === 35) { authEnd = i; break; }
      if (c === 37) {
        const h1 = s.charCodeAt(i + 1), h2 = s.charCodeAt(i + 2);
        // A "%" at the end of the string reads as NaN, which no comparison
        // admits; `<= 127` is written that way so NaN takes the reject.
        if (!(h1 <= 127) || !(h2 <= 127) || HEX_CHAR[h1] === 0 || HEX_CHAR[h2] === 0) return false;
        i += 2;
        continue;
      }
      // The last "@" ends userinfo, so everything recorded before it belongs
      // to a part that has its own rules and is dropped here.
      if (c === 64) { bracketBeforeAt = sawBracket; at = i; firstColon = -1; lastColon = -1; hostStart = i + 1; }
      else if (c === 58) { if (firstColon === -1) firstColon = i; lastColon = i; }
      else if (c === 91 || c === 93) { sawBracket = 1; }
    }
    if (authEnd === -1) authEnd = n;
    // Brackets belong to the host, so one before the "@" is not userinfo.
    if (at !== -1 && bracketBeforeAt) return false;
    if (s.charCodeAt(hostStart) === 91) { // '['
      let close = -1;
      for (let j = hostStart + 1; j < authEnd; j++) { if (s.charCodeAt(j) === 93) { close = j; break; } }
      if (close === -1) return false;
      if (close + 1 !== authEnd) {
        if (s.charCodeAt(close + 1) !== 58) return false;
        if (!allDigits(s, close + 2, authEnd)) return false;
      }
    } else if (lastColon !== -1) {
      // A host holding more than one colon is an IPv6 address, and those must
      // be bracketed. Without that rule the last group reads as a port number.
      if (firstColon !== lastColon) return false;
      if (!allDigits(s, lastColon + 1, authEnd)) return false;
    }
    i = authEnd;
  }
  for (; i < n; i++) {
    c = s.charCodeAt(i);
    if (c > 127 || URI_CHAR[c] === 0) return false;
    if (c === 37) {
      const h1 = s.charCodeAt(i + 1), h2 = s.charCodeAt(i + 2);
      if (!(h1 <= 127) || !(h2 <= 127) || HEX_CHAR[h1] === 0 || HEX_CHAR[h2] === 0) return false;
      i += 2;
    }
  }
  return true;
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


// RFC 3986 allows these ASCII characters in a URI and nothing else: the
// unreserved set, the delimiters, and "%" when it introduces two hex digits.
// The printable characters missing from that list are the ones this rejects:
// " < > \ ^ ` { | }, plus everything below 0x21 and above 0x7e. The old check
// only looked for whitespace and non-printables, so a backslash or a lone
// percent sign passed as a URI.
function uriChar (c) {
  if (c < 33 || c > 126) return false;
  return !(c === 34 || c === 60 || c === 62 || c === 92 ||
           c === 94 || c === 96 || c === 123 || c === 124 || c === 125);
}
function isHex (c) {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}
function uriChars (s, from) {
  for (let i = from; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!uriChar(c)) return false;
    if (c === 37) { // '%'
      if (!isHex(s.charCodeAt(i + 1)) || !isHex(s.charCodeAt(i + 2))) return false;
      i += 2;
    }
  }
  return true;
}
const uriCharsSource = (v, from) =>
  `for(let _ri=${from};_ri<${v}.length;_ri++){const _rc=${v}.charCodeAt(_ri);` +
  'if(_rc<33||_rc>126||_rc===34||_rc===60||_rc===62||_rc===92||_rc===94||_rc===96||_rc===123||_rc===124||_rc===125)return false;' +
  `if(_rc===37){const _h1=${v}.charCodeAt(_ri+1),_h2=${v}.charCodeAt(_ri+2);` +
  'if(!((_h1>=48&&_h1<=57)||(_h1>=97&&_h1<=102)||(_h1>=65&&_h1<=70))||' +
  '!((_h2>=48&&_h2<=57)||(_h2>=97&&_h2<=102)||(_h2>=65&&_h2<=70)))return false;_ri+=2}}';

function allDigits (s, from, to) {
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

// The authority sits between "//" and the next "/", "?" or "#". A bracketed
// host must close, and a port is digits.
//
// Everything here reads the original string through index bounds. Cutting the
// authority out with `slice` and asking it for `lastIndexOf` and two regular
// expressions allocated a string for every URI validated, and a document
// carrying a handful of URLs paid that per field; the authority of an ordinary
// URL is a dozen characters, so walking it twice costs less than copying it
// once.
function uriAuthority (s, start) {
  if (s.charCodeAt(start) !== 47 || s.charCodeAt(start + 1) !== 47) return true;
  const n = s.length;
  const authStart = start + 2;
  let authEnd = n;
  for (let i = authStart; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 47 || c === 63 || c === 35) { authEnd = i; break; }
  }
  // The last "@" splits userinfo from the host. Brackets belong to the host,
  // so one before the "@" is not userinfo.
  let at = -1;
  for (let i = authEnd - 1; i >= authStart; i--) {
    if (s.charCodeAt(i) === 64) { at = i; break; }
  }
  if (at !== -1) {
    for (let i = authStart; i < at; i++) {
      const c = s.charCodeAt(i);
      if (c === 91 || c === 93) return false;
    }
  }
  const hpStart = at === -1 ? authStart : at + 1;
  if (s.charCodeAt(hpStart) === 91) { // '['
    let close = -1;
    for (let i = hpStart + 1; i < authEnd; i++) {
      if (s.charCodeAt(i) === 93) { close = i; break; }
    }
    if (close === -1) return false;
    if (close + 1 === authEnd) return true;
    if (s.charCodeAt(close + 1) !== 58) return false;
    return allDigits(s, close + 2, authEnd);
  }
  let firstColon = -1;
  let lastColon = -1;
  for (let i = hpStart; i < authEnd; i++) {
    if (s.charCodeAt(i) === 58) {
      if (firstColon === -1) firstColon = i;
      lastColon = i;
    }
  }
  if (lastColon === -1) return true;
  // A host holding more than one colon is an IPv6 address, and those must be
  // bracketed. Without that rule the last group reads as a port number.
  if (firstColon !== lastColon) return false;
  return allDigits(s, lastColon + 1, authEnd);
}
const uriAuthoritySource = (v, start) =>
  `if(${v}.charCodeAt(${start})===47&&${v}.charCodeAt(${start}+1)===47){` +
  `let _ae=${v}.length;` +
  `for(let _ai=${start}+2;_ai<${v}.length;_ai++){const _ac=${v}.charCodeAt(_ai);` +
  'if(_ac===47||_ac===63||_ac===35){_ae=_ai;break}}' +
  `const _au=${v}.slice(${start}+2,_ae);const _aat=_au.lastIndexOf('@');` +
  'if(_aat!==-1&&/[[\\]]/.test(_au.slice(0,_aat)))return false;' +
  'const _hp=_aat===-1?_au:_au.slice(_aat+1);' +
  'if(_hp.charCodeAt(0)===91){const _cl=_hp.indexOf("]");' +
  'if(_cl===-1)return false;const _rs=_hp.slice(_cl+1);' +
  'if(_rs!==""){if(_rs.charCodeAt(0)!==58||!/^[0-9]*$/.test(_rs.slice(1)))return false}}' +
  'else{const _co=_hp.lastIndexOf(":");' +
  'if(_co!==-1){if(_hp.indexOf(":")!==_co)return false;' +
  'if(!/^[0-9]*$/.test(_hp.slice(_co+1)))return false}}}';


// An IRI is a URI that also admits non-ASCII. The ASCII rules are identical,
// so the same character test runs with everything above 0x7e allowed through.
function iriChar (c) { return c > 126 ? c !== 127 : uriChar(c); }
function iriChars (s, from) {
  for (let i = from; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!iriChar(c)) return false;
    if (c === 37) {
      if (!isHex(s.charCodeAt(i + 1)) || !isHex(s.charCodeAt(i + 2))) return false;
      i += 2;
    }
  }
  return true;
}
const iriCharsSource = (v, from) =>
  `for(let _ii=${from};_ii<${v}.length;_ii++){const _ic=${v}.charCodeAt(_ii);` +
  'if(_ic===127||(_ic<127&&(_ic<33||_ic===34||_ic===60||_ic===62||_ic===92||_ic===94||_ic===96||_ic===123||_ic===124||_ic===125)))return false;' +
  `if(_ic===37){const _j1=${v}.charCodeAt(_ii+1),_j2=${v}.charCodeAt(_ii+2);` +
  'if(!((_j1>=48&&_j1<=57)||(_j1>=97&&_j1<=102)||(_j1>=65&&_j1<=70))||' +
  '!((_j2>=48&&_j2<=57)||(_j2>=97&&_j2<=102)||(_j2>=65&&_j2<=70)))return false;_ii+=2}}';

function iri (s) {
  const n = s.length;
  if (n === 0) return false;
  const first = s.charCodeAt(0);
  if (!((first >= 97 && first <= 122) || (first >= 65 && first <= 90))) return false;
  let colon = -1;
  for (let i = 1; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 58) { colon = i; break; }
    if (!(isDigit(c) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90) ||
      c === 43 || c === 45 || c === 46)) return false;
  }
  if (colon === -1) return false;
  return iriChars(s, colon + 1) && uriAuthority(s, colon + 1);
}
function iriSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n===0)return false;` +
    `const _f=${v}.charCodeAt(0);if(!((_f>=97&&_f<=122)||(_f>=65&&_f<=90)))return false;` +
    `let _co=-1;for(let _i=1;_i<_n;_i++){const _c=${v}.charCodeAt(_i);if(_c===58){_co=_i;break}` +
    `if(!((_c>=48&&_c<=57)||(_c>=97&&_c<=122)||(_c>=65&&_c<=90)||_c===43||_c===45||_c===46))return false}` +
    `if(_co===-1)return false;` +
    iriCharsSource(v, '_co+1') +
    uriAuthoritySource(v, '_co+1'));
}
function iriReference (s) { return iriChars(s, 0); }
function iriReferenceSource (v, isStr) { return guard(v, isStr, iriCharsSource(v, '0')); }

// An internationalised mailbox differs from a mailbox only in admitting
// non-ASCII on both sides. The separator stays the ASCII "@": a fullwidth one
// is a character in the local part, not a separator.
function idnEmail (s) {
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local.charCodeAt(0) === 34) {
    return local.length >= 2 && local.charCodeAt(local.length - 1) === 34 && domain.length > 0;
  }
  if (local.charCodeAt(0) === 46 || local.charCodeAt(local.length - 1) === 46) return false;
  if (local.indexOf('..') !== -1) return false;
  if (domain.charCodeAt(0) === 91) {
    return domain.charCodeAt(domain.length - 1) === 93 && domain.length > 2;
  }
  if (domain.charCodeAt(0) === 46 || domain.charCodeAt(domain.length - 1) === 46) return false;
  if (domain.indexOf('..') !== -1) return false;
  for (let i = 0; i < domain.length; i++) {
    const c = domain.charCodeAt(i);
    if (c <= 32 || c === 127 || c === 64) return false;
  }
  return true;
}
function idnEmailSource (v, isStr) {
  const inner =
    `const _at=${v}.lastIndexOf('@');` +
    `if(_at<=0||_at===${v}.length-1)return false;` +
    `const _lp=${v}.slice(0,_at),_dm=${v}.slice(_at+1);` +
    `if(_lp.charCodeAt(0)===34){if(_lp.length<2||_lp.charCodeAt(_lp.length-1)!==34||_dm.length===0)return false}` +
    `else{` +
      `if(_lp.charCodeAt(0)===46||_lp.charCodeAt(_lp.length-1)===46)return false;` +
      `if(_lp.indexOf('..')!==-1)return false;` +
      `if(_dm.charCodeAt(0)===91){if(_dm.charCodeAt(_dm.length-1)!==93||_dm.length<=2)return false}` +
      `else{` +
        `if(_dm.charCodeAt(0)===46||_dm.charCodeAt(_dm.length-1)===46)return false;` +
        `if(_dm.indexOf('..')!==-1)return false;` +
        `for(let _di=0;_di<_dm.length;_di++){const _dc=_dm.charCodeAt(_di);` +
        `if(_dc<=32||_dc===127||_dc===64)return false}` +
      `}` +
    `}`;
  return isStr ? `{${inner}}` : `if(typeof ${v}==='string'){${inner}}`;
}

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
  return uriChars(s, 0);
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
    'if((_se0>>>0)>6||(_se1>>>0)>9||_se0*10+_se1>60)return false;' +
    `let _i2=19;if(${v}.charCodeAt(19)===46){_i2=20;const _st=_i2;while(_i2<_n){const _c2=${v}.charCodeAt(_i2);if(_c2<48||_c2>57)break;_i2++}if(_i2===_st)return false}` +
    `const _tz=${v}.charCodeAt(_i2);let _dtoff=0;` +
    `if(_tz===90||_tz===122){if(_i2!==_n-1)return false}` +
    `else{if(_tz!==43&&_tz!==45)return false;if(_n-_i2!==6)return false;` +
    `const _oh=${v}.charCodeAt(_i2+1),_oh2=${v}.charCodeAt(_i2+2),_om=${v}.charCodeAt(_i2+4),_om2=${v}.charCodeAt(_i2+5);` +
    `if(_oh<48||_oh>57||_oh2<48||_oh2>57||_om<48||_om>57||_om2<48||_om2>57)return false;` +
    `if(${v}.charCodeAt(_i2+3)!==58)return false;` +
    `const _ohv=(_oh-48)*10+(_oh2-48),_omv=(_om-48)*10+(_om2-48);` +
    `if(_ohv>23||_omv>59)return false;` +
    `_dtoff=(_tz===43?1:-1)*(_ohv*60+_omv)}` +
    `if(_se0*10+_se1===60){` +
    `const _dtu=(((_h0*10+_h1)*60+(_mi0*10+_mi1)-_dtoff)%1440+1440)%1440;` +
    `if(_dtu!==1439)return false}`);
}

// The scan, over a range of the string given as source expressions. The email
// check reads its domain half through this, without slicing it out, which was an
// allocation on every call.
//
// A separate function rather than optional parameters on hostnameSource: the code
// generator calls every entry of its format table as `fn(v, isStr, ctx)`, so a
// third parameter here would silently receive a context object and emit
// `_st=[object Object]`. That declines the whole compile, which is how it was
// found.
function hostnameRangeSource (v, st, en) {
  return `const _st=${st},_en=${en},_n=_en-_st;if(_n===0||_n>253)return false;let _ll=0,_pv=46;` +
    `for(let _i=_st;_i<_en;_i++){const _c=${v}.charCodeAt(_i);` +
    `if(_c===46){if(_ll===0||_pv===45)return false;_ll=0;_pv=_c;continue}` +
    `const _an=(_c>=48&&_c<=57)||(_c>=97&&_c<=122)||(_c>=65&&_c<=90);` +
    `if(!_an&&_c!==45)return false;` +
    `if(_c===45&&_pv===46)return false;` +
    `if(++_ll>63)return false;_pv=_c}` +
    `if(_ll===0||_pv===45)return false`;
}

function hostnameSource (v, isStr) {
  return guard(v, isStr, hostnameRangeSource(v, '0', `${v}.length`));
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

// The same walk as `uri` above, as source, for the code generator to hoist
// once per compiled function and call. Two copies of one algorithm is what
// this file has always done for every format, so they sit together here and
// tests/test_uri_helper_parity.js holds them to the same answer over a corpus
// built from the walk's own boundaries.
const URI_HELPER_TABLES = 'const _uct=new Uint8Array(128);for(let _i=33;_i<127;_i++)_uct[_i]=1;' +
  '_uct[34]=_uct[60]=_uct[62]=_uct[92]=_uct[94]=_uct[96]=_uct[123]=_uct[124]=_uct[125]=0;' +
  'const _uch=new Uint8Array(128);for(let _i=48;_i<58;_i++)_uch[_i]=1;' +
  'for(let _i=97;_i<103;_i++)_uch[_i]=1;for(let _i=65;_i<71;_i++)_uch[_i]=1;' +
  'const _ucs=new Uint8Array(128);for(let _i=48;_i<58;_i++)_ucs[_i]=1;' +
  'for(let _i=97;_i<123;_i++)_ucs[_i]=1;for(let _i=65;_i<91;_i++)_ucs[_i]=1;' +
  '_ucs[43]=1;_ucs[45]=1;_ucs[46]=1';
const URI_HELPER_BODY = 'const _n=_s.length;if(_n===0)return false;let _c=_s.charCodeAt(0);if(_c>127||_ucs[_c]===0||(_c>=48&&_c<=57)||_c===43||_c===45||_c===46)return false;let _co=-1;for(let _i=1;_i<_n;_i++){_c=_s.charCodeAt(_i);if(_c===58){_co=_i;break}if(_c>127||_ucs[_c]===0)return false}if(_co===-1)return false;let _i=_co+1;let _ae=_n;if(_s.charCodeAt(_i)===47&&_s.charCodeAt(_i+1)===47){const _as=_i+2;let _at=-1,_fc=-1,_lc=-1,_br=0,_ba=0,_hs=_as;_ae=-1;for(_i=_as;_i<_n;_i++){_c=_s.charCodeAt(_i);if(_c>127||_uct[_c]===0)return false;if(_c===47||_c===63||_c===35){_ae=_i;break}if(_c===37){const _h1=_s.charCodeAt(_i+1),_h2=_s.charCodeAt(_i+2);if(!(_h1<=127)||!(_h2<=127)||_uch[_h1]===0||_uch[_h2]===0)return false;_i+=2;continue}if(_c===64){_ba=_br;_at=_i;_fc=-1;_lc=-1;_hs=_i+1}else if(_c===58){if(_fc===-1)_fc=_i;_lc=_i}else if(_c===91||_c===93){_br=1}}if(_ae===-1)_ae=_n;if(_at!==-1&&_ba)return false;if(_s.charCodeAt(_hs)===91){let _cl=-1;for(let _j=_hs+1;_j<_ae;_j++){if(_s.charCodeAt(_j)===93){_cl=_j;break}}if(_cl===-1)return false;if(_cl+1!==_ae){if(_s.charCodeAt(_cl+1)!==58)return false;for(let _j=_cl+2;_j<_ae;_j++){const _d=_s.charCodeAt(_j);if(_d<48||_d>57)return false}}}else if(_lc!==-1){if(_fc!==_lc)return false;for(let _j=_lc+1;_j<_ae;_j++){const _d=_s.charCodeAt(_j);if(_d<48||_d>57)return false}}_i=_ae}for(;_i<_n;_i++){_c=_s.charCodeAt(_i);if(_c>127||_uct[_c]===0)return false;if(_c===37){const _h1=_s.charCodeAt(_i+1),_h2=_s.charCodeAt(_i+2);if(!(_h1<=127)||!(_h2<=127)||_uch[_h1]===0||_uch[_h2]===0)return false;_i+=2}}return true;';
const uriHelperSource = (name) =>
  URI_HELPER_TABLES + ';function ' + name + '(_s){' + URI_HELPER_BODY + '}';

function uriSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n===0)return false;` +
    `const _f=${v}.charCodeAt(0);if(!((_f>=97&&_f<=122)||(_f>=65&&_f<=90)))return false;` +
    `let _co=-1;for(let _i=1;_i<_n;_i++){const _c=${v}.charCodeAt(_i);if(_c===58){_co=_i;break}` +
    `if(!((_c>=48&&_c<=57)||(_c>=97&&_c<=122)||(_c>=65&&_c<=90)||_c===43||_c===45||_c===46))return false}` +
    `if(_co===-1)return false;` +
    uriCharsSource(v, '_co+1') +
    uriAuthoritySource(v, '_co+1'));
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
    // A literal excludes the controls, the space and DEL.
    if (c !== 123 && (c <= 32 || c === 127)) return false;
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
      `if(_c!==123&&(_c<=32||_c===127))return false;` +
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
// The emitted form keeps the comparison chain: a standalone module pays for the
// bytes of a 128-entry table in every file that validates an email, and the
// runtime pays for the chain on every call. Different budgets, same answers,
// which `tests/test_format_engine_parity.js` holds.
// Stated as the complement: of the printable range, only twelve characters are
// not atext or the dot, so excluding them is 54 source bytes shorter than listing
// what is allowed, and a standalone module carries this expression. Checked
// against the allowed-list form over every code point from 0 to 65536 in
// tests/test_formats_single_pass.js.
const EMAIL_LOCAL_SRC = (v) => `(${v}>32&&${v}<127&&${v}!==34&&${v}!==40&&${v}!==41&&${v}!==44&&${v}!==58&&${v}!==59&&${v}!==60&&${v}!==62&&${v}!==64&&${v}!==91&&${v}!==92&&${v}!==93)`;
// The same table treatment the rest of this file uses for character classes, and
// no slicing: the two halves are read in place by offset. The version that split
// the string at the '@' and tested each local character against a chain of ten
// comparisons cost 3.2x the hostname check it contains, and that one function was
// the only measured place ata validated slower than the default validator.
const EMAIL_LOCAL = new Uint8Array(128);
for (let i = 48; i <= 57; i++) EMAIL_LOCAL[i] = 1; // digits
for (let i = 97; i <= 122; i++) EMAIL_LOCAL[i] = 1; // a-z
for (let i = 65; i <= 90; i++) EMAIL_LOCAL[i] = 1; // A-Z
for (let i = 35; i <= 39; i++) EMAIL_LOCAL[i] = 1; // # $ % & '
for (let i = 94; i <= 96; i++) EMAIL_LOCAL[i] = 1; // ^ _ `
for (let i = 123; i <= 126; i++) EMAIL_LOCAL[i] = 1; // { | } ~
for (const c of [46, 33, 42, 43, 45, 47, 61, 63]) EMAIL_LOCAL[c] = 1; // . ! * + - / = ?

// One forward pass over the string. '@' is not a local-part character, so in an
// unquoted address the first one is the separator, and the local part can be
// checked on the way to finding it. The version that called lastIndexOf first
// read the string backwards before reading it forwards twice.
function email(s) {
  const n = s.length;
  if (n < 3) return false;
  let at;
  if (s.charCodeAt(0) === 34) {
    // A quoted local part may contain '@', so it needs the last one. Rare enough
    // to keep the extra scan rather than complicate the common path.
    at = s.lastIndexOf('@');
    if (at < 2 || at === n - 1 || at > 64) return false;
    if (s.charCodeAt(at - 1) !== 34) return false;
  } else {
    if (s.charCodeAt(0) === 46) return false; // a leading dot is not a mailbox
    at = -1;
    let afterDot = false;
    for (let i = 0; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c === 64) { at = i; break; }
      if (c > 127 || EMAIL_LOCAL[c] === 0) return false;
      if (c === 46) {
        if (afterDot) return false; // a doubled dot is not one either
        afterDot = true;
      } else {
        afterDot = false;
      }
    }
    if (at <= 0 || at === n - 1 || at > 64) return false;
    if (s.charCodeAt(at - 1) === 46) return false;
  }
  if (s.charCodeAt(at + 1) === 91) { // '['
    if (s.charCodeAt(n - 1) !== 93 || n - at - 1 <= 2) return false;
    // IPv6 literals are tagged; anything else in brackets is an IPv4 address.
    if (s.startsWith('IPv6:', at + 2)) return ipv6(s.slice(at + 7, n - 1));
    return ipv4(s.slice(at + 2, n - 1));
  }
  return hostname(s, at + 1, n);
}
// Emitted rather than bound as a closure: a standalone module embeds format
// functions by their source text, so anything reaching a free variable would
// not survive the trip. The domain half reuses hostnameSource, which keeps
// one hostname implementation for both halves of this file.
function emailSource (v, isStr) {
  const inner =
    // One forward pass, and neither half sliced out. '@' is not a local-part
    // character, so in an unquoted address the first one is the separator and the
    // local part is checked on the way to it. A quoted local part may contain
    // '@' and keeps the backward scan, which is the rare shape.
    // The bounds tests are merged into one condition per branch, and there is no
    // separate length check: an empty local part fails `_at<=0` and an empty
    // domain fails `_at===_n0-1`, so a short string is already refused. This
    // lands in every emitted module that validates an email, and 25 bytes of it
    // put the CLI smoke build over its --max-size once.
    `const _n0=${v}.length;let _at;` +
    `if(${v}.charCodeAt(0)===34){` +
      `_at=${v}.lastIndexOf('@');` +
      `if(_at<2||_at===_n0-1||_at>64||${v}.charCodeAt(_at-1)!==34)return false` +
    `}else{` +
      `if(${v}.charCodeAt(0)===46)return false;` +
      `_at=-1;let _pd=false;` +
      `for(let _i=0;_i<_n0;_i++){const _lc=${v}.charCodeAt(_i);if(_lc===64){_at=_i;break}if(!${EMAIL_LOCAL_SRC('_lc')})return false;if(_lc===46){if(_pd)return false;_pd=true}else _pd=false}` +
      `if(_at<=0||_at===_n0-1||_at>64||${v}.charCodeAt(_at-1)===46)return false` +
    `}` +
    // An address literal is rare enough to pay for its own slice inside the
    // branch that needs it; the hostname path, which is every real address,
    // reads the domain in place.
    `if(${v}.charCodeAt(_at+1)===91){` +
      `const _dm=${v}.slice(_at+1);` +
      `if(_dm.charCodeAt(_dm.length-1)!==93||_dm.length<=2)return false;` +
      `const _in=_dm.slice(1,-1);` +
      `if(_in.startsWith('IPv6:')){const _i6=_in.slice(5);${ipv6Source('_i6', true)}}` +
      `else{${ipv4Source('_in', true)}}` +
    `}` +
    `else{${hostnameRangeSource(v, '_at+1', `${v}.length`)}}`;
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

module.exports = { uriHelperSource, date, ipv4, dateTime, ipv6, hostname, uri, uriReference, uuid, time, noReserved, jsonPointer, relativeJsonPointer, uriTemplate, email, duration, uriChars, uriAuthority, uriCharsSource, uriAuthoritySource, iri, iriReference, idnEmail, iriSource, iriReferenceSource, idnEmailSource, dateSource, ipv4Source, dateTimeSource, ipv6Source, hostnameSource, uriSource, uuidSource, timeSource, noReservedSource, jsonPointerSource, relativeJsonPointerSource, uriTemplateSource, emailSource, durationSource };
