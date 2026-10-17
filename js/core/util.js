/* Fizz Lab — small numeric helpers shared by every module.
 *
 * Every module attaches itself to the single global namespace `window.Fizz`
 * so the project runs straight from the file system (no bundler, no server).
 */
(function (Fizz) {
  'use strict';

  const FOUR_THIRDS_PI = 4.18879020478639;

  const U = {
    FOUR_THIRDS_PI,

    clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    lerp(a, b, t) { return a + (b - a) * t; },

    smoothstep(e0, e1, x) {
      const t = U.clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    },

    /** Log-uniform sample in [lo, hi] — the natural prior for sizes spanning decades. */
    logUniform(lo, hi) { return lo * Math.pow(hi / lo, Math.random()); },

    /** Deterministic integer hash → [0, 1). Used for pixel textures that must not flicker. */
    hash2(x, y) {
      let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    },

    sphereVolume(r) { return FOUR_THIRDS_PI * r * r * r; },
    sphereRadius(v) { return Math.cbrt(v / FOUR_THIRDS_PI); },
  };

  Fizz.U = U;
})(window.Fizz = window.Fizz || {});
