import { _ip4 } from './_ip4.mjs'
export function fmt_ipv4 (s) { if(!_ip4.test(s))return false; return true }
