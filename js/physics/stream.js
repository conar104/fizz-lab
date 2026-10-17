/* Fizz Lab — the stream from the bottle to the glass.
 *
 * The stream is not drawn as a fixed arc: every step the bottle's outflow
 * leaves the lip as a parcel that then flies on its own, ballistically, in the
 * table frame (see table.js). So it takes the stream ~0.1 s to reach the drink,
 * a glug or a jerk of the bottle travels down it as a visible pulse, and if the
 * glass is swung away mid-pour the stream lands on the table.
 *
 * BREAK-UP. A falling jet stays whole for a length set by the Rayleigh–Plateau
 * instability (Grant & Middleman 1966, AIChE J. 12:669):
 *     L_b / d = 19.5·[√We·(1 + 3·Oh)]^0.85,   We = ρv²d/σ,  Oh = μ/√(ρσd)
 * then it continues as drops. A pour (d ≈ 8 mm, 1 m/s) stays whole for over a
 * metre; the thin trickle at the end of a pour breaks up within centimetres.
 *
 * DRIBBLE (the teapot effect). Slow liquid does not leave the lip: it turns
 * round the edge and runs down the outside of the neck, then drips (Duez et
 * al. 2010, Phys. Rev. Lett. 104:084503: separation needs inertia to beat the
 * capillary adhesion at the lip; wettable lips dribble more). Here the share
 * that clings is
 *     f = 1 / (1 + (u/u_c)⁴),   u_c = k·√(σ(1 + cos θ)/(ρ r_lip))
 * At a glass rim (k = 1, u_c ≈ 0.3 m/s) the outside wall is right below the
 * edge and an overflow runs down it unless it is moving fast. Under a tilted
 * bottle's lip the liquid would have to turn back under the neck against
 * gravity, so it lets go far sooner: k = 0.3, chosen so a steady pour
 * (≳ 20 ml/s) leaves the lip cleanly and only a trickle dribbles, as seen.
 * Form and constants are estimates.
 */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  const LIP_R = 1.5e-3;          // radius of curvature of a bottle lip [m] (estimate)
  const DRIP_OFFSET = 0.003;     // drips fall from ~3 mm back along the neck [m]
  const BOTTLE_LIP_K = 0.3;      // see the header

  function breakupLength(d, v, fl) {
    const We = fl.rho * v * v * d / fl.sigma, Oh = fl.mu / Math.sqrt(fl.rho * fl.sigma * d);
    return d * 19.5 * Math.pow(Math.sqrt(We) * (1 + 3 * Oh), 0.85);
  }
  function separationSpeed(fl, contactAngle, k = 1) {
    return k * Math.sqrt(fl.sigma * (1 + Math.cos(contactAngle * Math.PI / 180)) / (fl.rho * LIP_R));
  }
  /** Share of a flow at speed u that clings to an edge instead of leaving it. */
  function clingFraction(u, uc) { return 1 / (1 + Math.pow(Math.max(u, 0) / uc, 4)); }

  class Stream {
    constructor() { this.clear(); }
    clear() { this.parcels = []; }
    get flyingV() { let v = 0; for (const p of this.parcels) v += p.V; return v; }

    /**
     * Launch the outflow of one step. lip: [x, y] (table frame), vel: [ux, vy],
     * d: jet diameter at the lip, axis: unit vector lip → bottle base.
     */
    emit(V, lip, vel, d, axis, fl, uc) {
      if (!(V > 0)) return;
      const u = Math.hypot(vel[0], vel[1]);
      const cling = clingFraction(u, uc);
      const jetV = V * (1 - cling), dripV = V * cling;
      if (jetV > 0) {
        this.parcels.push({ V: jetV, x: lip[0], y: lip[1], vx: vel[0], vy: vel[1], d, v0: Math.max(u, 1e-3),
                            Lb: breakupLength(d, Math.max(u, 0.05), fl), dist: 0, age: 0, drip: false, state: 0 });
      }
      if (dripV > 0) {
        // the clinging liquid gathers in a drop hanging under the neck
        const x = lip[0] + axis[0] * DRIP_OFFSET, y = lip[1] + axis[1] * DRIP_OFFSET;
        let hang = this.parcels.find(p => p.hanging);
        if (!hang) { hang = { V: 0, vx: 0, vy: 0, d: 0, v0: 0, Lb: 0, dist: 0, age: 0, drip: true, hanging: true, idle: 0 }; this.parcels.push(hang); }
        hang.V += dripV; hang.x = x; hang.y = y; hang.idle = 0;
      }
    }

    /**
     * Fly every parcel. classify(p) → 'cup' (arrived in the drink), 'table',
     * 'wall' (hit the outside of the glass), or null (still flying).
     */
    step(dt, classify, fl) {
      const out = { cup: 0, cupD: 0, table: [], wall: [] };
      const keep = [];
      // Tate's law: a pendant drop falls once its weight beats surface tension
      // around its neck; from a curved surface the neck is ~l_c wide, and only
      // ~60 % of the drop falls (Harkins–Brown), so V_drop ≈ 0.6·2π·l_c·σ/(ρg) ≈ 0.07 ml.
      const lc = Math.sqrt(fl.sigma / (fl.rho * C.G));
      const vDrop = 0.6 * 2 * Math.PI * lc * fl.sigma / (fl.rho * C.G);
      for (const p of this.parcels) {
        if (p.hanging) {
          p.idle += dt;
          if (p.V < vDrop && p.idle < 2) { keep.push(p); continue; }
          p.hanging = false;                                    // it lets go (or, idle, is shaken off)
        }
        p.age += dt;
        p.vy -= C.G * dt;
        const dx = p.vx * dt, dy = p.vy * dt;
        p.x += dx; p.y += dy; p.dist += Math.hypot(dx, dy);
        const where = classify(p);
        if (where === 'cup') { out.cup += p.V; out.cupD += p.V * (p.d || 0.002); continue; }
        if (where === 'table') { out.table.push(p); continue; }
        if (where === 'wall') { out.wall.push(p); continue; }
        if (p.age > 5) { out.table.push(p); continue; }
        keep.push(p);
      }
      this.parcels = keep;
      if (out.cup > 0) out.cupD /= out.cup;                     // volume-weighted lip diameter of what arrived
      return out;
    }
  }

  Fizz.Stream = { Stream, breakupLength, separationSpeed, clingFraction, BOTTLE_LIP_K };
})(window.Fizz = window.Fizz || {});
