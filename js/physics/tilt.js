/* Fizz Lab — geometry of a tilted cup.
 *
 * The physics tracks the liquid as an "equivalent level" z: the height it
 * would stand at in the upright cup. When the cup is tilted by θ, the same
 * liquid fills the rotated cup up to a horizontal surface at world height h.
 * This module maps between z and h using the cross-section area:
 *
 *     D · z  =  area of the rotated cup section lying below the line y = h
 *
 * (exact in the 2-D cross-section; a close approximation for the 3-D
 * cylinder). From it follow the two things tilt changes physically:
 *   rimLevel  — the equivalent level at which liquid reaches the LOW rim and
 *               spills. Tilting a full glass pours it out.
 *   chord(h)  — the width of the free surface, which widens as the glass
 *               leans (surface area ∝ 1/cos θ while it spans both walls).
 *
 * World frame: origin at the centre of the inner floor, y up. Positive θ
 * rotates the cup counter-clockwise, so its mouth leans left toward the bottle.
 */
(function (Fizz) {
  'use strict';

  /** Clip a polygon to the half-plane y ≤ h and return its area (shoelace). */
  function areaBelow(poly, h) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ain = a[1] <= h, bin = b[1] <= h;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (h - a[1]) / (b[1] - a[1]);
        out.push([a[0] + t * (b[0] - a[0]), h]);
      }
    }
    let s = 0;
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  /** Horizontal extent [xa, xb] of the polygon at height h. */
  function chordAt(poly, h) {
    let xa = Infinity, xb = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] - h) * (b[1] - h) > 0 || a[1] === b[1]) continue;
      const x = a[0] + (h - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      if (x < xa) xa = x;
      if (x > xb) xb = x;
    }
    return xa <= xb ? [xa, xb] : null;
  }

  /**
   * Build the mapping for a cup of inner width D and height H tilted by θ [rad].
   * Results are cached by the caller (it only changes when D, H or θ do).
   */
  function make(D, H, theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    const rot = (x, y) => [x * c - y * s, x * s + y * c];
    const hw = D / 2;
    const poly = [rot(-hw, 0), rot(hw, 0), rot(hw, H), rot(-hw, H)];
    const ys = poly.map(p => p[1]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const lowRim = Math.min(poly[2][1], poly[3][1]);

    const worldToLevel = (h) => areaBelow(poly, h) / D;

    /** Inverse by bisection: area is monotonic in h. */
    function levelToWorld(z) {
      if (theta === 0) return z;
      const target = D * z;
      let lo = yMin, hi = yMax;
      if (target <= 0) return yMin;
      for (let it = 0; it < 40; it++) {
        const mid = 0.5 * (lo + hi);
        if (areaBelow(poly, mid) < target) lo = mid; else hi = mid;
      }
      return 0.5 * (lo + hi);
    }

    return {
      theta, cos: c, sin: s, poly, yMin, yMax,
      rot,
      worldToLevel: theta === 0 ? (h) => Math.max(0, h) : worldToLevel,
      levelToWorld,
      chord: (h) => chordAt(poly, h),
      /** Equivalent level at which liquid reaches the lower rim and spills. */
      rimLevel: theta === 0 ? H : worldToLevel(lowRim),
      lowRimSide: s > 0 ? -1 : 1,          // which rim is lower: −1 left, +1 right
      /** Width of the free surface relative to the upright cup. */
      surfaceFactor(z) {
        if (theta === 0) return 1;
        const ch = chordAt(poly, levelToWorld(z));
        return ch ? Math.max(0.05, (ch[1] - ch[0]) / D) : 1;
      },
    };
  }

  Fizz.Tilt = { make, areaBelow, chordAt };
})(window.Fizz = window.Fizz || {});
