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
// Four dotted decimal octets, 0 to 255, no leading zeros: the same language
// ipv4Range walks, as one regular expression. The engine answers a dotted quad
// in about 12 ns where the walk takes 17, for the reason `uri` above found:
// its character-class loop beats a charCodeAt loop. ipv4Range stays for the
// embedded form inside an IPv6 address, where the octets are a slice.
// tests/test_ipv4_regex.js holds the two to the same answers.
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function ipv4 (s) {
  return IPV4.test(s);
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
// Eight groups of one to four hex digits and nothing else: the uncompressed
// form, which is always a valid address. The walk below takes 64 ns on one;
// this answers in about 30, and anything it does not match, compressed forms
// and embedded IPv4 included, goes to the walk as before. It is only tried from
// 15 characters, the shortest string it can match, so a short rejection does
// not pay for it. tests/test_ipv6_fast_path.js holds the subset relation.
const IPV6_FULL = /^(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}$/;

function ipv6 (s) {
  const n = s.length;
  if (n >= 15 && IPV6_FULL.test(s)) return true;
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
// The shape almost every URI in a document has, as one regular expression: a
// scheme, then either "//" and a host with no userinfo, port, brackets or
// percent escapes, or no authority at all, then a tail of characters RFC 3986
// allows, again without "%". Everything it accepts the walk below accepts too,
// and it answers the common case in about 25 ns where the walk takes 43 on a
// 34-character URL, because the engine scans a character class faster than a
// charCodeAt loop does. Anything it declines, the walk decides as before.
//
// The two branches after the colon are exclusive on purpose. With the "//"
// group merely optional, "http://[::1" could skip it and match "//[::1" as a
// path, accepting a string the walk rejects for its unclosed bracket.
// tests/test_uri_fast_path.js holds the subset relation.
const URI_FAST = /^[A-Za-z][A-Za-z0-9+.\-]*:(?:\/\/[!$&-.0-9;=A-Z_a-z~]*(?:[\/?#][!#$&-;=?-\[\]_a-z~]*)?|(?!\/\/)[!#$&-;=?-\[\]_a-z~]*)$/;

function uri (s) {
  if (URI_FAST.test(s)) return true;
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
// The same set through the URI_CHAR and HEX_CHAR tables: one load per
// character, where uriChar() was a call and up to eleven comparisons, and on
// SchemaStore's SARIF samples, full of URIs, that loop was a sixth of what the
// interpreted engine spent. A "%" at the end reads past the string, NaN,
// which fails the bound as it failed isHex().
function uriChars (s, from) {
  for (let i = from; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 127 || URI_CHAR[c] === 0) return false;
    if (c === 37) { // '%'
      const h1 = s.charCodeAt(i + 1), h2 = s.charCodeAt(i + 2);
      if (!(h1 <= 127) || !(h2 <= 127) || HEX_CHAR[h1] === 0 || HEX_CHAR[h2] === 0) return false;
      i += 2;
    }
  }
  return true;
}

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
function iriReference (s) { return iriChars(s, 0); }

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

// RFC 3339 appendix A duration. The units form a chain rather than a set: a
// year may be followed by a month and a month by a day, and the same on the
// time side, so "P1Y2D" and "PT1H2S" are not durations. Weeks stand alone and
// no unit takes a fraction.
const DURATION_RE = /^P(?:\d+W|(?:\d+Y(?:\d+M(?:\d+D)?)?|\d+M(?:\d+D)?|\d+D)(?:T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))?|T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))$/;
function duration (s) { return DURATION_RE.test(s); }

module.exports = { IPV4, IPV6_FULL, ipv4Range, URI_FAST, date, ipv4, dateTime, ipv6, hostname, uri, uriReference, uuid, time, noReserved, jsonPointer, relativeJsonPointer, uriTemplate, email, duration, uriChars, uriAuthority, iri, iriReference, idnEmail, DURATION_RE, URI_TEMPLATE_EXPR };
