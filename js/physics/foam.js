/* Fizz Lab — the foam head.
 *
 * The foam is a 1-D stack of horizontal layers (index 0 touches the liquid).
 * Newly surfaced bubbles enter at the bottom and push older foam upward.
 * Each layer carries:
 *     vg  gas volume [m³]      vl  liquid volume [m³]
 *     N   bubble count         cl  dissolved CO2 in its liquid [mol/m³]
 *     s   how much of its liquid is the drink (1) rather than meltwater (0)
 *
 * Five processes act on every layer, each with its own physics:
 *   (a) degassing  — CO2 in the foam's own liquid diffuses into its bubbles
 *   (b) coarsening — Ostwald ripening: gas diffuses from small to large bubbles
 *   (c) coalescence — films rupture once drainage dries the foam below φc
 *   (d) bursting   — the top layer pops into the air
 *   (e) drainage   — gravity pulls liquid down the Plateau-border network
 */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  const LAYER_H = 1.5e-3;        // nominal new-layer thickness [m]
  const MAX_LAYERS = 90;
  const PHI_INJECT = 0.20;       // liquid fraction of freshly surfaced bubbly froth
  const BETA = 3;                // steepness of the film-rupture law
  const TAU_WET = 0.08;          // time scale for excess liquid above φ_jam to run out [s]
  // Top films are thicker and wetter than interior ones. With ×250 the CO2
  // permeating out of the top of the head costs ~0.07 mm/s of height — in line
  // with CO2 (beer) heads that take minutes, not seconds, to collapse. Estimate.
  const TOP_FILM_FACTOR = 250;
  const MAX_RATE = 40;           // cap on rupture frequencies [1/s]
  const MIN_GAS = 1e-12;
  // Foam films live on the drink's surfactants (caramel, saponins, proteins…).
  // Water carries none, so foam whose liquid is partly meltwater ruptures
  // faster: rates × 1/(S0 + (1 − S0)·s). Pure-water foam (s = 0) is ~10× less
  // stable, a few-ms film life in reality, capped here by MAX_RATE. Estimate.
  const S0 = 0.1;
  const fragility = (s) => 1 / (S0 + (1 - S0) * U.clamp(s, 0, 1));

  class Foam {
    constructor() {
      this.layers = [];
      this.geometry = [];   // parallel array: { z0, z1, A, phi, R, Pc }
      this.top = 0;
    }

    clear() { this.layers.length = 0; this.geometry.length = 0; }

    static radius(L) { return U.sphereRadius(L.vg / Math.max(L.N, 1e-30)); }

    get gasVolume() { let s = 0; for (const L of this.layers) s += L.vg; return s; }
    get liquidVolume() { let s = 0; for (const L of this.layers) s += L.vl; return s; }
    get co2Moles() { let s = 0; for (const L of this.layers) s += L.vl * L.cl; return s; }

    /** Add surfaced gas (vg, N bubbles) together with liquid vl at concentration c and strength s. */
    add(vg, N, vl, c, areaBottom, s = 1) {
      if (vg <= 0) return;
      let L = this.layers[0];
      if (!L || (L.vg + L.vl) / areaBottom > LAYER_H) {
        L = { vg: 0, vl: 0, N: 0, cl: c, s };
        this.layers.unshift(L);
        this.geometry.unshift({ z0: 0, z1: 0, A: areaBottom, phi: 0, R: 0, Pc: 0 });
        if (this.layers.length > MAX_LAYERS) this._mergeTop();
      }
      if (vl > 0) { L.cl = (L.cl * L.vl + c * vl) / (L.vl + vl); L.s = (L.s * L.vl + s * vl) / (L.vl + vl); }
      L.vg += vg; L.vl += vl; L.N += Math.max(N, 1);
    }

    /** Foam landing on top of the head (thrown foam falling back in). */
    addTop(vg, N, vl, c, area, s = 1) {
      if (vg <= 0) return;
      this.layers.push({ vg, vl, N: Math.max(N, 1), cl: c, s });
      this.geometry.push({ z0: 0, z1: 0, A: area, phi: 0, R: 0, Pc: 0 });
      if (this.layers.length > MAX_LAYERS) {                 // fold it into the layer below
        const a = this.layers.pop(), b = this.layers[this.layers.length - 1];
        this.geometry.pop();
        b.cl = (b.cl * b.vl + a.cl * a.vl) / Math.max(b.vl + a.vl, 1e-30);
        b.s = (b.s * b.vl + a.s * a.vl) / Math.max(b.vl + a.vl, 1e-30);
        b.vg += a.vg; b.vl += a.vl; b.N += a.N;
      }
    }

    /** Liquid volume a surfacing gas volume drags up with it. */
    static entrainedLiquid(vg) { return vg * PHI_INJECT / (1 - PHI_INJECT); }

    _mergeTop() {
      const a = this.layers.pop(), b = this.layers[this.layers.length - 1];
      this.geometry.pop();
      b.cl = (b.cl * b.vl + a.cl * a.vl) / Math.max(b.vl + a.vl, 1e-30);
      b.s = (b.s * b.vl + a.s * a.vl) / Math.max(b.vl + a.vl, 1e-30);
      b.vg += a.vg; b.vl += a.vl; b.N += a.N;
    }

    /** Stack the layers from height `base`; areaAt(z) is the free cross-section at z. */
    layout(base, areaAt) {
      let z = base;
      for (let i = 0; i < this.layers.length; i++) {
        const L = this.layers[i], G = this.geometry[i];
        G.A = areaAt(z);
        G.z0 = z;
        z += (L.vg + L.vl) / G.A;
        G.z1 = z;
        G.phi = L.vl / Math.max(L.vg + L.vl, 1e-30);
        G.R = Foam.radius(L);
      }
      this.top = z;
      return z;
    }

    /**
     * ctx = { fl, bev, Pamb, base, areaAt }
     * returns liquid/CO2 drained into the bulk and gas lost to the room.
     */
    step(dt, ctx) {
      const out = { drainV: 0, drainMol: 0, degasMol: 0, burstV: 0, drainS: 1 };
      let drainSV = 0;
      if (!this.layers.length) return out;
      const { fl, bev, Pamb } = ctx;
      this.layout(ctx.base, ctx.areaAt);

      const RT = C.R * fl.T;
      const ceq = fl.kH * Pamb;
      // Ostwald ripening constant (Lemlich / Princen–Mason):  d⟨R²⟩/dt = 4σ D He / (P h)
      const Kc = 4 * fl.sigma * fl.D * fl.heCC / (Pamb * bev.filmThickness);
      const capLen = Math.sqrt(fl.sigma / (fl.rho * C.G));   // ~2.6 mm; bigger bubbles sag & pop
      const n = this.layers.length;

      for (let i = 0; i < n; i++) {
        const L = this.layers[i], G = this.geometry[i];
        let R = Foam.radius(L);

        // (a) the foam's liquid keeps fizzing into the bubbles around it.
        //     The liquid sits in Plateau borders of radius r_pb; it relaxes toward
        //     equilibrium on the diffusion time τ = r_pb² / (4D).
        if (L.vl > 0) {
          const phi0 = L.vl / (L.vg + L.vl);
          const rPB = R * Math.sqrt(U.clamp(phi0, 1e-5, 0.33) / 0.33);
          const tau = rPB * rPB / (4 * fl.D);
          const dn = (L.cl - ceq) * L.vl * (1 - Math.exp(-dt / tau));
          L.cl -= dn / L.vl;
          L.vg += dn * RT / Pamb;
          out.degasMol += dn;
        }

        // (b) coarsening, slowed in wet foam (Hilgenfeldt): (1 − √(φ/φ*))²
        const phi = L.vl / (L.vg + L.vl);
        const wetBrake = (1 - Math.sqrt(Math.min(phi, C.PHI_JAM) / C.PHI_JAM)) ** 2;
        R = Math.sqrt(R * R + Kc * wetBrake * dt);

        // (c) coalescence. Draining foams collapse once their liquid fraction
        //     falls below a critical φc, largely independent of bubble size
        //     (Carrier & Colin 2003). Fine foams survive by draining slowly
        //     (permeability ∝ R²), not by tolerating more suction. Bubbles beyond
        //     the capillary length sag and pop regardless.
        //     Capillary pressure is kept as a diagnostic:
        //     φ ≈ 0.33 (r_pb / R)²  ⇒  r_pb = R √(φ/0.33),   Pc = σ / r_pb
        const rPB = R * Math.sqrt(U.clamp(phi, 1e-5, 0.33) / 0.33);
        const Pc = fl.sigma / rPB;
        const severity = Math.exp(Math.min(BETA * (bev.criticalPhi / Math.max(phi, 1e-5) - 1), 20) + R / capLen);
        const kCoal = Math.min(MAX_RATE, bev.coalescenceRate * severity * fragility(L.s));
        R *= Math.exp(kCoal * dt / 3);                     // N ∝ R⁻³ drops at rate kCoal
        L.N = L.vg / U.sphereVolume(R);
        G.Pc = Pc; G.R = R; G.phi = phi;
        G.severity = severity;
      }

      // (d) bursting at the top: one bubble diameter lost per bubble lifetime,
      //     plus CO2 permeating straight through the top films into the room.
      let lose = 0;
      {
        const T = this.layers[n - 1], G = this.geometry[n - 1];
        const R = Foam.radius(T);
        const kBurst = Math.min(MAX_RATE, bev.burstRate * G.severity * fragility(T.s));
        const uBurst = kBurst * 2 * R;
        const uPerm = fl.D * fl.heCC / (TOP_FILM_FACTOR * bev.filmThickness);
        lose = (uBurst + uPerm) * G.A * dt;
      }
      for (let i = n - 1; i >= 0 && lose > 0; i--) {
        const L = this.layers[i];
        if (L.vg <= 0) continue;
        const take = Math.min(lose, L.vg);
        L.N *= (L.vg - take) / L.vg;                       // bubbles pop whole: R unchanged
        L.vg -= take; lose -= take; out.burstV += take;
      }

      // (e) drainage, top → bottom so liquid can cascade within a step.
      //     Darcy flux through the Plateau-border network, q = k·ρg/μ, with the
      //     measured foam permeabilities (bubble diameter D = 2R):
      //         rigid films  (channel-dominated, Weaire et al.):  k = 8.0·10⁻⁴ D² φ²
      //         mobile films (node-dominated, Koehler et al.):   k = 6.7·10⁻⁴ D² φ^{3/2}
      //     blended by the drink's interface mobility. Validated for φ ≲ 0.07–0.2;
      //     wetter froth is handled by the excess-liquid term below.
      for (let i = n - 1; i >= 0; i--) {
        const L = this.layers[i];
        if (L.vl <= 0) continue;
        const G = this.geometry[i];
        const R = Foam.radius(L);
        const phi = L.vl / Math.max(L.vg + L.vl, 1e-30);
        const pe = Math.min(phi, C.PHI_JAM), D2 = 4 * R * R;
        const perm = (1 - bev.mobility) * 8.0e-4 * D2 * pe * pe + bev.mobility * 6.7e-4 * D2 * Math.pow(pe, 1.5);
        const u = perm * fl.rho * C.G / fl.mu;
        let q = u * G.A * dt;
        const vlJam = L.vg * C.PHI_JAM / (1 - C.PHI_JAM);
        if (L.vl > vlJam) q += (L.vl - vlJam) * (1 - Math.exp(-dt / TAU_WET));
        q = Math.min(q, L.vg > MIN_GAS ? 0.9 * L.vl : L.vl);
        const mol = q * L.cl;
        L.vl -= q;
        if (i > 0) {
          const B = this.layers[i - 1];
          B.cl = (B.cl * B.vl + mol) / Math.max(B.vl + q, 1e-30);
          B.s = (B.s * B.vl + L.s * q) / Math.max(B.vl + q, 1e-30);
          B.vl += q;
        } else {
          out.drainV += q; out.drainMol += mol; drainSV += q * L.s;
        }
      }

      // prune collapsed layers, passing any leftover liquid down
      for (let i = this.layers.length - 1; i >= 0; i--) {
        const L = this.layers[i];
        if (L.vg >= MIN_GAS) continue;
        if (i > 0) {
          const B = this.layers[i - 1];
          B.cl = (B.cl * B.vl + L.cl * L.vl) / Math.max(B.vl + L.vl, 1e-30);
          B.s = (B.s * B.vl + L.s * L.vl) / Math.max(B.vl + L.vl, 1e-30);
          B.vl += L.vl;
        } else {
          out.drainV += L.vl; out.drainMol += L.vl * L.cl; drainSV += L.vl * L.s;
        }
        this.layers.splice(i, 1);
        this.geometry.splice(i, 1);
      }
      if (out.drainV > 0) out.drainS = drainSV / out.drainV;
      this.layout(ctx.base, ctx.areaAt);
      return out;
    }

    /** Pouring through the head breaks films: remove gas from the top down. */
    erode(volume) {
      for (let i = this.layers.length - 1; i >= 0 && volume > 0; i--) {
        const L = this.layers[i];
        const take = Math.min(volume, L.vg * 0.999);
        const N0 = L.N;
        L.N = N0 * (L.vg - take) / L.vg;
        L.vg -= take; volume -= take;
      }
    }

    /** Remove everything above zMax (it spilled over the rim). Requires a fresh layout(). */
    trimAbove(zMax) {
      const out = { vg: 0, vl: 0, mol: 0, N: 0, s: 1 };
      let sv = 0;
      for (let i = this.layers.length - 1; i >= 0; i--) {
        const L = this.layers[i], G = this.geometry[i];
        if (G.z1 <= zMax) break;
        const f = G.z0 >= zMax ? 1 : (G.z1 - zMax) / (G.z1 - G.z0);
        out.vg += L.vg * f; out.vl += L.vl * f; out.mol += L.vl * f * L.cl; out.N += L.N * f; sv += L.vl * f * L.s;
        L.vg *= 1 - f; L.vl *= 1 - f; L.N *= 1 - f;
        if (f >= 1) { this.layers.splice(i, 1); this.geometry.splice(i, 1); }
      }
      if (out.vl > 0) out.s = sv / out.vl;
      return out;
    }

    /** Remove a volume V from the top of the head (it flowed over the rim). Requires a fresh layout(). */
    trimVolume(V) {
      const out = { vg: 0, vl: 0, mol: 0, N: 0, s: 1 };
      let sv = 0;
      for (let i = this.layers.length - 1; i >= 0 && V > 0; i--) {
        const L = this.layers[i], tot = L.vg + L.vl;
        if (tot <= 0) continue;
        const f = Math.min(1, V / tot);
        out.vg += L.vg * f; out.vl += L.vl * f; out.mol += L.vl * f * L.cl; out.N += L.N * f; sv += L.vl * f * L.s;
        L.vg *= 1 - f; L.vl *= 1 - f; L.N *= 1 - f;
        V -= tot * f;
        if (f >= 1) { this.layers.splice(i, 1); this.geometry.splice(i, 1); }
      }
      if (out.vl > 0) out.s = sv / out.vl;
      return out;
    }

    stats() {
      let vg = 0, vl = 0, rw = 0, pcTop = 0;
      for (let i = 0; i < this.layers.length; i++) {
        const L = this.layers[i];
        vg += L.vg; vl += L.vl; rw += this.geometry[i].R * L.vg;
      }
      if (this.geometry.length) pcTop = this.geometry[this.geometry.length - 1].Pc || 0;
      return { vg, vl, phi: vl / Math.max(vg + vl, 1e-30), R: vg > 0 ? rw / vg : 0, pcTop };
    }
  }

  Foam.fragility = fragility;
  Fizz.Foam = Foam;
})(window.Fizz = window.Fizz || {});
