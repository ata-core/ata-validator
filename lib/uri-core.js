'use strict';

// RFC 3986 URI and URI-reference, RFC 3987 IRI and IRI-reference, as one walk
// over the string with no slicing. `mode` bit 1 asks for a scheme (uri, iri),
// bit 2 lets non-ASCII through (iri, iri-reference). The rules the walk holds
// that a character-class scan does not: a second "@" in the authority, a port
// that is not digits, square brackets anywhere but around an IP literal, the
// literal itself (RFC 3986 IPv6 with an embedded IPv4 of no leading zeros, an
// RFC 6874 zone id, IPvFuture), a colon in the first segment of a relative
// path, and a second "#". A reference made only of unreserved characters,
// sub-delimiters, "/" and "@" (a file name, a path) is one whatever its
// shape, and is answered by one scan before any of that.
//
// A factory, like lib/safe-regex.js: the interpreted engine calls the
// function it returns, and the code generator emits the factory's source
// text (`source`) into the program it builds, so a standalone module carries
// the same walk without importing it. Nothing inside the factory reads a
// free variable, and no comments inside it: its text is what gets emitted.
// `ip6` is the IPv6 check for a bracketed host, one string in: lib/formats.js
// gives its own and the generator emits ipv6Source, so neither carries a
// second copy. The slice it costs happens only on an IP literal.
function __ataUri (ip6) {
  const C = new Uint8Array(128);
  for (let i = 48; i < 58; i++) C[i] = 3;
  for (let i = 65; i < 91; i++) C[i] = 3;
  for (let i = 97; i < 123; i++) C[i] = 3;
  C[43] = 3; C[45] = 3; C[46] = 3;
  C[95] = 1; C[126] = 1;
  C[33] = 1; C[36] = 1; C[38] = 1; C[39] = 1; C[40] = 1; C[41] = 1; C[42] = 1; C[44] = 1; C[59] = 1; C[61] = 1;
  const H = new Uint8Array(128);
  for (let i = 48; i < 58; i++) H[i] = 1;
  for (let i = 65; i < 71; i++) H[i] = 1;
  for (let i = 97; i < 103; i++) H[i] = 1;
  function pct (s, i) {
    const a = s.charCodeAt(i + 1), b = s.charCodeAt(i + 2);
    return a < 128 && b < 128 && H[a] === 1 && H[b] === 1;
  }
  const P = new Uint8Array(128);
  for (let i = 0; i < 128; i++) P[i] = C[i] & 1;
  P[58] = 1; P[64] = 1; P[47] = 1;
  const Q = new Uint8Array(P);
  Q[63] = 1;
  const S = new Uint8Array(P);
  S[58] = 0;
  function literal (s, from, to) {
    if (from >= to) return false;
    const f = s.charCodeAt(from);
    if (f === 118 || f === 86) {
      let i = from + 1, h = 0;
      for (; i < to; i++) { const c = s.charCodeAt(i); if (c < 128 && H[c] === 1) h++; else break; }
      if (h === 0 || s.charCodeAt(i) !== 46 || i + 1 >= to) return false;
      for (i++; i < to; i++) { const c = s.charCodeAt(i); if (!(c < 128 && ((C[c] & 1) === 1 || c === 58))) return false; }
      return true;
    }
    let z = -1;
    for (let i = from; i < to; i++) if (s.charCodeAt(i) === 37) { z = i; break; }
    if (z === -1) return ip6(s.slice(from, to));
    if (s.charCodeAt(z + 1) !== 50 || s.charCodeAt(z + 2) !== 53 || z + 3 >= to) return false;
    for (let i = z + 3; i < to; i++) {
      const c = s.charCodeAt(i);
      if (c === 37) { if (!pct(s, i)) return false; i += 2; continue; }
      if (!(c < 128 && (C[c] & 1) === 1)) return false;
    }
    return ip6(s.slice(from, z));
  }
  return function (s, mode) {
    const n = s.length;
    const wide = (mode & 2) !== 0;
    if ((mode & 1) === 0 && !(s.charCodeAt(0) === 47 && s.charCodeAt(1) === 47)) {
      let k = 0;
      for (; k < n; k++) { const c = s.charCodeAt(k); if (c > 127 || S[c] === 0) break; }
      if (k === n) return true;
    }
    let i = 0, c = s.charCodeAt(0), scheme = false;
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      let j = 1;
      while (j < n) { c = s.charCodeAt(j); if (c === 58 || c > 127 || (C[c] & 2) === 0) break; j++; }
      if (j < n && c === 58) { scheme = true; i = j + 1; }
    }
    if (!scheme && (mode & 1) !== 0) return false;
    let auth = false;
    if (s.charCodeAt(i) === 47 && s.charCodeAt(i + 1) === 47) {
      auth = true;
      const st = i + 2;
      let end = n, at = -1, br = false, brAt = false, colon = -1;
      for (let k = st; k < n; k++) {
        c = s.charCodeAt(k);
        if (c === 47 || c === 63 || c === 35) { end = k; break; }
        if (c < 128) {
          if ((C[c] & 1) === 1) continue;
          if (c === 37) { if (!pct(s, k)) return false; k += 2; continue; }
          if (c === 58) { if (colon === -1) colon = k; continue; }
          if (c === 64) { if (at !== -1) return false; at = k; brAt = br; colon = -1; continue; }
          if (c === 91 || c === 93) { br = true; continue; }
          return false;
        }
        if (!wide) return false;
      }
      if (brAt) return false;
      const hs = at === -1 ? st : at + 1;
      if (s.charCodeAt(hs) === 91) {
        let close = -1;
        for (let k = hs + 1; k < end; k++) if (s.charCodeAt(k) === 93) { close = k; break; }
        if (close === -1 || !literal(s, hs + 1, close)) return false;
        if (close + 1 < end) {
          if (s.charCodeAt(close + 1) !== 58) return false;
          for (let k = close + 2; k < end; k++) { c = s.charCodeAt(k); if (c < 48 || c > 57) return false; }
        }
      } else {
        if (br) return false;
        if (colon !== -1) for (let k = colon + 1; k < end; k++) { c = s.charCodeAt(k); if (c < 48 || c > 57) return false; }
      }
      i = end;
    }
    if (!scheme && !auth && s.charCodeAt(i) !== 47) {
      for (; i < n; i++) {
        c = s.charCodeAt(i);
        if (c === 47 || c === 63 || c === 35) break;
        if (c === 58) return false;
        if (c === 37) { if (!pct(s, i)) return false; i += 2; continue; }
        if (c < 128 ? P[c] === 0 : !wide) return false;
      }
    }
    for (; i < n; i++) {
      c = s.charCodeAt(i);
      if (c < 128 ? P[c] === 0 : !wide) {
        if (c === 63 || c === 35) break;
        if (c === 37) { const a = s.charCodeAt(i + 1), b = s.charCodeAt(i + 2); if (!(a < 128 && b < 128 && H[a] === 1 && H[b] === 1)) return false; i += 2; continue; }
        return false;
      }
    }
    if (i >= n) return true;
    if (c === 63) {
      for (i++; i < n; i++) {
        c = s.charCodeAt(i);
        if (c < 128 ? Q[c] === 0 : !wide) {
          if (c === 35) break;
          if (c === 37) { if (!pct(s, i)) return false; i += 2; continue; }
          return false;
        }
      }
      if (i >= n) return true;
    }
    for (i++; i < n; i++) {
      c = s.charCodeAt(i);
      if (c < 128 ? Q[c] === 0 : !wide) {
        if (c === 37) { if (!pct(s, i)) return false; i += 2; continue; }
        return false;
      }
    }
    return true;
  };
}

module.exports = { __ataUri };
