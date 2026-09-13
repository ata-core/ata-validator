'use strict';

// The string to send back to a model when its structured output failed
// validation.
//
// This exists because of a measurement rather than a preference. Feeding the
// conventional error text back into a retry loop, one model, an invoice schema,
// paired so the same failing output went to both arms:
//
//   constraints the model could infer from context   40 of 40 recovered
//   constraints it could not (an internal vocabulary) 0 of 30 recovered
//
// With the expected values named in the message, the second case was 30 of 30.
// The conventional message for `enum` is "must be equal to one of the allowed
// values", which names neither the values nor what arrived, so the model
// guesses. It guesses plausibly and it is always wrong: "HH" for a Hamburg
// office, "FR" for a Lyon desk. Every retry came back well formed and still
// invalid, and no number of further retries can fix it, because what is needed
// was never in the loop.
//
// ata already carries the missing halves on each error, `detail` and
// `received`. The trap is that joining `message`, which is the obvious thing to
// do, throws both away. So this is one call that does not.

// `multipleOf: 0.01` is how a schema says money, and a model acts on "rounded
// to 2 decimal places" where it does not reliably act on "a multiple of 0.01".
// describeSchema found that by measurement; the same wording belongs here, or
// the two halves of the loop describe the same rule differently.
function phrase (error) {
  const p = error.params || {};
  if (error.keyword === 'multipleOf' && typeof p.multipleOf === 'number') {
    const m = p.multipleOf;
    if (m > 0 && m < 1) {
      const places = Math.round(Math.log10(1 / m));
      if (Math.abs(Math.pow(10, -places) - m) < Number.EPSILON * 8) {
        return `must be rounded to ${places} decimal place${places === 1 ? '' : 's'}`;
      }
    }
  }
  return null;
}

function line (error) {
  const where = error.instancePath || error.path || '';
  const body = phrase(error) ||
    (typeof error.detail === 'string' && error.detail ? error.detail : error.message);
  // `detail` usually quotes the offending value already; saying it twice reads
  // like a stutter in a string that is going into a prompt. A container is
  // summarised as `[object, ~0.1KB]` rather than shown, which tells a model
  // nothing it cannot see in its own output, so that is left out too.
  const raw = error.received === undefined || error.received === null ? '' : String(error.received);
  // A container tells a model nothing its own output does not already show,
  // and it is the most expensive thing you can put in a prompt. That covers
  // both the `[object, ~0.1KB]` summary and a whole serialized object.
  const head = raw.charAt(0);
  const useless = (head === '[' && /^\[(object|array)\b/.test(raw)) || head === '{' ||
    (head === '[' && raw.charAt(raw.length - 1) === ']');
  const received = useless ? '' : raw;
  const got = received && body && !body.includes(received) ? `, got ${received}` : '';
  return `${where || '/'}: ${body}${got}`;
}

// toRetryMessage(errors, opts)
//   opts.limit  most errors to include (default 20). A model does not act on
//               forty complaints, and the prompt is not free.
function toRetryMessage (errors, opts) {
  if (!errors || typeof errors.length !== 'number' || errors.length === 0) return '';
  const limit = opts && typeof opts.limit === 'number' ? opts.limit : 20;
  const shown = errors.length > limit ? Array.prototype.slice.call(errors, 0, limit) : errors;
  const lines = [];
  for (let i = 0; i < shown.length; i++) lines.push(line(shown[i]));
  if (errors.length > shown.length) lines.push(`and ${errors.length - shown.length} more`);
  return lines.join('\n');
}

module.exports = { toRetryMessage };
