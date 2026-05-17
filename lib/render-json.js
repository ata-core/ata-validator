'use strict';

function renderJSON (errors, opts) {
  opts = opts || {};
  const payload = {
    errors: Array.isArray(errors) ? errors : [],
    summary: { count: Array.isArray(errors) ? errors.length : 0, context: opts.context || 'input' },
  };
  return opts.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

module.exports = { renderJSON };
