'use strict';
// The `verbose` option for the 2.0 Validator: Validator.use(verbose). Each
// error of a rejection gets, on a copy and before the errors are presented,
// parentSchema (the schema object holding the keyword that failed), schema
// (that keyword's value) and data (the value at the error's instancePath), as
// the 1.x Validator gives them under the same option (_verboseWrap,
// resolveSchemaByPath and lib/pointer.js, written small here: a form page
// carries this). A validator asked for verbose without it is refused, naming
// this import.
const un = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~');
const wrap = (r, root, data) => ({
  valid: false,
  errors: r.errors.map((e) => {
    if (!e || e.parentSchema !== undefined) return e;
    const sp = typeof e.schemaPath === 'string' ? e.schemaPath : '';
    // The schema holding the last segment of the path, which is the keyword.
    let p;
    if (sp[0] === '#') {
      const parts = sp.slice(1).split('/').filter(Boolean);
      p = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (p == null || typeof p !== 'object') { p = undefined; break; }
        p = p[un(parts[i])];
      }
    }
    const last = un(sp.slice(sp.lastIndexOf('/') + 1));
    // The value at the instance path; undefined where the walk leaves the document.
    let d = data;
    const ip = e.instancePath;
    if (ip) {
      for (const s of ip.slice(ip[0] === '/' ? 1 : 0).split('/')) {
        if (d == null) { d = undefined; break; }
        d = d[un(s)];
      }
    }
    return { ...e, parentSchema: p, schema: p !== null && typeof p === 'object' && last ? p[last] : undefined, data: d };
  }),
});
module.exports = { verbose: Object.freeze({ name: 'verbose', wrap }) };
