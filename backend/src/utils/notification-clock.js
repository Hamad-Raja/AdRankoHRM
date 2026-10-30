"use strict";
// A server-only seam for deterministic expiry/cutoff tests. Never reads HTTP inputs.
module.exports={now:()=>new Date()};
