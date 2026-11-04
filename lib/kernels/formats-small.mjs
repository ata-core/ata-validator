// The uri, uri-reference and email formats as regular expressions, for a
// bundle where bytes count more than nanoseconds: the table backend's plans
// (lib/ir/table.mjs) name these. They accept exactly what the scanners in
// ./formats.mjs accept (_uri, _urif, generated from lib/js-compiler.js),
// RFC 3986 as the current engine reads it; tests/test_formats_small.js holds
// the two to the same answers on every string of up to five characters over
// an alphabet that covers each character class, on generated and mutated
// URIs and addresses, and on the official suite's format tests.
//
// U: unreserved and sub-delims; X: a percent-encoded octet.
const U = "A-Za-z0-9\\-._~!$&'()*+,;="
const X = '%[0-9A-Fa-f]{2}'
// An IP literal: IPv6 (the same expression as the email check's), with a zone
// (%25 and at least one character), or IPvFuture.
const IP6 = '(?:(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){6}(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|::(?:(?:[0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{1,4})?|::(?:(?:[0-9A-Fa-f]{1,4}:){0,5})?(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[0-9A-Fa-f]{1,4}:){0}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,5}[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){0}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,4})?(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[0-9A-Fa-f]{1,4}:){1}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,4}[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){1}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,3})?(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[0-9A-Fa-f]{1,4}:){2}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,3}[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){2}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,2})?(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[0-9A-Fa-f]{1,4}:){3}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,2}[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){3}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,1})?(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[0-9A-Fa-f]{1,4}:){4}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,1}[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){4}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,0})?(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[0-9A-Fa-f]{1,4}:){5}[0-9A-Fa-f]{1,4}::(?:(?:[0-9A-Fa-f]{1,4}:){0,0}[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){6}[0-9A-Fa-f]{1,4}::))'
const LIT = '\\[(?:' + IP6 + '(?:%25(?:[' + U + ']|' + X + ')+)?|[vV][0-9A-Fa-f]+\\.[' + U + ':]+)\\]'
// authority: userinfo@ once, then an IP literal or a reg-name, then a port.
const AUTH = '(?:(?:[' + U + ':]|' + X + ')*@)?(?:' + LIT + '|(?:[' + U + ']|' + X + ')*)(?::[0-9]*)?'
const PATH = '(?:[' + U + ':@/]|' + X + ')*'
const TAIL = '(?:\\?(?:[' + U + ':@/?]|' + X + ')*)?(?:#(?:[' + U + ':@/?]|' + X + ')*)?$'
const SCHEME = '[A-Za-z][A-Za-z0-9+.\\-]*:'
// uri: a scheme, then an authority and a path that is empty or starts with
// "/", or a path that does not start with "//".
const URI = /* @__PURE__ */ new RegExp('^' + SCHEME + '(?://' + AUTH + '(?:/' + PATH + ')?|(?!//)' + PATH + ')' + TAIL)
// uri-reference: a uri, or a relative reference whose first segment, when the
// path does not start with "/", has no ":".
const REF = /* @__PURE__ */ new RegExp('^(?:' + SCHEME + '(?://' + AUTH + '(?:/' + PATH + ')?|(?!//)' + PATH + ')|//' + AUTH + '(?:/' + PATH + ')?|/(?!/)' + PATH + '|(?:[' + U + '@]|' + X + ')+(?:/' + PATH + ')?|)' + TAIL)
export const fmt_uri_s = (s) => URI.test(s)
export const fmt_uri_reference_s = (s) => REF.test(s)

// email: the address split at its last "@"; the local part (at most 64
// characters) a dot-atom or a quoted string, the domain (at most 253) a
// hostname of labels of 1 to 63 letters, digits and inner hyphens, or an
// IPv4 or "IPv6:" literal. The dot-atom's characters are the scanner's mask.
const A = "[!#$%&'*+\\-/0-9=?A-Z^_`a-z{|}~]"
const LOCAL = /* @__PURE__ */ new RegExp('^(?:' + A + '+(?:\\.' + A + '+)*|"(?:[ !#-\\[\\]-~]|\\\\[ -~])*")$')
const V4 = '(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
const DOMAIN = /* @__PURE__ */ new RegExp('^(?:\\[(?:[iI][pP][vV]6:' + IP6 + '|' + V4 + ')\\]|' + LABEL + '(?:\\.' + LABEL + ')*)$')
export const fmt_email_s = (s) => { const a = s.lastIndexOf('@'); return a > 0 && a <= 64 && s.length - a <= 254 && LOCAL.test(s.slice(0, a)) && DOMAIN.test(s.slice(a + 1)) }
