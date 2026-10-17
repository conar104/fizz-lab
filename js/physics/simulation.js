/* Fizz Lab — the simulation core.
 *
 * Orchestrates every sub-model once per time step:
 *
 *   geometry ─ cup, liquid level with every ice cube's displacement, foam stack
 *   ice      ─ each cube a rigid body: falls, floats, stacks, slides, overflows
 *   pour     ─ plunging jet: liquid, heat and CO2 in; air entrained; foam eroded
 *   flow     ─ jet plume and stirring velocity / turbulence field
 *   nucleate ─ every wetted surface patch emits bubbles; dry surfaces trap air
 *   bubbles  ─ growth by CO2 stripping, rise, surfacing
 *   foam     ─ degassing, coarsening, coalescence, bursting, drainage
 *   surface  ─ direct CO2 loss through the free liquid surface
 *   heat     ─ soda ↔ cup wall ↔ room, soda ↔ ice (sensible + melting), fizz cooling
 *   spill    ─ liquid or foam above the rim leaves the cup: it runs down the
 *              outside, or — moving fast enough — flies off (thrown drink,
 *              erupting foam) and lands on the table (table.js)
 *   hand     ─ the cup follows the tilt you ask for like a real hand, and the
 *              drink sloshes in it (slosh.js)
 *   stream   ─ the bottle's outflow flies to the glass as parcels (stream.js)
 *
 * The cup holds a well-mixed bulk liquid (one concentration, one temperature),
 * a layer of meltwater that can float on it, and the foam layers, each with
 * its own liquid CO2.
 */
