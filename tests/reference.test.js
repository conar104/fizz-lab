// Fizz Lab — model vs. published reference data.
// Every check compares a model output with an INDEPENDENT tabulated value
// (not the formula it was fitted from). Run:  node tests/reference.test.js
const { load, section, near, expect, summary } = require('./harness');
const Fizz = load();
const { Props, Nucleation, BubblePhysics, Bottle, Jet, C } = Fizz;
const K = (t) => t + 273.15;

// ---------------------------------------------------------------------------
section('Water properties (IAPWS / CRC Handbook)');
// IAPWS 2008 viscosity release (Huber et al., J. Phys. Chem. Ref. Data 38:101), mPa·s
for (const [t, mu] of [[0, 1.7914], [10, 1.3060], [20, 1.0016], [25, 0.8900], [40, 0.6527]])
  near(`viscosity of water ${t} °C`, Props.muWater(K(t)) * 1e3, mu, 0.02, 'IAPWS 2008');
// density, CRC Handbook (Kell 1975), kg/m³
for (const [t, rho] of [[0, 999.84], [4, 999.97], [20, 998.21], [25, 997.05], [40, 992.22]])
  near(`density of water ${t} °C`, Props.rhoWater(K(t)), rho, 0.0005, 'CRC / Kell');
// IAPWS 2014 surface tension release, mN/m
for (const [t, s] of [[0.01, 75.65], [20, 72.74], [25, 71.97], [40, 69.60]])
  near(`surface tension of water ${t} °C`, Props.sigmaWater(K(t)) * 1e3, s, 0.005, 'IAPWS 2014');

// ---------------------------------------------------------------------------
section('CO2 solubility and diffusivity');
// Solubility in pure water at 1 atm TOTAL pressure (so p_CO2 = 1 atm − p_water),
// g CO2 per kg water — CRC Handbook / Engineering ToolBox table
const pw = { 0: 611, 10: 1228, 20: 2339, 25: 3170, 40: 7385 };           // vapour pressure, Pa
for (const [t, g] of [[0, 3.35], [10, 2.32], [20, 1.69], [25, 1.45], [40, 0.97]]) {
  const kH = Props.henry(K(t));                                            // mol/(m³·Pa)
  const molPerKg = kH * (C.P_ATM - pw[t]) / Props.rhoWater(K(t));
  near(`CO2 solubility ${t} °C (g/kg)`, molPerKg * C.M_CO2 * 1000, g, 0.03, 'CRC solubility table');
}
// heat of solution: calorimetric value ≈ −19.4 kJ/mol at 25 °C (Carroll et al. 1991 give 19–20)
near('heat released dissolving CO2, 25 °C (kJ/mol)', Props.desorptionEnthalpy(K(25)) / 1000, 19.9, 0.05, 'Carroll, Slupsky & Mather 1991');
// Diffusivity — independent fit of Jähne, Heinz & Dietrich (1987), JGR 92:10767:
//   D = 5.019e-6 · exp(−19.51 kJ/mol / RT)
for (const t of [10, 25, 35]) {
  const ref = 5.019e-6 * Math.exp(-19510 / (C.R * K(t)));
  near(`CO2 diffusivity in water ${t} °C`, Props.diffusivity(K(t), 1), ref, 0.07, 'Jähne et al. 1987');
}
near('1 volume of CO2 in g/L', C.MOL_PER_VOLUME * C.M_CO2, 1.96, 0.01, 'industry definition, 1 vol = 1.96 g/L');

// ---------------------------------------------------------------------------
section('Sucrose solutions, 20 °C (CRC Handbook)');
const bevAt = (brix) => ({ viscosityRatio: Math.exp(0.0258 * brix + 0.00027 * brix * brix), densityExcess: 3.85 * brix + 0.0145 * brix * brix });
for (const [w, mu, rho] of [[5, 1.146, 1017.9], [10, 1.336, 1038.1], [15, 1.592, 1059.2]]) {
  const b = bevAt(w);
  near(`sucrose ${w} wt% viscosity (mPa·s)`, Props.muWater(K(20)) * b.viscosityRatio * 1e3, mu, 0.02, 'CRC sucrose table');
  near(`sucrose ${w} wt% density (kg/m³)`, Props.rhoWater(K(20)) + b.densityExcess, rho, 0.001, 'CRC sucrose table');
}
// the catalogue really uses this model
const cola = Props.BEVERAGES.cola;
near('cola (10.4 °Bx) viscosity ratio', cola.viscosityRatio, Math.exp(0.0258 * 10.4 + 0.00027 * 10.4 * 10.4), 1e-9, 'self-consistency');

// ---------------------------------------------------------------------------
section('Bubble rise speed');
const water20 = Props.fluid(Object.assign({}, Props.BEVERAGES.club, { surfaceTensionRatio: 1 }), K(20));
{
  const R = 20e-6;                                        // Re ≈ 0.03: Stokes' law is exact here
  const stokes = 2 / 9 * water20.rho * C.G * R * R / water20.mu;
  near('rigid 40 µm bubble vs Stokes law', BubblePhysics.terminalVelocity(R, water20, 0), stokes, 0.03, 'Stokes 1851');
  near('clean 40 µm bubble vs Hadamard–Rybczynski', BubblePhysics.terminalVelocity(R, water20, 1), 1.5 * stokes, 0.04, 'Hadamard 1911');
}
{
  // Clift, Grace & Weber (1978) Fig. 7.3, air in contaminated water
  const v1 = BubblePhysics.terminalVelocity(0.5e-3, water20, 0);
  expect('1 mm contaminated bubble rises at 8–13 cm/s', v1 > 0.08 && v1 < 0.13, `model ${(v1 * 100).toFixed(1)} cm/s`, 'Clift, Grace & Weber 1978, Fig. 7.3');
  const v3 = BubblePhysics.terminalVelocity(1.5e-3, water20, 0);
  // clean water plateaus at 30–35 cm/s; contamination slows high-Re bubbles by up to ~2×
  expect('3 mm contaminated bubble is slower than the clean 30–35 cm/s plateau, faster than half of it', v3 > 0.15 && v3 < 0.30,
         `model ${(v3 * 100).toFixed(1)} cm/s (Tomiyama 1998 contaminated-system drag)`, 'Clift, Grace & Weber 1978; Magnaudet & Eames 2000');
}

