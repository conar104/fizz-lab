/* Fizz Lab — rising bubbles (Lagrangian particles).
 *
 * Each particle stands for `w` identical real bubbles (w can be 1 or 10⁴ — a
 * Mentos emits millions per second). Per bubble we track moles of CO2 and of
 * air separately, because entrained air bubbles start with zero CO2 and are
 * the most aggressive gas strippers in the cup.
 *
 * Every step, for every bubble:
 *   1. radius from the gas law, including hydrostatic + Laplace pressure
 *   2. terminal rise velocity from a drag correlation
 *   3. CO2 mass transfer across its skin  (Sherwood number + turbulence)
 *   4. advection by the liquid flow (pour plume, stirring) + turbulent dispersion
 * Bubbles reaching the surface are handed to the foam.
 */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  // Look-up tables on a log-radius grid: drag and mass transfer depend only on
  // R and the fluid, so they are tabulated once per step instead of per bubble.
  const TABLE_N = 128;
  const R_LO = 0.3e-6, R_HI = 8e-3;
  const LOG_LO = Math.log(R_LO), LOG_SPAN = Math.log(R_HI / R_LO);
  const R_DISSOLVED = 0.4e-6;   // below this a bubble has dissolved back into the liquid
  const N_DISSOLVED = 1e-21;     // mol: less gas than this is no longer a bubble
  const SWARM_C = 0.35;         // drift-flux coefficient for buoyancy-driven bubble columns

  /**
   * Radius from moles: solve  (P_L + 2σ/R)·(4/3)πR³ = nRT  for R.
   * f(R) = P_L R³ + 2σR² − 3nRT/4π is convex and starting from the ideal-gas
   * radius (which overshoots) Newton converges monotonically in 2–3 steps.
   */
  function radiusFromMoles(n, PL, sigma, RT) {
    if (!(n > 0)) return 0;                      // fully dissolved: avoid 0/0 in the Newton step
    const k = 3 * n * RT / (4 * Math.PI);
    let R = Math.cbrt(k / PL);
    for (let it = 0; it < 3; it++) {
      const f = (PL * R + 2 * sigma) * R * R - k;
      const df = (3 * PL * R + 4 * sigma) * R;
      R -= f / df;
    }
    return R;
  }

  /**
   * Terminal rise velocity. Drag: Schiller–Naumann, interpolated between a
   * rigid (surfactant-coated, Cd = 24/Re·…) and a mobile (clean, 16/Re·…)
   * interface, floored by Tomiyama's deformed-bubble limit Cd = (8/3)·Eo/(Eo+4).
   *   force balance:  v = √( 4 d Δρ g / (3 ρ Cd) )
   */
  function terminalVelocity(R, fl, mob) {
    const d = 2 * R, drho = fl.rho;                 // gas density (~2 kg/m³) neglected
    const Eo = drho * C.G * d * d / fl.sigma;       // Eötvös number
    const cdCap = (8 / 3) * Eo / (Eo + 4);
    const a = 24 - 8 * mob;
    const vStokes = (2 / 9) * drho * C.G * R * R / fl.mu * (24 / a);
    const vCap = Math.sqrt(4 * d * drho * C.G / (3 * fl.rho * cdCap));
    let v = Math.min(vStokes, vCap);
    for (let it = 0; it < 6; it++) {
      const Re = Math.max(d * v / fl.nu, 1e-9);
      const Cd = Math.max(a / Re * (1 + 0.15 * Math.pow(Re, 0.687)), cdCap);
      v = 0.5 * (v + Math.sqrt(4 * d * drho * C.G / (3 * fl.rho * Cd)));
    }
    return v;
  }

  /**
   * Liquid-side mass-transfer coefficient k_L [m/s] for a rising bubble.
   *   rigid skin:  Sh = 2 + 0.6 Re^½ Sc^⅓        (Frössling / Ranz–Marshall)
   *   mobile skin: Sh = 2 + 1.13 (Re·Sc)^½      (Higbie penetration theory)
   *   k_L = Sh · D / (2R)
   */
  function massTransferCoeff(R, v, fl, mob) {
    const Re = 2 * R * v / fl.nu;
    const shRigid = 2 + 0.6 * Math.sqrt(Re) * Math.cbrt(fl.Sc);
    const shMobile = 2 + 1.13 * Math.sqrt(Re * fl.Sc);
    return (shRigid + (shMobile - shRigid) * mob) * fl.D / (2 * R);
  }

  /** Lamont & Scott eddy-cell model: turbulence renews the bubble skin.  k = 0.4 (εν)^¼ Sc^−½ */
  function turbulentKL(eps, fl) {
    return eps > 0 ? 0.4 * Math.sqrt(Math.sqrt(eps * fl.nu)) / Math.sqrt(fl.Sc) : 0;
  }

  class BubbleField {
    constructor(capacity) {
      this.cap = capacity;
      this.x = new Float64Array(capacity);
      this.y = new Float64Array(capacity);
      this.nC = new Float64Array(capacity);   // mol CO2 per real bubble
      this.nA = new Float64Array(capacity);   // mol air per real bubble
      this.w = new Float64Array(capacity);    // real bubbles per particle
      this.R = new Float64Array(capacity);
      this.zd = new Float64Array(capacity);   // depth across the cup, −1…1 (rendering only; the physics is a cross-section)
      this.count = 0;
      this.holdup = 0;                        // gas volume suspended in the liquid [m³]
      this.realCount = 0;
      this.meanRise = 0;
      this.vtTable = new Float64Array(TABLE_N);
      this.kTable = new Float64Array(TABLE_N);
      this._flow = { ux: 0, uy: 0, eps: 0, Dt: 0 };
    }

    clear() { this.count = 0; this.holdup = 0; this.realCount = 0; this.meanRise = 0; }

    free() { return this.cap - this.count; }

    /** Create `w` bubbles of radius R at (x, y). Returns moles of CO2 put into them (per particle total). */
    spawn(x, y, R, Pin, RT, airFraction, w) {
      if (this.count >= this.cap) return -1;
      const i = this.count++;
      const n = Pin * U.sphereVolume(R) / RT;
      this.x[i] = x; this.y[i] = y; this.R[i] = R; this.w[i] = w; this.zd[i] = Math.random() * 2 - 1;
      this.nA[i] = n * airFraction;
      this.nC[i] = n * (1 - airFraction);
      return this.nC[i] * w;
    }

    /**
     * Take a gas volume V out of the top of the bubble cloud (it went over the rim
     * with the liquid it was mixed into). Returns the CO2 [mol] it carried off.
     */
    removeTop(V) {
      if (!(V > 0) || !this.count) return 0;
      const idx = Array.from({ length: this.count }, (_, i) => i).sort((a, b) => this.y[b] - this.y[a]);
      let mol = 0, gone = 0;
      const dead = [];
      for (const i of idx) {
        if (gone >= V) break;
        const each = U.sphereVolume(this.R[i]);
        const take = Math.min(this.w[i], (V - gone) / Math.max(each, 1e-30));
        mol += this.nC[i] * take; gone += each * take;
        this.w[i] -= take;
        if (this.w[i] <= 1e-9) dead.push(i);
      }
      dead.sort((a, b) => b - a).forEach(i => this._remove(i));
      this.holdup = Math.max(0, this.holdup - gone);
      return mol;
    }

    _remove(i) {
      const j = --this.count;
      this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.R[i] = this.R[j];
      this.nC[i] = this.nC[j]; this.nA[i] = this.nA[j]; this.w[i] = this.w[j]; this.zd[i] = this.zd[j];
    }

    _buildTables(fl, mob) {
      for (let k = 0; k < TABLE_N; k++) {
        const R = Math.exp(LOG_LO + LOG_SPAN * k / (TABLE_N - 1));
        const v = terminalVelocity(R, fl, mob);
        this.vtTable[k] = v;
        this.kTable[k] = massTransferCoeff(R, v, fl, mob);
      }
    }

    _lookup(table, R) {
      const f = U.clamp((Math.log(R) - LOG_LO) / LOG_SPAN, 0, 1) * (TABLE_N - 1);
      const k = Math.min(f | 0, TABLE_N - 2), t = f - k;
      return table[k] + (table[k + 1] - table[k]) * t;
    }

    /**
     * env = { fl, mobility, c, level, Pamb, halfWidth, flow(x, y, out), obstacles: [{x0,x1,y0,y1}],
     *         layerY, cLayer, availableLayer }   — a meltwater layer floating above layerY
     * Returns CO2 uptake from the liquid (and from the layer) and the gas that reached the surface.
     */
    step(dt, env) {
      const { fl, level, Pamb, halfWidth } = env;
      const obstacles = env.obstacles || [];
      // Conservation: bubbles cannot take more CO2 than the liquid holds. Matters
      // when the cup has nearly emptied (spilled) while bubbles are still rising.
      let budget = Math.max(0, env.available) * 0.5;
      let budgetW = Math.max(0, env.availableLayer || 0) * 0.5;
      const layerY = env.layerY != null ? env.layerY : Infinity, cW = env.cLayer || 0;
      this._buildTables(fl, env.mobility);
      // Bubble-swarm (drift-flux) circulation: a cloud of bubbles makes the
      // mixture lighter, and the buoyant column carries liquid — and every
      // bubble in it — upward at  u ≈ C·√(g α H)  (bubble-column scaling).
      // Negligible for normal fizz, decisive for a Mentos eruption.
      const alpha = this.holdup / Math.max(this.holdup + env.liquidVolume, 1e-12);
      const uSwarm = SWARM_C * Math.sqrt(C.G * alpha * Math.max(level, 0));
      this.swarm = uSwarm;
      const RT = C.R * fl.T, rhoG = fl.rho * C.G, sigma = fl.sigma, kH = fl.kH, c = env.c;
      const flow = this._flow;
      let uptake = 0, uptakeW = 0, surfacedV = 0, surfacedN = 0, holdup = 0, vtSum = 0, nSum = 0;

      for (let i = 0; i < this.count; i++) {
        const y0 = this.y[i];
        const PL = Pamb + rhoG * Math.max(0, level - y0);
        const nTot = this.nC[i] + this.nA[i];
        // A bubble in undersaturated (chilled, degassed) soda can dissolve completely
        // in one step; drop it — and, defensively, any particle whose state went bad.
        if (!(nTot > N_DISSOLVED) || !Number.isFinite(y0) || !Number.isFinite(this.x[i]) || !(this.w[i] > 0)) {
          this._remove(i--);
          continue;
        }
        const R = radiusFromMoles(nTot, PL, sigma, RT);
        this.R[i] = R;
        const vt = this._lookup(this.vtTable, R);
        env.flow(this.x[i], y0, flow);

        // --- CO2 across the skin: dn/dt = 4πR² k_L (c − kH·p_CO2)
        const kL = this._lookup(this.kTable, R) + turbulentKL(flow.eps, fl);
        const pCO2 = (PL + 2 * sigma / R) * this.nC[i] / nTot;
        // in the meltwater layer the bubble meets water with (almost) no CO2: it gives some back
        const inLayer = y0 > layerY;
        let dn = 4 * Math.PI * R * R * kL * ((inLayer ? cW : c) - kH * pCO2) * dt;
        if (this.nC[i] + dn < 0) dn = -this.nC[i];
        if (inLayer) {
          if (dn > 0) { dn = Math.min(dn, budgetW / this.w[i]); budgetW -= dn * this.w[i]; }
          uptakeW += dn * this.w[i];
        } else {
          if (dn > 0) { dn = Math.min(dn, budget / this.w[i]); budget -= dn * this.w[i]; }
          uptake += dn * this.w[i];
        }
        this.nC[i] += dn;

        // --- motion: buoyant slip + liquid velocity + turbulent dispersion
        const jitter = Math.sqrt(24 * flow.Dt * dt);        // uniform kick with variance 2·Dt·dt
        let x = this.x[i] + flow.ux * dt + (Math.random() - 0.5) * jitter;
        let y = y0 + (vt + uSwarm + flow.uy) * dt + (Math.random() - 0.5) * jitter * 0.5;
        const lim = halfWidth - R;
        if (x < -lim) x = -lim; else if (x > lim) x = lim;
        if (y < R) y = R;
        // Ice cubes: a bubble that runs into one slides off its nearer side. In a
        // packed pile that side may be another cube — but a real pile is porous in
        // 3-D, so the bubble threads up through the gaps instead (moved past the top).
        for (let k = 0; k < obstacles.length; k++) {
          const o = obstacles[k];
          if (!(y > o.y0 && y < o.y1 && x > o.x0 && x < o.x1)) continue;
          const xs = (x - o.x0 < o.x1 - x) ? o.x0 - 1e-4 : o.x1 + 1e-4;
          let blocked = Math.abs(xs) > lim;
          for (let m = 0; m < obstacles.length && !blocked; m++) {
            const p = obstacles[m];
            if (m !== k && y > p.y0 && y < p.y1 && xs > p.x0 && xs < p.x1) blocked = true;
          }
          if (blocked) y = o.y1 + R; else x = xs;
        }
        this.x[i] = x; this.y[i] = y;

        if (y >= level) {
          // surfaced: expand to ambient pressure and hand over to the foam
          surfacedV += (this.nC[i] + this.nA[i]) * RT / Pamb * this.w[i];
          surfacedN += this.w[i];
          this._remove(i--);
        } else if (R < R_DISSOLVED && this.nA[i] < 1e-18) {
          this._remove(i--);                                 // undersaturated liquid ate it
        } else {
          holdup += U.sphereVolume(R) * this.w[i];
          vtSum += (vt + uSwarm + flow.uy) * this.w[i];
          nSum += this.w[i];
        }
      }
      this.holdup = holdup;
      this.realCount = nSum;
      this.meanRise = nSum > 0 ? vtSum / nSum : 0;
      return { uptake, uptakeW, surfacedV, surfacedN };
    }
  }

  Fizz.BubbleField = BubbleField;
  Fizz.BubblePhysics = { radiusFromMoles, terminalVelocity, massTransferCoeff, turbulentKL };
})(window.Fizz = window.Fizz || {});
