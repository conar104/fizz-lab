/* Fizz Lab — the bottle you pour from.
 *
 * Flow out of a bottle is not set by the pourer directly: it follows from the
 * bottle's angle, how much liquid is left, and — crucially — how fast AIR can
 * get back in to replace what leaves. Every millilitre poured out must be
 * matched by a millilitre of air coming in through the same mouth.
 *
 *   geometry  the bottle is a solid of revolution (body, shoulder, neck). For a
 *             tilt φ (0 = upright, 90° = horizontal, 180° = upside-down) the
 *             liquid surface is the horizontal plane holding the remaining
 *             volume, found by slicing the bottle along its axis.
 *   head      how far that surface stands above the lowest point of the lip.
 *
 * Two regimes:
 *
 *   SMOOTH  part of the mouth is still above the liquid. Liquid leaves through
 *           the lower part like a weir, air enters through the upper part as
 *           an orifice flow. The headspace pressure drops until they balance:
 *               Q_liquid(head − ΔP/ρg) = Q_air(ΔP)
 *   GLUG    the mouth is flooded. Air can only get in as bubbles that rise up
 *           through the neck, at most one neck-full at the Davies–Taylor
 *           speed  U = 0.35·√(g d):
 *               Q_max = (π d²/4) · 0.35 · √(g d)
 *           That is within 5 % of Clanet & Searby's (2004) measured
 *           mean drain rate for upturned bottles, (π/12)·√g·d^{5/2}. The air
 *           arrives in pulses, so the stream glugs.
 *
 * So tipping the bottle slowly keeps an air path open and pours smoothly; jerking
 * it upside-down floods the neck and the flow is throttled into glugs.
 */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  const CD = 0.62;               // discharge coefficient of a sharp lip
  const RHO_AIR = 1.2;
  const TAYLOR = 0.35;           // Davies–Taylor bubble speed coefficient
  const GLUG_DEPTH = 0.8;        // pulse amplitude of glugging (mean preserved)
  const FLOOD_FRACTION = 0.04;   // mouth area left for air below which the neck is flooded
  const REST_ANGLE = 35;         // where the hand returns the bottle [deg]
  const MAX_ANGLE = 170;
  const RETURN_SPEED = 150;      // how fast the hand rights the bottle [deg/s]
  const MANUAL_SPEED = 400;      // fastest a hand turns a held bottle to where you point it [deg/s] (estimate)
  const SLICES = 90;

  /**
   *   body  radius R for length Lb, then a conical shoulder of length Ls,
   *   then the neck (bore radius r) of length Ln.
   */
  // PET: 500 ml ≈ Ø65 × 205 mm, 2 L ≈ Ø109 × 310 mm; both use the PCO 1881 neck, bore 21.7 mm.
  const BOTTLES = {
    pet500:   { id: 'pet500', name: '500 ml PET bottle', fill: 500e-6, R: 0.0325, Lb: 0.130, Ls: 0.050, r: 0.01085, Ln: 0.020 },
    pet2l:    { id: 'pet2l', name: '2 L PET bottle', fill: 2000e-6, R: 0.0545, Lb: 0.200, Ls: 0.070, r: 0.01085, Ln: 0.020 },
    // 26.5 mm crown finish (outer, per manufacturer sheets) with ~4.7 mm glass → ~17 mm bore (estimate)
    glass355: { id: 'glass355', name: '355 ml glass bottle', fill: 355e-6, R: 0.0300, Lb: 0.100, Ls: 0.060, r: 0.0085, Ln: 0.040 },
  };

  /** Area of the part of a disc of radius r lying beyond a chord at signed distance a. */
  function segment(r, a) {
    if (a >= r) return 0;
    if (a <= -r) return Math.PI * r * r;
    return r * r * Math.acos(a / r) - a * Math.sqrt(r * r - a * a);
  }

  class Bottle {
    constructor(type) {
      this.type = type;
      this.L = type.Lb + type.Ls + type.Ln;
      this.slices = [];
      const ds = this.L / SLICES;
      for (let i = 0; i < SLICES; i++) {
        const s = (i + 0.5) * ds;
        this.slices.push({ s, r: this.radiusAt(s), ds });
      }
      this.capacity = this.slices.reduce((v, sl) => v + Math.PI * sl.r * sl.r * sl.ds, 0);
      this.reset();
    }

    reset() {
      this.V = this.type.fill;          // liquid left [m³]
      this.phi = REST_ANGLE;            // axis angle from upright [deg]
      this.Q = 0;
      this.regime = 'idle';
      this.deficit = 0;                 // headspace pressure below atmospheric [Pa]
      this.head = 0;
      this.glugPhase = 0;
      this.surface = 0;
      this.mouthLiquidArea = 0;
    }

    radiusAt(s) {
      const t = this.type;
      if (s <= t.Lb) return t.R;
      if (s <= t.Lb + t.Ls) return t.R + (t.r - t.R) * (s - t.Lb) / t.Ls;
      return t.r;
    }

    /**
     * Liquid volume below the horizontal plane at height h (bottle frame:
     * origin at the centre of the base, axis tilted φ from vertical). A point
     * at axial distance s and transverse offset w sits at  y = s cosφ − w sinφ.
     */
    volumeBelow(h, cosP, sinP) {
      let v = 0;
      for (const sl of this.slices) {
        if (sinP < 1e-6) { if (sl.s * cosP < h) v += Math.PI * sl.r * sl.r * sl.ds; continue; }
        v += segment(sl.r, (sl.s * cosP - h) / sinP) * sl.ds;
      }
      return v;
    }

    /** Height of the free surface holding the remaining liquid (bisection: volume is monotonic in h). */
    surfaceHeight(cosP, sinP) {
      let lo = Infinity, hi = -Infinity;
      for (const sl of this.slices) {
        const y = sl.s * cosP, dy = sl.r * sinP;
        lo = Math.min(lo, y - dy); hi = Math.max(hi, y + dy);
      }
      for (let it = 0; it < 32; it++) {
        const mid = 0.5 * (lo + hi);
        if (this.volumeBelow(mid, cosP, sinP) < this.V) lo = mid; else hi = mid;
      }
      return 0.5 * (lo + hi);
    }

    /**
     * Liquid flow through the mouth for an effective head e (above the lowest
     * point of the lip). The mouth is a circle of bore radius r whose plane is
     * tilted: its vertical extent is 2a with a = r sinφ. Weir integral over the
     * submerged part:  Q = Cd ∫ b(z) √(2g(e − z)) dz,  b = chord width at height z.
     */
    liquidFlow(e, sinP) {
      if (e <= 0) return 0;
      const r = this.type.r, a2 = 2 * r * sinP;
      if (a2 < 1e-3) return CD * Math.PI * r * r * Math.sqrt(2 * C.G * e);     // mouth nearly horizontal
      const top = Math.min(e, a2), n = 16, dz = top / n;
      let q = 0;
      for (let i = 0; i < n; i++) {
        const z = (i + 0.5) * dz;
        const w = r - z / sinP;
        q += 2 * Math.sqrt(Math.max(0, r * r - w * w)) * Math.sqrt(2 * C.G * (e - z)) * dz;
      }
      return CD * q;
    }

    airFlow(areaAir, dP) { return dP > 0 ? CD * areaAir * Math.sqrt(2 * dP / RHO_AIR) : 0; }

    /** Davies–Taylor ceiling on air bubbling up a flooded neck. */
    glugLimit() {
      const d = 2 * this.type.r;
      return Math.PI * d * d / 4 * TAYLOR * Math.sqrt(C.G * d);
    }

    /**
     * Advance the hand and the flow.
     * ctl = { holding, auto, tiltSpeed [deg/s], targetQ [m³/s], manualPhi [deg] (held by the cursor) }
     * returns the volume poured out this step [m³].
     */
    step(dt, ctl, fl) {
      // --- the hand
      if (ctl.manualPhi != null) {
        // held by the cursor: the hand turns the bottle toward the angle you point it at
        const d = U.clamp(ctl.manualPhi, 0, MAX_ANGLE) - this.phi;
        this.phi += Math.sign(d) * Math.min(Math.abs(d), MANUAL_SPEED * dt);
      } else if (ctl.holding) {
        this.phi = Math.min(MAX_ANGLE, this.phi + ctl.tiltSpeed * dt);
      } else if (ctl.auto) {
        // a pourer's reflex: tip until the flow reaches the aim, then hold it there,
        // tipping further as the bottle empties
        const err = (ctl.targetQ - this.Q) / Math.max(ctl.targetQ, 1e-9);
        const rate = err > 0.1 ? ctl.tiltSpeed : err < -0.15 ? -ctl.tiltSpeed * 0.5 : ctl.tiltSpeed * err;
        this.phi = U.clamp(this.phi + rate * dt, REST_ANGLE, MAX_ANGLE);
      } else {
        this.phi = Math.max(REST_ANGLE, this.phi - RETURN_SPEED * dt);
      }

      // --- where the liquid stands
      const rad = this.phi * Math.PI / 180;
      const cosP = Math.cos(rad), sinP = Math.sin(rad);
      const t = this.type, r = t.r;
      this.cosP = cosP; this.sinP = sinP;
      if (this.V <= 1e-9) { this.V = 0; this.Q = 0; this.regime = 'empty'; return 0; }
      const h = this.surfaceHeight(cosP, sinP);
      this.surface = h;
      const lipLow = this.L * cosP - r * sinP;
      const e = h - lipLow;
      this.head = e;
      if (e <= 0) { this.Q = 0; this.regime = 'idle'; this.deficit = 0; this.mouthLiquidArea = 0; return 0; }

      // --- how much of the mouth is under the liquid (in the mouth plane)
      const mouthArea = Math.PI * r * r;
      const wLine = sinP > 1e-6 ? r - e / sinP : -Infinity;      // liquid covers w > wLine
      const areaLiq = sinP > 1e-6 ? segment(r, wLine) : mouthArea;
      const areaAir = mouthArea - areaLiq;
      const rhoG = fl.rho * C.G;

      let Q, dP;
      if (areaAir < FLOOD_FRACTION * mouthArea) {
        // GLUG: air only gets in as neck-sized bubbles, in pulses
        const d = 2 * r;
        const f = TAYLOR * Math.sqrt(C.G * d) / (1.5 * d);          // one bubble per 1.5 neck diameters of rise
        this.glugPhase += 2 * Math.PI * f * dt;
        const pulse = 1 + GLUG_DEPTH * Math.sin(this.glugPhase);
        // suction needed to push a bubble in; a neck wider than ~2 capillary lengths
        // cannot hold liquid up, so as the head runs out the bubble just breaks through
        dP = rhoG * Math.min(d / 2, e / 2);
        // mean flow = the smaller of the head-driven and air-limited rates; the
        // pulsation rides on top of it so the time-average is preserved
        Q = Math.min(this.liquidFlow(e - dP / rhoG, sinP), this.glugLimit()) * pulse;
        this.regime = 'glug';
      } else {
        // SMOOTH: find the headspace suction that balances liquid out against air in
        let lo = 0, hi = rhoG * e;
        for (let it = 0; it < 30; it++) {
          const mid = 0.5 * (lo + hi);
          if (this.liquidFlow(e - mid / rhoG, sinP) > this.airFlow(areaAir, mid)) lo = mid; else hi = mid;
        }
        dP = 0.5 * (lo + hi);
        Q = this.liquidFlow(e - dP / rhoG, sinP);
        this.regime = 'smooth';
      }
      this.deficit = dP;
      this.mouthLiquidArea = areaLiq;
      const dV = Math.min(this.V, Q * dt);
      this.V -= dV;
      this.Q = dV / dt;
      return dV;
    }

    /** Exit velocity and jet diameter at the lip (continuity through the wetted part of the mouth). */
    exitJet() {
      const A = Math.max(this.mouthLiquidArea, 1e-7);
      return { v: this.Q / A, d: Math.sqrt(4 * A / Math.PI) };
    }
  }

  Bottle.TYPES = BOTTLES;
  Bottle.REST_ANGLE = REST_ANGLE;
  Fizz.Bottle = Bottle;
})(window.Fizz = window.Fizz || {});
