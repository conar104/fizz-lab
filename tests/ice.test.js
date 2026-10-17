// Fizz Lab — ice: geometry limits, energy conservation, melt rate, and how ice
// interacts with the rest of the physics.   Run: node tests/ice.test.js
const { section, near, expect, summary, seed } = require('./harness');
const { Fizz } = require('./scenario');
const { Simulation, Ice, C, Props } = Fizz;
const K = (t) => t + C.T0;

/** A cup that already holds still liquid at temperature t (no pour, no CO2). */
function still(params, ml, t) {
  seed(5);
  const sim = new Simulation(Object.assign({ beverage: 'club', carbonation: 0, iceCubes: 0 }, params));
  sim.liquid.V = ml * 1e-6; sim.liquid.T = K(t); sim.liquid.n = 0; sim.liquid.s = 1;
  sim.wall.T = K(params.cupTemp != null ? params.cupTemp : t);
  sim.geom = sim.computeGeometry();
  return sim;
}

/** Total enthalpy relative to liquid water at 0 °C: liquid + foam liquid + wall + every cube (incl. latent heat). */
function enthalpy(sim) {
  const L = sim.liquid, fl = sim.fluid;
  let H = (L.V + sim.foam.liquidVolume) * fl.rho * fl.cp * (L.T - C.T0);
  const Wl = sim.water;
  if (Wl.V > 0) { const fw = sim._layerFluid(); H += Wl.V * fw.rho * fw.cp * (Wl.T - C.T0); }
  H += sim.wall.heatCapacity * (sim.wall.T - C.T0);
  for (const c of sim.ice.cubes) H += c.m * (C.CP_ICE * (c.T - C.T0) - C.L_FUSION);
  return H;
}

// ---------------------------------------------------------------------------
section('How much ice fits');
{
  near('2.5 cm cubes per layer in a 7.5 cm glass', Ice.lanesFor(0.075, 0.025).reduce((s, l) => s + l.perRow, 0), 4, 0,
    'geometry: chord of the circle at each depth lane');
  expect('a cube wider than the glass (face diagonal a√2 > D) does not fit at all', Ice.capacity(0.04, 0.12, 0.03) === 0,
    `capacity of a 4 cm glass for 3 cm cubes = ${Ice.capacity(0.04, 0.12, 0.03)}`, 'geometry');
  const r = [24, 40].map(n => {
    seed(1);
    const sim = new Simulation({ cupDiameter: 7.5, cupHeight: 15, iceCubes: n });
    for (let i = 0; i < 4 * 120; i++) sim.step(1 / 120);
    return { n, cup: sim.ice.count, table: sim.ice.cubes.length - sim.ice.count };
  });
  expect('a glass filled to capacity keeps all its cubes', r[0].table === 0, `24 cubes → ${r[0].cup} in the glass`, 'geometry');
  expect('overfilling heaps the ice, and the excess tumbles out onto the table', r[1].table > 0 && r[1].cup <= Ice.capacity(0.075, 0.15, 0.025) + 4,
    `40 cubes → ${r[1].cup} stay, ${r[1].table} overflow`, 'rigid-body stacking');
}

