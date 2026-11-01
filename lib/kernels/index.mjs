// ata-validator/kernels: what a module written by the IR backend
// (lib/ir/emit.mjs) imports. Each name is an export of its own, so a bundle
// keeps one copy of the helpers its modules use, however many modules there
// are, and none of the rest.
export * from './rt.mjs'
export * from './kernels.mjs'
import defaults from '../defaults.js'
// The shared default pass, for a schema whose defaults the IR does not
// specialize (a cycle, or a default behind patternProperties).
export const buildDefaultsApplier = /* @__PURE__ */ (() => defaults.buildDefaultsApplier)()
