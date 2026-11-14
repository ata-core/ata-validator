function _idna(){return _idna.o||(_idna.o=(function __ataIdna () {
const MARK0 = /^\p{M}/u;
const LETTER_DIGIT = /^[\p{Ll}\p{Lu}\p{Lo}\p{Nd}\p{Lm}\p{Mn}\p{Mc}]$/u;
const IGNORABLE = /^[\p{Default_Ignorable_Code_Point}\p{White_Space}\p{Noncharacter_Code_Point}]$/u;
const UNASSIGNED = /^\p{Cn}$/u;
const GREEK = /^\p{Script=Greek}$/u;
const HEBREW = /^\p{Script=Hebrew}$/u;
const KANA_HAN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const RTL = /^[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]$/u;
const JOINING = /^[\u0600-\u08FF\u1800-\u18AF\uA840-\uA87F\u{10AC0}-\u{10AFF}\u{10B80}-\u{10BAF}\u{10D00}-\u{10D3F}\u{10EC0}-\u{10EFF}\u{10F30}-\u{10FFF}\u{1E900}-\u{1E95F}]$/u;
const FOLD_GREEK = /^[\u1F80-\u1F87\u1F90-\u1F97\u1FA0-\u1FA7\u1FB2-\u1FB4\u1FB7\u1FC2-\u1FC4\u1FC7\u1FF2-\u1FF4\u1FF7]$/u;
const BIDI_ON = /^[\u02B9\u02BA\u02C6-\u02CF\u02EC\u2E2F\uA67F\uA717-\uA71F\uA788]$/u;
const BIDI_L_MARK = /^[\u0CBF\u0CC6\u{11A07}\u{11A08}\u{11C3F}]$/u;
const TRANSPARENT = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
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
if (cp >= 0x13A0 && cp <= 0x13F5) return 1;
if (cp === 0x345 || (cp >= 0x13F8 && cp <= 0x13FD) || (cp >= 0x1C80 && cp <= 0x1C88) || (cp >= 0xAB70 && cp <= 0xABBF) ||
(cp >= 0x1F80 && cp <= 0x1FF7 && FOLD_GREEK.test(ch))) return 0;
if (ch.normalize('NFKC').toLowerCase().normalize('NFKC') !== ch) return 0;
if (IGNORABLE.test(ch)) return 0;
if ((cp >= 0x20D0 && cp <= 0x20FF) || (cp >= 0x1D100 && cp <= 0x1D24F)) return 0;
if ((cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0xA960 && cp <= 0xA97F) || (cp >= 0xD7B0 && cp <= 0xD7FF)) return 0;
return LETTER_DIGIT.test(ch) ? 1 : 0;
}
function virama (cp) {
if (cp === undefined || cp < 0x300) return false;
const c = String.fromCodePoint(cp);
return ('a' + c + '़').normalize('NFD') === 'a़' + c &&
('a' + c + '्').normalize('NFD') === 'a' + c + '्' &&
('a्' + c).normalize('NFD') === 'a्' + c;
}
function bidi (cp) {
if (cp === 0x2D) return 'ES';
if (cp >= 0x30 && cp <= 0x39) return 'EN';
if (cp < 0x80) return 'L';
if (cp >= 0x6F0 && cp <= 0x6F9) return 'EN';
if ((cp >= 0x660 && cp <= 0x669) || (cp >= 0x10D30 && cp <= 0x10D39) || (cp >= 0x10D40 && cp <= 0x10D49)) return 'AN';
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
function aLabel (label) {
const cps = decode(label.slice(4));
if (cps === null || cps.every((c) => c < 0x80) || encode(cps) !== label.slice(4)) return null;
const u = String.fromCodePoint(...cps);
if (u.normalize('NFC') !== u || !uLabel(cps)) return null;
return cps;
}
function bidiName (labels) {
let rtl = false;
for (const l of labels) for (const c of l) { const b = bidi(c); if (b === 'R' || b === 'AN') { rtl = true; break; } }
if (!rtl) return true;
for (const l of labels) if (!bidiLabel(l)) return false;
return true;
}
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
function idnHostname (s) {
if (typeof s !== 'string' || s.length === 0) return false;
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
if (l.length > 126) return false;
for (const c of l) cps.push(c.codePointAt(0));
if (cps.length > 63 || !uLabel(cps)) return false;
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
})())}
export { _idna }
