// Fizz Lab — surface tension at the glass: menisci, rim pinning, foam yield,
// and what happens at the rim.   Run: node tests/capillary.test.js
const { section, near, expect, summary, seed } = require('./harness');
const { Fizz, pour, BASE } = require('./scenario');
const { Simulation, Capillary, Props, C } = Fizz;
const K = (t) => t + C.T0;
const water = Props.fluid(Object.assign({}, Props.BEVERAGES.club, { surfaceTensionRatio: 1 }), K(20));

// ---------------------------------------------------------------------------
section('Capillary scales');
near('capillary length of water, 20 °C (mm)', Capillary.capillaryLength(water) * 1000, 2.71, 0.02, 'l_c = √(σ/ρg), σ = 72.7 mN/m');
near('water climbing a clean glass wall, θ = 25° (mm)', Capillary.wallMeniscus(water, 25) * 1000,
     2.71 * Math.sqrt(2 * (1 - Math.sin(25 * Math.PI / 180))), 0.02, 'Laplace–Young, vertical wall (de Gennes et al. 2004, ch. 1)');
expect('on a water-repellent cup (θ > 90°) the meniscus dips instead', Capillary.wallMeniscus(water, 95) < 0,
       `${(Capillary.wallMeniscus(water, 95) * 1000).toFixed(2)} mm at θ = 95°`, 'Laplace–Young');
near('max overfill above a square rim (mm)', Capillary.rimOverfill(water, 25) * 1000, Math.SQRT2 * 2.71, 0.02,
     'Gibbs pinning at an edge (Oliver, Huh & Mason 1977): h = 2 l_c sin(α/2), α → 90°');
near('foam yield stress, R = 0.3 mm, 90 % gas (Pa)', Capillary.foamYieldStress(0.07, 3e-4, 0.1), 0.51 * (0.07 / 3e-4) * (0.9 - 0.635) ** 2, 1e-9,
     'Mason, Bibette & Weitz 1996; Saint-Jalmes & Durian 1999');
expect('wet foam (gas fraction below random close packing, 0.635) has no yield stress', Capillary.foamYieldStress(0.07, 3e-4, 0.4) === 0,
       '60 % liquid → τ_y = 0', 'jamming transition');
{
  const h = Capillary.foamStandHeight(0.07, 3e-4, 0.1, 1000);
  expect('a typical soda head can stand a few mm to ~1 cm proud of the rim', h > 0.002 && h < 0.02,
    `${(h * 1000).toFixed(1)} mm for R = 0.3 mm, 10 % liquid`, 'τ_y/(ρ_f g); beer and soda heads visibly dome above the rim');
}
{
  const foamU = Capillary.overflowSpeed(water, { phi: 0.15, R: 3e-4 }, 4e-3), liqU = Capillary.overflowSpeed(water, null, 1e-3);
  expect('spilled foam creeps down the outside; spilled liquid streams', foamU < 0.1 && liqU > 3 * foamU,
    `foam lobe ${(foamU * 100).toFixed(1)} cm/s, liquid film ${(liqU * 100).toFixed(0)} cm/s`, 'Bingham film vs Nusselt film');
}

// ---------------------------------------------------------------------------
section('At the rim');
{
  // fill a still glass to 2 mm ABOVE the rim: surface tension holds it
  seed(1);
  const sim = new Simulation({ beverage: 'club', carbonation: 0, cupDiameter: 7.5, cupHeight: 10, material: 'glass' });
  sim.liquid.V = sim.A * (sim.H + 0.002); sim.liquid.T = K(20); sim.liquid.n = 0;
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  expect('a glass can be filled ~2 mm above its rim without spilling', sim.stats.spilledV < 1e-7,
    `spilled ${(sim.stats.spilledV * 1e6).toFixed(2)} ml; bulge allowed ${(sim.crown.bulgeMax * 1000).toFixed(1)} mm`, 'rim pinning (Gibbs)');
  sim.liquid.V += sim.A * 0.004;
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  expect('…but past the pinning limit it spills, down to the limit', sim.stats.spilledV > 5e-6 && Math.abs(sim.geom.level - sim.H - sim.crown.bulgeMax) < 3e-4,
    `spilled ${(sim.stats.spilledV * 1e6).toFixed(1)} ml; surface now ${((sim.geom.level - sim.H) * 1000).toFixed(1)} mm above the rim`, 'rim pinning (Gibbs)');
}
{
  const r = pour(Object.assign({}, BASE, { pourHeight: 25, cupHeight: 11 }), { watch: 5 });
  expect('a high pour domes its head above the rim before it overflows', r.sim.crown.domeMax > 0 && r.sim.stats.foamSpilledV > 0,
    `dome up to ${(r.sim.crown.domeMax * 1000).toFixed(1)} mm; ${(r.sim.stats.foamSpilledV * 1e6).toFixed(0)} ml of foam went over`, 'foam yield stress');
}
{
  seed(2);
  const sim = new Simulation({ beverage: 'club', carbonation: 0, cupDiameter: 7.5, cupHeight: 10, tilt: 30 });
  sim.liquid.V = sim.A * 0.095; sim.liquid.T = K(20); sim.liquid.n = 0;
  for (let i = 0; i < 60; i++) sim.step(1 / 120);
  const sides = new Set(Object.keys(sim.stats.spillBySide).map(Number));
  expect('tilt a full glass and it spills over the LOW rim only', sim.stats.spilledV > 0 && sides.size === 1 && sides.has(sim.geom.tilt.lowRimSide),
    `${(sim.stats.spilledV * 1e6).toFixed(0)} ml over side ${[...sides].join(',')} (low side ${sim.geom.tilt.lowRimSide})`, 'geometry + rim pinning');
}

process.exitCode = summary() ? 1 : 0;