// ---------------------------------------------------------------------------
section('Energy conservation (calorimetry, room switched off)');
{
  const saved = Object.assign({}, Simulation.HEAT);
  Simulation.HEAT.hAir = 0;                                   // isolate: no heat in or out
  // 200 ml of 25 °C water, a glass at 25 °C, then 5 freezer cubes at −18 °C
  const sim = still({ cupDiameter: 7.5, cupHeight: 12, cupTemp: 25, iceSize: 2.5, iceTemp: -18 }, 200, 25);
  for (let i = 0; i < 5; i++) sim.addIce();
  for (let i = 0; i < 120; i++) sim.step(1 / 120);           // let them fall in
  const H0 = enthalpy(sim);
  for (let i = 0; i < 600 * 60; i++) sim.step(1 / 60);       // 10 minutes
  const H1 = enthalpy(sim);
  const exchanged = 5 * 0.025 ** 3 * C.RHO_ICE * (C.CP_ICE * 18 + C.L_FUSION);     // heat it takes to warm and melt the ice
  expect('energy is conserved through warming, melting and refreezing', Math.abs(H1 - H0) < 0.005 * exchanged,
    `enthalpy drift ${(H1 - H0).toFixed(1)} J over 10 min, against ${(exchanged / 1000).toFixed(1)} kJ moved into the ice`, 'first law of thermodynamics');
  for (let i = 0; i < 1800 * 30; i++) sim.step(1 / 30);       // a further 30 minutes, to equilibrium
  // Calorimetry prediction for the final state: is there enough heat to melt all the ice?
  const mW = 200e-6 * Props.rhoWater(K(25)), cw = Props.BEVERAGES.club.heatCapacity;
  const mI = 5 * 0.025 ** 3 * C.RHO_ICE, Cg = sim.wall.heatCapacity;
  const heatAvailable = (mW * cw + Cg) * 25;                  // cooling water + glass to 0 °C
  const heatToMelt = mI * (C.CP_ICE * 18 + C.L_FUSION);       // warming and melting all the ice
  const predictedMelt = heatAvailable >= heatToMelt ? mI : (heatAvailable - mI * C.CP_ICE * 18) / C.L_FUSION;
  // The approach to equilibrium is asymptotic (the driving ΔT → 0), so check the
  // books instead: what has melted plus what the remaining warmth WILL melt must
  // equal the calorimetry prediction.
  const fl = sim.fluid, flW = sim._layerFluid();
  const warmth = (sim.liquid.V * fl.rho * fl.cp) * (sim.liquid.T - C.T0) + Cg * (sim.wall.T - C.T0)
               + sim.water.V * flW.rho * flW.cp * (sim.water.T - C.T0);
  const stillCold = sim.ice.cubes.reduce((q, c) => q + c.m * C.CP_ICE * (C.T0 - c.T), 0);
  const projected = sim.ice.melted - sim.ice.frozen + (warmth - stillCold) / C.L_FUSION;
  expect('…and heads to the state calorimetry predicts', Math.abs(projected - predictedMelt) / predictedMelt < 0.03,
    `melted ${((sim.ice.melted - sim.ice.frozen) * 1000).toFixed(1)} g so far, + ${((warmth - stillCold) / C.L_FUSION * 1000).toFixed(1)} g the remaining warmth will melt = ${(projected * 1000).toFixed(1)} g; calorimetry: ${(predictedMelt * 1000).toFixed(1)} g`,
    'm_w c_w ΔT_w + C_glass ΔT_g = m_i (c_i ΔT_i + L_f)');
  Object.assign(Simulation.HEAT, saved);
}
{
  const saved = Object.assign({}, Simulation.HEAT);
  Simulation.HEAT.hAir = 0;
  // more ice than the water can melt: everything must settle at the freezing point, ice left over
  const sim = still({ cupDiameter: 7.5, cupHeight: 12, cupTemp: 10, iceSize: 2.5, iceTemp: -18 }, 100, 10);
  for (let i = 0; i < 12; i++) sim.addIce();
  for (let i = 0; i < 900 * 60; i++) sim.step(1 / 60);
  expect('with excess ice the drink settles at its freezing point and ice remains', Math.abs(sim.liquid.T - C.T0) < 0.2 && sim.ice.mass > 0,
    `water ${(sim.liquid.T - C.T0).toFixed(2)} °C, ${(sim.ice.mass * 1000).toFixed(0)} g of ice left, ${(sim.ice.frozen * 1000).toFixed(1)} g of water froze onto the cold cubes`,
    'phase equilibrium');
  Object.assign(Simulation.HEAT, saved);
}

