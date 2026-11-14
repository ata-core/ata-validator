import { _idna } from './_idna.mjs'
export function fmt_idn_hostname (s) { {if(!_idna().idnHostname(s))return false}; return true }