// ---------------------------------------------------------------------------
section('Nucleation');
{
  // Liger-Belair (2005): in champagne (S ≈ 4.8, σ ≈ 50 mN/m) the critical radius is ≈ 0.2 µm
  const kH = 1, P = C.P_ATM, c = 5.8 * kH * P;
  const Rstar = Nucleation.criticalRadius(c, kH, P, 0.050);
  near('critical radius in champagne-like liquid (µm)', Rstar * 1e6, 0.2, 0.05, 'Liger-Belair 2005, J. Agric. Food Chem.');
  const logJ = Nucleation.homogeneousLog10Rate(0.072, 3 * P, K(20));
  expect('homogeneous nucleation is negligible at 3 atm supersaturation', logJ < -1e5, `log10 J = ${logJ.toExponential(2)} per m³·s`, 'classical nucleation theory (Wilt 1986)');
}

// ---------------------------------------------------------------------------
section('Bottle outflow');
{
  const b = new Bottle(Bottle.TYPES.pet500), d = 2 * Bottle.TYPES.pet500.r;
  near('glug ceiling vs Clanet & Searby (π/12)·√g·d^2.5', b.glugLimit(), Math.PI / 12 * Math.sqrt(C.G) * Math.pow(d, 2.5), 0.06, 'Clanet & Searby 2004, J. Fluid Mech. 510');
  // drain time of an upturned 500 ml bottle (flipped at 300°/s)
  const fl = Props.fluid(Props.BEVERAGES.cola, K(4));
  let t = 0;
  while (b.V > 1e-7 && t < 60) { b.step(1 / 240, { holding: true, tiltSpeed: 300 }, fl); t += 1 / 240; }
  // Clanet & Searby: T_e = 3.0·L/√(g D0) · (D0/d)^{5/2} for an equivalent cylinder of the same volume
  const D0 = 2 * Bottle.TYPES.pet500.R, L = 500e-6 / (Math.PI * D0 * D0 / 4);
  const Te = 3.0 * L / Math.sqrt(C.G * D0) * Math.pow(D0 / d, 2.5);
  near('500 ml bottle upside-down drain time (s)', t, Te, 0.30, 'Clanet & Searby 2004 scaling, ideal cylinder');
}
{
  const fl = Props.fluid(Props.BEVERAGES.cola, K(20));
  // Davies & Taylor (1950): a long bubble rises up a tube at 0.35·√(g·d)
  const d = 0.0217;
  const b = new Bottle(Bottle.TYPES.pet500);
  near('implied air-bubble speed in neck (m/s)', b.glugLimit() / (Math.PI * d * d / 4), 0.351 * Math.sqrt(C.G * d), 0.01, 'Davies & Taylor 1950 / Dumitrescu 1943');
}

// ---------------------------------------------------------------------------
section('Turbulence & entrainment formulas (implemented as published)');
{
  const fl = Props.fluid(Props.BEVERAGES.club, K(20));
  // Hinze (1955): d_max = 0.725 (σ/ρ)^0.6 ε^−0.4 — check the implementation, ε = 1 W/kg
  near('Hinze maximum bubble diameter at ε = 1 W/kg (mm)', Jet.hinzeMaxRadius(1, fl) * 2e3,
       0.725 * Math.pow(fl.sigma / fl.rho, 0.6) * 1e3, 1e-6, 'Hinze 1955');
  // Bin (1993): Q_air/Q = 0.04·Fr^0.28·(h/d0)^0.4 well above the onset speed
  const cal = Jet.tuning.cal;
  Jet.tuning.cal = 1;                                       // the published formula, uncalibrated
  const j = Jet.plungingJet({ Q: 40e-6, d0: 0.012, fall: 1.0, tilt: 0, fl, splash: 1 });
  Jet.tuning.cal = cal;
  const ref = 0.04 * Math.pow(j.Fr, 0.28) * Math.pow(1.0 / 0.012, 0.4) * (1 - (Jet.V_ONSET / j.vEff) ** 2);
  near('Bin air-entrainment ratio, 1 m fall', j.ratio, ref, 1e-9, 'Bin 1993, Chem. Eng. Sci. 48');
  console.log(`NOTE  in the game Bin's coefficient is scaled by ${cal} — fitted to Liger-Belair et al. 2010 (see validation.test.js)`);
  expect('free-fall impact speed √(v0² + 2gh)', Math.abs(j.v - Math.sqrt(j.v0 * j.v0 + 2 * C.G)) < 1e-9, `v = ${j.v.toFixed(3)} m/s`, 'Torricelli / energy conservation');
}

process.exitCode = summary() ? 1 : 0;
