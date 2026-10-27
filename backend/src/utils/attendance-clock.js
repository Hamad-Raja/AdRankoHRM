"use strict";
// Server-only clock seam for deterministic tests; never reads request data.
module.exports = { now: () => new Date() };
