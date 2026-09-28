'use strict';

// The source emitters for the formats: each returns JavaScript source that
// checks a string in place, which the code generator inlines into the
// function it builds. Split from lib/formats.js, which keeps the runtime
// checks the interpreted engine calls, so a bundle without the code generator
// (ata-validator/lite) does not carry them.

const { DURATION_RE, URI_TEMPLATE_EXPR, URI_FAST } = require('./formats');

const uriCharsSource = (v, from) =>
  `for(let _ri=${from};_ri<${v}.length;_ri++){const _rc=${v}.charCodeAt(_ri);` +
  'if(_rc<33||_rc>126||_rc===34||_rc===60||_rc===62||_rc===92||_rc===94||_rc===96||_rc===123||_rc===124||_rc===125)return false;' +
  `if(_rc===37){const _h1=${v}.charCodeAt(_ri+1),_h2=${v}.charCodeAt(_ri+2);` +
  'if(!((_h1>=48&&_h1<=57)||(_h1>=97&&_h1<=102)||(_h1>=65&&_h1<=70))||' +
  '!((_h2>=48&&_h2<=57)||(_h2>=97&&_h2<=102)||(_h2>=65&&_h2<=70)))return false;_ri+=2}}';
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
const iriCharsSource = (v, from) =>
  `for(let _ii=${from};_ii<${v}.length;_ii++){const _ic=${v}.charCodeAt(_ii);` +
  'if(_ic===127||(_ic<127&&(_ic<33||_ic===34||_ic===60||_ic===62||_ic===92||_ic===94||_ic===96||_ic===123||_ic===124||_ic===125)))return false;' +
  `if(_ic===37){const _j1=${v}.charCodeAt(_ii+1),_j2=${v}.charCodeAt(_ii+2);` +
  'if(!((_j1>=48&&_j1<=57)||(_j1>=97&&_j1<=102)||(_j1>=65&&_j1<=70))||' +
  '!((_j2>=48&&_j2<=57)||(_j2>=97&&_j2<=102)||(_j2>=65&&_j2<=70)))return false;_ii+=2}}';
function iriSource (v, isStr) {
  return guard(v, isStr, `const _n=${v}.length;if(_n===0)return false;` +
    `const _f=${v}.charCodeAt(0);if(!((_f>=97&&_f<=122)||(_f>=65&&_f<=90)))return false;` +
    `let _co=-1;for(let _i=1;_i<_n;_i++){const _c=${v}.charCodeAt(_i);if(_c===58){_co=_i;break}` +
    `if(!((_c>=48&&_c<=57)||(_c>=97&&_c<=122)||(_c>=65&&_c<=90)||_c===43||_c===45||_c===46))return false}` +
    `if(_co===-1)return false;` +
    iriCharsSource(v, '_co+1') +
    uriAuthoritySource(v, '_co+1'));
}
function iriReferenceSource (v, isStr) { return guard(v, isStr, iriCharsSource(v, '0')); }
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
  '_ucs[43]=1;_ucs[45]=1;_ucs[46]=1;const _ufa=/' + URI_FAST.source + '/';
