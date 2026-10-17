/* Fizz Lab — the hand that holds the cup, and the drink sloshing inside it.
 *
 * HAND. The tilt you ask for (drag, ← →, the slider) is a TARGET. A real hand
 * cannot jump there: it moves the cup like a critically damped second-order
 * system (point-to-point wrist movements take ~0.15–0.3 s; a flick peaks at 20–40 rad/s),
 *     θ̈ = ω_h²(θ_target − θ) − 2ω_h·θ̇,   |θ̇| ≤ Ω_max
 * The cup pivots on its low bottom corner, which stays planted on the table.
 *
 * SLOSH. The liquid's first sloshing mode in a vertical cylinder of radius R
 * filled to depth h (Lamb 1932; Abramson 1966, NASA SP-106):
 *     ω₁² = (g·ξ₁/R)·tanh(ξ₁·h/R),     ξ₁ = 1.8412 (first root of J₁′)
 * The surface is treated as a plane tilted by δ (the "planar surface" analogue
 * of this mode). In a container accelerating at a, the surface would settle at
 *     tan δ_eq = −a_x / (g + a_y)
 * (exact for steady acceleration), so the mode is a damped oscillator chasing
 * that angle:
 *     δ̈ + 2ζω₁δ̇ + ω₁²(δ − δ_eq) = 0
 * The acceleration is taken where the mode lives: on the cup axis about R/ξ₁
 * below the surface (the mode's flow decays as e^(−ξ₁·depth/R)). Pure rotation
 * about that point leaves the surface level (the liquid does not turn with the
 * cup); rotation about the table corner swings it, which is what throws liquid.
 *
 * Damping ζ:
 *   viscous boundary layers on the wall and floor (Mikishev & Dorozhkin 1961,
 *   as given by Ibrahim 2005, Liquid Sloshing Dynamics, eq. 3.12):
 *       ζ_v = 0.79·√(ν/√(gR³))·[1 + 0.318/sinh(ξh/R)·(1 + (1 − h/R)/cosh(ξh/R))]
 *   contact-line friction, which dominates in small vessels (Keulegan 1959):
 *       ζ_cl ≈ 0.01 (estimate)
 *   a head of foam, a strong damper (Sauret et al. 2015, Phys. Fluids 27,
 *   "Damping of liquid sloshing by foams"):  ζ_f ≈ 0.03 per cm of foam (estimate)
 *   wave breaking: the linear mode only holds for small waves. Once the wave at
 *   the wall, η = R·tan δ, is comparable to the depth (shallow: a bore forms,
 *   η ≳ 0.5·h) or too steep (η/λ ≳ 0.2 with λ ≈ 2πR/ξ₁, Stokes' limit for
 *   standing waves), it breaks and loses most of its energy within a cycle:
 *       ζ_b = 1.5·(η − η_b)/η_b  (capped)   above η_b = min(0.5·h, 0.2·λ)
 *   so a violent slosh dies in a few tenths of a second instead of ringing
 *   (estimate; breaking dissipation in sloshing, e.g. Faltinsen & Timokha 2009).
 */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  const XI = 1.8412;
  // Two speeds of hand: steady adjustments (ω = 14 rad/s, ≤ 12 rad/s; arm movements of
  // ~0.3 s) and a deliberate flick, when you ask for a fast or large move
  // (ω = 25 rad/s, ≤ 20 rad/s; wrist flicks reach 20–40 rad/s). Estimates.
  const HAND = { omega: 14, maxRate: 12, flickOmega: 25, flickRate: 20, flickTrigger: 3, flickHold: 0.5 };
  const ZETA_CL = 0.01, ZETA_FOAM_PER_M = 3, ZETA_MAX = 0.5, ZETA_BREAK_MAX = 3;
  const DELTA_MAX = 1.1;                        // ~63°: beyond this the "planar surface" picture is meaningless

  /**
   * Exact update of x'' + 2ζωx' + ω²x = 0 over dt (under-, critically or over-
   * damped). Exact, so with nothing driving it the energy ½(x'² + ω²x²) can only
   * fall — no numerical gain, unlike explicit schemes.
   */
  function dampedStep(x, v, w, z, dt) {
    if (z < 0.999) {
      const wd = w * Math.sqrt(1 - z * z), e = Math.exp(-z * w * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
      return [e * (x * c + (v + z * w * x) / wd * s), e * (v * c - (z * w * v + w * w * x) / wd * s)];
    }
    if (z <= 1.001) {
      const e = Math.exp(-w * dt), k = v + w * x;
      return [e * (x + k * dt), e * (v - w * k * dt)];
    }
    const q = Math.sqrt(z * z - 1), r1 = -w * (z - q), r2 = -w * (z + q);
    const A = (v - r2 * x) / (r1 - r2), B = x - A, e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
    return [A * e1 + B * e2, A * r1 * e1 + B * r2 * e2];
  }

  function frequency(R, h) { return Math.sqrt(C.G * XI / R * Math.tanh(XI * Math.max(h, 1e-4) / R)); }

  function viscousDamping(R, h, nu) {
    const x = XI * Math.max(h, 1e-4) / R;
    return 0.79 * Math.sqrt(nu / Math.sqrt(C.G * R * R * R)) * (1 + 0.318 / Math.sinh(x) * (1 + (1 - h / R) / Math.cosh(x)));
  }

  function damping(R, h, nu, foamH) {
    return Math.min(ZETA_MAX, viscousDamping(R, h, nu) + ZETA_CL + ZETA_FOAM_PER_M * Math.max(0, foamH));
  }

  class Hand {
    constructor(theta = 0) { this.theta = theta; this.omega = 0; this.alpha = 0; this.omegaAvg = 0; this.lastTarget = theta; this.flick = 0; }
    set(theta) { this.theta = theta; this.omega = 0; this.alpha = 0; this.omegaAvg = 0; this.lastTarget = theta; this.flick = 0; }
    step(dt, target) {
      // a fast or big change of the target is a flick: the hand moves quicker for a moment
      const ask = Math.abs(target - this.lastTarget);
      this.lastTarget = target;
      if (ask / dt > HAND.flickTrigger) this.flick = HAND.flickHold;
      this.flick = Math.max(0, this.flick - dt);
      const w = this.flick > 0 ? HAND.flickOmega : HAND.omega;
      const maxRate = this.flick > 0 ? HAND.flickRate : HAND.maxRate;
      // exact update of the critically damped system over dt (no overshoot, any dt)
      const e0 = this.theta - target, v0 = this.omega;
      const ex = Math.exp(-w * dt);
      const A = e0, B = v0 + w * e0;
      let e = (A + B * dt) * ex;
      let v = (B - w * (A + B * dt)) * ex;
      if (Math.abs(v) > maxRate) {                           // the wrist has a top speed
        v = Math.sign(v) * maxRate;
        e = e0 + 0.5 * (v0 + v) * dt;
        if (Math.sign(e) !== Math.sign(e0)) e = 0;
      }
      this.alpha = (v - v0) / dt;
      this.omega = v;
      this.theta = target + e;
      // the steady part of the motion (what someone watching the glass would anticipate)
      this.omegaAvg += (v - this.omegaAvg) * Math.min(1, dt / 0.15);
    }
  }

  class Slosh {
    constructor() { this.reset(); }
    reset() { this.delta = 0; this.rate = 0; this.omega1 = 0; this.zeta = 0; this.ax = 0; this.ay = 0; }

    /**
     * ctx = { hand, R, h (liquid depth), nu, foamH, pivot: [u, v] cup-local pivot,
     *         modeV: cup-local height where the mode is forced }
     */
    step(dt, ctx) {
      const { hand, R, h } = ctx;
      if (!(h > 5e-4)) { this.delta *= Math.exp(-dt * 20); this.rate = 0; return; }
      const w1 = this.omega1 = frequency(R, h);
      const z = this.zeta = damping(R, h, ctx.nu, ctx.foamH);
      // where the forcing point is, relative to the pivot, in the world
      const th = hand.theta, c = Math.cos(th), s = Math.sin(th);
      const du = 0 - ctx.pivot[0], dv = ctx.modeV - ctx.pivot[1];
      const rx = du * c - dv * s, ry = du * s + dv * c;
      // a = α × r − ω² r   (rigid rotation about the fixed pivot)
      const W = hand.omega, Al = hand.alpha;
      const ax = -Al * ry - W * W * rx, ay = Al * rx - W * W * ry;
      this.ax = ax; this.ay = ay;
      const eq = Math.atan2(-ax, Math.max(0.2 * C.G, C.G + ay));
      // semi-implicit (symplectic) integration in substeps that resolve ω₁
      const n = Math.max(1, Math.ceil(dt * w1 / 0.3));
      const hdt = dt / n;
      const etaB = Math.min(0.5 * h, 0.2 * 2 * Math.PI * R / XI);    // where waves break
      for (let k = 0; k < n; k++) {
        const eta = R * Math.abs(Math.tan(this.delta));
        const zb = eta > etaB ? Math.min(ZETA_BREAK_MAX, 1.5 * (eta - etaB) / etaB) : 0;
        this.breaking = zb > 0;
        // exact over the sub-step, about the equilibrium the cup's acceleration sets
        const [x, v] = dampedStep(this.delta - eq, this.rate, w1, z + zb, hdt);
        this.delta = eq + x; this.rate = v;
      }
      if (this.delta > DELTA_MAX) { this.delta = DELTA_MAX; if (this.rate > 0) this.rate = 0; }
      if (this.delta < -DELTA_MAX) { this.delta = -DELTA_MAX; if (this.rate < 0) this.rate = 0; }
    }

    /** Vertical speed of the surface where it meets the wall on `side` (±1) [m/s]. */
    wallSpeed(side, R) { return side * R * this.rate; }
  }

  Fizz.Slosh = { Hand, Slosh, frequency, viscousDamping, damping, dampedStep, XI, HAND };
})(window.Fizz = window.Fizz || {});
