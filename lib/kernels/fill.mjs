// The shared default pass, for a schema whose defaults the IR does not
// specialize (a cycle, or a default behind patternProperties). A module of
// its own: it reads lib/defaults.js, and a module that imports it only from
// here leaves it out of a bundle when no default needs it.
import defaults from '../defaults.js'
export const buildDefaultsApplier = /* @__PURE__ */ (() => defaults.buildDefaultsApplier)()
