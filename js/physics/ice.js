/* Fizz Lab — ice: perfect cubes as physical bodies, how fast they melt,
 * and where the soda freezes.
 *
 *   IcePile         every cube a rigid body: falls, floats, stacks, slides when
 *                   the glass tilts, and overflows the rim onto the table
 *   meltCoefficient heat-transfer coefficient soda → ice surface [W/(m²·K)]
 *   freezingPoint   of the drink (sugar and ethanol lower it)
 *   capacity        how many cubes fit below the rim (for the UI)
 *
 * The melting itself is the Stefan condition at the ice surface: once a cube is
 * at 0 °C, every joule arriving melts ice,
 *     ṁ = h·A_wet·(T_soda − 0 °C) / L_f,   L_f = 333.55 kJ/kg
 * and colder ice first warms (sensible heat, c_p,ice = 2108 J/kg·K).
 */
(function (Fizz) {
  'use strict';
  const { C, U, Props } = Fizz;

  /** Thermal conductivity of water [W/(m·K)]: linear fit to IAPWS 2011, 0–40 °C (±1 %). */
  function kWater(T) { return 0.5610 + 0.00195 * (T - C.T0); }

  /**
   * Buoyancy of the boundary layer around melting ice [Δρ/ρ]. The layer spans
   * every temperature from 0 °C at the ice to T in the bulk, and water is
   * densest at 4 °C, so the driving density difference is the layer AVERAGE
   *     Δρ = (1/T) ∫₀ᵀ [ρ(T') − ρ(T)] dT'
   * (positive: the layer sinks; negative: it rises). It changes sign — the flow
   * reverses — near 5 °C, as observed by Carey & Gebhart (1981, J. Fluid Mech.
   * 107:37: bidirectional flow between 4.7 and 5.0 °C). Signed.
   */
  function layerBuoyancy(T, rhoBulk) {
    const t = T - C.T0;
    if (Math.abs(t) < 1e-3) return 0;
    const n = 16, rhoT = Props.rhoWater(T);
    let s = 0;
    for (let i = 0; i < n; i++) s += Props.rhoWater(C.T0 + t * (i + 0.5) / n) - rhoT;
    return (s / n) / rhoBulk;
  }


  /**
   * Convection from soda to a submerged cube of edge a (treated as a sphere of
   * diameter a), combining:
   *   natural convection, Churchill (1983) for spheres:
   *       Nu = 2 + 0.589·Ra^¼ / [1 + (0.469/Pr)^{9/16}]^{4/9}
   *     with the boundary-layer buoyancy above (IAPWS-accurate ρ(T)), which
   *     captures water's density maximum and the flow reversal near 5 °C.
   *   forced convection (stirring, pouring), Ranz & Marshall (1952):
   *       Nu = 2 + 0.6·Re^½·Pr^⅓
   *   mixed:  Nu = (Nu_nat³ + Nu_forced³)^⅓   (Churchill's blending rule)
   */
  function meltCoefficient(fl, a, T, u) {
    T = U.clamp(T, C.T0 - 10, C.T0 + 100);                  // stay inside the fits' validity
    const k = kWater(T);
    const alpha = k / (fl.rho * fl.cp);
    const Pr = fl.nu / alpha;
    const drho = Math.abs(layerBuoyancy(T, fl.rho));
    const Ra = C.G * drho * a * a * a / (fl.nu * alpha);
    const nuNat = 2 + 0.589 * Math.pow(Ra, 0.25) / Math.pow(1 + Math.pow(0.469 / Pr, 9 / 16), 4 / 9);
    const Re = Math.max(u, 0) * a / fl.nu;
    const nuForced = 2 + 0.6 * Math.sqrt(Re) * Math.cbrt(Pr);
    const Nu = Math.cbrt(nuNat ** 3 + nuForced ** 3);
    return Nu * k / a;
  }

  /**
   * Freezing point [K]: colligative depression ΔT = i·K_f·m, K_f = 1.86 K·kg/mol.
   *   sugar (342.3 g/mol, i = 1) and any extra solute (ethanol in champagne),
   *     both diluted by meltwater (`strength` = fraction still the original drink);
   *   dissolved salt, NaCl: i ≈ 1.87 measured for dilute solutions (0.1 mol/kg
   *     freezes at −0.348 °C), `saltMolal` in mol per kg of water.
   * This is also the temperature at which ice melts in the drink: ice in contact
   * with a solution melts at the solution's freezing point, so salty or sugary
   * soda melts its ice colder, and therefore faster.
   */
  const I_NACL = 1.87;
  function freezingPoint(bev, strength = 1, saltMolal = 0) {
    const b = bev.brix * strength;
    const mSugar = b * 1000 / (342.3 * (100 - b));
    // (salt's depression is capped at the NaCl–water eutectic, −21.1 °C)
    return C.T0 - 1.86 * mSugar - (bev.extraFreezeDepression || 0) * strength - Math.min(21.1, I_NACL * 1.86 * saltMolal);
  }

  // -------------------------------------------------------------------------
  // The ice pile: every cube a rigid, axis-aligned body in the cup's frame
  // -------------------------------------------------------------------------
  //
  // The scene is a cross-section, but a cup holds cubes in depth too. Cubes are
  // placed in depth LANES (rows front-to-back, one cube deep each). A lane at
  // depth z offers the chord of the circular cup, 2·√(R² − (|z| + a/2)²), so
  // outer lanes are narrower: capacity comes from the real geometry. Cubes
  // collide only with cubes in their own lane.
  //
  // Each step, in the cup's own (possibly tilted) frame u (across), v (up):
  //   gravity      g_local = (−g sinθ, −g cosθ)        tilt slides ice to the low wall
  //   the swing    the cup turns about its table corner with ω, α (the hand), so in
  //                its frame every cube also feels −(α×r − ω²r) (the frame's own
  //                acceleration: centrifugal plus the swing's start and stop) and
  //                Coriolis −2Ω×w. Swing a glass hard and the cubes are flung out of
  //                its mouth; in the air they fly ballistically (table frame) and
  //                can fall back in, hit the outside of the glass, or land and slide
  //                on the table (kinetic friction μ ≈ 0.3, ice on wood, wet; estimate).
  //   stirring     the spoon is a moving rod: a cube in its way is pushed aside at the
  //                spoon's speed; and the swirling drink drags submerged cubes round
  //                with it (drag is against the liquid's velocity, not the glass's).
  //   buoyancy     −ρ_l·V_sub·g_local                     (Archimedes)
  //   drag         −½·ρ·C_d·a²·|w|·w, C_d = 1.05 for a cube (Hoerner 1965)
  //   added mass   a body moving in the drink drags some of it along: m + C_A·ρ·V_sub,
  //                C_A ≈ 0.8 for a cube (box in heave; estimate)
  //   heave        a floating cube bobs on its waterplane stiffness k = ρ·g·a²; it loses
  //   damping      that energy mainly by making surface waves (radiation damping) and
  //                to the wall boundary layers — a linear damping ratio ζ ≈ 0.2 for a
  //                box (estimate; floating boxes' heave-decay tests give 0.1–0.3), so a
  //                dropped cube settles within a second or two instead of bobbing on
  // then position-based contacts: floor, walls (below the rim) and cube–cube
  // overlap. A cube whose bottom is above the rim is no longer held by the
  // walls; a heap that high is unstable and slumps outward, so it tips over
  // the rim, falls, and lands on the table.
  const CD_CUBE = 1.05;
  const SLUMP = 0.35;            // outward acceleration of cubes heaped above the rim, × g (estimate)
  const RHO_AIR = 1.2;
  const MU_TABLE = 0.3;          // ice sliding on a (wet) wooden table (estimate)
  const C_ADDED = 0.8, ZETA_HEAVE = 0.2, TAU_SWAY = 0.8;   // see above; sway: small sideways drift dies in ~1 s
  const MU_GLASS = 0.1;          // wet ice sliding on the glass floor (estimate; wet ice 0.02–0.1)

  /** Depth lanes for cubes of edge a in a cup of diameter D (the lane count that fits most cubes per layer). */
  function lanesFor(D, a) {
    const R = D / 2;
    let best = [], bestN = 0;
    for (let n = 1; n <= Math.max(1, Math.floor(D / a)); n++) {
      const lanes = [];
      for (let k = 0; k < n; k++) {
        const z = (k - (n - 1) / 2) * a;
        const reach = Math.abs(z) + a / 2;
        if (reach >= R) continue;
        const half = Math.sqrt(R * R - reach * reach);
        const perRow = Math.floor(2 * half / a);
        if (perRow >= 1) lanes.push({ z, half, perRow });
      }
      const total = lanes.reduce((s, l) => s + l.perRow, 0);
      if (total > bestN) { best = lanes; bestN = total; }
    }
    return best;
  }

  /** Cubes that fit below the rim (they may also heap up to half a cube proud of it). */
  function capacity(D, H, a) {
    const perLayer = lanesFor(D, a).reduce((s, l) => s + l.perRow, 0);
    return perLayer * Math.floor((H + 0.5 * a) / a);
  }

  class IcePile {
    constructor() { this.cubes = []; this.melted = 0; this.frozen = 0; this.tableMelt = 0; this.laneDefs = []; }

    get count() { let n = 0; for (const c of this.cubes) if (c.where === 'cup') n++; return n; }
    get mass() { let m = 0; for (const c of this.cubes) if (c.where === 'cup') m += c.m; return m; }
    get T() {
      let m = 0, mt = 0;
      for (const c of this.cubes) if (c.where === 'cup') { m += c.m; mt += c.m * c.T; }
      return m > 0 ? mt / m : C.T0;
    }
    get onTable() { return this.cubes.filter(c => c.where !== 'cup'); }

    /** Lay n cubes into the cup lane by lane, layer by layer; the extras heap above the rim. */
    fill(n, a, T, cup) {
      this.cubes = []; this.melted = 0; this.frozen = 0; this.tableMelt = 0;
      this.laneDefs = lanesFor(cup.D, a);
      if (!this.laneDefs.length) {                // too wide to fit at all: perched on the rim, they fall off
        for (let i = 0; i < n; i++) this._make(a, T, (i % 2 ? 1 : -1) * 0.3 * cup.D, cup.H + a * (0.5 + i), 0);
        return;
      }
      let placed = 0;
      for (let layer = 0; placed < n; layer++) {
        for (let li = 0; li < this.laneDefs.length && placed < n; li++) {
          const L = this.laneDefs[li];
          for (let j = 0; j < L.perRow && placed < n; j++, placed++) {
            this._make(a, T, -L.perRow * a / 2 + (j + 0.5) * a, a / 2 + layer * a * 1.0001, li);
          }
        }
      }
    }

    /** Drop one cube in from just above the mouth. */
    drop(a, T, cup) {
      if (!this.laneDefs.length) this.laneDefs = lanesFor(cup.D, a);
      const lanes = this.laneDefs.length ? this.laneDefs : [{ z: 0, half: cup.D / 2 }];
      const li = (Math.random() * lanes.length) | 0;
      const span = Math.max(0, lanes[li].half - a / 2);
      return this._make(a, T, (Math.random() * 2 - 1) * span, cup.H + 0.6 * a, li, true);
    }

    _make(a, T, u, v, lane, dropped = false) {
      const c = { a, m: a * a * a * C.RHO_ICE, T, u, v, wu: 0, wv: 0, lane, where: 'cup', sub: 0, wasWet: false,
                  dropped, below: false, above: false, x: 0, y: 0 };
      this.cubes.push(c);
      return c;
    }

    /** Submerged fraction of a cube, from the WORLD heights of the liquid surface and of the cube. */
    submerged(c, tilt, hSurface) {
      const hc = c.u * tilt.sin + c.v * tilt.cos;            // world height of its centre
      const e = 0.5 * c.a * (Math.abs(tilt.cos) + Math.abs(tilt.sin));   // half its vertical extent
      return U.clamp((hSurface - (hc - e)) / (2 * e), 0, 1);
    }

    /** Volume the pile would displace if the surface stood at world height h. */
    displaced(tilt, h) {
      let v = 0;
      for (const c of this.cubes) if (c.where === 'cup') v += c.a * c.a * c.a * this.submerged(c, tilt, h);
      return v;
    }

    /**
     * ctx = { D, H, wall, tilt (the LIQUID's frame: effective gravity), hSurface, rhoL,
     *         toTable(u, v), velToTable(u, v, wu, wv) — cup-local → table frame }
     * Returns events: { type: 'splash', cube, speed } when a dropped cube hits the
     * soda, and { type: 'overflow', cube } when one tips over the rim.
     */
    step(dt, ctx) {
      const { tilt, hSurface, rhoL } = ctx;
      // gravity in the cup's own frame (its real angle), and the swing (if any)
      const cupT = ctx.cupTilt || tilt;
      const g0u = -C.G * cupT.sin, g0v = -C.G * cupT.cos;
      const fr = ctx.frame || { omega: 0, alpha: 0, pivot: [0, 0] };
      const W = fr.omega, Al = fr.alpha;
      const lanes = this.laneDefs.length ? this.laneDefs : [{ z: 0, half: ctx.D / 2 }];
      const events = [];
      const R = ctx.D / 2, Ro = R + (ctx.wall || 0);
      for (const c of this.cubes) {
        c.a = Math.cbrt(c.m / C.RHO_ICE);
        if (c.where === 'table') {                          // sliding to a stop on the table
          const sp = Math.abs(c.wu);
          if (sp > 0) { const dv = Math.min(sp, MU_TABLE * C.G * dt); c.wu -= Math.sign(c.wu) * dv; c.x += c.wu * dt; }
          continue;
        }
        if (c.where === 'air') {                            // flying outside the cup, table frame
          // gravity and air drag (C_d of a cube; implicit, so it can only take energy out)
          const sp = Math.hypot(c.wu, c.wv), kd = 0.5 * RHO_AIR * CD_CUBE * c.a * c.a * sp / c.m;
          c.wu /= 1 + kd * dt; c.wv = (c.wv - C.G * dt) / (1 + kd * dt);
          c.x += c.wu * dt; c.y += c.wv * dt;
          if (ctx.toCup) {
            const [u, v] = ctx.toCup(c.x, c.y);
            const lz = lanes[Math.min(c.lane, lanes.length - 1)].z;
            const inMouth = Math.abs(u) < Math.max(0, Math.sqrt(Math.max(0, R * R - lz * lz)) - c.a / 2) && v < ctx.H && v > c.a / 2;
            const [vu, vv] = ctx.velToCup(c.x, c.y, c.wu, c.wv);
            if (inMouth && vv < 0 && c.flownOut) {                // falls back in through the mouth
              Object.assign(c, { where: 'cup', u, v, wu: vu, wv: vv, wasWet: false, dropped: true });
              continue;
            }
            if (Math.abs(u) < Ro + c.a / 2 && v < ctx.H && v > -0.005 && !inMouth && Math.abs(lz) < Ro) {
              // hit the outside of the glass: pushed clear, its sideways speed (in the cup's frame) stopped
              const side = u >= 0 ? 1 : -1;
              const [x, y] = ctx.toTable(side * (Ro + c.a / 2), v);
              const [wx, wy] = ctx.velToTable(side * (Ro + c.a / 2), v, 0, vv);
              Object.assign(c, { x, y, wu: wx, wv: wy });
            }
          }
          if (c.y - c.a / 2 <= 0) {                         // lands (table frame: the top is y = 0) and slides
            c.y = c.a / 2; c.wv = 0; c.wu *= 0.5; c.where = 'table';
            events.push({ type: 'landed', cube: c });
          }
          continue;
        }
        const f = this.submerged(c, tilt, hSurface);
        if (f > 0 && !c.wasWet) {
          const speed = Math.hypot(c.wu, c.wv);
          if (c.dropped && speed > 0.3) events.push({ type: 'splash', cube: c, speed });
          c.wasWet = true;
        }
        c.sub = f;
        const lift = 1 - rhoL * c.a ** 3 * f / c.m;              // gravity minus buoyancy, per unit mass
        // drag against the liquid's own motion (the stirred swirl), not the glass
        const lzc = lanes[Math.min(c.lane, lanes.length - 1)].z;
        const lu = f > 0 && ctx.liquidU ? ctx.liquidU(c.u, lzc) : 0;
        const speed = Math.hypot(c.wu - lu, c.wv);
        const drag = 0.5 * (rhoL * f + RHO_AIR * (1 - f)) * CD_CUBE * c.a * c.a * speed / c.m;
        // effective gravity in the swinging cup: g − (α×r − ω²r), r from the pivot
        const ru = c.u - fr.pivot[0], rv = c.v - fr.pivot[1];
        const gu = g0u - (-Al * rv - W * W * ru), gv = g0v - (Al * ru - W * W * rv);
        let au = gu * lift - drag * (c.wu - lu) + 2 * W * c.wv, av = gv * lift - drag * c.wv - 2 * W * c.wu;   // + Coriolis
        if (c.v - c.a / 2 > ctx.H) {                             // heaped above the rim: slumps outward
          const side = tilt.sin > 0.05 ? -1 : (c.u >= 0 ? 1 : -1);
          au += side * SLUMP * C.G;
        }
        // the drink carried along (added mass) slows every acceleration in it
        const mEff = c.m + C_ADDED * rhoL * c.a ** 3 * f;
        au *= c.m / mEff; av *= c.m / mEff;
        c.wu += au * dt; c.wv += av * dt;
        if (f > 0 && f < 1) {
          // floating: heave and sway damped linearly (implicit, stable at any dt)
          const k = rhoL * Math.hypot(gu, gv) * c.a * c.a;
          const b = 2 * ZETA_HEAVE * Math.sqrt(k * mEff);
          c.wv /= 1 + b / mEff * dt;
          c.wu = lu + (c.wu - lu) / (1 + dt / TAU_SWAY);
        }
        c.u += c.wu * dt; c.v += c.wv * dt;
        c.below = c.above = false;
        // the spoon: a rod from just off the floor to above the rim, moving on its circle
        const sp = ctx.spoon;
        if (sp && c.v - c.a / 2 < sp.top) {
          const gapU = c.a / 2 + sp.r, gapZ = c.a / 2 + sp.r;
          if (Math.abs(lzc - sp.z) < gapZ && Math.abs(c.u - sp.u) < gapU) {
            const side = c.u >= sp.u ? 1 : -1;
            c.u = sp.u + side * gapU;                          // pushed out of its way
            if ((sp.vu - c.wu) * side > 0) c.wu = sp.vu;       // and carried at the spoon's speed
          }
        }
      }
      // Contacts (position-based, a few sweeps). Cubes are visited bottom-up and a
      // vertical overlap moves only the UPPER cube: the lower one is already held
      // by the floor or the cubes beneath it, so a tall stack never squeezes into
      // itself (splitting overlaps evenly would let a heap sink into the pile).
      const cup = this.cubes.filter(c => c.where === 'cup');
      for (let it = 0; it < 4; it++) {
        cup.sort((p, q) => p.v - q.v);
        for (const c of cup) {
          if (c.v < c.a / 2) { c.v = c.a / 2; if (c.wv < 0) c.wv = 0; c.below = true; c.onFloor = true; }
          const half = lanes[Math.min(c.lane, lanes.length - 1)].half;
          if (c.v - c.a / 2 < ctx.H) {                           // inside: the walls hold it
            const lim = Math.max(0, half - c.a / 2);
            if (c.u < -lim) { c.u = -lim; if (c.wu < 0) c.wu = 0; }
            if (c.u > lim) { c.u = lim; if (c.wu > 0) c.wu = 0; }
          }
        }
        for (let i = 0; i < cup.length; i++) {
          const p = cup[i];
          for (let j = i + 1; j < cup.length; j++) {
            const q = cup[j];
            if (p.lane !== q.lane) continue;
            const s = 0.5 * (p.a + q.a);
            const du = q.u - p.u, dv = q.v - p.v;
            const ou = s - Math.abs(du), ov = s - Math.abs(dv);
            if (ou <= 0 || ov <= 0) continue;
            if (ov < ou) {                                       // stacked: separate vertically
              const top = dv > 0 ? q : p, bot = dv > 0 ? p : q;
              top.v += ov;
              const wv = 0.5 * (top.wv + bot.wv);
              if (top.wv < wv) top.wv = wv;
              if (bot.wv > wv) bot.wv = wv;
              top.below = true; bot.above = true;
            } else {
              const sgn = du > 0 ? 1 : -1;
              p.u -= sgn * ou * 0.5; q.u += sgn * ou * 0.5;
              const wu = 0.5 * (p.wu + q.wu); p.wu = q.wu = wu;
            }
          }
        }
      }
      // Coulomb friction on the floor of the glass: the normal force is the cube's
      // weight less its buoyancy (in the swinging frame); sliding stops, it never speeds up
      for (const c of cup) {
        if (!c.onFloor) continue;
        c.onFloor = false;
        const ru = c.u - fr.pivot[0], rv = c.v - fr.pivot[1];
        const gvn = g0v - (Al * ru - W * W * rv);
        const n = Math.max(0, -gvn * (1 - rhoL * c.a ** 3 * c.sub / c.m));
        const sp = Math.abs(c.wu);
        if (sp > 0) c.wu -= Math.sign(c.wu) * Math.min(sp, MU_GLASS * n * dt);
      }
      // Out of the mouth: a cube flung clear of the rim leaves with its velocity
      // (plus the cup's own, as the cup turns) and flies.
      for (const c of cup) {
        if (c.where === 'cup' && c.v - c.a / 2 > ctx.H + 1e-3 && c.wv > 0.15) {
          const [x, y] = ctx.toTable(c.u, c.v);
          const [wx, wy] = ctx.velToTable(c.u, c.v, c.wu, c.wv);
          Object.assign(c, { where: 'air', x, y, wu: wx, wv: wy, sub: 0, below: false, above: false, flownOut: true });
          events.push({ type: 'thrown', cube: c });
        }
      }
      // Over the rim: a cube resting above the rim tips over once its centre of
      // mass passes the rim edge, and falls outside in the world frame.
      for (const c of cup) {
        if (c.where === 'cup' && c.v - c.a / 2 > ctx.H * 0.98 && Math.abs(c.u) > ctx.D / 2) {
          const side = c.u > 0 ? 1 : -1;
          c.u = side * (ctx.D / 2 + ctx.wall + c.a / 2);          // clear of the wall as it goes over
          const [x, y] = ctx.toTable(c.u, c.v);                     // the table frame (fixed to the room)
          const [wx, wy] = ctx.velToTable(c.u, c.v, c.wu, c.wv);
          Object.assign(c, { where: 'air', x, y, wu: wx, wv: wy, sub: 0, below: false, above: false, flownOut: false });
          events.push({ type: 'overflow', cube: c });
        }
      }
      return events;
    }

    /**
     * Wetted and air-exposed face areas of a perfect cube (exact face areas):
     * the four sides wet up to the waterline; the underside only if not resting
     * on the floor or another cube; the top only if fully under and uncovered.
     */
    faces(c) {
      const a = c.a, a2 = a * a, f = c.where === 'cup' ? c.sub : 0;
      const restBottom = c.where === 'table' || c.below;
      const covered = c.above;
      let wet = 4 * a2 * f, dry = 4 * a2 * (1 - f);
      if (!restBottom) { if (f > 0) wet += a2; else dry += a2; }
      if (!covered) { if (f >= 1) wet += a2; else dry += a2; }
      return { wet, dry };
    }

    prune() { this.cubes = this.cubes.filter(c => c.m > 1e-7); }
  }

  Fizz.Ice = { capacity, lanesFor, kWater, layerBuoyancy, meltCoefficient, freezingPoint, IcePile };
})(window.Fizz = window.Fizz || {});
