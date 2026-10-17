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
 *
 * SLOSHING. The drink in the bottle has its own first sloshing mode. Its free
 * surface tilts by an angle s about the level, a damped oscillator driven by
 * the bottle's acceleration (the level a still liquid would take in the moving
 * bottle is tilted by atan(−a_x / (g + a_y))):
 *     s'' = ω₀²·(s_eq − s) − 2ζω₀·s',   ω₀² = g·k·tanh(k·h),  k = 1.841 / R
 * (first antisymmetric mode of a circular tank, Ibrahim 2005, Liquid Sloshing
 * Dynamics, ch. 2; ~3.7 Hz in a 500 ml bottle). ζ ≈ 0.03 (clean wall, plus the
 * shoulder and neck). The tilted surface raises the liquid at the mouth when it
 * swings that way, so sloshing pulses the pour.
 *
 * SHAKING. A surface driven past ~25° that overturns faster than ~0.15 m/s
 * breaks and traps air as fine bubbles (~50 µm; estimate: entrained gas ∝ the
 * breaking edge's speed). In supersaturated soda each one is a ready-made
 * nucleus: it grows by diffusion of CO2 into it (Epstein–Plesset, Sh = 2),
 *     dV/dt = 4πR·D·(c − c_eq)·RT/P   per bubble,
 * so a cloud of N bubbles grows fast while they are small, and they rise out
 * at their Stokes speed 2ρgR²/9μ (capped at 0.25 m/s), stacking up as foam in
 * the headspace (bursting at the drink's own rate). Foam that outgrows the headspace comes out of the mouth.
 * The CO2 those bubbles carry off is gone from the drink, so a shaken bottle
 * pours flatter, and the bubbles still in it pour out with the drink and foam
 * up the glass. (A shaken bottle that is still sealed would gush on opening;
 * here the bottle is already open.)
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
  const SLOSH_ZETA = 0.03;       // damping ratio of the bottle's first slosh mode (estimate)
  const SLOSH_BREAK = 0.45;      // surface steeper than this [rad] breaks and traps air (estimate)
  const ENTRAIN = 0.02;          // air trapped per (surface area × breaking-edge speed) (estimate)
  const BREAK_SPEED = 0.15;      // a wave must hit the wall at least this fast to trap air [m/s] (estimate)
  const R_TRAPPED = 50e-6;       // radius of the bubbles a breaking wave traps [m] (estimate)
  const D_CO2 = 1.9e-9;          // diffusivity of CO2 in the drink [m²/s]
  const FOAM_PHI = 0.15;         // liquid fraction of the foam they make in the headspace

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
      this.slosh = 0; this.sloshRate = 0; this.sloshExcess = 0;   // free-surface tilt [rad] (+ raises the mouth side) and its rate
      this.Vb = 0; this.Nb = 0;             // gas in bubbles mixed through the drink [m³] and how many
      this.foamG = 0; this.foamL = 0;       // foam in the headspace: gas and liquid [m³]
      this.lostMol = 0;                     // CO2 the drink has lost to bubbles since it was opened [mol]
      this.spew = null;                     // foam/liquid pushed out of the mouth this step
    }

    /**
     * Sloshing and shaking (see the header). ctx = { ax, ay [m/s², the drink's
     * centre of mass], c [mol/m³ dissolved], ceq [mol/m³ at 1 atm], RT, P [Pa],
     * burstTau [s, how long its foam lasts] }. Returns mol CO2 taken out of the drink.
     */
    stepShake(dt, ctx) {
      const t = this.type, R = t.R;
      this.spew = null;
      if (this.V <= 1e-9) { this.slosh = this.sloshRate = 0; this.Vb = this.Nb = 0; return 0; }
      // the free-surface mode: depth along the axis ~ V / (πR²), capped by the body
      const k = 1.841 / R, depth = Math.min(t.Lb, this.V / (Math.PI * R * R));
      const w0 = Math.sqrt(C.G * k * Math.tanh(k * Math.max(depth, 0.005)));
      const sEq = Math.atan2(-(ctx.ax || 0), C.G + (ctx.ay || 0));
      // exact integration of the damped oscillator over dt (stable at any step)
      const z = SLOSH_ZETA, wd = w0 * Math.sqrt(1 - z * z), e = Math.exp(-z * w0 * dt);
      const x0 = this.slosh - sEq, v0 = this.sloshRate;
      const cs = Math.cos(wd * dt), sn = Math.sin(wd * dt);
      this.slosh = sEq + e * (x0 * cs + (v0 + z * w0 * x0) / wd * sn);
      this.sloshRate = e * (v0 * cs - (z * w0 * v0 + w0 * w0 * x0) / wd * sn);
      this.sloshExcess = this.slosh - sEq;
      // breaking: the excess is spent tearing the surface, trapping air
      let mol = 0;
      const over = Math.abs(this.slosh - sEq) - SLOSH_BREAK;
      if (over > 0) {
        // driven past breaking: the surface overturns at the wall at about ω₀R per
        // radian it is forced beyond the limit
        const edge = over * w0 * R;
        const Vair = ENTRAIN * Math.PI * R * R * Math.max(0, edge - BREAK_SPEED) * dt;
        this.Vb += Vair; this.Nb += Vair / (4 / 3 * Math.PI * R_TRAPPED ** 3);
        this.slosh = sEq + Math.sign(this.slosh - sEq) * SLOSH_BREAK;
      }
      // trapped bubbles grow on the dissolved CO2, then rise out into foam
      if (this.Vb > 0 && this.Nb > 0) {
        const Rb = Math.cbrt(3 * this.Vb / (4 * Math.PI * this.Nb));
        const drive = Math.max(0, ctx.c - ctx.ceq) * ctx.RT / ctx.P;   // gas volume per volume of drink
        let dVg = this.Nb * 4 * Math.PI * Rb * D_CO2 * drive * dt;
        const molMax = 0.5 * Math.max(0, ctx.c - ctx.ceq) * this.V;     // never more than half the excess
        mol = Math.min(dVg * ctx.P / ctx.RT, molMax);
        dVg = mol * ctx.RT / ctx.P;
        this.Vb += dVg;
        const R2 = Math.cbrt(3 * this.Vb / (4 * Math.PI * this.Nb));
        const u = Math.min(0.25, 2 * 1000 * C.G * R2 * R2 / (9 * (ctx.mu || 1.5e-3)));
        const fr = 1 - Math.exp(-dt * u / Math.max(depth, 0.01));
        const out = this.Vb * fr;
        this.Vb -= out; this.Nb -= this.Nb * fr;
        const lift = Math.min(this.V * 0.5, out * FOAM_PHI / (1 - FOAM_PHI));
        this.foamG += out; this.foamL += lift; this.V -= lift;
        if (this.Vb < 1e-10) this.Vb = this.Nb = 0;
      }
      // the foam bursts back into liquid and gas
      if (this.foamG > 0) {
        const f = 1 - Math.exp(-dt / Math.max(ctx.burstTau || 5, 0.5));
        const back = this.foamL * f;
        this.foamG -= this.foamG * f; this.foamL -= back; this.V += back;
        if (this.foamG < 1e-10) { this.V += this.foamL; this.foamG = this.foamL = 0; }
      }
      // what no longer fits comes out of the mouth: foam first, then liquid swollen by bubbles
      const room = this.capacity - this.V - this.Vb;
      const foamV = this.foamG + this.foamL;
      if (foamV > room) {
        const ex = Math.min(foamV, foamV - Math.max(0, room)), f = ex / foamV;
        this.spew = { vg: this.foamG * f, vl: this.foamL * f, liquid: 0 };
        this.foamG -= this.foamG * f; this.foamL -= this.foamL * f;
        if (room < 0) {                                            // the drink itself is pushed out
          const vl = Math.min(this.V, -room);
          this.V -= vl; this.spew.liquid = vl;
        }
      }
      this.lostMol += mol;
      return mol;
    }

    /** Gas fraction of what pours out now (bubbles carried with the drink). */
    get gasFraction() { return this.V > 1e-9 ? this.Vb / (this.V + this.Vb) : 0; }
    /** Height of the foam on the drink in the bottle [m], for drawing. */
    get foamHeight() { return (this.foamG + this.foamL) / (Math.PI * this.type.R * this.type.R); }

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
      // the sloshing surface stands higher (or lower) at the mouth, which sits a
      // horizontal distance ≈ (L/2)·sinφ from the middle of the drink. Only the
      // swing about the level the moving bottle imposes counts: a steady
      // acceleration tilts the surface and the effective gravity alike.
      const e = h - lipLow + Math.tan(U.clamp(this.sloshExcess || 0, -0.5, 0.5)) * 0.5 * this.L * sinP;
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
      // the bubbles mixed through the drink leave with it, in proportion
      if (this.Vb > 0) { const fo = Math.min(1, dV / Math.max(this.V, 1e-12)); this.Vb -= this.Vb * fo; this.Nb -= this.Nb * fo; }
      this.V -= dV;
      this.Q = dV / dt;
      return dV;
    }

    /**
     * Exit velocity and jet diameter at the lip. Pouring smoothly, the liquid
     * fills the wetted segment of the mouth: continuity, v = Q/A. Glugging, the
     * mouth is flooded but shared with the air pushing in, so the liquid does
     * not fill it: it leaves at the speed its head gives it (Torricelli on the
     * effective head e − ΔP/ρg, ~0.7 of it averaged over the depth, an
     * estimate) and the jet necks down to match (vena contracta, A = Q/v).
     * Spreading a glugging flow over the whole mouth would make it crawl out at
     * ~0.25 m/s and cling round the lip (teapot effect), when a glugging bottle
     * really throws a clear arc.
     */
    exitJet() {
      const A = Math.max(this.mouthLiquidArea, 1e-7);
      const eEff = Math.max(0, (this.head || 0) - (this.deficit || 0) / (1000 * C.G));
      const v = this.regime === 'glug' ? Math.max(this.Q / A, 0.7 * Math.sqrt(2 * C.G * eEff)) : this.Q / A;
      const Aj = Math.min(A, this.Q / Math.max(v, 1e-6));
      return { v, d: Math.sqrt(4 * Math.max(Aj, 1e-8) / Math.PI) };
    }
  }

  Bottle.TYPES = BOTTLES;
  Bottle.REST_ANGLE = REST_ANGLE;
  Fizz.Bottle = Bottle;
})(window.Fizz = window.Fizz || {});