const URI_HELPER_BODY = 'if(_ufa.test(_s))return true;const _n=_s.length;if(_n===0)return false;let _c=_s.charCodeAt(0);if(_c>127||_ucs[_c]===0||(_c>=48&&_c<=57)||_c===43||_c===45||_c===46)return false;let _co=-1;for(let _i=1;_i<_n;_i++){_c=_s.charCodeAt(_i);if(_c===58){_co=_i;break}if(_c>127||_ucs[_c]===0)return false}if(_co===-1)return false;let _i=_co+1;let _ae=_n;if(_s.charCodeAt(_i)===47&&_s.charCodeAt(_i+1)===47){const _as=_i+2;let _at=-1,_fc=-1,_lc=-1,_br=0,_ba=0,_hs=_as;_ae=-1;for(_i=_as;_i<_n;_i++){_c=_s.charCodeAt(_i);if(_c>127||_uct[_c]===0)return false;if(_c===47||_c===63||_c===35){_ae=_i;break}if(_c===37){const _h1=_s.charCodeAt(_i+1),_h2=_s.charCodeAt(_i+2);if(!(_h1<=127)||!(_h2<=127)||_uch[_h1]===0||_uch[_h2]===0)return false;_i+=2;continue}if(_c===64){_ba=_br;_at=_i;_fc=-1;_lc=-1;_hs=_i+1}else if(_c===58){if(_fc===-1)_fc=_i;_lc=_i}else if(_c===91||_c===93){_br=1}}if(_ae===-1)_ae=_n;if(_at!==-1&&_ba)return false;if(_s.charCodeAt(_hs)===91){let _cl=-1;for(let _j=_hs+1;_j<_ae;_j++){if(_s.charCodeAt(_j)===93){_cl=_j;break}}if(_cl===-1)return false;if(_cl+1!==_ae){if(_s.charCodeAt(_cl+1)!==58)return false;for(let _j=_cl+2;_j<_ae;_j++){const _d=_s.charCodeAt(_j);if(_d<48||_d>57)return false}}}else if(_lc!==-1){if(_fc!==_lc)return false;for(let _j=_lc+1;_j<_ae;_j++){const _d=_s.charCodeAt(_j);if(_d<48||_d>57)return false}}_i=_ae}for(;_i<_n;_i++){_c=_s.charCodeAt(_i);if(_c>127||_uct[_c]===0)return false;if(_c===37){const _h1=_s.charCodeAt(_i+1),_h2=_s.charCodeAt(_i+2);if(!(_h1<=127)||!(_h2<=127)||_uch[_h1]===0||_uch[_h2]===0)return false;_i+=2}}return true;';
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
function jsonPointerSource(v, isStr) {
  const body = `{let _ok=${v}==='';if(!_ok&&${v}.charCodeAt(0)===47){_ok=true;for(let _i=0;_i<${v}.length;_i++){if(${v}.charCodeAt(_i)!==126)continue;const _n=${v}.charCodeAt(_i+1);if(_n!==48&&_n!==49){_ok=false;break}}}if(!_ok)return false}`;
  return isStr ? body : `if(typeof ${v}==='string')${body}`;
}
function relativeJsonPointerSource(v, isStr) {
  const body = `{let _i=0;while(_i<${v}.length){const _c=${v}.charCodeAt(_i);if(_c<48||_c>57)break;_i++}let _ok=_i>0&&!(_i>1&&${v}.charCodeAt(0)===48);if(_ok){const _r=${v}.slice(_i);if(_r!=='#'){_ok=_r==='';if(!_ok&&_r.charCodeAt(0)===47){_ok=true;for(let _j=0;_j<_r.length;_j++){if(_r.charCodeAt(_j)!==126)continue;const _n=_r.charCodeAt(_j+1);if(_n!==48&&_n!==49){_ok=false;break}}}}}if(!_ok)return false}`;
  return isStr ? body : `if(typeof ${v}==='string')${body}`;
}
function uriTemplateSource (v, isStr) {
  const inner =
    `let _i=0;` +
    `while(_i<${v}.length){` +
      `const _c=${v}.charCodeAt(_i);` +
      `if(_c===125)return false;` +
      `if(_c!==123&&(_c<=32||_c===127))return false;` +
      `if(_c!==123){_i++;continue}` +
      // `_ute`, not `_e`: this source is spliced into a generated function whose
      // error accumulator is `_e`, and a `const _e` here shadowed it, so
      // `(_e||(_e=[])).push(...)` ran against a number and threw. The verdict was
      // right, so the suite never saw it; only a caller reading `.errors` did.
      `const _ute=${v}.indexOf('}',_i+1);` +
      `if(_ute===-1)return false;` +
      `const _x=${v}.slice(_i+1,_ute);` +
      `if(_x===''||_x.indexOf('{')!==-1)return false;` +
      `if(!${URI_TEMPLATE_EXPR.toString()}.test(_x))return false;` +
      `_i=_ute+1` +
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
function durationSource (v, isStr) {
  const inner = `if(!${DURATION_RE.toString()}.test(${v}))return false`;
  return isStr ? inner : `if(typeof ${v}==='string'&&${inner.slice(3)}`;
}
module.exports = { uriHelperSource, uriCharsSource, uriAuthoritySource, iriSource, iriReferenceSource, idnEmailSource, dateSource, ipv4Source, dateTimeSource, ipv6Source, hostnameSource, uriSource, uuidSource, timeSource, noReservedSource, jsonPointerSource, relativeJsonPointerSource, uriTemplateSource, emailSource, durationSource };