// ---------------------------------------------------------------------------
section('Melting rate');
{
  // Wolfram Demonstrations "Ice Cube Melting in Water": a cube in 175 mL of 15 °C water
  // raised the level to 194.5 mL (so ≈19.5 g of ice, floating) and melted in 7.515 min.
  const a = Math.cbrt(19.5e-3 / C.RHO_ICE);
  const sim = still({ cupDiameter: 6.5, cupHeight: 9, cupTemp: 20, roomTemp: 20, iceSize: a * 100, iceTemp: -18, material: 'glass' }, 175, 15);
  sim.addIce();
  let t = 0;
  while (t < 1800 && (sim.ice.cubes.length && sim.ice.cubes[0].m > 0.02 * 19.5e-3)) { sim.step(1 / 30); t += 1 / 30; }
  // KNOWN GAP (≈1.9× slow): the model treats the liquid as well mixed, but in a
  // still glass the cold meltwater sinks and the floating cube keeps sitting in
  // the warmer top water. The convection coefficient itself is the standard
  // sphere correlation (melting spheres follow it — see EVIDENCE.md).
  near('19.5 g cube in 175 mL at 15 °C: melt time (min) [known gap]', t / 60, 7.515, 1.0, 'Wolfram Demonstrations measurement (cube temperature not stated; −18 °C assumed)');
}
{
  // the density maximum at 4 °C: natural convection, and so melting, nearly stalls around 4–8 °C
  const fl = (t) => Props.fluid(Props.BEVERAGES.club, K(t));
  const h = (t) => Ice.meltCoefficient(fl(t), 0.025, K(t), 0);
  let tMin = 1, hMin = Infinity;
  for (let t = 1; t <= 12; t += 0.25) if (h(t) < hMin) { hMin = h(t); tMin = t; }
  expect('melting convection reverses direction (and is weakest) near 5 °C', tMin >= 4.5 && tMin <= 7,
    `weakest at ${tMin.toFixed(2)} °C; h = ${h(2).toFixed(0)}, ${hMin.toFixed(0)}, ${h(15).toFixed(0)} W/m²K at 2, ${tMin} and 15 °C`,
    'Carey & Gebhart 1981: flow reverses at 4.7–5.0 °C (density maximum at 4 °C)');
  const hs = Ice.meltCoefficient(fl(15), 0.025, K(15), 0.15);
  expect('stirring melts ice faster (forced convection)', hs > 1.5 * h(15), `${h(15).toFixed(0)} → ${hs.toFixed(0)} W/m²K at 0.15 m/s`, 'Ranz & Marshall 1952');
}

