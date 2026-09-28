'use strict';

// The closure pass that fills `default` values, shared by the validator core
// and by the wrapper around a compiled module, so both fill defaults the same
// way. The generated pass in index.js is held to this one by
// tests/test_nested_defaults_engines.js.

// Extract default values from a schema tree. Returns a function that applies
// defaults to an object in-place (mutates), or null if no defaults exist.
function buildDefaultsApplier(schema) {
  if (typeof schema !== "object" || schema === null) return null;
  const actions = [];
  collectDefaults(schema, actions);
  if (actions.length === 0) return null;
  return (data) => {
    for (let i = 0; i < actions.length; i++) actions[i](data);
  };
}

// Write an own property. Plain assignment of a key named `__proto__` does
// not create a property at all: it hits the Object.prototype setter and
// rewrites the object's prototype, which is how a schema could reach
// Object.prototype itself. defineProperty has no such special case.
function setOwn(obj, key, val) {
  if (key === "__proto__") {
    Object.defineProperty(obj, key, {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    obj[key] = val;
  }
}

function collectDefaults(schema, actions, path) {
  if (typeof schema !== "object" || schema === null) return;
  const props = schema.properties;
  if (!props) return;
  for (const [key, prop] of Object.entries(props)) {
    if (prop && typeof prop === "object" && prop.default !== undefined) {
      const defaultVal = prop.default;
      if (!path) {
        actions.push((data) => {
          if (typeof data === "object" && data !== null && !Object.hasOwn(data, key)) {
            setOwn(data,
              key,
              typeof defaultVal === "object" && defaultVal !== null
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal);
          }
        });
      } else {
        const parentPath = path;
        actions.push((data) => {
          let target = data;
          for (let j = 0; j < parentPath.length; j++) {
            if (typeof target !== "object" || target === null) return;
            // Own keys only. `target[key]` for an inherited name walks the
            // prototype chain: a parent named `__proto__` that the instance
            // does not carry resolved to Object.prototype, and the child
            // defaults were written onto it, for every object in the realm.
            if (!Object.hasOwn(target, parentPath[j])) return;
            target = target[parentPath[j]];
          }
          if (
            typeof target === "object" &&
            target !== null &&
            !Object.hasOwn(target, key)
          ) {
            setOwn(target,
              key,
              typeof defaultVal === "object" && defaultVal !== null
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal);
          }
        });
      }
    }
    // Recurse into nested object schemas
    if (prop && typeof prop === "object" && prop.properties) {
      collectDefaults(prop, actions, (path || []).concat(key));
    }
  }
}

module.exports = { buildDefaultsApplier, setOwn };
