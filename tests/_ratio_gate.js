'use strict'

// A cost test compares two timings as a ratio, so machine speed drops out, but a
// shared CI runner still lands one measurement over budget now and then: in the
// CI history these gates failed on a single job of the matrix, a different one
// each time, while the others passed. A regression is over budget every time it
// is measured; noise is not. So a gate measures again before it fails, and fails
// only when every attempt is over.
//
// `measure` takes the measurements and returns the failure messages, empty when
// everything is within budget. `ok` prints the passing line from the attempt
// that passed.
function ratioGate (measure, ok, attempts = 3) {
  let failures = []
  for (let a = 1; a <= attempts; a++) {
    const result = measure()
    failures = result.failures
    if (failures.length === 0) {
      console.log(ok(result) + (a > 1 ? ` (attempt ${a} of ${attempts})` : ''))
      return
    }
  }
  for (const f of failures) console.error(`${f} (over budget on all ${attempts} attempts)`)
  process.exit(1)
}

module.exports = { ratioGate }
