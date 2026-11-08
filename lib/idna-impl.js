'use strict';

// IDNA2008 for the `hostname` and `idn-hostname` formats: the A-label checks a
// hostname's `xn--` labels need (RFC 5890, 5891), the U-label rules an
// internationalised hostname is held to (RFC 5891, 5892 and its contextual
// rules, the Bidi rule of RFC 5893), and the UTS 46 mapping an
// internationalised hostname is read through.
//
// Without tables. The derived property of RFC 5892 is computed from what the
// engine already knows about Unicode: general categories, the binary
// properties `\p{...}` reads, NFKC, and lower-casing in place of case folding.
// The canonical combining class a virama has is read from how NFD reorders it
// next to two marks of known class, and Bidi and joining classes from scripts
// and categories. Every approximation leans one way: where the engine cannot
// tell, the character is allowed, so a name is refused only for a rule it
// certainly breaks. tests/test_idna.js holds each one against the published
// tables (IANA's IDNA2008 properties, Unicode's Bidi, joining and combining
// class data) code point by code point.
//
// One function returning the checks, with nothing outside it, so the code
// generator can write its source into a module that imports nothing, as it
// does the URI walk.
function __ataIdna () {
  const MARK0 = /^\p{M}/u;
  const LETTER_DIGIT = /^[\p{Ll}\p{Lu}\p{Lo}\p{Nd}\p{Lm}\p{Mn}\p{Mc}]$/u;
  const IGNORABLE = /^[\p{Default_Ignorable_Code_Point}\p{White_Space}\p{Noncharacter_Code_Point}]$/u;
  const UNASSIGNED = /^\p{Cn}$/u;
  const GREEK = /^\p{Script=Greek}$/u;
  const HEBREW = /^\p{Script=Hebrew}$/u;
  const KANA_HAN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
  // The right-to-left blocks, whose letters are Bidi class R or AL (which the
  // rule treats alike): Hebrew to Arabic Extended-A, Hebrew and Arabic
  // presentation forms, the historic scripts from U+10800, and Mende Kikakui
  // to the Arabic mathematical letters.
  const RTL = /^[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]$/u;
  // The blocks of the scripts whose letters join across a zero width
  // non-joiner: Arabic, Syriac, NKo, Mandaic, Mongolian, Phags-pa, Manichaean,
  // Psalter Pahlavi, Hanifi Rohingya, Arabic Extended-C, Sogdian to
  // Chorasmian, Adlam.
  const JOINING = /^[\u0600-\u08FF\u1800-\u18AF\uA840-\uA87F\u{10AC0}-\u{10AFF}\u{10B80}-\u{10BAF}\u{10D00}-\u{10D3F}\u{10EC0}-\u{10EFF}\u{10F30}-\u{10FFF}\u{1E900}-\u{1E95F}]$/u;
  // Greek letters with ypogegrammeni, which fold to two characters.
  const FOLD_GREEK = /^[\u1F80-\u1F87\u1F90-\u1F97\u1FA0-\u1FA7\u1FB2-\u1FB4\u1FB7\u1FC2-\u1FC4\u1FC7\u1FF2-\u1FF4\u1FF7]$/u;
  // Modifier letters of Bidi class ON, and marks of class L.
  const BIDI_ON = /^[\u02B9\u02BA\u02C6-\u02CF\u02EC\u2E2F\uA67F\uA717-\uA71F\uA788]$/u;
  const BIDI_L_MARK = /^[\u0CBF\u0CC6\u{11A07}\u{11A08}\u{11C3F}]$/u;
  const TRANSPARENT = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

  // RFC 5892 section 3, in its order. 0 refused, 1 PVALID, 2 CONTEXTO, 3 CONTEXTJ.
  function status (cp) {
    switch (cp) {
      case 0xDF: case 0x3C2: case 0x6FD: case 0x6FE: case 0xF0B: case 0x3007: return 1;
      case 0xB7: case 0x375: case 0x5F3: case 0x5F4: case 0x30FB: return 2;
      case 0x640: case 0x7FA: case 0x302E: case 0x302F: case 0x3031: case 0x3032: case 0x3033:
      case 0x3034: case 0x3035: case 0x303B: return 0;
    }
    if ((cp >= 0x660 && cp <= 0x669) || (cp >= 0x6F0 && cp <= 0x6F9)) return 2;
    if (cp === 0x2D || (cp >= 0x30 && cp <= 0x39) || (cp >= 0x61 && cp <= 0x7A)) return 1;
    if (cp < 0x80) return 0;
    if (cp === 0x200C || cp === 0x200D) return 3;
    const ch = String.fromCodePoint(cp);
    if (UNASSIGNED.test(ch)) return 0;
    // Unstable: changed by NFKC, case folding and NFKC again. Lower-casing
    // stands in for case folding except where the two differ, written out:
    // Cherokee folds to its capitals, so those are stable and the small
    // letters are not, and a few letters fold to more than their lower case.
    if (cp >= 0x13A0 && cp <= 0x13F5) return 1;
    if (cp === 0x345 || (cp >= 0x13F8 && cp <= 0x13FD) || (cp >= 0x1C80 && cp <= 0x1C88) || (cp >= 0xAB70 && cp <= 0xABBF) ||
      (cp >= 0x1F80 && cp <= 0x1FF7 && FOLD_GREEK.test(ch))) return 0;
    if (ch.normalize('NFKC').toLowerCase().normalize('NFKC') !== ch) return 0;
    if (IGNORABLE.test(ch)) return 0;
    if ((cp >= 0x20D0 && cp <= 0x20FF) || (cp >= 0x1D100 && cp <= 0x1D24F)) return 0;
    if ((cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0xA960 && cp <= 0xA97F) || (cp >= 0xD7B0 && cp <= 0xD7FF)) return 0;
    return LETTER_DIGIT.test(ch) ? 1 : 0;
  }

  // Canonical combining class 9: NFD moves the character after a nukta (class
  // 7), so its class is above 7, and leaves it in place on either side of the
  // Devanagari virama (class 9), so it is 9.
  function virama (cp) {
    if (cp === undefined || cp < 0x300) return false;
    const c = String.fromCodePoint(cp);
    return ('a' + c + '़').normalize('NFD') === 'a़' + c &&
      ('a' + c + '्').normalize('NFD') === 'a' + c + '्' &&
      ('a्' + c).normalize('NFD') === 'a्' + c;
  }

  // Bidi class, as the rule reads it: 'R' for R and AL, 'L', 'EN', 'AN',
  // 'NSM', 'ON', 'BN', 'ES' for the hyphen, or '' where these approximations
  // cannot say (a character newer than Unicode 16).
  function bidi (cp) {
    if (cp === 0x2D) return 'ES';
    if (cp >= 0x30 && cp <= 0x39) return 'EN';
    if (cp < 0x80) return 'L';
    if (cp >= 0x6F0 && cp <= 0x6F9) return 'EN';
    if ((cp >= 0x660 && cp <= 0x669) || (cp >= 0x10D30 && cp <= 0x10D39) || (cp >= 0x10D40 && cp <= 0x10D49)) return 'AN';
    // The allowed characters the scripts and categories below would misread,
    // their classes from DerivedBidiClass.
    switch (cp) {
      case 0xB7: case 0x375: case 0x30FB: return 'ON';
      case 0x200C: case 0x200D: return 'BN';
      case 0x5F3: case 0x5F4: case 0x6FD: case 0x6FE: return 'R';
      case 0xF0B: case 0x3007: return 'L';
    }
    if ((cp >= 0x7C0 && cp <= 0x7C9) || (cp >= 0x1E950 && cp <= 0x1E959)) return 'R';
    const ch = String.fromCodePoint(cp);
    if (BIDI_ON.test(ch)) return 'ON';
    if (BIDI_L_MARK.test(ch)) return 'L';
    if (/^[\p{Mn}\p{Me}]$/u.test(ch)) return 'NSM';
    if (RTL.test(ch)) return /^[\p{L}]$/u.test(ch) ? 'R' : '';
    if (/^[\p{L}\p{Mc}\p{Nd}]$/u.test(ch)) return 'L';
    return '';
  }

  // RFC 5893 section 2, for one label of a name that has a right-to-left
  // character somewhere. True when the label passes or when a character of
  // unknown class keeps the rule from deciding.
  function bidiLabel (cps) {
    const cls = cps.map(bidi);
    if (cls.includes('')) return true;
    const first = cls[0];
    if (first !== 'L' && first !== 'R') return false;
    let end = cls.length - 1;
    while (end > 0 && cls[end] === 'NSM') end--;
    if (first === 'R') {
      for (const c of cls) if (c === 'L') return false;
      if (cls.includes('EN') && cls.includes('AN')) return false;
      return cls[end] === 'R' || cls[end] === 'EN' || cls[end] === 'AN';
    }
    for (const c of cls) if (c === 'R' || c === 'AN') return false;
    return cls[end] === 'L' || cls[end] === 'EN';
  }

  // A label of code points, not mapped, held to RFC 5891 section 4.2.3 and the
  // contextual rules of RFC 5892 appendix A.
  function uLabel (cps) {
    const n = cps.length;
    if (n === 0 || cps[0] === 0x2D || cps[n - 1] === 0x2D) return false;
    if (n >= 4 && cps[2] === 0x2D && cps[3] === 0x2D) return false;
    if (MARK0.test(String.fromCodePoint(cps[0]))) return false;
    let arabicIndic = false, extended = false;
    for (let i = 0; i < n; i++) {
      const cp = cps[i];
      const st = status(cp);
      if (st === 0) return false;
      if (st === 1) continue;
      if (st === 3) {
        if (virama(cps[i - 1])) continue;
        if (cp === 0x200D) return false;
        // ZWNJ between joining letters, transparent characters skipped. A side
        // the scripts cannot settle is let through.
        let a = i - 1; while (a >= 0 && TRANSPARENT.test(String.fromCodePoint(cps[a]))) a--;
        let b = i + 1; while (b < n && TRANSPARENT.test(String.fromCodePoint(cps[b]))) b++;
        if (a < 0 || b >= n) return false;
        const left = String.fromCodePoint(cps[a]), right = String.fromCodePoint(cps[b]);
        if ((/^\p{L}$/u.test(left) && !JOINING.test(left)) || (/^\p{L}$/u.test(right) && !JOINING.test(right))) return false;
        continue;
      }
      if (cp === 0xB7) { if (cps[i - 1] !== 0x6C || cps[i + 1] !== 0x6C) return false; continue; }
      if (cp === 0x375) { if (i + 1 >= n || !GREEK.test(String.fromCodePoint(cps[i + 1]))) return false; continue; }
      if (cp === 0x5F3 || cp === 0x5F4) { if (i === 0 || !HEBREW.test(String.fromCodePoint(cps[i - 1]))) return false; continue; }
      if (cp === 0x30FB) { if (!KANA_HAN.test(String.fromCodePoint(...cps).replace(/・/g, ''))) return false; continue; }
      if (cp <= 0x669) arabicIndic = true; else extended = true;
    }
    return !(arabicIndic && extended);
  }

  // RFC 3492, for the part after `xn--`. Code points, or null.
  function decode (s) {
    const out = [];
    const d = s.lastIndexOf('-');
    for (let j = 0; j < d; j++) { const c = s.charCodeAt(j); if (c >= 0x80) return null; out.push(c); }
    let n = 128, i = 0, bias = 72;
    for (let p = d + 1; p < s.length;) {
      const old = i;
      let w = 1;
      for (let k = 36; ; k += 36) {
        if (p >= s.length) return null;
        const c = s.charCodeAt(p++);
        const digit = c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : 36;
        if (digit >= 36 || digit > Math.floor((0x7fffffff - i) / w)) return null;
        i += digit * w;
        const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
        if (digit < t) break;
        if (w > Math.floor(0x7fffffff / (36 - t))) return null;
        w *= 36 - t;
      }
      const len = out.length + 1;
      bias = adapt(i - old, len, old === 0);
      if (Math.floor(i / len) > 0x7fffffff - n) return null;
      n += Math.floor(i / len);
      i %= len;
      if (n > 0x10FFFF) return null;
      out.splice(i++, 0, n);
    }
    return out;
  }
  function adapt (delta, points, first) {
    delta = first ? Math.floor(delta / 700) : delta >> 1;
    delta += Math.floor(delta / points);
    let k = 0;
    for (; delta > 455; k += 36) delta = Math.floor(delta / 35);
    return k + Math.floor(36 * delta / (delta + 38));
  }
  function encode (cps) {
    let out = '';
    for (const c of cps) if (c < 0x80) out += String.fromCharCode(c);
    const basic = out.length;
    let h = basic;
    if (basic > 0) out += '-';
    let n = 128, delta = 0, bias = 72;
    while (h < cps.length) {
      let m = 0x10FFFF;
      for (const c of cps) if (c >= n && c < m) m = c;
      delta += (m - n) * (h + 1);
      n = m;
      for (const c of cps) {
        if (c < n) delta++;
        if (c === n) {
          let q = delta;
          for (let k = 36; ; k += 36) {
            const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
            if (q < t) break;
            const dg = t + (q - t) % (36 - t);
            out += String.fromCharCode(dg < 26 ? dg + 97 : dg + 22);
            q = Math.floor((q - t) / (36 - t));
          }
          out += String.fromCharCode(q < 26 ? q + 97 : q + 22);
          bias = adapt(delta, h + 1, h === basic);
          delta = 0;
          h++;
        }
      }
      delta++;
      n++;
    }
    return out;
  }

  // An A-label, `xn--` and its Punycode, given lower-cased: it decodes, to
  // something not all ASCII, encodes back to itself, and is a valid U-label.
  // The code points, or null.
  function aLabel (label) {
    const cps = decode(label.slice(4));
    if (cps === null || cps.every((c) => c < 0x80) || encode(cps) !== label.slice(4)) return null;
    const u = String.fromCodePoint(...cps);
    if (u.normalize('NFC') !== u || !uLabel(cps)) return null;
    return cps;
  }

  // The Bidi rule over a whole name, its labels as code points.
  function bidiName (labels) {
    let rtl = false;
    for (const l of labels) for (const c of l) { const b = bidi(c); if (b === 'R' || b === 'AN') { rtl = true; break; } }
    if (!rtl) return true;
    for (const l of labels) if (!bidiLabel(l)) return false;
    return true;
  }

  // A `hostname` whose LDH checks have passed and which has a label with
  // hyphens in its third and fourth places: every label starting `xn--` must
  // be an A-label, and the name as a whole must keep the Bidi rule.
  function hostnameLabels (s) {
    const labels = [];
    for (const raw of s.split('.')) {
      const l = raw.toLowerCase();
      if (l.charCodeAt(2) === 0x2D && l.charCodeAt(3) === 0x2D && l.startsWith('xn--')) {
        const cps = aLabel(l);
        if (cps === null) return false;
        labels.push(cps);
      } else labels.push([...l].map((c) => c.charCodeAt(0)));
    }
    return bidiName(labels);
  }

  // `idn-hostname`: the name read through the UTS 46 mapping (compatibility
  // forms and case folded, default-ignorable characters dropped, the ideographic
  // full stops made dots), then every label an A-label or a U-label, 63
  // octets at most in its A-label form, 253 for the name.
  function idnHostname (s) {
    if (typeof s !== 'string' || s.length === 0) return false;
    // Lower-casing stands in for case folding, except where status() writes
    // the difference out: Cherokee folds to its capitals, and the others are
    // folded through their capitals (U+1F80 to U+1F00 U+03B9).
    const m = s.normalize('NFKC').toLowerCase()
      .replace(/[\u13F8-\u13FD\uAB70-\uABBF]/g, (c) => c.toUpperCase())
      .replace(/[\u0345\u1C80-\u1C88\u1F80-\u1F87\u1F90-\u1F97\u1FA0-\u1FA7\u1FB2-\u1FB4\u1FB7\u1FC2-\u1FC4\u1FC7\u1FF2-\u1FF4\u1FF7]/g, (c) => c.toUpperCase().toLowerCase())
      .normalize('NFC')
      .replace(/(?![‌‍])\p{Default_Ignorable_Code_Point}/gu, '').replace(/[。．｡]/g, '.');
    const parts = m.split('.');
    const labels = [];
    let octets = parts.length - 1;
    for (const l of parts) {
      let cps, ascii = true;
      for (let i = 0; i < l.length; i++) if (l.charCodeAt(i) >= 0x80) { ascii = false; break; }
      if (ascii) {
        if (l.length === 0 || l.length > 63) return false;
        for (let i = 0; i < l.length; i++) {
          const c = l.charCodeAt(i);
          if (!(c === 0x2D || (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7A))) return false;
        }
        if (l.charCodeAt(0) === 0x2D || l.charCodeAt(l.length - 1) === 0x2D) return false;
        if (l.charCodeAt(2) === 0x2D && l.charCodeAt(3) === 0x2D) {
          if (!l.startsWith('xn--')) return false;
          cps = aLabel(l);
          if (cps === null) return false;
        } else cps = [...l].map((c) => c.charCodeAt(0));
        octets += l.length;
      } else {
        cps = [];
        for (const c of l) cps.push(c.codePointAt(0));
        if (!uLabel(cps)) return false;
        const a = 4 + encode(cps).length;
        if (a > 63) return false;
        octets += a;
      }
      labels.push(cps);
    }
    if (octets > 253) return false;
    return bidiName(labels);
  }

  return { hostnameLabels, idnHostname, status, virama, bidi, decode, encode };
}

module.exports = { __ataIdna };