// ---------------------------------------------------------------------------
section('Ice and the rest of the drink');
{
  near('cola freezing point (°C)', Ice.freezingPoint(Props.BEVERAGES.cola) - C.T0, -0.63, 0.1, 'colligative: 1.86 K·kg/mol × sucrose molality');
  near('champagne freezing point (°C)', Ice.freezingPoint(Props.BEVERAGES.champagne) - C.T0, -4.4, 0.15, 'wine freezes near −4 to −5 °C');
}
{
  // melt a lot of ice into cola and check dilution of CO2, sugar and its properties
  seed(2);
  const sim = new Simulation({ beverage: 'cola', carbonation: 3.8, sodaTemp: 20, cupDiameter: 7.5, cupHeight: 15, iceCubes: 6, iceTemp: 0, roomTemp: 20, pourAmount: 200 });
  sim.startPour(true);
  for (let i = 0; i < 20 * 60; i++) sim.step(1 / 60);
  const before = { s: sim.liquid.s, mu: sim.fluid.mu, kH: sim.fluid.kH };
  for (let i = 0; i < 600 * 30; i++) sim.step(1 / 30);
  const melt = sim.ice.melted - sim.ice.frozen;
  const expectS = 200e-6 / (200e-6 + melt / Props.rhoWater(C.T0));
  // strength of everything in the glass: the drink plus any meltwater still floating on it
  const sAll = (sim.liquid.s * sim.liquid.V + sim.water.s * sim.water.V) / sim.cupVolume;
  expect('meltwater waters the drink down (strength = soda / (soda + meltwater))', Math.abs(sAll - expectS) < 0.03,
    `strength ${sAll.toFixed(3)} after ${(melt * 1000).toFixed(0)} g melted (mixing alone predicts ${expectS.toFixed(3)}; ${(sim.water.V * 1e6).toFixed(0)} ml still floats on top)`, 'mass balance');
  const fl = sim.fluid, flRef = Props.fluid(Props.BEVERAGES.cola, sim.liquid.T);
  expect('…which thins the syrup and lets it hold slightly more CO2 (less sugar to salt it out)',
    fl.mu < flRef.mu && fl.kH > flRef.kH, `μ ${(fl.mu * 1e3).toFixed(3)} vs ${(flRef.mu * 1e3).toFixed(3)} mPa·s undiluted; k_H ×${(fl.kH / flRef.kH).toFixed(3)}`, 'sucrose tables; Sechenov');
}
{
  // ice displaces liquid: adding cubes to a full glass makes it spill
  const sim = still({ cupDiameter: 7.5, cupHeight: 10 }, 420, 10);
  for (let i = 0; i < 4; i++) sim.addIce();
  for (let i = 0; i < 5 * 120; i++) sim.step(1 / 120);
  expect('dropping ice into a brim-full glass makes it overflow', sim.stats.spilledV > 10e-6,
    `${(sim.stats.spilledV * 1e6).toFixed(0)} ml spilled for ${(4 * 15.625 * 0.917).toFixed(0)} ml of floating ice displacement`, 'Archimedes');
  expect('floating cubes ride with ~92 % of their volume under', sim.ice.cubes.filter(c => c.where === 'cup').every(c => c.sub > 0.8 && c.sub < 1),
    sim.ice.cubes.filter(c => c.where === 'cup').map(c => c.sub.toFixed(2)).join(', '), 'ρ_ice/ρ_water = 917/1000');
}

// ---------------------------------------------------------------------------
section('Salt');
{
  const club = Props.BEVERAGES.club;
  near('0.1 mol/kg NaCl freezing point (°C)', Ice.freezingPoint(club, 1, 0.1) - C.T0, -0.348, 0.02, 'measured: 0.1 m NaCl freezes at −0.348 °C (i ≈ 1.87)');
  const melt = (pinches) => {
    seed(4);
    const sim = new Simulation({ beverage: 'club', carbonation: 0, iceCubes: 6, iceTemp: 0, cupHeight: 15, sodaTemp: 2, pourAmount: 250 });
    sim.startPour(true);
    for (let i = 0; i < 10 * 60; i++) sim.step(1 / 60);
    for (let k = 0; k < pinches; k++) sim.addSalt();
    for (let i = 0; i < 300 * 30; i++) sim.step(1 / 30);
    return { m: sim.ice.melted - sim.ice.frozen, Tf: sim.freezingPoint() - C.T0, kH: sim.fluid.kH, T: sim.liquid.T - C.T0 };
  };
  const plain = melt(0), salty = melt(15);
  expect('a spoonful of salt (6 g) makes the ice melt faster', salty.m > 1.1 * plain.m,
    `${(plain.m * 1000).toFixed(1)} g → ${(salty.m * 1000).toFixed(1)} g in 5 min; melting point ${salty.Tf.toFixed(2)} °C`, 'colligative freezing-point depression: ice melts at the solution’s freezing point');
  expect('…chills the drink below 0 °C, toward its new freezing point', salty.T < plain.T,
    `${plain.T.toFixed(2)} → ${salty.T.toFixed(2)} °C`, 'salt–ice chilling (as in an ice-cream maker)');
  expect('…and slightly lowers CO2 solubility (salting-out)', salty.kH < plain.kH,
    `k_H ×${(salty.kH / plain.kH).toFixed(4)}`, 'Sechenov, K_s ≈ 0.11 L/mol (Weisenberger & Schumpe 1996)');
}

process.exitCode = summary() ? 1 : 0;
