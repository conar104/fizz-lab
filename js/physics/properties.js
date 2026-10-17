/* Fizz Lab — material & fluid property models.
 *
 *   fluid(beverage, T)  → every temperature-dependent property the solver needs
 *   BEVERAGES           → what is in the bottle
 *   SURFACES            → everything the soda can touch (cups, ice, Mentos, salt)
 */
(function (Fizz) {
  'use strict';
  const { C } = Fizz;

  // -------------------------------------------------------------------------
  // Pure-water correlations
  // -------------------------------------------------------------------------

  /**
   * Dynamic viscosity [Pa·s] — the two fits given in the CRC Handbook
   * (agree with IAPWS 2008 to ±0.3 % over 0–100 °C):
   *   0–20 °C   (Bingham):  log10 μ[cP] = 1301 / (998.333 + 8.1855(t−20) + 0.00585(t−20)²) − 1.30223
   *   20–100 °C (Kestin):   log10(μ/μ20) = [1.3272(20−t) − 0.001053(t−20)²] / (t + 105),  μ20 = 1.002 cP
   */
  function muWater(T) {
    const t = T - C.T0, dt = t - 20;
    const cP = t < 20
      ? Math.pow(10, 1301 / (998.333 + 8.1855 * dt + 0.00585 * dt * dt) - 1.30223)
      : 1.002 * Math.pow(10, (1.3272 * -dt - 0.001053 * dt * dt) / (t + 105));
    return cP * 1e-3;
  }

  /** Density [kg/m³] — Thiesen–Scheel–Diesselhorst; captures the 4 °C maximum. */
  function rhoWater(T) {
    const t = T - C.T0;
    return 1000 * (1 - ((t + 288.9414) / (508929.2 * (t + 68.12963))) * (t - 3.9863) ** 2);
  }

  /** Surface tension against air [N/m] — IAPWS 1994 release. */
  function sigmaWater(T) {
    const tau = 1 - T / 647.096;
    return 0.2358 * Math.pow(tau, 1.256) * (1 - 0.625 * tau);
  }

  /**
   * Henry's-law solubility of CO2 [mol/(m³·Pa)]:  c_eq = kH · p_CO2.
   * Weiss (1974), Marine Chemistry 2:203, fresh water (S = 0):
   *     ln K0 = −58.0931 + 90.5069·(100/T) + 22.2940·ln(T/100)   [mol/(kg·atm)]
   * the standard reference fit to the measured data (±0.2 % over −1…40 °C).
   * Cold soda holds far more gas: K0(4 °C) ≈ 1.95 × K0(25 °C).
   * `saltingOut` is the Sechenov factor for dissolved sugar (< 1).
   */
  const WEISS = { A1: -58.0931, A2: 90.5069, A3: 22.2940 };
  function henry(T, saltingOut = 1) {
    const K0 = Math.exp(WEISS.A1 + WEISS.A2 * (100 / T) + WEISS.A3 * Math.log(T / 100));
    return K0 * rhoWater(T) / C.P_ATM * saltingOut;
  }

  /**
   * Heat of CO2 leaving solution [J/mol], from the same fit (van 't Hoff):
   *     ΔH = R · d ln K0 / d(1/T)·(−1) = R·(100·A2 − A3·T)   ≈ 20 kJ/mol at 25 °C
   */
  function desorptionEnthalpy(T) { return C.R * (100 * WEISS.A2 - WEISS.A3 * T); }

  /**
   * Diffusivity of CO2 in water [m²/s] — Versteeg & van Swaaij (1988),
   * J. Chem. Eng. Data 33:29:   D = 2.35·10⁻⁶ · exp(−2119 / T)
   * In sugar solutions the modified Stokes–Einstein relation D·μ^0.8 = const
   * (same paper) accounts for the thicker syrup.
   */
  function diffusivity(T, viscosityRatio) {
    return 2.35e-6 * Math.exp(-2119 / T) * Math.pow(viscosityRatio, -0.8);
  }

  /** Every property at temperature T, bundled once per step so hot loops never recompute. */
  function fluid(bev, T) {
    const mu = muWater(T) * bev.viscosityRatio;
    const rho = rhoWater(T) + bev.densityExcess;
    const sigma = sigmaWater(T) * bev.surfaceTensionRatio;
    const D = diffusivity(T, bev.viscosityRatio);
    const kH = henry(T, bev.solubilityRatio);
    return {
      T, mu, rho, sigma, D, kH,
      nu: mu / rho,
      Sc: mu / (rho * D),                 // Schmidt number (momentum vs. mass diffusion)
      cp: bev.heatCapacity,
      heCC: kH * C.R * T,                 // dimensionless Henry constant c_liquid / c_gas
    };
  }

  // -------------------------------------------------------------------------
  // Beverages
  //
  // Each drink is built from two ingredients:
  //   1. its measured sugar content (°Brix), from which the bulk properties of a
  //      sucrose solution follow — viscosity, density, heat capacity and the
  //      Sechenov salting-out of CO2;
  //   2. its foam chemistry class (what surfactants it contains), which sets
  //      surface tension, interface mobility and film stability.
  // Carbonation is the drink's typical fill level in volumes of CO2, with sources.
  //
  //   viscosityRatio, densityExcess, surfaceTensionRatio   bulk liquid
  //   solubilityRatio   Sechenov salting-out by sugar (~11 % sucrose ≈ −7 %)
  //   mobility          0 = surfactant-laden rigid bubble skin, 1 = clean mobile skin.
  //                     Sets drag (Stokes ↔ Hadamard), mass transfer and drainage.
  //   filmThickness     typical thin-film thickness in foam [m]; thinner films
  //                     let gas diffuse bubble→bubble faster (coarsening)
  //   criticalPhi       critical liquid fraction φc (Carrier & Colin 2003): films
  //                     rupture en masse once drainage dries the foam below φc,
  //                     independent of bubble size. The key foam-stability knob.
  //   burstRate / coalescenceRate   rupture frequencies at φ = φc [1/s]
  // -------------------------------------------------------------------------
  /**
   * Bulk properties of a sucrose solution at a given °Brix (g sugar / 100 g),
   * fitted to the CRC Handbook / ICUMSA sucrose tables at 20 °C (0–15 °Bx):
   *   viscosity   ln(μ/μ_w) = 0.0258·Bx + 0.00027·Bx²     (±1.5 %)
   *   density     ρ − ρ_w  = 3.85·Bx + 0.0145·Bx²  kg/m³  (±0.3 kg/m³)
   *   heat cap.   c_p ≈ 4184·(1 − 0.005·Bx)                (±1 %, e.g. 10 °Bx → 3.97 kJ/kg·K)
   *   salting-out log10(c0/c) = k_s·[sucrose], k_s ≈ 0.095 L/mol — ESTIMATE: no
   *               measured Sechenov coefficient for CO2/sucrose was found; this
   *               gives ~7 % lower solubility at 11 °Bx, typical of non-electrolytes.
   */
  function sugarSolution(brix) {
    const rho = 998 + 3.85 * brix + 0.0145 * brix * brix;
    const molar = (brix / 100) * rho / 342.3;              // mol sucrose per litre
    return {
      viscosityRatio: Math.exp(0.0258 * brix + 0.00027 * brix * brix),
      densityExcess: 3.85 * brix + 0.0145 * brix * brix,
      heatCapacity: 4184 * (1 - 0.005 * brix),
      solubilityRatio: Math.pow(10, -0.095 * molar),
    };
  }

  // Foam chemistry classes: what is coating the bubbles.
  const FOAM_CLASSES = {
    // caramel colour + phosphoric acid: weakly surface-active
    cola:     { surfaceTensionRatio: 0.97, mobility: 0.15, filmThickness: 120e-9, criticalPhi: 0.07,  burstRate: 1.0, coalescenceRate: 0.25 },
    // aspartame + potassium benzoate lower σ (Coffey 2008, qualitative); values estimated
    diet:     { surfaceTensionRatio: 0.92, mobility: 0.25, filmThickness: 90e-9,  criticalPhi: 0.06,  burstRate: 1.0, coalescenceRate: 0.25 },
    // clear / fruit sodas: sugar + citric acid, little surfactant
    fruit:    { surfaceTensionRatio: 0.99, mobility: 0.3,  filmThickness: 100e-9, criticalPhi: 0.10,  burstRate: 1.1, coalescenceRate: 0.3 },
    // gum arabic / ester-gum emulsions in citrus sodas stabilise films a little
    emulsion: { surfaceTensionRatio: 0.95, mobility: 0.2,  filmThickness: 110e-9, criticalPhi: 0.08,  burstRate: 1.0, coalescenceRate: 0.25 },
    // saponins (yucca / quillaja) added as a foaming agent
    saponin:  { surfaceTensionRatio: 0.76, mobility: 0.05, filmThickness: 200e-9, criticalPhi: 0.012, burstRate: 0.8, coalescenceRate: 0.15 },
    // quinine is mildly surface-active
    quinine:  { surfaceTensionRatio: 0.96, mobility: 0.4,  filmThickness: 80e-9,  criticalPhi: 0.15,  burstRate: 1.0, coalescenceRate: 0.3 },
    // sparkling wine: proteins and polysaccharides give a short-lived, fine collar
    wine:     { surfaceTensionRatio: 0.69, mobility: 0.2,  filmThickness: 100e-9, criticalPhi: 0.08,  burstRate: 1.0, coalescenceRate: 0.25 },
    // plain carbonated water: clean slippery bubbles, films pop when wet
    water:    { surfaceTensionRatio: 1.0,  mobility: 0.9,  filmThickness: 30e-9,  criticalPhi: 0.5,   burstRate: 1.0, coalescenceRate: 0.4 },
  };

  const SRC = {
    ali: 'Ali et al. 2022, Sci. Inquiry Rev. 6(3) — measured',
    uf: 'UF/IFAS EDIS FS379 — standard range',
    guide: 'Industry carbonation guides — typical range',
    est: 'Estimate: assumed equal to its sugared sibling',
    lb10: 'Liger-Belair et al. 2010, J. Agric. Food Chem. 58:8768 — measured 11.4 g/L',
  };

  /**
   * Catalogue. `vol` is the typical fill carbonation [volumes]; `brix` the sugar.
   * Colours: liquid / highlight, wet-foam tint, translucency, can label.
   */
  const CATALOG = [
    { id: 'cola',      name: 'Cola',          eg: 'e.g. Coca-Cola',   vol: 3.8, brix: 10.4, foam: 'cola',     source: SRC.ali,
      liquid: '#36170a', liquidHi: '#552a12', foamTint: '#b98a52', label: '#b13e53', stripe: '#f4f4f4' },
    { id: 'cola2',     name: 'Sweet cola',    eg: 'e.g. Pepsi',       vol: 3.6, brix: 11.4, foam: 'cola',     source: SRC.ali,
      liquid: '#33170b', liquidHi: '#54301a', foamTint: '#b98a52', label: '#3b5dc9', stripe: '#b13e53' },
    { id: 'diet',      name: 'Diet cola',     eg: 'e.g. Diet Coke',   vol: 3.7, brix: 0.1,  foam: 'diet',     source: SRC.est,
      liquid: '#3a1a0b', liquidHi: '#5a2d14', foamTint: '#c09560', label: '#c2c3c7', stripe: '#b13e53' },
    { id: 'pepper',    name: 'Pepper soda',   eg: 'e.g. Dr Pepper',   vol: 3.5, brix: 11.0, foam: 'cola',     source: SRC.guide + ' (3.4–3.6)',
      liquid: '#3d1210', liquidHi: '#62201c', foamTint: '#b07a5c', label: '#7a1f2b', stripe: '#f4f4f4' },
    { id: 'lemonlime', name: 'Lemon-lime',    eg: 'e.g. Sprite / 7-Up', vol: 3.8, brix: 10.0, foam: 'fruit',  source: SRC.ali + ' (7-Up 3.7)',
      liquid: '#dff5e0', liquidHi: '#f4fff4', foamTint: '#eef6ee', label: '#38b764', stripe: '#ffcd75', clear: 0.22 },
    { id: 'citrus',    name: 'Citrus soda',   eg: 'e.g. Mountain Dew', vol: 3.2, brix: 11.9, foam: 'emulsion', source: SRC.ali,
      liquid: '#c8e04a', liquidHi: '#e6f58c', foamTint: '#eef3c0', label: '#38b764', stripe: '#b13e53', clear: 0.55 },
    { id: 'orange',    name: 'Orange soda',   eg: 'e.g. Fanta',       vol: 1.8, brix: 13.0, foam: 'fruit',    source: SRC.ali + ' (Mirinda also 1.8)',
      liquid: '#f07a1a', liquidHi: '#ffad4a', foamTint: '#ffd9a8', label: '#ef7d57', stripe: '#3b5dc9', clear: 0.8 },
    { id: 'rootbeer',  name: 'Root beer',     eg: 'e.g. A&W',         vol: 3.7, brix: 11.5, foam: 'saponin',  source: SRC.guide + ' (3.5–4.0)',
      liquid: '#2a1206', liquidHi: '#4a2410', foamTint: '#c7a27a', label: '#5d275d', stripe: '#ffcd75' },
    { id: 'gingerale', name: 'Ginger ale',    eg: 'e.g. Canada Dry',  vol: 3.3, brix: 9.0,  foam: 'fruit',    source: SRC.guide + ' (3.2–3.5)',
      liquid: '#e8c46a', liquidHi: '#f6dc96', foamTint: '#f4ead0', label: '#38b764', stripe: '#ffcd75', clear: 0.4 },
    { id: 'tonic',     name: 'Tonic water',   eg: 'e.g. Schweppes',   vol: 3.2, brix: 8.5,  foam: 'quinine',  source: SRC.uf + ' (3.0–3.5)',
      liquid: '#e4f1f7', liquidHi: '#f8fdff', foamTint: '#f0f6f8', label: '#f4f4f4', stripe: '#ffcd75', clear: 0.18 },
    { id: 'club',      name: 'Club soda',     eg: 'seltzer / soda water', vol: 3.0, brix: 0, foam: 'water',  source: SRC.uf + ' (2.5–3.5)',
      liquid: '#9fd8ef', liquidHi: '#d3f3ff', foamTint: '#f4f8fa', label: '#41a6f6', stripe: '#f4f4f4', clear: 0.18 },
    // Champagne: the drink with the best published pouring data, so it doubles as
    // the model's validation case. Its 12 % ethanol changes the liquid, so the
    // sucrose-derived values are replaced by measured ones (same paper):
    //   σ ≈ 50 mN/m;  μ(T) = 1.08·10⁻⁴·exp(2806/T) mPa·s → ≈1.6× water;
    //   Henry constant ≈ 1.21 g/(L·bar) at 20 °C vs 1.69 for water (Agabaliantz 1963,
    //   as used by Liger-Belair) → solubility ratio 0.72.
    { id: 'champagne', name: 'Champagne', eg: 'brut sparkling wine', vol: 11.4 / 1.964, brix: 1.0, foam: 'wine', source: SRC.lb10,
      liquid: '#f3e3a0', liquidHi: '#fff4c4', foamTint: '#fbf6e2', label: '#1f3b2c', stripe: '#ffcd75', clear: 0.35,
      // 12 % vol ethanol ≈ 2.3 mol/kg → ΔT_f ≈ 4.3 K (wine freezes near −5 °C)
      override: { viscosityRatio: 1.6, solubilityRatio: 0.72, extraFreezeDepression: 4.3 } },
  ];

  const FOAM_NOTES = {
    cola: 'Caramel colour and phosphoric acid are weakly surface-active.',
    diet: 'Aspartame + potassium benzoate lower surface tension; sugar-free, so thinner and holds a little more CO2 than regular.',
    fruit: 'Little besides sugar and citric acid coats the bubbles: a quick, airy head.',
    emulsion: 'Flavour-oil emulsion stabilisers (gum arabic, ester gum) toughen the films a little.',
    saponin: 'Saponins (yucca / quillaja) are added as a foaming agent: a long-lived, beer-like head.',
    quinine: 'Quinine is mildly surface-active; with modest sugar the head is brief.',
    water: 'No surfactants: bubbles are clean and slippery and films pop the moment they form.',
    wine: '12 % ethanol lowers surface tension to ~50 mN/m; proteins give a brief, fine collar.',
  };

  const BEVERAGES = {};
  for (const d of CATALOG) {
    BEVERAGES[d.id] = Object.assign(
      { id: d.id, name: d.name, eg: d.eg, carbonation: d.vol, brix: d.brix, source: d.source,
        liquid: d.liquid, liquidHi: d.liquidHi, foamTint: d.foamTint, label: d.label, stripe: d.stripe,
        clear: d.clear || 0,
        note: `${d.brix > 0.5 ? `${d.brix} °Brix sugar.` : 'Sugar-free.'} ${FOAM_NOTES[d.foam]}` },
      sugarSolution(d.brix), FOAM_CLASSES[d.foam], d.override || {});
  }

  /**
   * The drink after meltwater has mixed in: `strength` is the fraction that is
   * still the original drink. Sugar-derived properties are recomputed from the
   * diluted °Brix; other solute effects (salting-out, surface tension, extra
   * viscosity) blend toward pure water in proportion — log-linearly for the
   * ones that are exponential in concentration (viscosity, Sechenov salting-out).
   * Foam-chemistry constants are left unchanged (a known simplification).
   */
  function dilute(bev, strength) {
    if (!(strength < 0.995)) return bev;
    const q = Math.round(strength * 100) / 100;
    const cache = bev._diluted || (Object.defineProperty(bev, '_diluted', { value: {} }), bev._diluted);
    if (cache[q]) return cache[q];
    const pow = (r) => Math.pow(r, q), lin = (r) => 1 + (r - 1) * q;
    return (cache[q] = Object.assign({}, bev, {
      viscosityRatio: pow(bev.viscosityRatio),
      solubilityRatio: pow(bev.solubilityRatio),
      surfaceTensionRatio: lin(bev.surfaceTensionRatio),
      densityExcess: bev.densityExcess * q,
      heatCapacity: C.CP_WATER + (bev.heatCapacity - C.CP_WATER) * q,
      strength: q,
    }));
  }

  // -------------------------------------------------------------------------
  // Surfaces the soda touches
  //
  //   sitesPerCm2     cavity density with mouth radius > 1 µm (power-law size spectrum)
  //   contactAngle    degrees; hydrophobic cavities trap gas (Bankoff criterion)
  //   cavityRadius    typical gas-pocket mouth radius r_c [m]
  //   entrapDepth     air volume trapped per unit area when a DRY surface is
  //                   first wetted (roughness / porosity / frost depth) [m]
  //   sigmaFactor     local surface-tension reduction (Mentos' gum arabic)
  //   k, cp, rho, wall   thermal conductivity, heat capacity, density, wall thickness
  // -------------------------------------------------------------------------
  function surface(def) {
    return Object.freeze(Object.assign({ sigmaFactor: 1 }, def, { sitesPerM2: def.sitesPerCm2 * 1e4 }));
  }

  const SURFACES = {
    glass:     surface({ id: 'glass', name: 'Glass', sitesPerCm2: 0.4, contactAngle: 25, cavityRadius: 2e-6,
                         entrapDepth: 0.02e-6, k: 1.05, cp: 840, rho: 2500, wall: 3.0e-3,
                         note: 'Smooth and very hydrophilic: almost no gas-trapping cavities. Most glass fizz comes from dust and scratches.' }),
    plastic:   surface({ id: 'plastic', name: 'Plastic (PET)', sitesPerCm2: 2, contactAngle: 72, cavityRadius: 3e-6,
                         entrapDepth: 0.4e-6, k: 0.20, cp: 1250, rho: 1380, wall: 0.6e-3,
                         note: 'Mildly hydrophobic with moulding micro-scratches; thin wall, poor conductor.' }),
    paper:     surface({ id: 'paper', name: 'Paper (PE-lined)', sitesPerCm2: 5, contactAngle: 95, cavityRadius: 5e-6,
                         entrapDepth: 2.5e-6, k: 0.06, cp: 1400, rho: 800, wall: 0.5e-3,
                         note: 'Hydrophobic polyethylene lining over fibre texture traps plenty of air.' }),
    styrofoam: surface({ id: 'styrofoam', name: 'Styrofoam (EPS)', sitesPerCm2: 8, contactAngle: 90, cavityRadius: 8e-6,
                         entrapDepth: 6e-6, k: 0.035, cp: 1300, rho: 40, wall: 3.0e-3,
                         note: 'Bead boundaries are cavity-rich; superb insulator, so the soda stays cold.' }),
    ceramic:   surface({ id: 'ceramic', name: 'Ceramic mug', sitesPerCm2: 0.8, contactAngle: 35, cavityRadius: 2e-6,
                         entrapDepth: 0.05e-6, k: 1.4, cp: 880, rho: 2300, wall: 5.0e-3,
                         note: 'Glazed and hydrophilic like glass, but a thick heavy wall: a big heat reservoir.' }),
    steel:     surface({ id: 'steel', name: 'Stainless steel', sitesPerCm2: 1.5, contactAngle: 70, cavityRadius: 2e-6,
                         entrapDepth: 0.1e-6, k: 16, cp: 500, rho: 7900, wall: 0.8e-3,
                         note: 'Brushed finish and a native oxide; conducts heat ~15× faster than glass.' }),

    ice:       surface({ id: 'ice', name: 'Ice', sitesPerCm2: 400, contactAngle: 50, cavityRadius: 15e-6,
                         entrapDepth: 40e-6, k: 2.2, cp: 2108, rho: 917, wall: 0,
                         note: 'Cracks, frost and frozen-in air bubbles: an enormous field of ready-made gas pockets.' }),
    mentos:    surface({ id: 'mentos', name: 'Mentos', sitesPerCm2: 2e5, contactAngle: 90, cavityRadius: 3e-6,
                         entrapDepth: 60e-6, sigmaFactor: 0.7, k: 0.3, cp: 1500, rho: 1400, wall: 0,
                         note: 'Micro-rough candy shell; gum arabic lowers surface tension right where bubbles are born.' }),
    salt:      surface({ id: 'salt', name: 'Salt crystals', sitesPerCm2: 3000, contactAngle: 60, cavityRadius: 3e-6,
                         entrapDepth: 15e-6, k: 6, cp: 880, rho: 2160, wall: 0,
                         note: 'Dissolving crystal faces and the air clinging to dry grains.' }),
  };

  const CUP_MATERIALS = ['glass', 'plastic', 'paper', 'styrofoam', 'ceramic', 'steel'];

  Fizz.Props = { muWater, rhoWater, sigmaWater, henry, desorptionEnthalpy, diffusivity, fluid, dilute, BEVERAGES, SURFACES, CUP_MATERIALS };
})(window.Fizz = window.Fizz || {});