(function (Fizz) {
  'use strict';
  const { C, U, Props, Nucleation: Nuc, Jet, BubbleField, Foam, Tilt, Bottle, Ice, Capillary, Slosh } = Fizz;
  const TableM = Fizz.Table, StreamM = Fizz.Stream;

  const PARTICLE_CAP = 7000;
  // Heat-transfer coefficients [W/(m²·K)], typical natural-convection values.
  // Soda → ice is NOT a constant: it comes from Ice.meltCoefficient (Churchill).
  // Exposed as Simulation.HEAT so tests can switch the room off (calorimetry).
  const HEAT = { hAir: 10, hWall: 300 };
  const SURFACE_KL = 2e-5;          // free-surface CO2 transfer coefficient, still liquid [m/s]
  const FILM_WET_PER_FLOW = 120;    // ice area wetted by a running film per unit pour rate [m²/(m³/s)]
  const FILM_DRAIN_TAU = 1.5;       // how long a wet ice film keeps fizzing after the pour [s]
  const FOAM_ERODE_EFF = 0.02;      // fraction of jet power spent breaking foam films
  const STIR_EPS = 5;               // dissipation while stirring [W/kg]
  const SPOON = { width: 0.012, bowl: 6e-4, speed: 0.3, wake: 1.0e-3, entrain: 0.5 };
  //   width/bowl: blade width [m] and bowl area [m²]; speed: tip speed [m/s];
  //   wake: depth of the air cavity a stroke opens at the surface [m]; entrain: fraction kept
  const ICE_SPLASH_AIR = 0.3;       // air dragged under by a dropped cube, × cube volume
  // Pouring onto an ice pile: the stream shatters into sheets and drops at every
  // cube on its way down, each a fresh plunge. Entrainment multiplier vs. a clean
  // jet = BASE + PER_STEP × (number of cube-heights it tumbles through). Calibrated.
  const ICE_SPLASH_BASE = 2.0, ICE_SPLASH_PER_STEP = 1.5;
  // Freezer ice is cloudy with air: water at 0 °C holds ~29 ml/L of dissolved air,
  // which freezing expels into bubbles, ~2.5 % of the ice volume. Melting frees them.
  const ICE_AIR_FRACTION = 0.025, ICE_BUBBLE_R = 100e-6;
  // A stream breaking over a cube is deflected rather than stopped: the
  // tumbling liquid keeps ~60 % of its speed (~36 % of its energy).
  const ICE_KEEP_SPEED = 0.6;
  const FLAT_VOLUMES = 1.5;         // below this many volumes soda tastes flat (a convention)
  const S_STOP = 0.15;              // supersaturation below which bubbling effectively stops
  const MENTOS = { area: 11e-4, sink: 0.2, tau: 45, radius: 0.0095 };   // tau: rough candy shell dissolving [s]; Ø 19 mm
  /** A uniformly random point in a disc of radius r. */
  const randomInDisc = (r) => { const q = r * Math.sqrt(Math.random()), a = Math.random() * 2 * Math.PI; return [q * Math.cos(a), q * Math.sin(a)]; };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  // A pinch of table salt: ~0.4 g (1/16 tsp) of ~0.5 mm grains, tracked as 24
  // clusters of ~120 grains. Their faces nucleate bubbles while they last.
  //   rho: crystal density 2165 kg/m³; grainR: 0.25 mm; satMolal: solubility
  //   6.10 mol/kg water at 0 °C rising 0.0028 mol/kg per K (35.65 → 36.04 g per
  //   100 g water at 0 → 25 °C, CRC); D25: NaCl diffusivity in water at 25 °C
  //   (1.61·10⁻⁹ m²/s, CRC), scaled ∝ T/μ (Stokes–Einstein).
  const SALT = { area: 25e-4, pinch: 0.4e-3, molar: 0.05844, rho: 2165, grainR: 0.25e-3,
                 satMolal0: 6.10, satSlope: 0.0028, D25: 1.61e-9, iceTau: 15, eutectic: 273.15 - 21.1 };
  // Bodies in the glass (Mentos, salt): density, size, drag, friction (estimates
  // where not stated): a Mentos is a 19 mm lens ~1.25 g/cm³ (it sinks in soda);
  // drag of a disc ~1.1; salt grains are spheres (Schiller–Naumann).
  const BODY = {
    mentos: { rho: 1250, radius: 0.0095, half: 0.003, rest: 0.0045, cd: 1.1, mu: 0.35 },
    salt:   { rho: 2165, radius: 3e-4, half: 3e-4, rest: 3e-4, cd: null, mu: 0.5 },
  };
  // CO2 salting-out by NaCl: log10(c0/c) = K_s·[NaCl], K_s ≈ 0.11 L/mol from the
  // Weisenberger & Schumpe (1996) ion parameters (h_Na+ 0.1143, h_Cl− 0.0318,
  // h_CO2 −0.0172 m³/kmol at 25 °C).
  const KS_NACL_CO2 = 0.11;
  // Dissolving NaCl takes in heat: ΔH_sol = +3.88 kJ/mol at infinite dilution (CRC
  // Handbook) — salt chills the drink a little by itself, before any ice melts.
  const NACL_DH = 3.88e3;
  // Brine per salt mass fraction w (seawater data, Sharqawy, Lienhard & Zubair 2010,
  // Desalination & Water Treatment 16:354): density +0.76 kg/m³ per g/kg (1024.8 vs
  // 998.2 at 35 g/kg, 20 °C) and heat capacity −1.29 % per % (3993 vs 4182 J/kg·K).
  const BRINE_RHO = 760, BRINE_CP = 1.29;
  // Dissolved CO2 adds mass but little volume (partial molar volume 37 cm³/mol,
  // Garcia 2001): the drink is denser by c·(M − ρ·V̄), ≈ 1 kg/m³ at 3.7 volumes.
  const CO2_MOLAR_VOLUME = 37e-6;
  // Meltwater lighter than the drink floats on it as a layer. Turbulence below
  // erodes the interface at u_e = E·u with E ≈ 0.1/Ri for Ri ≳ 1, Ri = g′ℓ/u²
  // with ℓ the size of the eddies doing the work (Turner 1973, Buoyancy Effects
  // in Fluids, ch. 9; Fernando 1991, Annu. Rev. Fluid Mech. 23:455); E → 0.2
  // without stratification. ℓ ≈ 5 mm here (bubble wakes, the plume edge; estimate),
  // or the layer's own depth once it is thicker.
  const ENTRAIN_K = 0.1, ENTRAIN_0 = 0.2, EDDY_L = 5e-3;
  const STILL_FLOW = 0.004;         // natural-convection speed along the walls of a still glass [m/s]
  const MAX_TILT = 90;              // the cup can be laid on its side [deg]
  const BASE = { ceramic: 0.005, styrofoam: 0.004 };   // base thickness [m]; others 3 mm
  const FOAM_LIFE_TABLE = 20;       // foam on the outside of the glass collapses in ~20 s
  const BOTTLE_PARK = 0.09;         // between pours the lip is held this far out from the glass [m]
  const PATCH_NAMES = { wall: 'Wall', floor: 'Floor', ice: 'Ice', iceFilm: 'Ice-film', mentos: 'Mentos', salt: 'Salt', spoon: 'Spoon' };

  const DEFAULTS = {
    beverage: 'diet', carbonation: 3.7, sodaTemp: 4,
    material: 'glass', cupDiameter: 7.5, cupHeight: 12, cupTemp: 21, rinsed: false,
    iceCubes: 0, iceSize: 2.5, iceTemp: -18,
    bottle: 'pet500', tiltSpeed: 45,
    pourAmount: 330, pourRate: 35, pourHeight: 5, tilt: 0,
    roomTemp: 21, pressure: 101.3,
  };

  class Simulation {
    constructor(params) {
      this.params = Object.assign({}, DEFAULTS, params);
      this.bubbles = new BubbleField(PARTICLE_CAP);
      this.foam = new Foam();
      this.flow = { plume: false, xi: 0, uc0: 0, dj: 0, level: 0, epsStir: 0, swirl: 0, phase: 0 };
      this._flowFn = this._makeFlow();
      this.listeners = {};
      this.reset();
    }

    on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
    emit(evt, data) { (this.listeners[evt] || []).forEach(fn => fn(data)); }

    // ---------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------
    reset() {
      const p = this.params;
      this.time = 0;
      this.hand = new Slosh.Hand(U.clamp(p.tilt, 0, MAX_TILT) * Math.PI / 180);
      this.slosh = new Slosh.Slosh();
      this.table = new TableM.Table();
      this.stream = new StreamM.Stream();
      this.eject = { u: 0, uLiquid: 0, foamV: 0, liquidV: 0 };
      this.bev = Props.BEVERAGES[p.beverage];
      this.mat = Props.SURFACES[p.material];
      this.D = p.cupDiameter / 100;
      this.H = p.cupHeight / 100;
      this.A = Math.PI * this.D * this.D / 4;
      this.cBottle = p.carbonation * C.MOL_PER_VOLUME;

      // s = strength: the fraction of the liquid that is the original drink (the rest is meltwater)
      this.liquid = { V: 0, n: 0, T: p.sodaTemp + C.T0, s: 1, salt: 0 };   // salt: mol NaCl dissolved
      // fresh meltwater floating on the drink (V, CO2 n, temperature T, drink fraction s)
      this.water = { V: 0, n: 0, T: C.T0, s: 0, salt: 0 };
      const m = this.mat;
      const wallMass = m.rho * m.wall * (Math.PI * this.D * this.H + this.A);
      this.wall = { T: p.cupTemp + C.T0, heatCapacity: wallMass * m.cp, mass: wallMass };


      this.bottle = new Bottle(Bottle.TYPES[p.bottle] || Bottle.TYPES.pet500);
      this.bubbles.clear();
      this.foam.clear();
      this.ice = new Ice.IcePile();
      this.ice.fill(p.iceCubes | 0, p.iceSize / 100, p.iceTemp + C.T0, this._cupShape());
      this.pour = { active: false, auto: false, target: 0, poured: 0, jet: null, Qin: 0, d0: 0.008,
                    xImp: 0, zImp: 0, hitIce: false, filmArea: 0, eps: 0, Rmax: 0, Q: 0,
                    mouth: { x: -this.D / 2 - BOTTLE_PARK, y: this.H + p.pourHeight / 100 }, land: { x: 0, y: 0 }, exit: { ux: 0, vy: 0 } };
      this.additives = { mentos: [], salt: [], stirring: false, spoonWet: false };
      this.runs = [];                   // spilled liquid / foam sliding down the outside of the glass
      this.crown = { liquid: 0, foam: 0, bulgeMax: 0, domeMax: 0 };
      this.wet = { wall: 0, bottom: false, ice: 0 };
      this.acc = {};
      this.patches = {};
      this.stats = { co2In: 0, spilledV: 0, spilledMol: 0, foamSpilledV: 0, burstV: 0, iceOverflow: 0, spillBySide: {},
                     maxFoamTop: 0, firstPour: -1, entrainedV: 0, emissionRate: 0 };
      this.history = [];
      this._histT = 0;
      this.fluid = Props.fluid(this.bev, this.liquid.T);
      this.Pamb = p.pressure * 1000;
      this.geom = this.computeGeometry();
      this.emit('reset');
    }

    get concentration() {
      return this.liquid.V > 1e-9 ? this.liquid.n / this.liquid.V : this.cBottle;
    }

    // ---------------------------------------------------------------------
    // Geometry
    // ---------------------------------------------------------------------
    /** Dissolved salt [mol/L] and its molality [mol per kg of water]. */
    // (the dissolved salt is shared by the drink and the liquid in its head of foam)
    get saltVolume() { return this.liquid.V + this.foam.liquidVolume; }
    get saltMolar() { return this.saltVolume > 1e-9 ? this.liquid.salt / (this.saltVolume * 1000) : 0; }
    get saltMolal() { return this.saltVolume > 1e-9 ? Math.min(this.liquid.salt / (this.saltVolume * Props.rhoWater(this.liquid.T)), SALT.satMolal0 + 0.1) : 0; }

    /** The drink's freezing point now — and the temperature its ice melts at. */
    freezingPoint() { return Ice.freezingPoint(this.bev, this.liquid.s, this.saltMolal); }

    /** Salt mass fraction of the bulk drink [kg/kg]. */
    get saltMassFraction() { return this.saltVolume > 1e-9 ? Math.min(0.264, this.liquid.salt * SALT.molar / (this.saltVolume * 1000)) : 0; }   // ≤ saturated brine

    /**
     * The drink as a solution: salt lowers CO2 solubility (Sechenov: kH × 10^(−K_s·[NaCl])),
     * makes it denser and lowers its heat capacity (brine); dissolved CO2 makes it slightly denser.
     */
    _saltedFluid(fl) {
      const cs = this.saltMolar, w = this.saltMassFraction;
      const cCO2 = this.liquid.V > 1e-9 ? this.liquid.n / this.liquid.V : 0;
      const rho = fl.rho + BRINE_RHO * w + cCO2 * (C.M_CO2 - Props.rhoWater(fl.T) * CO2_MOLAR_VOLUME);
      const out = Object.assign({}, fl, { rho, nu: fl.mu / rho, Sc: fl.mu / (rho * fl.D), cp: fl.cp * (1 - BRINE_CP * w) });
      if (cs > 0) { const f = Math.pow(10, -KS_NACL_CO2 * cs); out.kH = fl.kH * f; out.heCC = fl.heCC * f; }
      return out;
    }

    /** The floating meltwater layer as a fluid: whatever drink it has taken up, and any salt dissolved in it. */
    _layerFluid() {
      const W = this.water;
      const fl = Props.fluid(Props.dilute(this.bev, W.s), W.T);
      const w = W.V > 1e-12 ? Math.min(0.264, (W.salt || 0) * SALT.molar / (W.V * 1000)) : 0;
      if (w <= 0) return fl;
      const rho = fl.rho + BRINE_RHO * w;
      return Object.assign({}, fl, { rho, nu: fl.mu / rho, cp: fl.cp * (1 - BRINE_CP * w) });
    }
    /** Salt molality of the meltwater layer [mol/kg water]. */
    get layerSaltMolal() { const W = this.water; return W.V > 1e-12 ? Math.min((W.salt || 0) / (W.V * Props.rhoWater(W.T)), SALT.satMolal0 + 0.1) : 0; }
    /** Saturation molality of NaCl at temperature T [mol/kg water] (CRC). */
    _saltSat(T) { return SALT.satMolal0 + SALT.satSlope * (T - C.T0); }

    // ---------------------------------------------------------------------
    // Frames. "World": origin at the inner floor centre, y up (moves with the
    // cup as it tips about its corner). "Table": origin at that corner on the
    // table top — fixed to the room. The cup's own frame is rotated by θ; the
    // liquid's frame by θ − δ (δ = slosh angle of the surface).
    // ---------------------------------------------------------------------
    /** The pivot: the cup's outer bottom corner on the table, cup-local [u, v]. */
    pivotLocal() { return [-(this.D / 2 + Math.max(this.mat.wall, 1.5e-3)), -(BASE[this.params.material] || 0.003)]; }
    pivotWorld() { return this.cupTilt().rot(...this.pivotLocal()); }
    worldToTable(x, y) { const p = this.pivotWorld(); return [x - p[0], y - p[1]]; }
    tableToCup(x, y) {
      const p = this.pivotWorld(), T = this.cupTilt();
      const wx = x + p[0], wy = y + p[1];
      return [wx * T.cos + wy * T.sin, -wx * T.sin + wy * T.cos];
    }
    /** World height of the liquid surface above world x (the surface is a plane tilted by δ). */
    _surfaceY(x) {
      const g = this.geom, d = g.delta || 0;
      return (g.tilt.levelToWorld(g.level) + x * Math.sin(d)) / Math.cos(d);
    }
    /** Velocity of a world point carried by the cup's rotation about the pivot. */
    _carried(wx, wy) {
      const p = this.pivotWorld(), W = this.hand.omega;
      return [-W * (wy - p[1]), W * (wx - p[0])];
    }

    /** Cup dimensions the ice physics needs. */
    _cupShape() { return { D: this.D, H: this.H, wall: Math.max(this.mat.wall, 1.5e-3) }; }

    computeGeometry() {
      const tilt = this.tiltGeometry(), cupTilt = this.cupTilt();
      const A = this.A, I = this.ice;
      const Vt = this.liquid.V + this.water.V + this.bubbles.holdup;
      const cubes = I.cubes.filter(c => c.where === 'cup');

      // Liquid level: A·z = liquid + gas holdup + volume the cubes displace at the
      // surface height z implies. Displacement grows with z, so bisect.
      let level;
      if (!cubes.length) {
        level = Vt / A;
      } else {
        let lo = 0, hi = (Vt + I.mass / C.RHO_ICE) / A + 1e-3;
        for (let it = 0; it < 32; it++) {
          const mid = 0.5 * (lo + hi);
          if (A * mid < Vt + I.displaced(tilt, tilt.levelToWorld(mid))) lo = mid; else hi = mid;
        }
        level = 0.5 * (lo + hi);
      }
      const hS = tilt.levelToWorld(level);

      const g = { level, tilt, cupTilt, delta: cupTilt.theta - tilt.theta, cubes, iceWet: 0, iceWetBulk: 0, iceExposed: 0, iceA: 0, iceTop: 0, iceBottom: Infinity,
                  iceSpan: null, floating: false, obstacles: [] };
      let aSum = 0, u0 = Infinity, u1 = -Infinity;
      for (const c of cubes) {
        c.sub = I.submerged(c, tilt, hS);
        const fc = I.faces(c);
        g.iceWet += fc.wet; g.iceExposed += fc.dry;
        aSum += c.a;
        g.iceTop = Math.max(g.iceTop, c.v + c.a / 2);
        g.iceBottom = Math.min(g.iceBottom, c.v - c.a / 2);
        u0 = Math.min(u0, c.u - c.a / 2); u1 = Math.max(u1, c.u + c.a / 2);
        if (c.sub > 0 && !c.below) g.floating = true;
        g.obstacles.push({ x0: c.u - c.a / 2, x1: c.u + c.a / 2, y0: c.v - c.a / 2, y1: c.v + c.a / 2 });
      }
      if (cubes.length) { g.iceA = aSum / cubes.length; g.iceSpan = { u0, u1 }; }
      // free cross-section at equivalent level z: the cup minus every cube cut by that plane
      g.areaAt = (z) => {
        if (!cubes.length) return A;
        const h = tilt.levelToWorld(z);
        let blocked = 0;
        for (const c of cubes) {
          const hc = c.u * tilt.sin + c.v * tilt.cos, e = 0.5 * c.a * (Math.abs(tilt.cos) + Math.abs(tilt.sin));
          if (h > hc - e && h < hc + e) blocked += c.a * c.a;
        }
        return Math.max(0.1 * A, A - blocked);
      };
      // the meltwater layer floats on top: its bottom, in equivalent-level units, and
      // the share of each cube's wetted height that sits in it
      g.waterZ = this.water.V > 0 ? Math.max(0, level - this.water.V / g.areaAt(level)) : level;
      const hW = tilt.levelToWorld(g.waterZ);
      for (const c of cubes) {
        c.layer = 0;
        if (this.water.V > 0 && c.sub > 0) {
          const hc = c.u * tilt.sin + c.v * tilt.cos, e = 0.5 * c.a * (Math.abs(tilt.cos) + Math.abs(tilt.sin));
          const lo = hc - e, hi = Math.min(hc + e, hS);
          if (hi > lo) c.layer = U.clamp((hi - Math.max(lo, hW)) / (hi - lo), 0, 1);
        }
        g.iceWetBulk += I.faces(c).wet * (1 - c.layer);
      }
      g.rimLevel = tilt.rimLevel;
      g.freeArea = g.areaAt(level) * tilt.surfaceFactor(level);
      g.foamTop = this.foam.layout(level, g.areaAt);
      g.foamHeight = g.foamTop - level;
      return g;
    }

    /**
     * The LIQUID's frame: the cup at its real angle θ, less the slosh angle δ of
     * the surface (a surface tilted by δ in a cup at θ is a level surface in a
     * cup at θ − δ). All liquid geometry — level, rim, spill side — uses this.
     */
    tiltGeometry() {
      const th = U.clamp(this.hand.theta - this.slosh.delta, -1.45, 1.55);
      const key = `${this.D}|${this.H}|${th.toFixed(5)}`;
      if (this._tiltKey !== key) { this._tiltKey = key; this._tilt = Tilt.make(this.D, this.H, th); }
      return this._tilt;
    }
    /** The cup's own frame at its real angle (walls, rim, drawing). */
    cupTilt() {
      const th = this.hand.theta;
      const key = `${this.D}|${this.H}|${th.toFixed(5)}`;
      if (this._cupKey !== key) { this._cupKey = key; this._cupT = Tilt.make(this.D, this.H, th); }
      return this._cupT;
    }
    /** Real tilt of the cup [deg]. */
    get tiltDeg() { return this.hand.theta * 180 / Math.PI; }
    /** Everything liquid in the cup: drink + floating meltwater. */
    get cupVolume() { return this.liquid.V + this.water.V; }

    // ---------------------------------------------------------------------
    // Player actions
    // ---------------------------------------------------------------------
    startPour(auto = false) {
      const P = this.pour;
      if (P.active && auto === P.auto) return;
      P.active = true; P.auto = auto;
      P.target = auto ? P.poured + this.params.pourAmount * 1e-6 : Infinity;
      if (this.stats.firstPour < 0) this.stats.firstPour = this.time;
    }
    /** Let go: the hand rights the bottle, and the stream tails off as it does. */
    stopPour() { this.pour.active = false; this.pour.auto = false; }

    /**
     * Drop a Mentos in: released somewhere over the mouth (x across, z in depth),
     * with the small sideways push of a hand letting go; it bounces off the wall
     * if it reaches it and lies flat where it lands.
     */
    dropMentos() {
      const room = Math.max(0, this.D / 2 - MENTOS.radius);
      const [x, z] = randomInDisc(0.7 * room);
      this.additives.mentos.push({ kind: 'mentos', where: 'cup', x, z, y: this.H + 0.015 + Math.random() * 0.02, age: 0, wet: false,
                                   vx: (Math.random() - 0.5) * 0.1, vy: 0, vz: (Math.random() - 0.5) * 0.1,
                                   spin: Math.random() * Math.PI, tilt: (Math.random() - 0.5) * 0.6 });
      this.emit('mentos');
    }
    /** A pinch of salt: 24 grains scattered round where the fingers are, each with its own drift. */
    addSalt() {
      const [cx, cz] = randomInDisc(0.45 * this.D / 2);
      for (let i = 0; i < 24; i++) {
        // a pinch spreads into a patch ~1–2 cm across (Gaussian scatter, σ ≈ 5 mm)
        const gx = gauss() * 0.005, gz = gauss() * 0.005;
        const m0 = SALT.pinch / 24;
        this.additives.salt.push({ kind: 'salt', where: 'cup', x: cx + gx, z: cz + gz, y: this.H + 0.01 + Math.random() * 0.02,
                                   vx: gx * 2, vy: 0, vz: gz * 2,
                                   age: 0, wet: false, area: SALT.area / 24, m: m0, m0,
                                   // how many real grains this cluster stands for
                                   grains: m0 / (SALT.rho * U.sphereVolume(SALT.grainR)) });
      }
    }
    /**
     * Pick the bottle up with the cursor. While held, its lip goes where you put
     * it (world frame, metres) and the hand turns it toward the angle you point it
     * at; the flow still comes from the bottle physics (head over the lip, air
     * getting in, glugs). Let go and the hand rights it where it is; it stays
     * there until HOLD / AUTO takes it over (or a reset puts it back).
     */
    grabBottle() {
      const P = this.pour;
      P.manual = { x: P.mouth.x, y: P.mouth.y, phi: this.bottle.phi };
      P.restSpot = null;
      P.active = false; P.auto = false;
    }
    moveBottle(x, y) {
      const m = this.pour.manual;
      if (!m) return;
      // the lip cannot go inside the glass or into the table
      const T = this.cupTilt(), Ro = this.D / 2 + Math.max(this.mat.wall, 1.5e-3);
      const rimY = Math.max(T.rot(-Ro, this.H)[1], T.rot(Ro, this.H)[1]);
      const lo = T.rot(-Ro, 0)[0] - 0.01, hi = T.rot(Ro, 0)[0] + 0.01;
      const tableY = this.pivotWorld()[1];
      m.x = U.clamp(x, -0.6, 0.6);
      m.y = U.clamp(y, tableY + 0.02, 0.7);
      if (m.x > Math.min(lo, hi) && m.x < Math.max(lo, hi) && m.y < rimY + 0.004) m.y = rimY + 0.004;
      // the hand holding it moves it at once (even while the game is paused)
      this.pour.mouth.x = m.x; this.pour.mouth.y = m.y;
    }
    tipBottle(phiDeg) { if (this.pour.manual) this.pour.manual.phi = U.clamp(phiDeg, 0, 170); }
    releaseBottle() {
      const P = this.pour;
      if (P.manual) P.restSpot = { x: P.manual.x, y: P.manual.y };     // put down where it is
      P.manual = null;
    }
    get bottleHeld() { return !!this.pour.manual; }

    /** Wipe the table: puddles, foam heaps, spilled ice, anything in the air. The glass is left as it is. */
    cleanTable() {
      this.table.clear();
      this.ice.cubes = this.ice.cubes.filter(c => c.where === 'cup');
      this.runs = [];
      this.emit('cleaned');
    }
    /** Stand the glass back up (the hand brings it there). */
    upright() { this.params.tilt = 0; }
    /** Stop everything the hands are doing: pouring and stirring. */
    stopAll() { this.stopPour(); this.setStir(false); }

    /** Stirring is a toggle: the spoon keeps going until switched off. */
    setStir(on) { this.additives.stirring = !!on; }
    toggleStir() { this.setStir(!this.additives.stirring); return this.additives.stirring; }
    /**
     * The spoon goes round in one steady circle, clockwise seen from above
     * (x right, z toward the viewer; the angle increases), at radius 0.3·D.
     * spoonX is its position across the cross-section, spoonZ its depth.
     */
    spoonX() { return Math.cos(this.flow.phase) * this.D * 0.3; }
    spoonZ() { return Math.sin(this.flow.phase) * this.D * 0.3; }

    /**
     * Drop one ice cube in, live, from just above the mouth. From there the
     * physics takes over: it falls, splashes (dragging an air cavity under, about
     * ICE_SPLASH_AIR × its volume), floats or stacks — and if the glass is
     * already heaped full, it tumbles over the rim onto the table.
     */
    addIce() {
      const p = this.params;
      this.ice.drop(p.iceSize / 100, p.iceTemp + C.T0, this._cupShape());
      this.emit('ice');
      return true;
    }

    /**
     * Change how many cubes are in the glass, live, keeping the drink and its
     * head: more are dropped in; fewer means the top ones are fished out.
     */
    setIceCount(n) {
      n = Math.max(0, n | 0);
      this.params.iceCubes = n;
      const inCup = this.ice.cubes.filter(c => c.where === 'cup');
      const diff = n - inCup.length;
      if (diff > 0) {
        const p = this.params;
        for (let k = 0; k < diff; k++) {
          const c = this.ice.drop(p.iceSize / 100, p.iceTemp + C.T0, this._cupShape());
          c.v += k * c.a * 1.05;                                // dropped one above another, not all at once
        }
        this.emit('ice');
      } else if (diff < 0) {
        const out = new Set(inCup.sort((a, b) => b.v - a.v).slice(0, -diff));
        this.ice.cubes = this.ice.cubes.filter(c => !out.has(c));
      }
      this.geom = this.computeGeometry();
    }

    /** Move the ice; turn its events into physics (splash air) and stats. */
    _stepIce(dt) {
      const g = this.geom, fl = this.fluid;
      const tilt = g.tilt, cup = this._cupShape();
      const cupT = g.cupTilt;
      const events = this.ice.step(dt, {
        D: cup.D, H: cup.H, wall: cup.wall, tilt, hSurface: tilt.levelToWorld(g.level), rhoL: fl.rho,
        toTable: (u, v) => { const w = cupT.rot(u, v); return this.worldToTable(w[0], w[1]); },
        velToTable: (u, v, wu, wv) => {
          const w = cupT.rot(u, v), q = cupT.rot(wu, wv), k = this._carried(w[0], w[1]);
          return [q[0] + k[0], q[1] + k[1]];
        },
        toCup: (x, y) => this.tableToCup(x, y),
        velToCup: (x, y, vx, vy) => {
          // relative to the turning cup: take away the cup's own velocity there, then un-rotate
          const p = this.pivotWorld(), k = this._carried(x + p[0], y + p[1]);
          const rx = vx - k[0], ry = vy - k[1];
          return [rx * cupT.cos + ry * cupT.sin, -rx * cupT.sin + ry * cupT.cos];
        },
        // the swing the hand gives the cup: the cubes feel it as centrifugal, tangential and Coriolis forces
        cupTilt: cupT, frame: { omega: this.hand.omega, alpha: this.hand.alpha, pivot: this.pivotLocal() },
        // stirring: the swirl of the drink (clockwise from above) and the spoon itself
        liquidU: this.additives.stirring ? (u, z) => {
          const r = Math.hypot(u, z) || 1e-6, f = Math.min(1, r / (0.3 * this.D));
          return -0.6 * SPOON.speed * (z / r) * f;
        } : null,
        spoon: this.additives.stirring ? (() => {
          const w = SPOON.speed / (0.3 * this.D), ph = this.flow.phase, r = 0.3 * this.D;
          return { u: r * Math.cos(ph), z: r * Math.sin(ph), vu: -r * w * Math.sin(ph), r: 0.003, top: this.H + 0.05 };
        })() : null,
      });
      for (const ev of events) {
        if (ev.type === 'overflow') { this.stats.iceOverflow++; this.emit('iceOverflow'); continue; }
        if (ev.type === 'thrown') { this.stats.iceThrown = (this.stats.iceThrown || 0) + 1; this.emit('iceThrown'); continue; }
        if (ev.type === 'landed') continue;
        // a plunging cube drags an air cavity under; it breaks into bubbles that strip CO2
        if (g.level < 0.01) continue;
        const RT = C.R * fl.T, a = ev.cube.a;
        const Vair = ICE_SPLASH_AIR * a * a * a * Math.min(1, ev.speed);
        const R = Jet.hinzeMaxRadius(STIR_EPS, fl);
        for (let k = 0; k < 6; k++) {
          const Rk = U.logUniform(0.3 * R, R);
          const y = Math.max(Rk, g.level - Math.random() * Math.min(a, g.level * 0.8));
          const Pin = this.Pamb + fl.rho * C.G * (g.level - y) + 2 * fl.sigma / Rk;
          this.bubbles.spawn(ev.cube.u + (Math.random() - 0.5) * a, y, Rk, Pin, RT, 1, (Vair / 6) / U.sphereVolume(Rk));
        }
      }
    }

    // ---------------------------------------------------------------------
    // Main step
    // ---------------------------------------------------------------------
    step(dt) {
      const p = this.params, L = this.liquid;
      this._dt = dt;
      this.time += dt;
      this.Pamb = p.pressure * 1000;
      this.cBottle = p.carbonation * C.MOL_PER_VOLUME;           // the bottle's settings act live on the next pour
      // the hand moves the cup toward the tilt asked for; the drink sloshes in it
      this.hand.step(dt, U.clamp(p.tilt, 0, MAX_TILT) * Math.PI / 180);
      {
        const g0 = this.geom, R = this.D / 2;
        this.slosh.step(dt, { hand: this.hand, R, h: this.cupVolume > 1e-9 ? g0.level : 0, nu: this.fluid.nu,
                              foamH: g0.foamHeight, pivot: this.pivotLocal(), modeV: Math.max(0, g0.level - R / Slosh.XI) });
      }
      // the drink as it is now: meltwater dilutes its sugar and solutes
      const fl = this.fluid = this._saltedFluid(Props.fluid(Props.dilute(this.bev, L.s), L.T));
      this.geom = this.computeGeometry();
      this._stepIce(dt);
      this.geom = this.computeGeometry();

      let desorbed = 0;                 // mol CO2 leaving solution this step (for fizz cooling)
      this._stepPour(dt, fl);
      this.geom = this.computeGeometry();
      this._updateFlow(dt);
      this._stepAdditives(dt);
      desorbed += this._stepNucleation(dt, fl);

      // --- bubbles in the liquid
      const g = this.geom;
      const Wl = this.water;
      const res = this.bubbles.step(dt, {
        fl, mobility: this.bev.mobility, c: this.concentration, level: g.level, Pamb: this.Pamb,
        halfWidth: this.D / 2, flow: this._flowFn, obstacles: g.obstacles, liquidVolume: L.V, available: L.n,
        layerY: Wl.V > 0 ? g.waterZ : Infinity, cLayer: Wl.V > 0 ? Wl.n / Wl.V : 0, availableLayer: Wl.n,
      });
      L.n = Math.max(0, L.n - res.uptake);
      Wl.n = Math.max(0, Wl.n - res.uptakeW);
      desorbed += res.uptake + res.uptakeW;
      this.surfacedRate = res.surfacedV / dt;
      if (res.surfacedV > 0) this._toFoam(res.surfacedV, res.surfacedN);

      // --- foam
      const topR = this.foam.geometry.length ? this.foam.geometry[this.foam.geometry.length - 1].R : 0;
      const fr = this.foam.step(dt, { fl, bev: this.bev, Pamb: this.Pamb, base: g.level, areaAt: g.areaAt });
      if (fr.burstV > 0) this._spray(fr.burstV, topR || 3e-4, fl);
      if (Wl.V > 0 && fr.drainV > 0) {
        // the head drains onto the top of the liquid: into the meltwater layer
        Wl.s = (Wl.s * Wl.V + fr.drainS * fr.drainV) / (Wl.V + fr.drainV);
        Wl.V += fr.drainV; Wl.n += fr.drainMol;
      } else {
        if (fr.drainV > 0) L.s = (L.s * L.V + fr.drainS * fr.drainV) / Math.max(L.V + fr.drainV, 1e-15);
        L.V += fr.drainV; L.n += fr.drainMol;
      }
      this.stats.burstV += fr.burstV;
      desorbed += fr.degasMol;

      // --- free-surface degassing (Danckwerts surface renewal enhanced by pour/stir).
      //     A meltwater layer is a lid: the surface then belongs to the layer, whose
      //     water holds almost no CO2.
      if (L.V > 1e-9) {
        const covered = this.foam.layers.length ? 0.3 : 1;
        const kS = SURFACE_KL + (this.pour.jet ? 2e-4 : 0) + (this.additives.stirring ? 1e-4 : 0);
        const cAir = fl.kH * this.Pamb * C.X_CO2_AIR;
        const top = Wl.V > 1e-9 ? Wl : L;
        const cTop = top.n / Math.max(top.V, 1e-12);
        const dn = U.clamp(kS * g.freeArea * covered * (cTop - cAir) * dt, -top.n, 0.5 * top.n);
        top.n -= dn; desorbed += dn;
      }
      this._stepLayer(dt, fl);

      this._stepHeat(dt, fl, desorbed / dt);
      this._stepSpill();
      this._stepTable(dt, fl);
      this.geom = this.computeGeometry();
      this.stats.maxFoamTop = Math.max(this.stats.maxFoamTop, this.geom.foamTop);
      this._sanitize();
      this._record(dt);
    }

    /**
     * Watchdog. The models above are designed to stay finite, but a single bad
     * particle or layer must never be able to take down the whole scene. Any
     * non-finite state is repaired from its neighbours and reported once.
     */
    _sanitize() {
      const L = this.liquid, I = this.ice, p = this.params;
      const fixes = [];
      if (!Number.isFinite(L.V) || L.V < 0) { L.V = 0; fixes.push('liquid volume'); }
      if (!Number.isFinite(L.n) || L.n < 0) { L.n = L.V * this.cBottle * 0.5; fixes.push('dissolved CO2'); }
      if (!Number.isFinite(L.T)) { L.T = p.sodaTemp + C.T0; fixes.push('soda temperature'); }
      if (!Number.isFinite(this.wall.T)) { this.wall.T = p.roomTemp + C.T0; fixes.push('cup temperature'); }
      const nIce = I.cubes.length;
      I.cubes = I.cubes.filter(c => [c.m, c.T, c.u, c.v, c.x, c.y].every(Number.isFinite) && c.m >= 0);
      if (I.cubes.length !== nIce) fixes.push('ice cubes');
      if (!Number.isFinite(L.s)) { L.s = 1; fixes.push('drink strength'); }
      const Wl = this.water;
      if (![Wl.V, Wl.n, Wl.T, Wl.s, Wl.salt || 0].every(Number.isFinite) || Wl.V < 0) { this.water = { V: 0, n: 0, T: C.T0, s: 0, salt: 0 }; fixes.push('meltwater layer'); }
      if (![this.hand.theta, this.hand.omega].every(Number.isFinite)) { this.hand.set(U.clamp(p.tilt, 0, MAX_TILT) * Math.PI / 180); fixes.push('cup angle'); }
      if (![this.slosh.delta, this.slosh.rate].every(Number.isFinite)) { this.slosh.reset(); fixes.push('slosh'); }
      const nd = this.table.drops.length;
      this.table.drops = this.table.drops.filter(d => [d.x, d.y, d.z, d.vx, d.vy, d.vz, d.V].every(Number.isFinite));
      this.table.puddles = this.table.puddles.filter(q => [q.x, q.z, q.r, q.V].every(Number.isFinite));
      if (this.table.drops.length !== nd) fixes.push('flying drops');
      this.stream.parcels = this.stream.parcels.filter(q => [q.x, q.y, q.vx, q.vy, q.V].every(Number.isFinite));
      const okBody = (o) => (o.where === 'cup' ? [o.x, o.y, o.z, o.vx, o.vy, o.vz] : [o.tx, o.ty, o.tz, o.vx, o.vz]).every(Number.isFinite);
      const nb = this.additives.mentos.length + this.additives.salt.length;
      this.additives.mentos = this.additives.mentos.filter(okBody);
      this.additives.salt = this.additives.salt.filter(o => okBody(o) && Number.isFinite(o.m));
      if (this.additives.mentos.length + this.additives.salt.length !== nb) fixes.push('Mentos / salt');
      if (!Number.isFinite(this.bubbles.holdup)) { this.bubbles.clear(); fixes.push('bubbles'); }
      if (this.foam.layers.some(l => !Number.isFinite(l.vg + l.vl + l.N + l.cl))) { this.foam.clear(); fixes.push('foam'); }
      const m = this.pour.mouth;
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) { m.x = -this.D / 2 - BOTTLE_PARK; m.y = this.H + p.pourHeight / 100; fixes.push('bottle position'); }
      if (fixes.length) {
        this.geom = this.computeGeometry();
        if (!this._warned) { this._warned = true; console.warn('[Fizz] repaired non-finite state:', fixes.join(', '), 'at t =', this.time.toFixed(2)); }
        this.stats.repairs = (this.stats.repairs || 0) + 1;
      }
    }

    /** Surfaced gas becomes foam, dragging liquid (at bulk concentration) up with it. */
    _toFoam(vg, N) {
      const L = this.liquid, Wl = this.water;
      const vl = Math.min(Foam.entrainedLiquid(vg), 0.5 * (L.V + Wl.V));
      // the liquid it drags up comes from the TOP: the meltwater layer first, if there is one
      const fromW = Math.min(vl, 0.9 * Wl.V), fromB = vl - fromW;
      const cW = Wl.V > 0 ? Wl.n / Wl.V : 0;
      // the liquid's actual concentration (not the bottle fallback used when the cup is dry)
      const cB = L.V > 0 ? L.n / L.V : 0;
      Wl.V -= fromW; Wl.n = Math.max(0, Wl.n - fromW * cW);
      L.V -= fromB; L.n = Math.max(0, L.n - fromB * cB);
      const c = vl > 0 ? (fromW * cW + fromB * cB) / vl : cB;
      const sF = vl > 0 ? (fromW * Wl.s + fromB * L.s) / vl : L.s;
      this.foam.add(vg, N, vl, c, this.geom.areaAt(this.geom.level), sF);
    }

    // ---------------------------------------------------------------------
    // Pouring
    // ---------------------------------------------------------------------
    _stepPour(dt, fl) {
      const P = this.pour, p = this.params, L = this.liquid;
      // AUTO lets go once the amount has gone in; the stream then tails off
      if (P.active && P.auto && P.poured >= P.target) { this.stopPour(); this.emit('pourDone'); }

      // the bottle decides the flow: angle, liquid left, and air getting back in
      const dVout = this.bottle.step(dt, {
        holding: P.active && !P.auto, auto: P.active && P.auto,
        tiltSpeed: p.tiltSpeed, targetQ: p.pourRate * 1e-6,
        manualPhi: P.manual ? P.manual.phi : null,
      }, fl);
      if (dVout > 0 && this.stats.firstPour < 0) this.stats.firstPour = this.time;
      P.Q = dVout / dt;                                         // leaving the bottle
      this._aim(fl);
      const Tin = p.sodaTemp + C.T0;
      const flIn = Props.fluid(this.bev, Tin);
      if (dVout > 0) {
        // the outflow leaves the lip as a parcel and flies (stream.js); slow flow dribbles
        P.poured += dVout;
        const ex = this.bottle.exitJet();
        const phi = this.bottle.phi * Math.PI / 180;
        this.stream.emit(dVout, this.worldToTable(P.mouth.x, P.mouth.y), [P.exit.ux, P.exit.vy], ex.d,
                         [-Math.sin(phi), -Math.cos(phi)], flIn, StreamM.separationSpeed(flIn, 72, StreamM.BOTTLE_LIP_K));
      }
      const dV = this._stepStream(dt);                          // what reached the drink this step
      const Q = dV / dt;
      P.Qin = Q;
      if (Q <= 1e-9) {
        P.jet = null;
        P.filmArea *= Math.exp(-dt / FILM_DRAIN_TAU);
        return;
      }
      const g = this.geom;
      const tilt = Math.max(0, this.hand.theta);
      const { hitIce, tilted } = P;
      const shallow = g.level < 4e-3;
      // Over ice the stream does not stop at the top of the pile: it keeps falling
      // through the gaps to the liquid, re-plunging at every cube. So the jet's
      // energy comes from the full drop, and entrainment scales with the cascade.
      let fall = P.mouth.y - P.land.y, splash;
      if (hitIce) {
        const surface = this._surfaceY(P.land.x);
        P.cascadeSteps = Math.max(0, (P.land.y - surface) / g.iceA);
        fall = P.mouth.y - surface;
        splash = ICE_SPLASH_BASE + ICE_SPLASH_PER_STEP * P.cascadeSteps;
      } else {
        P.cascadeSteps = 0;
        splash = tilted ? 0.4 : shallow ? 1.8 : 1.0;                     // a wall film plunges gently
      }
      const jet = Jet.plungingJet({ Q, d0: P.d0, fall, tilt, fl, splash });
      P.jet = jet;
      // over ice part of the stream's energy is spent shattering on the cubes
      const poolPower = hitIce ? jet.power * ICE_KEEP_SPEED * ICE_KEEP_SPEED : jet.power;
      P.eps = Jet.plumeDissipation(poolPower, jet.dj, Math.max(g.level, 1e-3), fl.rho);
      P.Rmax = Jet.hinzeMaxRadius(P.eps, fl);
      const xImp = P.xImp;

      // liquid, heat and CO2 in (enthalpy mixing at equal heat capacity). The plunging
      // stream punches through any meltwater layer and stirs it into the drink.
      L.T = L.V > 1e-9 ? (L.T * L.V + Tin * dV) / (L.V + dV) : Tin;
      L.s = L.V > 1e-9 ? (L.s * L.V + dV) / (L.V + dV) : 1;
      // CO2 lost through the stream's and wall film's own surfaces on the way in
      const transit = this._transitLoss(Q, jet, flIn);
      P.transitFraction = transit;
      L.V += dV; L.n += this.cBottle * dV * (1 - transit);
      this.stats.co2In += this.cBottle * dV;

      // entrained air → bubbles (or straight to froth if the cup is nearly empty)
      const dVair = jet.Qair * dt;
      this.stats.entrainedV += dVair;
      if (dVair > 0) {
        if (shallow) {
          this._toFoam(dVair, dVair / U.sphereVolume(0.5 * P.Rmax));
        } else {
          const n = Math.min(6, Math.max(1, Math.floor(this.bubbles.free() / 50)));
          const RT = C.R * fl.T;
          const xs = hitIce ? 0.5 * (g.iceSpan.u0 + g.iceSpan.u1) : xImp;
          const spread = hitIce ? 0.5 * (g.iceSpan.u1 - g.iceSpan.u0) : jet.dj;
          for (let k = 0; k < n; k++) {
            const R = U.logUniform(0.15 * P.Rmax, P.Rmax);
            const w = (dVair / n) / U.sphereVolume(R);
            const x = xs + (Math.random() - 0.5) * 2 * spread;
            // a plunging jet releases its bubbles just under the surface; liquid
            // tumbling through an ice pile carries them down the gaps between cubes
            const y = hitIce
              ? Math.max(R, g.iceBottom + Math.random() * Math.max(0, g.level - g.iceBottom))
              : Math.max(R, g.level - (0.5 + Math.random() * 2) * jet.dj);
            const Pin = this.Pamb + fl.rho * C.G * (g.level - y) + 2 * fl.sigma / R;
            if (this.bubbles.spawn(x, y, R, Pin, RT, 1, w) < 0) { this._toFoam(dVair / n, w); }
          }
        }
      }

      // stream running over exposed ice wets it into a fizzing film
      if (hitIce) {
        const target = Math.min(g.iceExposed, Q * FILM_WET_PER_FLOW);
        P.filmArea += (target - P.filmArea) * (1 - Math.exp(-dt / 0.3));
      } else {
        P.filmArea *= Math.exp(-dt / FILM_DRAIN_TAU);
      }

      // the jet punching through the head breaks films (energy budget: σ·3/R per m³ of foam)
      if (this.foam.layers.length) {
        const top = this.foam.geometry[this.foam.geometry.length - 1];
        const eFoam = 3 * fl.sigma / Math.max(top.R || 3e-4, 5e-5);
        this.foam.erode(FOAM_ERODE_EFF * jet.power / eFoam * dt);
      }
    }

    /**
     * Fly the stream's parcels. A parcel that comes down inside the mouth is in
     * the drink once it reaches where the stream lands (liquid, ice or the low
     * wall); one that comes down outside hits the glass or the table.
     * Returns the volume that reached the drink this step.
     */
    _stepStream(dt) {
      const P = this.pour, R = this.D / 2, H = this.H, wall = Math.max(this.mat.wall, 1.5e-3);
      const base = -this.pivotLocal()[1];
      const out = this.stream.step(dt, (q) => {
        const [u, v] = this.tableToCup(q.x, q.y);
        if (q.inside == null && v < H) q.inside = Math.abs(u) < R;
        if (q.inside === true) {
          const wy = q.y + this.pivotWorld()[1];
          return wy <= P.land.y + 1e-3 || Math.abs(u) >= R || v <= 0 ? 'cup' : null;
        }
        if (q.inside === false && Math.abs(u) <= R + wall && v >= -base) return 'wall';
        return q.y <= 0 ? 'table' : null;
      }, Props.fluid(this.bev, this.params.sodaTemp + C.T0));
      for (const q of out.table.concat(out.wall)) {
        // missed: onto the table (or down the outside of the glass to it)
        this.table.deposit(q.x, 0, q.V, 1);
        this.stats.spilledV += q.V; this.stats.spilledMol += this.cBottle * q.V;
        this.stats.streamMissed = (this.stats.streamMissed || 0) + q.V;
      }
      if (out.cup > 0) this.pour.d0 = out.cupD;                 // the jet that arrives is the one that left
      return out.cup;
    }

    /**
     * Fraction of the CO2 that diffuses out of the liquid while it is in transit:
     * through the surface of the falling stream, and (tilted glass) of the film
     * running down the wall. Higbie penetration theory for a freshly exposed
     * surface held for a time t gives a loss per unit area of
     *     ∫₀ᵗ k dt' · c = 4·√(D t / π) · c          (Higbie 1935)
     * so the lost fraction is (surface/volume) · 4√(Dt/π).
     *   stream:  surface/volume = 4/d (cylinder), t = fall time.
     *   film:    Nusselt (1916) film on a wall inclined at β:
     *            δ = (3 μ q / (ρ g sin β))^{1/3},  mean speed ū = q/δ,
     *            q = flow per unit width; surface/volume = 1/δ, t = path / ū.
     *            A pour makes film Reynolds numbers 4q/ν of ~10³, i.e. wavy-turbulent,
     *            so the transfer coefficient is the larger of Higbie's mean
     *            2√(D/πt) and Lamont–Scott's 0.4(εν)^¼Sc^−½ with the film's own
     *            dissipation ε = g sin β · ū (gravity's work per unit mass).
     * The drive is c itself: room air holds almost no CO2. No fitted constants.
     */
    _transitLoss(Q, jet, flIn) {
      const P = this.pour, D = flIn.D;
      const higbie = (t) => 4 * Math.sqrt(D * Math.max(t, 0) / Math.PI);
      const dStream = 0.5 * (P.d0 + jet.dj);
      let frac = (4 / dStream) * higbie(P.exit.tf || 0);
      if (P.tilted) {
        const beta = Math.PI / 2 - this.hand.theta;                // wall angle from horizontal
        const width = Math.min(Math.PI * this.D / 2, 6 * jet.dj);   // the stream spreads ~3 diameters each way
        const q = Q / width;
        const gs = flIn.rho * C.G * Math.max(Math.sin(beta), 0.05);
        const delta = Math.cbrt(3 * flIn.mu * q / gs);
        const uFilm = q / delta;
        const path = Math.max(0, 0.85 * this.H - this.geom.level);
        const t = path / uFilm;
        if (t > 0) {
          const kHigbie = 2 * Math.sqrt(D / (Math.PI * t));
          const kTurb = Fizz.BubblePhysics.turbulentKL(C.G * Math.sin(beta) * uFilm, flIn);
          frac += Math.max(kHigbie, kTurb) * t / delta;
        }
      }
      return U.clamp(frac, 0, 0.9);
    }

    /**
     * Where the stream lands and where the lip must be for it to land there.
     * The jet leaves the lip along the bottle axis, (sinφ, cosφ)·v, then falls
     * ballistically; the pourer's hand keeps the lip at pourHeight above the
     * rim and slides it sideways so the arc lands on target:
     *     t_fall = (v_y + √(v_y² + 2g·fall)) / g,   x_lip = x_land − v_x·t_fall
     * World frame: origin at the inner floor centre, y up (the tilt frame).
     */
    _aim(fl) {
      const P = this.pour, p = this.params, g = this.geom, tg = g.cupTilt;
      const hw = this.D / 2;
      if (P.manual) { this._aimManual(); return; }
      const rimNear = tg.rot(-hw, this.H)[1];                       // the rim on the bottle's side
      const y = Math.max(rimNear, tg.rot(hw, this.H)[1]) + p.pourHeight / 100;
      const ex = this.bottle.exitJet();
      const v = this.bottle.Q > 0 ? ex.v : 0;
      const ux = v * this.bottle.sinP, vy = v * this.bottle.cosP;
      const fallTime = (yLand) => { const fall = Math.max(1e-3, y - yLand); return (vy + Math.sqrt(vy * vy + 2 * C.G * fall)) / C.G; };
      /**
       * Does the arc that ends at `end` come down through the mouth, clear of the
       * rim? The pourer allows for the glass still turning (about its table corner)
       * while the stream is in the air.
       */
      const pl = this.pivotLocal(), pw = this.pivotWorld(), th0 = this.hand.theta, om = this.hand.omegaAvg;
      const clears = (end) => {
        const t1 = fallTime(end[1]), x0 = end[0] - ux * t1 - pw[0], y0 = y - pw[1];   // lip, table frame
        for (let k = 1; k <= 48; k++) {
          const t = t1 * k / 48, th = th0 + om * t, c = Math.cos(th), sn = Math.sin(th);
          const px = pl[0] * c - pl[1] * sn, py = pl[0] * sn + pl[1] * c;              // pivot in that frame
          const X = x0 + ux * t + px, Y = y0 + vy * t - 0.5 * C.G * t * t + py;
          if (-X * sn + Y * c < this.H) return Math.abs(X * c + Y * sn) < hw - 0.003;
        }
        return true;
      };
      let land = null;
      P.tilted = false;
      if (this.tiltDeg > 2) {
        // A tilted ("beer") pour runs the stream down the inside of the low wall:
        // near the rim if the arc can get there through the mouth, lower down if
        // not. As the glass comes upright that wall drops away under the lip and
        // no arc reaches it: the pour finishes straight into the drink, as a
        // bartender finishes a beer.
        for (const side of [tg.lowRimSide]) {
          const surf0 = this._surfaceY(tg.rot(side * (hw - 0.003), 0)[0]);
          for (let fH = 0.85; fH >= 0.2; fH -= 0.05) {
            let cand = tg.rot(side * (hw - 0.003), fH * this.H);
            if (cand[1] < surf0) cand = [cand[0], this._surfaceY(cand[0])];
            if (clears(cand)) { land = cand; P.tilted = true; P.wallSide = side; break; }
            if (cand[1] <= surf0 + 1e-4) break;
          }
          if (P.tilted) { P.xImp = side * (hw - 0.003); P.zImp = g.level; P.hitIce = false; break; }
        }
      }
      if (!land) {
        // straight down (an upright glass, or one barely tilted): onto ice sticking
        // out of the soda, or onto the liquid
        const xImp = -0.22 * this.D;
        let zImp = g.level, hitIce = false;
        // the highest cube under the stream that sticks out of the soda
        for (const c of g.cubes) {
          const top = c.v + c.a / 2;
          if (top > g.level + 2e-3 && Math.abs(c.u - xImp) < c.a / 2 && top > zImp) { zImp = top; hitIce = true; }
        }
        P.xImp = xImp; P.zImp = zImp; P.hitIce = hitIce;
        land = [xImp, hitIce ? tg.rot(xImp, zImp)[1] : this._surfaceY(xImp)];
      }
      const tf = fallTime(land[1]);
      P.land = { x: land[0], y: land[1] };
      P.exit = { ux, vy, tf };
      // The hand slides smoothly rather than teleporting, and keeps the lip over the
      // glass (so drips from the lip fall in); the stream then lands further in.
      let target = land[0] - ux * tf;
      const lipMin = tg.rot(-hw + 0.004, this.H)[0];
      if (!P.tilted && target < lipMin) {
        target = lipMin;
        P.land.x = Math.min(tg.rot(0.8 * hw, 0)[0], target + ux * tf);
        // the plume model (a free round jet) does not hold within ~D/4 of a wall,
        // where a real jet attaches to it; its axis is kept 0.28·D clear
        P.xImp = U.clamp(P.land.x, -0.22 * this.D, 0.22 * this.D);
        if (!P.hitIce) P.land.y = this._surfaceY(P.land.x);
      }
      // Where you put the bottle down, it stays (righted); otherwise, between
      // pours, the hand takes it out of the way, clear of the glass.
      if (P.restSpot && P.active) P.restSpot = null;            // HOLD / AUTO takes it over
      if (P.restSpot) {
        P.mouth.x += (P.restSpot.x - P.mouth.x) * Math.min(1, this._dt * 15);
        P.mouth.y += (P.restSpot.y - P.mouth.y) * Math.min(1, this._dt * 15);
        return;
      }
      const idle = !P.active && this.bottle.Q <= 0 && this.bottle.phi <= Bottle.REST_ANGLE + 1;
      if (idle) target = tg.rot(-hw, this.H)[0] - BOTTLE_PARK;
      P.mouth.x += (target - P.mouth.x) * Math.min(1, this._dt * (idle ? 6 : 15));
      P.mouth.y = y;
    }

    /**
     * The bottle in your hand: the lip is where you put it, and the stream lands
     * wherever its ballistic arc meets the drink (or ice sticking out of it).
     */
    _aimManual() {
      const P = this.pour, g = this.geom, tg = g.cupTilt, hw = this.D / 2;
      P.mouth.x = P.manual.x; P.mouth.y = P.manual.y;
      const ex = this.bottle.exitJet();
      const v = this.bottle.Q > 0 ? ex.v : 0;
      const ux = v * this.bottle.sinP, vy = v * this.bottle.cosP;
      // March the arc to where it comes down, as the stream itself would: into the
      // mouth (then to the drink's surface), onto the outside of the glass, or the table.
      let x = P.mouth.x, y = P.mouth.y, t = 0, landY = this._surfaceY(x), inside = null;
      const dtA = 0.002, Ro = hw + Math.max(this.mat.wall, 1.5e-3), tableY = this.pivotWorld()[1];
      let hit = 'table';
      for (let k = 0; k < 800; k++) {
        t += dtA; x = P.mouth.x + ux * t; y = P.mouth.y + vy * t - 0.5 * C.G * t * t;
        const u = x * tg.cos + y * tg.sin, vv = -x * tg.sin + y * tg.cos;
        if (inside == null && vv < this.H) inside = Math.abs(u) < hw;
        if (inside === true) { landY = this._surfaceY(x); if (y <= landY || Math.abs(u) >= hw) { hit = 'cup'; break; } }
        else if (inside === false && Math.abs(u) <= Ro && vv > -0.005) { hit = 'glass'; landY = y; break; }
        if (y <= tableY) { hit = 'table'; landY = tableY; break; }
      }
      P.aimHit = hit;
      // drips and the slow start of a pour fall straight off the lip: is the lip over the opening?
      const lu = P.mouth.x * tg.cos + P.mouth.y * tg.sin;
      P.lipOver = Math.abs(lu) < hw - 0.002;
      if (!P.lipOver) P.dripX = P.mouth.x;
      // ice sticking out of the drink under the stream catches it first
      let zImp = g.level, hitIce = false;
      for (const c of g.cubes) {
        const top = c.v + c.a / 2;
        if (top > g.level + 2e-3 && Math.abs(c.u - x) < c.a / 2 && top > zImp) { zImp = top; hitIce = true; }
      }
      P.tilted = false; P.hitIce = hitIce; P.zImp = zImp;
      P.land = { x, y: hitIce ? tg.rot(x, zImp)[1] : landY };
      // (the plume model is a free jet: its axis is kept 0.28·D clear of the wall)
      P.xImp = U.clamp(x, -0.22 * this.D, 0.22 * this.D);
      P.exit = { ux, vy, tf: Math.max(t, 1e-3) };
    }

    // ---------------------------------------------------------------------
    // Liquid flow field: turbulent round-jet plume + stirring
    // ---------------------------------------------------------------------
    _updateFlow(dt) {
      const f = this.flow, P = this.pour;
      const stirring = this.additives.stirring;
      f.plume = !!P.jet && this.geom.level > 4e-3;
      if (f.plume) {
        const tilted = P.tilted;
        // Ice breaks the stream's momentum; a wall film enters tangentially after
        // losing much of its speed to wall friction.
        f.xi = P.hitIce ? 0.5 * (this.geom.iceSpan.u0 + this.geom.iceSpan.u1) : tilted ? (P.wallSide || -1) * this.D / 2 : P.xImp;
        f.uc0 = P.jet.vEff * (P.hitIce ? ICE_KEEP_SPEED : tilted ? 0.3 : 1);
        f.dj = P.hitIce ? 0.5 * (this.geom.iceSpan.u1 - this.geom.iceSpan.u0) : tilted ? 2 * P.jet.dj : P.jet.dj;
      }
      f.level = this.geom.level;
      f.hw = this.D / 2;
      f.epsStir = stirring ? STIR_EPS : 0;
      f.swirl = stirring ? 0.08 : 0;
      if (stirring) f.phase += dt * SPOON.speed / (0.3 * this.D);   // tip speed = SPOON.speed
      // characteristic liquid speed scrubbing the walls (drives site shedding + heat transfer)
      f.uWall = STILL_FLOW + (f.plume ? 0.12 * f.uc0 : 0) + (stirring ? 0.15 : 0);
    }

    _makeFlow() {
      const f = this.flow;
      return (x, y, out) => {
        let ux = 0, uy = 0, eps = f.epsStir, Dt = 2e-8 + f.epsStir * 2e-6;
        if (f.plume) {
          const z = f.level - y;
          if (z > 0) {
            // self-similar round jet (Pope, Turbulent Flows, ch. 5): centreline
            // u_c = B·u0·d/z with B = 5.8; Gaussian profile with half-width
            // r½ = 0.094 z, i.e. e-folding radius b = r½/√ln2 = 0.113 z
            const b = 0.5 * f.dj + 0.113 * z;
            const uc = f.uc0 * Math.min(1, 5.8 * f.dj / z);
            // a plume cannot spread into the wall: confined, its axis is pushed
            // inward until it fits (1.5 e-folding radii clear of each wall)
            const room = Math.max(0, f.hw - 1.5 * b);
            const xc = Math.max(-room, Math.min(room, f.xi));
            const r = (x - xc) / b;
            const prof = Math.exp(-r * r);
            // plume turns outward at the floor: vertical velocity stagnates, radial grows
            const floor = Math.max(0, 1 - y / b);
            uy = (-uc * prof + 0.12 * uc * (1 - prof)) * (1 - floor);  // core down, weak return up
            ux = (x >= xc ? 1 : -1) * uc * prof * floor * 0.8;
            eps += 0.015 * uc * uc * uc / b * prof;
            Dt += 0.02 * uc * b * prof;
          }
        }
        if (f.swirl > 0) {
          ux += f.swirl * Math.sin(f.phase + y * 60);
          uy += 0.3 * f.swirl * Math.cos(f.phase * 1.3 + x * 80);
        }
        out.ux = ux; out.uy = uy; out.eps = eps; out.Dt = Dt;
      };
    }

    // ---------------------------------------------------------------------
    // Additives
    // ---------------------------------------------------------------------
    /**
     * Mentos and salt are bodies like the ice (ice.js). In the glass, in its own
     * frame, each feels gravity and the swing of the cup — −(α×r − ω²r), r from the
     * pivot, plus Coriolis — less buoyancy where it is under the drink, and drag
     * against the liquid (Schiller–Naumann for grains, a disc's C_d ≈ 1.1 for a
     * Mentos; the stirred drink swirls round the spoon's circle). The wall and
     * floor stop them (restitution 0.4; kinetic friction on the floor), they come
     * to rest on top of ice cubes, and a hard enough swing throws them out of the
     * mouth. Out of the glass they fly (table frame) with air drag, may fall back
     * in or hit the glass, and land and slide on the table.
     */
    _stepAdditives(dt) {
      const A = this.additives, g = this.geom;
      const R = this.D / 2, Ro = R + Math.max(this.mat.wall, 1.5e-3), H = this.H;
      const cupT = g.cupTilt, tl = g.tilt;
      const pl = this.pivotLocal(), W = this.hand.omega, Al = this.hand.alpha;
      const g0u = -C.G * cupT.sin, g0v = -C.G * cupT.cos;
      const hS = tl.levelToWorld(g.level), hW = this.water.V > 0 ? tl.levelToWorld(g.waterZ) : hS;
      const fl = this.fluid, swirl = A.stirring ? 0.6 * SPOON.speed : 0;
      const cubes = g.cubes;
      const lanes = this.ice.laneDefs.length ? this.ice.laneDefs : [{ z: 0 }];
      const RHO_AIR = 1.2, MU_AIR = 1.8e-5;
      const dragK = (o, B, rhoF, muF, vrel) => {
        // drag per unit mass and speed [1/m]: ½ρ_f C_d A / m
        const r = B.radius, m = B.rho * (o.kind === 'mentos' ? Math.PI * r * r * 2 * B.half : U.sphereVolume(r));
        const Re = Math.max(rhoF * vrel * 2 * r / muF, 1e-6);
        const cd = B.cd || (Re < 1000 ? 24 / Re * (1 + 0.15 * Math.pow(Re, 0.687)) : 0.44);
        return 0.5 * rhoF * cd * Math.PI * r * r / m;
      };
      const step = (o) => {
        const B = BODY[o.kind];
        o.age += dt;
        if (o.where === 'table') {
          const sp = Math.hypot(o.vx, o.vz);
          if (sp > 0) { const k = Math.max(0, 1 - B.mu * C.G * dt / sp); o.vx *= k; o.vz *= k; }
          o.tx += o.vx * dt; o.tz += o.vz * dt;
          return;
        }
        if (o.where === 'air') {
          const sp = Math.hypot(o.vx, o.vy, o.vz), kd = dragK(o, B, RHO_AIR, MU_AIR, sp) * sp;
          o.vx /= 1 + kd * dt; o.vz /= 1 + kd * dt; o.vy = (o.vy - C.G * dt) / (1 + kd * dt);
          o.tx += o.vx * dt; o.ty += o.vy * dt; o.tz += o.vz * dt;
          const [u, v] = this.tableToCup(o.tx, o.ty);
          const r2 = u * u + o.tz * o.tz;
          if (o.vy < 0 && v < H && v > 0 && r2 < (R - B.radius) ** 2) {          // back in through the mouth
            const [vu, vv] = this._velToCup(o.tx, o.ty, o.vx, o.vy);
            Object.assign(o, { where: 'cup', x: u, y: v, z: o.tz, vx: vu, vy: vv });
            return;
          }
          if (v < H && v > pl[1] && r2 < (Ro + B.radius) ** 2) {                   // hits the outside of the glass
            const rr = Math.sqrt(r2) || 1e-6, k = (Ro + B.radius) / rr;
            const [x, y] = this.worldToTable(...cupT.rot(u * k, v));
            o.tx = x; o.ty = y; o.tz *= k; o.vx *= 0.3; o.vz *= 0.3;
          }
          if (o.ty <= B.half) { o.ty = B.half; o.vy = 0; o.vx *= 0.5; o.vz *= 0.5; o.where = 'table'; }
          return;
        }
        // --- in the glass (its own frame: x across, y up the axis, z in depth)
        const hp = o.x * tl.sin + o.y * tl.cos;                   // height in the liquid's frame
        const sub = this.cupVolume > 1e-8 && hp < hS;
        o.sub = sub;
        o.inLayer = sub && this.water.V > 0 && hp > hW;
        const rhoF = sub ? fl.rho : RHO_AIR;
        // effective gravity in the swinging glass, less buoyancy
        const ru = o.x - pl[0], rv = o.y - pl[1];
        const gu = g0u - (-Al * rv - W * W * ru), gv = g0v - (Al * ru - W * W * rv);
        const lift = 1 - rhoF / B.rho;
        // the liquid's own motion: swirled round the spoon's circle (clockwise from above)
        let lx = 0, lz = 0;
        if (sub && swirl > 0) {
          const r = Math.hypot(o.x, o.z) || 1e-6, f = Math.min(1, r / (0.3 * this.D));
          lx = -swirl * (o.z / r) * f; lz = swirl * (o.x / r) * f;
        }
        const ru2 = o.vx - lx, rz2 = o.vz - lz, vrel = Math.hypot(ru2, o.vy, rz2);
        const kd = dragK(o, B, rhoF, sub ? fl.mu : MU_AIR, vrel) * vrel;
        // implicit drag toward the liquid's velocity, explicit body forces + Coriolis
        const au = gu * lift + 2 * W * o.vy, av = gv * lift - 2 * W * o.vx;
        o.vx = (o.vx + au * dt + kd * dt * lx) / (1 + kd * dt);
        o.vy = (o.vy + av * dt) / (1 + kd * dt);
        o.vz = (o.vz + kd * dt * lz) / (1 + kd * dt);
        o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
        o.onCube = null;
        // resting on an ice cube (its top face, in its depth lane)
        for (const c of cubes) {
          const lz2 = lanes[Math.min(c.lane, lanes.length - 1)].z, h = c.a / 2, top = c.v + h;
          if (Math.abs(o.x - c.u) < h && Math.abs(o.z - lz2) < h && o.y < top + B.half && o.y > c.v && o.vy <= 0.05) {
            o.y = top + B.half; o.vy = Math.max(0, c.wv); o.onCube = c;
            const k = Math.max(0, 1 - B.mu * Math.abs(gv) * dt / Math.max(Math.hypot(o.vx - c.wu, o.vz), 1e-9));
            o.vx = c.wu + (o.vx - c.wu) * k; o.vz *= k;
          }
        }
        // floor: rests, with friction
        if (o.y < B.rest) {
          o.y = B.rest; if (o.vy < 0) o.vy = 0;
          const n = Math.max(0, -gv * lift), sp = Math.hypot(o.vx, o.vz);
          if (sp > 0) { const k = Math.max(0, 1 - B.mu * n * dt / sp); o.vx *= k; o.vz *= k; }
        }
        // wall (below the rim): bounce, restitution 0.4
        const r = Math.hypot(o.x, o.z), lim = Math.max(0, R - B.radius);
        if (o.y < H && r > lim) {
          o.x *= lim / r; o.z *= lim / r;
          const vr = (o.vx * o.x + o.vz * o.z) / Math.max(lim, 1e-9);
          if (vr > 0) { o.vx -= 1.4 * vr * o.x / lim; o.vz -= 1.4 * vr * o.z / lim; }
        }
        // out of the mouth: above the rim and moving out, or past its edge
        if (o.y > H + B.half && (o.vy > 0 || r > R)) {
          const [tx, ty] = this.worldToTable(...cupT.rot(o.x, o.y));
          const [vx, vy] = this._velToTable(o.x, o.y, o.vx, o.vy);
          Object.assign(o, { where: 'air', tx, ty, tz: o.z, vx, vy, vz: o.vz });
          this.stats.bodiesThrown = (this.stats.bodiesThrown || 0) + 1;
        }
      };
      for (const m of A.mentos) step(m);
      for (const sg of A.salt) step(sg);
      this._dissolveSalt(dt);
    }

    /**
     * Salt dissolving, at its measured rate. A cluster of n grains of radius r
     * (from its remaining mass) dissolves by mass transfer into the liquid
     * touching it:
     *     dN/dt = k·A·ρ_w·(m_sat − m),   k = Sh·D/(2r),   Sh = 2 + 0.6·Re^½·Sc^⅓
     * (Ranz–Marshall; Re from the grain's speed through the liquid — sinking,
     * or the swirl of the spoon, or the pour's plume), m the liquid's molality and
     * m_sat ≈ 6.1 mol/kg the saturation limit, so it slows and stops as the liquid
     * nears saturation. Still on the floor a grain dissolves in about a minute;
     * stirred, in seconds. Dissolving takes in 3.88 kJ/mol from that liquid.
     * Where it dissolves matters: in the drink, in the floating meltwater, or —
     * resting on an ice cube above the drink — into the ice itself: it melts the
     * ice into brine as cold as the cube (the brine's freezing point equals the
     * cube's temperature), the heat of melting and dissolving comes out of the
     * cube, which gets colder, and the brine runs off into the drink (this is
     * how salt melts ice on a road). In a puddle on the table it dissolves there.
     */
    _dissolveSalt(dt) {
      const A = this.additives, L = this.liquid, Wl = this.water, fl = this.fluid;
      const D = (T, mu) => SALT.D25 * (T / 298.15) * (0.890e-3 / mu);
      const uFlow = Math.max(0, this.flow.uWall - STILL_FLOW) + (A.stirring ? 0.6 * SPOON.speed : 0);
      for (const sg of A.salt) {
        if (!(sg.m > 0)) continue;
        const rg = Math.cbrt(sg.m / sg.grains / (SALT.rho * 4 / 3 * Math.PI));
        const area = sg.grains * 4 * Math.PI * rg * rg;
        if (sg.where === 'table') {
          const pud = this.table.puddles.find(q => Math.hypot(q.x - sg.tx, q.z - sg.tz) < q.r);
          if (pud) { const dm = sg.m * (1 - Math.exp(-dt / 20)); sg.m -= dm; pud.salt = (pud.salt || 0) + dm / SALT.molar; }
          continue;
        }
        if (sg.where !== 'cup') continue;
        if (sg.onCube && !sg.sub) {
          // on ice, above the drink: ice + salt → cold brine
          const c = sg.onCube;
          if (c.T <= SALT.eutectic || c.m <= 0) continue;
          const dn = (sg.m / SALT.molar) * (1 - Math.exp(-dt / SALT.iceTau));
          // brine molality in equilibrium with the cube: T_f(m) = T_cube
          const mb = U.clamp((C.T0 - Math.min(c.T, C.T0 - 0.2)) / (1.87 * 1.86), 0.1, this._saltSat(c.T));
          const dmi = Math.min(dn / mb, 0.5 * c.m);
          const heat = C.L_FUSION * dmi + NACL_DH * dn;
          c.m -= dmi; c.T -= heat / Math.max(c.m * C.CP_ICE, 1e-9);
          sg.m -= dn * SALT.molar;
          // the brine runs off into the drink (dense: it sinks into the bulk)
          const dV = dmi / Props.rhoWater(C.T0), Cl = L.V * fl.rho * fl.cp;
          L.T = Cl > 1e-9 ? (L.T * Cl + c.T * dmi * C.CP_WATER) / (Cl + dmi * C.CP_WATER) : c.T;
          L.s = L.V > 1e-9 ? L.s * L.V / (L.V + dV) : 0;
          L.V += dV; L.salt += dn;
          this.ice.melted += dmi;
          continue;
        }
        if (!sg.sub) continue;
        // in the drink, or in the meltwater floating on it
        const inW = sg.inLayer && Wl.V > 1e-9;
        const T = inW ? Wl.T : L.T, flW = inW ? this._layerFluid() : fl;
        const molal = inW ? this.layerSaltMolal : this.saltMolal;
        const drive = this._saltSat(T) - molal;
        if (drive <= 0) continue;
        const u = Math.hypot(sg.vx, sg.vy, sg.vz) + uFlow;
        const Dn = D(T, flW.mu);
        const Re = u * 2 * rg / flW.nu, Sc = flW.nu / Dn;
        const Sh = 2 + 0.6 * Math.sqrt(Re) * Math.cbrt(Sc);
        const k = Sh * Dn / (2 * rg);
        // never more than would saturate the liquid that is there (a few drops saturate at once)
        const waterKg = (inW ? Wl.V : L.V) * Props.rhoWater(T);
        if (waterKg < 1e-7) continue;
        const dn = Math.min(sg.m / SALT.molar, k * area * Props.rhoWater(T) * drive * dt, drive * waterKg);
        sg.m -= dn * SALT.molar;
        const target = inW ? Wl : L;
        target.salt = (target.salt || 0) + dn;
        const Cx = inW ? Wl.V * flW.rho * flW.cp : L.V * fl.rho * fl.cp;
        if (Cx > 1e-6) target.T -= NACL_DH * dn / Cx;       // dissolving is endothermic
      }
      A.salt = A.salt.filter(sg => sg.m > 1e-3 * sg.m0);
    }

    /** Cup-local velocity of a table-frame point moving at (vx, vy): relative to the turning cup. */
    _velToCup(x, y, vx, vy) {
      const T = this.cupTilt(), p = this.pivotWorld(), k = this._carried(x + p[0], y + p[1]);
      const rx = vx - k[0], ry = vy - k[1];
      return [rx * T.cos + ry * T.sin, -rx * T.sin + ry * T.cos];
    }
    /** Table-frame velocity of a cup-local point (u, v) moving at (vu, vv) in the cup. */
    _velToTable(u, v, vu, vv) {
      const T = this.cupTilt(), w = T.rot(u, v), q = T.rot(vu, vv), k = this._carried(w[0], w[1]);
      return [q[0] + k[0], q[1] + k[1]];
    }

    // ---------------------------------------------------------------------
    // Heterogeneous nucleation on every wetted surface
    // ---------------------------------------------------------------------
    _stepNucleation(dt, fl) {
      const L = this.liquid, g = this.geom, p = this.params;
      const patches = this.patches = {};
      this.stats.emissionRate = 0;
      if (L.V < 1e-8 || g.level < 5e-4) return 0;

      const hw = this.D / 2, level = g.level;
      const rinse = p.rinsed ? 0.3 : 1;
      const cupSurf = rinse === 1 ? this.mat
        : Object.assign({}, this.mat, { sitesPerM2: this.mat.sitesPerM2 * rinse });
      const u = this.flow.uWall;
      let mol = 0;

      // --- cup wall (side) and floor
      // floor area not covered by cubes resting on it
      let resting = 0;
      for (const c of g.cubes) if (c.below && c.v - c.a / 2 < 1e-3) resting += c.a * c.a;
      const floorArea = Math.max(0.1 * this.A, this.A - resting);
      // the wall in contact with a meltwater layer (no CO2 to speak of) stays quiet
      const zB = Math.min(level, g.waterZ);
      mol += this._emit('wall', cupSurf, Math.PI * this.D * zB, zB / 2, u, () => {
        const side = Math.random() < 0.5 ? -1 : 1;
        return [side * hw * 0.995, Math.random() * zB];
      });
      mol += this._emit('floor', cupSurf, floorArea, level, u, () => [(Math.random() - 0.5) * 2 * hw * 0.98, 0]);

      // --- wetting front: dry rough surfaces trap air as they are first wetted
      if (!p.rinsed) {
        if (!this.wet.bottom) { this.wet.bottom = true; mol += this._entrap(this.mat, floorArea, () => [(Math.random() - 0.5) * 2 * hw, 0]); }
        if (level > this.wet.wall) {
          const z0 = this.wet.wall;
          mol += this._entrap(this.mat, Math.PI * this.D * (level - z0), () => {
            const side = Math.random() < 0.5 ? -1 : 1;
            return [side * hw * 0.99, z0 + Math.random() * (level - z0)];
          });
          this.wet.wall = level;
        }
      }

      // --- ice: submerged faces, plus the running film on faces above the soda
      if (g.cubes.length) {
        const placeIce = () => this._placeOnIce();
        const iceDepth = Math.max(0, level - Math.max(g.iceBottom, 0)) / 2;
        mol += this._emit('ice', Props.SURFACES.ice, g.iceWetBulk, iceDepth, u, placeIce);
        mol += this._emit('iceFilm', Props.SURFACES.ice, this.pour.filmArea, 0, 0.1, null);
        const wetNow = g.iceWet + this.pour.filmArea;
        if (wetNow > this.wet.ice) {
          const frost = U.smoothstep(-1, -8, this.ice.T - C.T0);   // only cold ice is frosty (mass-weighted mean)
          const add = (wetNow - this.wet.ice) * (0.3 + 0.7 * frost);
          mol += this._entrap(Props.SURFACES.ice, add, this.pour.filmArea > g.iceWet * 0.5 ? null : placeIce);
          this.wet.ice = wetNow;
        }
      }

      // --- the spoon: a moving steel surface (sites shed at the stroke speed),
      //     dry on its first dip, and every stroke opens an air cavity at the
      //     surface whose collapse leaves bubbles behind:
      //         Q_air ≈ entrain · width · speed · wake
      const A = this.additives;
      if (A.stirring) {
        const sx = this.spoonX();
        const placeSpoon = () => [sx + (Math.random() - 0.5) * SPOON.width, Math.random() * level];
        const spoonArea = 2 * SPOON.width * level + SPOON.bowl;
        if (!A.spoonWet) { A.spoonWet = true; mol += this._entrap(Props.SURFACES.steel, spoonArea, placeSpoon); }
        mol += this._emit('spoon', Props.SURFACES.steel, spoonArea, level / 2, SPOON.speed, placeSpoon);
        const dVair = SPOON.entrain * SPOON.width * SPOON.speed * SPOON.wake * this._dt;
        const Rmax = Jet.hinzeMaxRadius(STIR_EPS, fl), RT = C.R * fl.T;
        this.stats.entrainedV += dVair;
        const Rk = U.logUniform(0.2 * Rmax, Rmax);
        const y = level - Math.random() * Math.min(0.02, level * 0.8);
        const Pin = this.Pamb + fl.rho * C.G * (level - y) + 2 * fl.sigma / Rk;
        this.bubbles.spawn(sx, y, Rk, Pin, RT, 1, dVair / U.sphereVolume(Rk));
      }

      // --- Mentos and salt
      A.mentos.forEach((m, k) => {
        if (m.where !== 'cup' || !m.sub) return;
        const area = MENTOS.area * Math.exp(-m.age / MENTOS.tau);
        const place = () => [m.x + (Math.random() - 0.5) * 0.019, m.y + (Math.random() - 0.5) * 0.008];
        if (!m.wet) { m.wet = true; mol += this._entrap(Props.SURFACES.mentos, area, place); }
        mol += this._emit('mentos' + k, Props.SURFACES.mentos, area, level - m.y, u, place, 'mentos');
      });
      let saltArea = 0, saltDepth = 0;
      for (const s of A.salt) {
        if (s.where !== 'cup' || !s.sub) continue;
        const area = s.area * Math.pow(s.m / s.m0, 2 / 3);           // a dissolving grain shrinks
        if (!s.wet) { s.wet = true; mol += this._entrap(Props.SURFACES.salt, area, () => [s.x, s.y]); }
        saltArea += area; saltDepth += area * (level - s.y);
      }
      if (saltArea > 0) {
        const grains = A.salt.filter(s => s.where === 'cup' && s.sub);
        mol += this._emit('salt', Props.SURFACES.salt, saltArea, saltDepth / saltArea, u, () => {
          const s = grains[(Math.random() * grains.length) | 0];
          return [s.x, s.y];
        });
      }
      return mol;
    }

    /** A random point on the wetted faces of a random submerged cube. */
    _placeOnIce() {
      const g = this.geom, level = g.level;
      const wet = g.cubes.filter(c => c.sub > 0 && c.layer < 1);
      if (!wet.length) return [(Math.random() - 0.5) * this.D / 2, level * Math.random()];
      const c = wet[(Math.random() * wet.length) | 0];
      const bottom = c.v - c.a / 2, top = Math.min(c.v + c.a / 2, g.waterZ);
      return Math.random() < 0.75 || c.below
        ? [c.u + (Math.random() < 0.5 ? -1 : 1) * (c.a / 2 + 1e-4), bottom + Math.random() * Math.max(0, top - bottom)]
        : [c.u + (Math.random() - 0.5) * c.a, bottom - 1e-4];
    }

    /**
     * Emit bubbles from one surface patch. place() → [x, y] inside the liquid,
     * or null meaning "on a film at the surface" (bubbles go straight to foam).
     * Returns mol CO2 removed from solution.
     */
    _emit(key, surf, area, depth, u, place, group) {
      if (area <= 0) return 0;
      const fl = this.fluid, L = this.liquid, c = this.concentration;
      const PL = this.Pamb + fl.rho * C.G * depth;
      const ev = Nuc.evaluate(surf, { c, kH: fl.kH, PL, fl, u });
      const rate = ev.rate * area;
      const gk = group || key;
      const prev = this.patches[gk];
      if (prev) {
        prev.area += area; prev.rate += rate; prev.sites += ev.density * area;
      } else {
        this.patches[gk] = { name: PATCH_NAMES[gk] || surf.name, area, rate, sites: ev.density * area, Rstar: ev.Rstar, Rd: ev.Rd, freq: ev.freq };
      }
      this.stats.emissionRate += rate;
      if (rate <= 0) return 0;

      const dt = this._dt;
      let acc = (this.acc[key] || 0) + rate * dt;
      let nReal = Math.floor(acc);
      this.acc[key] = acc - nReal;
      if (nReal <= 0) return 0;

      const R = ev.Rd, RT = C.R * fl.T;
      const Pin = PL + 2 * fl.sigma * surf.sigmaFactor / R;
      const molEach = Pin * U.sphereVolume(R) / RT;
      if (nReal * molEach > 0.3 * L.n) nReal = Math.floor(0.3 * L.n / molEach);
      if (nReal <= 0) return 0;
      return this._spawnGroup(nReal, R, 0, place, molEach);
    }

    /** Air trapped in the roughness of a surface that has just been wetted. */
    _entrap(surf, newArea, place) {
      if (newArea <= 0 || surf.entrapDepth <= 0) return 0;
      const V = newArea * surf.entrapDepth;
      const R = Math.max(5e-6, Nuc.PINCH_RATIO * surf.cavityRadius);
      const nReal = V / U.sphereVolume(R);
      this.stats.entrainedV += V;
      return this._spawnGroup(nReal, R, 1, place, 0);
    }

    /** Spawn nReal real bubbles as a handful of weighted particles. Returns mol CO2 taken from the liquid. */
    _spawnGroup(nReal, R, airFraction, place, molEach) {
      const fl = this.fluid, L = this.liquid, RT = C.R * fl.T;
      const level = this.geom.level;
      const budget = Math.floor(this.bubbles.free() / 40);
      const V = U.sphereVolume(R);
      const co2Each = molEach || 0;
      if (!place || budget < 1) {
        // on a surface film (or no particle budget left): gas goes directly to the foam
        const molCO2 = Math.min(nReal * co2Each, L.n);
        L.n -= molCO2;
        this._toFoam(nReal * V, nReal);
        return molCO2;
      }
      const m = Math.max(1, Math.min(Math.ceil(nReal), budget, 10));
      const w = nReal / m;
      let mol = 0;
      for (let k = 0; k < m; k++) {
        const [x, y0] = place();
        const y = Math.min(Math.max(y0, R), level - 1e-5);
        const Pin = this.Pamb + fl.rho * C.G * Math.max(0, level - y) + 2 * fl.sigma / R;
        const got = this.bubbles.spawn(x, y, R, Pin, RT, airFraction, w);
        if (got > 0) mol += got;
      }
      L.n = Math.max(0, L.n - mol);
      return mol;
    }

    // ---------------------------------------------------------------------
    // Heat: soda ↔ wall ↔ room, soda ↔ ice, soda ↔ air, and fizz cooling
    // ---------------------------------------------------------------------
    _stepHeat(dt, fl, desorbRate) {
      const L = this.liquid, W = this.wall, g = this.geom, p = this.params, m = this.mat;
      const Tamb = p.roomTemp + C.T0;
      const Vliq = L.V + this.foam.liquidVolume;
      const Cl = Vliq * fl.rho * fl.cp;
      const hIn = HEAT.hWall + 3000 * this.flow.uWall;
      // series resistances: convective film + half the wall thickness by conduction
      const Uin = 1 / (1 / hIn + m.wall / (2 * m.k));
      const Uout = 1 / (1 / HEAT.hAir + m.wall / (2 * m.k));
      const Wl = this.water;
      const zB = Wl.V > 0 ? g.waterZ : g.level;                   // the wall touching drink vs layer
      const Awet = L.V > 1e-9 ? Math.PI * this.D * zB + this.A : 0;
      const AwetW = Wl.V > 0 ? Math.PI * this.D * (g.level - zB) : 0;
      const Aout = Math.PI * this.D * this.H + this.A;

      // relaxation form: unconditionally stable for small liquid volumes
      const relax = (UA, Cself) => 1 - Math.exp(-UA * dt / Math.max(Cself, 1e-9));

      if (Cl > 1e-6) {
        // wall ↔ liquid (exchange computed once, applied to both with energy conservation)
        const UA = Uin * Awet;
        const Ceff = (Cl * W.heatCapacity) / (Cl + W.heatCapacity);
        const q = (W.T - L.T) * (1 - Math.exp(-UA * dt / Ceff)) * Ceff;   // J moved into liquid
        L.T += q / Cl; W.T -= q / W.heatCapacity;

        // room air on the free surface (the layer's, if there is one)
        if (Wl.V <= 0) L.T += (Tamb - L.T) * relax(HEAT.hAir * g.freeArea, Cl);
      }
      const flW = Wl.V > 0 ? this._layerFluid() : null;
      const Cw = Wl.V > 0 ? Wl.V * flW.rho * flW.cp : 0;
      if (Cw > 1e-9) {
        const UA = Uin * AwetW, Ceff = (Cw * W.heatCapacity) / (Cw + W.heatCapacity);
        const q = (W.T - Wl.T) * (1 - Math.exp(-UA * dt / Ceff)) * Ceff;
        Wl.T += q / Cw; W.T -= q / W.heatCapacity;
        Wl.T += (Tamb - Wl.T) * relax(HEAT.hAir * g.freeArea, Cw);
      }
      W.T += (Tamb - W.T) * relax(Uout * Aout, W.heatCapacity);

      // Ice, cube by cube. Each exchanges heat with the soda through its wetted
      // faces (h from Ice.meltCoefficient) and with the room through its dry ones.
      // Ice touching a solution melts at the solution's freezing point T_m (sugar,
      // salt and ethanol all lower it; 0 °C for pure water, e.g. on the table).
      // The heat first brings the cube to T_m; whatever is left melts it (Stefan):
      //     m_melt = q_left / L_f
      // and a cube WARMER than T_m (0 °C ice dropped into salty soda) melts using
      // its own sensible heat as it cools to T_m — why salt melts ice.
      //
      // Faces in the floating meltwater layer touch fresh, cold water instead: they
      // melt at the layer's own freezing point (≈ 0 °C) with only the layer's small
      // ΔT to drive them — why a floating cube melts slower in salty or sugary water.
      const I = this.ice;
      const Tm = this.freezingPoint();
      const TmW = Wl.V > 0 ? Ice.freezingPoint(this.bev, Wl.s, this.layerSaltMolal) : C.T0;
      const uLayer = this._layerMixSpeed();
      let hWetSum = 0, wetSum = 0, meltNow = 0;
      for (const c of I.cubes) {
        const Ci = c.m * C.CP_ICE;
        const fc = I.faces(c);
        const fL = c.where === 'cup' && Wl.V > 0 ? (c.layer || 0) : 0;
        const Tmelt = c.where === 'cup' && c.sub > 0 ? fL * TmW + (1 - fL) * Tm : C.T0;
        let q = 0;
        if (c.where === 'cup' && Cl > 1e-6 && fc.wet * (1 - fL) > 0) {
          const A = fc.wet * (1 - fL);
          const h = Ice.meltCoefficient(fl, c.a, L.T, this.flow.uWall);
          const Ts = Math.min(c.T, Tm);                           // the surface is at most T_m
          const Ceff = c.T < C.T0 ? (Cl * Ci) / (Cl + Ci) : Cl;
          const qL = (L.T - Ts) * (1 - Math.exp(-h * A * dt / Ceff)) * Ceff;
          L.T -= qL / Cl;
          q += qL;
          hWetSum += h * A; wetSum += A;
        }
        if (c.where === 'cup' && Cw > 1e-9 && fc.wet * fL > 0) {
          const A = fc.wet * fL;
          const h = Ice.meltCoefficient(flW, c.a, Wl.T, uLayer);
          const Ts = Math.min(c.T, TmW);
          const Ceff = c.T < C.T0 ? (Cw * Ci) / (Cw + Ci) : Cw;
          const qW = (Wl.T - Ts) * (1 - Math.exp(-h * A * dt / Ceff)) * Ceff;
          Wl.T -= qW / Cw;
          q += qW;
          hWetSum += h * A; wetSum += A;
        }
        q += HEAT.hAir * fc.dry * (Tamb - c.T) * dt;
        if (c.T > Tmelt) { q += (c.T - Tmelt) * Ci; c.T = Tmelt; } // warmer than T_m: that heat melts it
        if (c.T < Tmelt) {                                        // 1) sensible heat up to T_m
          const need = (Tmelt - c.T) * Ci;
          if (q < need) { c.T += q / Ci; q = 0; } else { c.T = Tmelt; q -= need; }
        }
        if (q > 0) {                                              // 2) the rest melts it
          const dm = Math.min(c.m, q / C.L_FUSION);
          c.m -= dm; I.melted += dm; meltNow += dm;
          if (c.where === 'cup') this._meltIntoCup(dm, Tmelt);
          else {
            I.tableMelt += dm;                                    // into a puddle round the cube
            if (c.where === 'table') {
              const lanes = I.laneDefs.length ? I.laneDefs : [{ z: 0 }];
              this.table.deposit(c.x, lanes[Math.min(c.lane, lanes.length - 1)].z, dm / Props.rhoWater(C.T0), 0);
            }
          }
        }
      }
      I.prune();
      this.iceH = wetSum > 0 ? hWetSum / wetSum : 0;
      // smoothed melt rate [kg/s] for the readouts
      this.meltRate = (this.meltRate || 0) + (meltNow / dt - (this.meltRate || 0)) * Math.min(1, dt / 5);

      // Fizz cooling: releasing CO2 absorbs its heat of solution (~20 kJ/mol).
      // Applied after the ice so that, in a near-empty cup, any chill past the
      // freezing point is handled below (it freezes liquid instead).
      const Cnow = (L.V + this.foam.liquidVolume) * fl.rho * fl.cp;
      if (Cnow > 1e-6) L.T -= Props.desorptionEnthalpy(L.T) * Math.max(0, desorbRate) * dt / Cnow;

      // Soda chilled below its freezing point by very cold ice freezes ONTO the
      // ice; the latent heat released holds the soda at its freezing point.
      const Tf = this.freezingPoint();
      if (Cnow > 1e-6 && L.T < Tf) {
        const deficit = (Tf - L.T) * Cnow;                        // J
        const wet = I.cubes.filter(c => c.where === 'cup' && c.sub > 0);
        const wetArea = wet.reduce((s, c) => s + I.faces(c).wet, 0);
        if (wetArea > 0) {
          const dmF = Math.min(deficit / C.L_FUSION, 0.5 * L.V * fl.rho);
          for (const c of wet) {
            const share = dmF * I.faces(c).wet / wetArea;
            c.T = (c.T * c.m + Tf * share) / (c.m + share);     // new ice joins at the freezing point
            c.m += share;
          }
          I.frozen += dmF;
          const dV = dmF / Props.rhoWater(C.T0);
          L.s = Math.min(1, L.s * L.V / Math.max(L.V - dV, 1e-12));   // water leaves, solutes stay
          L.V -= dV;
        }
        L.T = Tf;
      }
      // the same for the meltwater layer: chilled below its own freezing point (by
      // colder meltwater from salty ice), it freezes back onto the cubes it touches
      if (Wl.V > 0) {
        const flW2 = this._layerFluid(), CwN = Wl.V * flW2.rho * flW2.cp;
        const TfW = Ice.freezingPoint(this.bev, Wl.s, this.layerSaltMolal);
        if (Wl.T < TfW) {
          const wet = I.cubes.filter(c => c.where === 'cup' && c.sub > 0);
          const deficit = (TfW - Wl.T) * CwN;
          const dmF = Math.min(deficit / C.L_FUSION, 0.5 * Wl.V * flW2.rho);
          if (wet.length && dmF > 0) {
            const wsum = wet.reduce((t, c) => t + I.faces(c).wet, 0);
            for (const c of wet) {
              const share = dmF * I.faces(c).wet / Math.max(wsum, 1e-12);
              c.T = (c.T * c.m + TfW * share) / (c.m + share);
              c.m += share;
            }
            I.frozen += dmF;
            Wl.V -= dmF / Props.rhoWater(C.T0);
            if (Wl.V < 0) Wl.V = 0;
          }
          Wl.T = TfW;
        }
      }
      if (L.V <= 1e-9 && this.foam.liquidVolume <= 1e-9) L.T = p.sodaTemp + C.T0;
    }

    /** Meltwater joins the soda at the melting temperature: no CO2, no sugar or salt (dilution), and frees the ice's trapped air. */
    _meltIntoCup(dm, Tmelt = C.T0) {
      const L = this.liquid, g = this.geom, fl = this.fluid;
      if (L.V > 1e-7 && g.level > 2e-3) {
        const Vair = ICE_AIR_FRACTION * dm / C.RHO_ICE;
        this.iceAirAcc = (this.iceAirAcc || 0) + Vair / U.sphereVolume(ICE_BUBBLE_R);
        if (this.iceAirAcc >= 1) {
          this.stats.entrainedV += this.iceAirAcc * U.sphereVolume(ICE_BUBBLE_R);
          this._spawnGroup(this.iceAirAcc, ICE_BUBBLE_R, 1, () => this._placeOnIce(), 0);
          this.iceAirAcc = 0;
        }
      }
      const dV = dm / Props.rhoWater(C.T0);
      const Wl = this.water;
      // Fresh meltwater lighter than the drink (sugar, salt, CO2 make the drink
      // denser; water is densest at 4 °C) rises and floats on it as a layer.
      // Heavier meltwater (cold water in warm, plain water) sinks and mixes in.
      if (L.V > 1e-8 && Props.rhoWater(Tmelt) < fl.rho) {
        const Cw = Wl.V * Props.rhoWater(Wl.T) * C.CP_WATER;
        Wl.T = Wl.V > 0 ? (Wl.T * Cw + Tmelt * dm * C.CP_WATER) / (Cw + dm * C.CP_WATER) : Tmelt;
        Wl.s = Wl.V > 0 ? Wl.s * Wl.V / (Wl.V + dV) : 0;
        Wl.V += dV;
        return;
      }
      const Cl = (L.V + this.foam.liquidVolume) * fl.rho * fl.cp;
      L.T = Cl > 1e-6 ? (L.T * Cl + Tmelt * dm * C.CP_WATER) / (Cl + dm * C.CP_WATER) : Tmelt;
      L.s = L.V > 1e-9 ? L.s * L.V / (L.V + dV) : 0;
      L.V += dV;
    }

    /**
     * Speed of the TURBULENCE that stirs the meltwater layer [m/s]: the pour plume
     * and the spoon (flow.uWall above its still-glass baseline, which is laminar
     * convection and mixes nothing across a density step), the bubble swarm, and
     * bubbles surfacing through the layer — their buoyancy flux g·j_g stirs it at
     * u ~ (g·j_g·h)^{1/3} (bubble-induced turbulence scaling).
     */
    _layerMixSpeed() {
      const g = this.geom, A = Math.max(g.freeArea, 1e-6);
      const hw = Math.max(this.water.V / A, 1e-4);
      const jg = (this.surfacedRate || 0) / A;
      return Math.max(0, this.flow.uWall - STILL_FLOW) + this.bubbles.swarm + Math.cbrt(C.G * jg * hw) + 1e-6;
    }

    /**
     * The floating meltwater layer: eroded into the drink by turbulence below it
     * (entrainment, Turner), warmed by the drink across the interface, and fed
     * CO2 only by slow diffusion — it is a fresh, cold, flat lid on the soda.
     */
    _stepLayer(dt, fl) {
      const Wl = this.water, L = this.liquid, g = this.geom;
      if (Wl.V <= 0) return;
      const flW = this._layerFluid();
      if (L.V < 1e-8 || flW.rho >= fl.rho) { this._mixLayer(Wl.V, fl, flW); return; }   // nothing to float on
      const A = Math.max(g.freeArea, 1e-6);
      const hw = Wl.V / A;
      const u = this._layerMixSpeed();
      const gp = C.G * (fl.rho - flW.rho) / fl.rho;
      const Ri = gp * Math.max(hw, EDDY_L) / (u * u);
      const E = ENTRAIN_K / (Ri + ENTRAIN_K / ENTRAIN_0);
      this.layerRi = Ri;
      this._mixLayer(Math.min(Wl.V, E * u * A * dt), fl, flW);
      if (Wl.V <= 0) return;
      // heat across the interface: turbulent exchange ρc_p·u_e plus conduction through the layer
      const Cl = L.V * fl.rho * fl.cp, Cw = Wl.V * flW.rho * flW.cp;
      const hI = flW.rho * flW.cp * E * u + Ice.kWater(Wl.T) / Math.max(hw, 1e-3);
      const Ceff = Cl * Cw / (Cl + Cw);
      const q = (L.T - Wl.T) * (1 - Math.exp(-hI * A * dt / Ceff)) * Ceff;
      L.T -= q / Cl; Wl.T += q / Cw;
      // CO2 diffuses up into it (film model, δ ≈ the layer thickness)
      const kD = fl.D / Math.max(hw, 1e-3);
      const dn = U.clamp(kD * A * (this.concentration - Wl.n / Wl.V) * dt, -Wl.n, 0.5 * L.n);
      L.n -= dn; Wl.n += dn;
    }

    /** Stir dV of the layer into the drink (volume, heat, CO2, and what drink it holds). */
    _mixLayer(dV, fl, flW) {
      const Wl = this.water, L = this.liquid;
      if (!(dV > 0)) return;
      const f = Math.min(1, dV / Wl.V);
      const Cl = L.V * fl.rho * fl.cp, Cd = dV * flW.rho * flW.cp;
      L.T = Cl + Cd > 0 ? (L.T * Cl + Wl.T * Cd) / (Cl + Cd) : Wl.T;
      L.s = (L.s * L.V + Wl.s * dV) / Math.max(L.V + dV, 1e-15);
      L.n += Wl.n * f; Wl.n -= Wl.n * f;
      const ds = (Wl.salt || 0) * f; L.salt += ds; Wl.salt = (Wl.salt || 0) - ds;
      L.V += dV; Wl.V -= dV;
      if (Wl.V < 1e-12) { Wl.V = 0; Wl.n = 0; L.salt += Wl.salt || 0; Wl.salt = 0; }
    }

    // ---------------------------------------------------------------------
    // Overflow
    // ---------------------------------------------------------------------
    /**
     * Overflow, with surface tension at the rim (see capillary.js).
     *   Liquid pins to the rim's edge and bulges above it by up to
     *   h = 2·l_c·sin(α/2) before it spills. The bulge thins toward the edge
     *   over ~l_c, so its volume is the column A·h less a rim deficit of about
     *   (2 − √2)·l_c·h per unit length of rim (2-D meniscus profile).
     *   Foam is a soft solid: it stands as a dome above the rim until its weight
     *   beats the yield stress, h = τ_y/(ρ_f g). A dome (paraboloid) of height h
     *   holds the volume of a column h/2. Whatever stands higher than that does
     *   not vanish at once: it flows over the rim at a finite rate (a viscous
     *   weir, Capillary.foamOverflowRate), so a surging head rises above the rim
     *   until its outflow matches what the bubbles make, keeps bursting and
     *   draining back while it waits, and settles to about the rim afterwards.
     * Whatever exceeds these leaves over the LOWER rim and slides down the
     * outside of the glass (this.runs), at the speed set by capillary.js.
     */
    _stepSpill() {
      const L = this.liquid, fl = this.fluid;
      let g = this.computeGeometry();
      const rim = g.rimLevel;
      const lc = Capillary.capillaryLength(fl);
      const bulge = Capillary.rimOverfill(fl, this.mat.contactAngle) * (1 - (2 - Math.SQRT2) * lc * 4 / this.D);
      this.crown = { liquid: Math.max(0, g.level - rim), foam: 0, bulgeMax: bulge, domeMax: 0 };
      const Wl = this.water;
      if (g.level > rim + bulge && L.V + Wl.V > 0) {
        const over = g.level - rim - bulge;
        // What stands above the rim is the drink AND the bubbles mixed through it
        // (gas holdup α swells the column — hugely in an eruption). The mixture goes
        // over together: only its liquid share is drink lost; its bubbles go too.
        const exV = over * g.areaAt(rim);
        const alpha = this.bubbles.holdup / Math.max(this.bubbles.holdup + L.V + Wl.V, 1e-15);
        this.bubbles.removeTop(alpha * exV);
        const dV = Math.min(L.V + Wl.V, (1 - alpha) * exV);
        // the top goes first: the meltwater layer, then the drink
        const fromW = Math.min(Wl.V, dV), fromB = dV - fromW;
        const nW = Wl.V > 0 ? Wl.n * fromW / Wl.V : 0;
        if (Wl.V > 0) Wl.salt = (Wl.salt || 0) * (1 - fromW / Wl.V);
        Wl.n -= nW; Wl.V -= fromW;
        const c = this.concentration;
        L.salt -= L.salt * Math.min(1, fromB / Math.max(L.V, 1e-12));
        L.V -= fromB; L.n = Math.max(0, L.n - fromB * c);
        if (L.V < 1e-12) { L.V = 0; L.n = 0; L.salt = 0; }
        const mol = nW + fromB * c, sOut = dV > 0 ? (fromW * Wl.s + fromB * L.s) / dV : 1;
        this.stats.spilledV += dV; this.stats.spilledMol += mol;
        this._overflow(dV, mol, sOut, over);
        g = this.computeGeometry();
      }
      const base = Math.max(rim, g.level);
      if (g.foamTop > base) {
        // the foam that would stand above the rim: its own bubbles and wetness set its strength
        let vg = 0, vl = 0, rw = 0;
        this.foam.layers.forEach((Lr, i) => {
          if (this.foam.geometry[i].z1 > base) { vg += Lr.vg; vl += Lr.vl; rw += this.foam.geometry[i].R * Lr.vg; }
        });
        const phi = vl / Math.max(vg + vl, 1e-30), R = vg > 0 ? rw / vg : 3e-4;
        const dome = Capillary.foamStandHeight(fl.sigma, R, phi, fl.rho);
        this.crown.domeMax = dome;
        const allowed = base + 0.5 * dome;                         // paraboloid ≙ column of half its height
        let uEx = 0;
        if (g.foamTop > allowed) {
          const volBefore = this.saltVolume;
          // how much can flow over the rim this step, and how much is up there
          const tilted = Math.abs(g.tilt.theta) >= 0.01;
          const perim = (tilted ? 0.5 : 1) * Math.PI * this.D;
          const Qout = Capillary.foamOverflowRate(fl, { phi, R }, g.foamTop - allowed, perim);
          let above = 0;
          this.foam.layers.forEach((Lr, i) => {
            const G = this.foam.geometry[i];
            if (G.z1 > allowed) above += (Lr.vg + Lr.vl) * (G.z1 - Math.max(G.z0, allowed)) / Math.max(G.z1 - G.z0, 1e-12);
          });
          const r = this.foam.trimVolume(Math.min(above, Qout * this._dt));
          L.salt -= L.salt * Math.min(1, r.vl / Math.max(volBefore, 1e-12));   // the spilled foam's liquid takes its salt with it
          this.stats.spilledV += r.vl; this.stats.spilledMol += r.mol;
          this.stats.foamSpilledV += r.vg + r.vl;
          if (r.vg + r.vl > 0) {
            // how fast the head is being pushed out of the mouth
            uEx = (r.vg + r.vl) / this._dt / Math.max(g.areaAt(rim) * g.tilt.surfaceFactor(rim), 1e-6);
            this._foamOut(r, uEx, { phi, R }, dome);
            this.emit('spill', r.vg + r.vl);
          }
        }
        this.eject.u += (uEx - this.eject.u) * Math.min(1, this._dt / 0.15);
        this.crown.foam = Math.max(0, this.foam.top - base);   // the dome standing (or surging) above the rim
      }
      if (g.foamTop <= base) this.eject.u *= Math.exp(-this._dt / 0.15);
      this._stepRuns();
    }

    /**
     * The fizz you feel on your face. A bubble bursting at a bare liquid surface
     * shoots a jet that breaks into drops: the top one ~1/10 of the bubble's
     * radius (Blanchard 1963), leaving at a few m/s, faster for smaller bubbles
     * (Spiel 1997; Ghabache & Séon 2016: ~4–6 m/s for 0.3–0.5 mm bubbles; fitted
     * here as v ≈ 2.6·(R/1 mm)^−0.6 m/s, an estimate). Bubbles bursting on top of a
     * head shatter a thin film instead: slower, ~20 µm film drops (Lhuissier &
     * Villermaux 2012). Air drag stops either within a few centimetres — the
     * aerosol over a glass of champagne. Most fall back in; some land outside.
     */
    _spray(burstV, Rb, fl) {
      const g = this.geom, L = this.liquid;
      if (L.V < 1e-7) return;
      const nBurst = burstV / U.sphereVolume(Rb);
      const bare = g.foamHeight < 6 * Rb;
      const rd = bare ? 0.1 * Rb : 20e-6;
      const v0 = bare ? U.clamp(2.6 * Math.pow(Rb / 1e-3, -0.6), 0.5, 8) : 1.0;
      const nDrop = nBurst * (bare ? 1 : 0.5);
      const V = Math.min(nDrop * U.sphereVolume(rd), 1e-3 * L.V);
      const c = this.concentration, n = V * c;
      const parts = Math.min(6, Math.ceil(nDrop / 15));
      if (!(V > 0) || parts < 1) return;
      L.salt -= L.salt * Math.min(1, V / Math.max(this.saltVolume, 1e-12));
      L.V -= V; L.n = Math.max(0, L.n - n);
      this.stats.spilledV += V; this.stats.spilledMol += n;
      this.stats.sprayV = (this.stats.sprayV || 0) + V;
      const tilt = g.tilt, h = tilt.levelToWorld(Math.max(g.foamTop, g.level));
      const ch = tilt.chord(h) || [-this.D / 2, this.D / 2];
      const cd = Math.cos(g.delta || 0), sd = Math.sin(g.delta || 0);
      for (let k = 0; k < parts; k++) {
        const xe = ch[0] + Math.random() * (ch[1] - ch[0]);
        const halfZ = Math.sqrt(Math.max(0, (this.D / 2) ** 2 - xe * xe));
        const wx = xe * cd - h * sd, wy = xe * sd + h * cd;
        const p = this.worldToTable(wx, wy);
        const up = v0 * (0.6 + 0.4 * Math.random()), carried = this._carried(wx, wy);
        this.table.launch('liquid', V / parts, 0, n / parts, L.s, [p[0], p[1] + 1e-4, (Math.random() * 2 - 1) * halfZ],
          [carried[0] + (Math.random() - 0.5) * 0.3 * up, carried[1] + up, (Math.random() - 0.5) * 0.3 * up], 3e-4, { rd, spray: true });
      }
    }

    /**
     * Liquid going over the rim. It leaves with the rim's own velocity (the cup
     * turning about its corner), the slosh wave running up the wall, and the weir
     * outflow √(g·h). Slow liquid turns round the rim and runs down the outside
     * (the teapot effect, as at the bottle lip); fast liquid separates and flies.
     */
    _overflow(dV, mol, sOut, over) {
      const g = this.geom, cupT = g.cupTilt, R = this.D / 2;
      const levelSides = Math.abs(g.tilt.theta) < 0.01 ? [-1, 1] : [g.tilt.lowRimSide];
      for (const side of levelSides) {
        const v = dV / levelSides.length, n = mol / levelSides.length;
        const rim = cupT.rot(side * R, this.H);
        const carried = this._carried(rim[0], rim[1]);
        const axis = [-cupT.sin, cupT.cos], out = [side * cupT.cos, side * cupT.sin];
        const wave = Math.max(0, this.slosh.wallSpeed(side, R));
        const weir = Math.sqrt(C.G * Math.max(over, 0));
        const rel = [axis[0] * wave + out[0] * weir, axis[1] * wave + out[1] * weir];
        const uRel = Math.hypot(rel[0], rel[1]);
        const fly = 1 - StreamM.clingFraction(uRel, StreamM.separationSpeed(this.fluid, this.mat.contactAngle));
        const vFly = v * fly;
        if (vFly > 1e-10) {
          const p = this.worldToTable(rim[0] + out[0] * 1e-3, rim[1] + out[1] * 1e-3);
          const parts = Math.min(4, Math.ceil(vFly / 2e-7));
          for (let k = 0; k < parts; k++) {
            const jit = 0.85 + 0.3 * Math.random();
            this.table.launch('liquid', vFly / parts, 0, n * fly / parts, sOut, [p[0], p[1], (Math.random() - 0.5) * 1.2 * R],
              [carried[0] + rel[0] * jit, carried[1] + rel[1] * jit, (Math.random() - 0.5) * 0.3 * uRel]);
          }
          this.eject.liquidV += vFly;
          this.eject.uLiquid = Math.hypot(carried[0] + rel[0], carried[1] + rel[1]);
        }
        if (v - vFly > 0) this._run('liquid', v - vFly, null, side, sOut);
      }
    }

    /**
     * Foam pushed out of the mouth at speed u. Foam is a soft solid: it holds
     * together (and creeps down the outside) while its yield stress τ_y and its
     * capillary grip on the rim win; once the dynamic pressure ρ_f·u² beats them
     * it is flung off in clumps. Share thrown:
     *     ρ_f u² / (ρ_f u² + τ_y + ρ_f u_c²)
     * so a gentle overflow oozes, a Mentos eruption in warm soda sprays foam
     * out (u ≈ 0.5 m/s rises ~1–2 cm and lands around the glass). Clumps leave
     * along the cup's axis at ~u, spreading outward as the extruded dome does.
     */
    _foamOut(r, u, foam, dome) {
      const g = this.geom, cupT = g.cupTilt, R = this.D / 2, fl = this.fluid;
      const rhoF = fl.rho * U.clamp(foam.phi, 0.02, 0.5);
      const tau = Capillary.foamYieldStress(fl.sigma, foam.R, foam.phi);
      const uc = StreamM.separationSpeed(fl, this.mat.contactAngle);
      const dyn = rhoF * u * u;
      const fly = dyn / (dyn + tau + rhoF * uc * uc);
      const vol = r.vg + r.vl;
      const thrown = vol * fly;
      if (thrown > 1e-10) {
        const parts = Math.min(5, Math.max(1, Math.ceil(thrown / 1e-6)));
        const axis = [-cupT.sin, cupT.cos];
        for (let k = 0; k < parts; k++) {
          const rr = R * Math.sqrt(Math.random()), a = Math.random() * 2 * Math.PI;
          const lu = rr * Math.cos(a), lz = rr * Math.sin(a);
          const top = cupT.rot(lu, this.H + 0.5 * dome * (1 - (rr / R) ** 2));
          const p = this.worldToTable(top[0], top[1]);
          const carried = this._carried(top[0], top[1]);
          const up = u * (0.7 + 0.6 * Math.random()), outw = 0.5 * u * (rr / R);
          const ou = Math.cos(a) * outw;                          // outward, along the cup's u axis
          const vel = [carried[0] + axis[0] * up + cupT.cos * ou, carried[1] + axis[1] * up + cupT.sin * ou, Math.sin(a) * outw];
          const f = fly / parts;
          this.table.launch('foam', r.vl * f, r.vg * f, r.mol * f, r.s, [p[0], p[1], lz], vel, foam.R);
        }
        this.eject.foamV += thrown; this.eject.flungV = (this.eject.flungV || 0) + thrown;
      }
      // The rest goes over the rim. The outside of the glass can only carry it
      // away as a creeping Bingham film: a layer clings up to about 2τ_y/(ρ_f g)
      // thick (thicker, its weight tears it off the wall), sliding at
      // overflowSpeed. A head that rises faster than that film can drain it
      // breaks off the rim in clumps and falls to the table.
      const rest = vol - thrown;
      if (rest > 0) {
        const tilted = Math.abs(g.tilt.theta) >= 0.01;
        const delta = Math.max(2 * tau / (rhoF * C.G), 0.5e-3);
        const perim = (tilted ? 0.5 : 1) * Math.PI * this.D;
        const film = perim * delta * Capillary.overflowSpeed(fl, foam, delta) * this._dt;
        const brk = Math.max(0, rest - film), runV = rest - brk;
        const fB = brk / vol, fR = runV / vol;
        if (brk > 1e-10) {
          const parts = Math.min(4, Math.max(1, Math.ceil(brk / 1e-6)));
          const Ro = R + Math.max(this.mat.wall, 1.5e-3) + 2e-3;
          for (let k = 0; k < parts; k++) {
            // anywhere round the rim (upright), or along the low half (tilted)
            const a = tilted ? (g.tilt.lowRimSide < 0 ? Math.PI : 0) + (Math.random() - 0.5) * Math.PI : Math.random() * 2 * Math.PI;
            const lu = Ro * Math.cos(a), lz = Ro * Math.sin(a);
            const at = cupT.rot(lu, this.H);
            const p = this.worldToTable(at[0], at[1]);
            const carried = this._carried(at[0], at[1]);
            const outw = Math.max(0.5 * u, 0.02) * (0.6 + 0.8 * Math.random());   // the overflowing dome spreads outward
            const vel = [carried[0] + cupT.cos * Math.cos(a) * outw, carried[1] + cupT.sin * Math.cos(a) * outw, Math.sin(a) * outw];
            const f = fB / parts;
            this.table.launch('foam', r.vl * f, r.vg * f, r.mol * f, r.s, [p[0], p[1], lz], vel, foam.R);
          }
          this.eject.foamV += brk; this.eject.brokenV = (this.eject.brokenV || 0) + brk;
        }
        if (runV > 0) {
          const sides = tilted ? [g.tilt.lowRimSide] : [-1, 1];
          for (const side of sides) this._run('foam', runV / sides.length, foam, side, r.s, r.vl * fR / sides.length);
        }
      }
    }

    /**
     * Everything already off the glass: drops and foam in flight, and puddles.
     * What comes down inside the mouth falls back into the drink.
     */
    _stepTable(dt, fl) {
      const R = this.D / 2, H = this.H, wall = Math.max(this.mat.wall, 1.5e-3), base = -this.pivotLocal()[1];
      const back = this.table.step(dt, {
        fl, bev: this.bev, fragility: Foam.fragility,
        catchCup: (x, y, z) => { const [u, v] = this.tableToCup(x, y); return v < H && v > 0 && u * u + z * z < R * R; },
        hitsCup: (x, y, z) => {
          const [u, v] = this.tableToCup(x, y), r2 = u * u + z * z;
          return v < H && v > -base && r2 <= (R + wall) ** 2 && r2 >= R * R;
        },
      });
      const L = this.liquid;
      for (const d of back) {
        this.stats.spilledV -= d.V; this.stats.spilledMol -= d.n;
        if (d.kind === 'foam') {
          this.foam.addTop(d.vg, d.vg / U.sphereVolume(3e-4), d.V, d.V > 0 ? d.n / d.V : 0, this.geom.areaAt(this.geom.level), d.s);
        } else {
          L.s = (L.s * L.V + d.s * d.V) / Math.max(L.V + d.V, 1e-15);
          L.V += d.V; L.n += d.n;
        }
      }
    }

    /** Start (or feed) a run of spilled liquid or foam down the outside of the glass on `side`. */
    _run(kind, vol, foam, side, sod = 1, liquidV = null) {
      const v = vol;
      const liq = liquidV != null ? liquidV : kind === 'liquid' ? vol : 0;
      this.stats.spillBySide[side] = (this.stats.spillBySide[side] || 0) + v;
      const open = this.runs.find(r => r.kind === kind && r.side === side && r.s < 0.01);
      if (open) { open.vol += v; open.liq += liq; return; }
      this.runs.push({ kind, side, vol: v, liq, s: 0, foam, sod, slot: Math.random() });
    }

    /** Runs slide down the outer wall (foam: Bingham film; liquid: Nusselt film) and end on the table. */
    _stepRuns() {
      const dt = this._dt, fl = this.fluid, wallH = this.H + 0.004;
      for (const r of this.runs) {
        // a run is a lobe ~2 cm wide; its thickness follows from its volume
        r.delta = U.clamp(r.vol / (0.02 * 0.02), 0.3e-3, 8e-3);
        r.u = Math.min(0.5, Capillary.overflowSpeed(fl, r.kind === 'foam' ? r.foam : null, r.delta));
        r.s += r.u * dt;
        if (r.kind === 'foam') r.vol *= Math.exp(-dt / 20);       // the outside foam also slowly collapses
      }
      // runs that reach the foot of the glass pool on the table there
      const cupT = this.geom.cupTilt, R = this.D / 2, wall = Math.max(this.mat.wall, 1.5e-3);
      for (const r of this.runs) {
        if (r.s < wallH) continue;
        const w = cupT.rot(r.side * (R + wall + 1e-3), this.pivotLocal()[1]);
        const [x] = this.worldToTable(w[0], w[1]);
        if (r.kind === 'foam') this.table.depositFoam(x, 0, Math.max(0, r.vol - r.liq), r.liq, r.foam ? r.foam.R : 3e-4, r.sod);
        else this.table.deposit(x, 0, r.liq, r.sod);
      }
      this.runs = this.runs.filter(r => r.s < wallH && r.vol > 1e-9);
    }

    // ---------------------------------------------------------------------
    // History & diagnostics
    // ---------------------------------------------------------------------
    _record(dt) {
      this._histT += dt;
      if (this._histT < 0.1) return;
      this._histT = 0;
      const g = this.geom;
      this.history.push({
        t: this.time, level: g.level, foamTop: g.foamTop,
        c: this.concentration * C.M_CO2, rate: this.stats.emissionRate, T: this.liquid.T - C.T0,
        ceq: this.fluid.kH * this.Pamb * C.M_CO2, Tf: this.freezingPoint() - C.T0, Tw: this.wall.T - C.T0,
        Tice: this.ice.count ? this.ice.T - C.T0 : NaN, has: this.cupVolume > 1e-7,
      });
      if (this.history.length > 3000) this.history.splice(0, this.history.length - 3000);
    }

    diagnostics() {
      const fl = this.fluid, g = this.geom, L = this.liquid, Pamb = this.Pamb, st = this.stats;
      const c = this.concentration;
      const ceq = fl.kH * Pamb;
      const PLmid = Pamb + fl.rho * C.G * g.level / 2;
      const dP = c / fl.kH - PLmid;
      const fs = this.foam.stats();
      const P = this.pour;

      // CO2 that has left solution = everything poured − what is still dissolved − what spilled dissolved
      const dissolved = L.n + this.foam.co2Moles;
      const released = Math.max(0, st.co2In - dissolved - st.spilledMol);

      // Two different endings, extrapolated from the recent slope of dissolved CO2:
      //   bubbling stops — S falls to S_STOP: R* outgrows nearly every cavity, so
      //                    nothing nucleates any more (it *looks* flat)
      //   taste-flat     — c < FLAT_VOLUMES. Near saturation only slow diffusion
      //                    through the free surface removes CO2, so this takes far longer.
      let tFlat = NaN, tStop = NaN;
      const h = this.history;
      if (h.length > 30 && L.V > 1e-7) {
        const a = h[h.length - 30], b = h[h.length - 1];
        const slope = (b.c - a.c) / (b.t - a.t);                  // g/L per s
        const eta = (target) => (b.c <= target ? 0 : slope < -1e-6 ? (b.c - target) / -slope : NaN);
        tFlat = eta(FLAT_VOLUMES * C.MOL_PER_VOLUME * C.M_CO2);
        tStop = eta(ceq * (1 + S_STOP) * C.M_CO2);
      }

      const contact = {
        wall: L.V > 1e-9 ? Math.PI * this.D * g.level : 0,
        floor: L.V > 1e-9 ? this.A : 0,
        ice: g.iceWet,
        iceFilm: P.filmArea,
        additives: 0,
      };
      for (const k in this.patches) if (k === 'mentos' || k === 'salt' || k === 'spoon') contact.additives += this.patches[k].area;
      contact.total = contact.wall + contact.floor + contact.ice + contact.iceFilm + contact.additives;

      return {
        time: this.time,
        cGL: c * C.M_CO2, cVol: c / C.MOL_PER_VOLUME, ceqGL: ceq * C.M_CO2,
        S: c / ceq - 1,
        kH: fl.kH * C.P_ATM / 1000,                       // mol/(L·atm)
        Rstar: dP > 0 ? 2 * fl.sigma / dP : Infinity,
        logJ: Nuc.homogeneousLog10Rate(fl.sigma, dP, fl.T),
        sigma: fl.sigma, mu: fl.mu, D: fl.D, rho: fl.rho, Sc: fl.Sc,
        Tliq: L.T - C.T0, Twall: this.wall.T - C.T0, Troom: this.params.roomTemp,
        iceMass: this.ice.mass, iceT: this.ice.T - C.T0, iceMelted: this.ice.melted, iceFrozen: this.ice.frozen,
        iceFloating: g.floating, iceThrown: this.stats.iceThrown || 0, iceCount: this.ice.count, iceOnTable: this.ice.cubes.length - this.ice.count,
        iceCapacity: Ice.capacity(this.D, this.H, this.params.iceSize / 100), iceH: this.iceH || 0,
        strength: this.liquid.s, freezingPoint: this.freezingPoint() - C.T0,
        saltGrams: this.liquid.salt * SALT.molar * 1000, saltMolal: this.saltMolal,
        saltUndissolved: this.additives.salt.reduce((t, q) => t + q.m, 0) * 1000, saltSat: this._saltSat(this.liquid.T),
        layerSaltGrams: (this.water.salt || 0) * SALT.molar * 1000, bodiesThrown: this.stats.bodiesThrown || 0, meltRate: this.meltRate || 0,
        layerV: this.water.V, layerT: this.water.T - C.T0, layerH: this.water.V / Math.max(g.freeArea, 1e-6), layerRi: this.layerRi || 0,
        tiltNow: this.tiltDeg, sloshDeg: this.slosh.delta * 180 / Math.PI, sloshHz: this.slosh.omega1 / (2 * Math.PI), sloshZeta: this.slosh.zeta,
        eruption: this.eject.u, thrownFoam: this.eject.foamV, thrownLiquid: this.eject.liquidV,
        floorV: this.table.floorV, sprayV: st.sprayV || 0, flying: this.table.flyingV, puddles: this.table.puddles.length, puddleV: this.table.puddles.reduce((t, q) => t + q.V, 0),
        piles: this.table.piles.length, pileV: this.table.pileFoamV, pileH: this.table.piles.reduce((t, q) => Math.max(t, q.h), 0),
        flungFoam: this.eject.flungV || 0, brokenFoam: this.eject.brokenV || 0,
        inStream: this.stream.flyingV, streamMissed: st.streamMissed || 0,
        volume: L.V + this.water.V, level: g.level, foamH: g.foamHeight, foamTop: g.foamTop, rim: g.rimLevel,
        foamPhi: fs.phi, foamR: fs.R, foamPc: fs.pcTop, foamGas: fs.vg, foamLayers: this.foam.layers.length,
        bubbles: this.bubbles.realCount, particles: this.bubbles.count, holdup: this.bubbles.holdup,
        rise: this.bubbles.meanRise,
        emission: st.emissionRate, patches: this.patches, contact,
        jet: P.jet, jetEps: P.eps, jetRmax: P.Rmax, hitIce: P.hitIce,
        bottle: { angle: this.bottle.phi, Q: P.Q, regime: this.bottle.regime, left: this.bottle.V,
                  head: this.bottle.head, suction: this.bottle.deficit, glugLimit: this.bottle.glugLimit(),
                  name: this.bottle.type.name },
        poured: P.poured, released: released * C.M_CO2 * 1000, burstV: st.burstV,   // grams
        spilled: st.spilledV, foamSpilled: st.foamSpilledV, entrained: st.entrainedV,
        tFlat, tStop, pouring: P.active,
      };
    }
  }

  Simulation.DEFAULTS = DEFAULTS;
  Simulation.HEAT = HEAT;
  Simulation.BOTTLE_PARK = BOTTLE_PARK;
  Simulation.FLAT_VOLUMES = FLAT_VOLUMES;
  Fizz.Simulation = Simulation;
})(window.Fizz = window.Fizz || {});
