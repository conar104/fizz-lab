// Fizz Lab — does every variable push the result in the direction reality does?
// One-factor-at-a-time sweeps from a common cola pour, each tied to evidence.
// Run: node tests/trends.test.js
const { section, expect, summary } = require('./harness');
const { Fizz, pour, BASE } = require('./scenario');

const run = (over, opts) => pour(Object.assign({}, BASE, over), opts);
const mm = (m) => `${(m * 1000).toFixed(0)} mm`;
const ml = (v) => `${(v * 1e6).toFixed(0)} ml`;
const gL = (c) => `${c.toFixed(2)} g/L`;
const rising = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

// ---------------------------------------------------------------------------
section('Temperature');
{
  const r = [4, 15, 25].map(t => run({ sodaTemp: t }));
  expect('warmer soda loses more CO2 while pouring', rising(r.map(x => x.lostDuringPour)),
    r.map((x, i) => `${[4, 15, 25][i]}°C → ${gL(x.lostDuringPour)}`).join(', '), 'Liger-Belair et al. 2010 (measured on champagne)');
  expect('warmer soda builds a bigger head', rising(r.map(x => x.foamGasPeak)),
    r.map((x, i) => `${[4, 15, 25][i]}°C → ${ml(x.foamGasPeak)} foam gas`).join(', '), 'Henry\'s law: higher supersaturation (Weiss 1974)');
}
{
  const cold = run({ cupTemp: -15, material: 'ceramic' }, { watch: 60 }), hot = run({ cupTemp: 60, material: 'ceramic' }, { watch: 60 });
  expect('a hot mug warms the soda; a frozen mug chills it', hot.Tend > cold.Tend + 3,
    `after 60 s: ${hot.Tend.toFixed(1)} °C vs ${cold.Tend.toFixed(1)} °C`, 'lumped heat transfer through the wall');
  expect('…and the warmed soda goes flat faster', hot.cEnd < cold.cEnd, `${gL(hot.cEnd)} vs ${gL(cold.cEnd)}`, 'Henry\'s law');
}

// ---------------------------------------------------------------------------
section('How it is poured');
{
  const v = run({}), t = run({ tilt: 45, pourHeight: 1 }, { style: 'tilted' });
  expect('a tilted ("beer-like") pour keeps more CO2', t.lostDuringPour < v.lostDuringPour,
    `${gL(t.lostDuringPour)} vs ${gL(v.lostDuringPour)}`, 'Liger-Belair et al. 2010');
  expect('…and makes less foam', t.foamGasPeak < v.foamGasPeak, `${ml(t.foamGasPeak)} vs ${ml(v.foamGasPeak)}`, 'Liger-Belair et al. 2010; bartending practice');
}
{
  const r = [0, 10, 25].map(h => run({ pourHeight: h }));
  expect('pouring from higher up makes more foam', rising(r.map(x => x.foamGasPeak)),
    r.map((x, i) => `${[0, 10, 25][i]} cm → ${ml(x.foamGasPeak)}`).join(', '), 'plunging-jet air entrainment grows with fall height (Bin 1993)');
  expect('…and strips more CO2', rising(r.map(x => x.lostDuringPour)),
    r.map((x, i) => `${[0, 10, 25][i]} cm → ${gL(x.lostDuringPour)}`).join(', '), 'Bin 1993; Liger-Belair 2010');
}
{
  const slow = run({ tiltSpeed: 15 }, { watch: 2 }), fast = run({ tiltSpeed: 300 }, { watch: 2 });
  const sb = slow.sim.bottle, fb = fast.sim.bottle;
  expect('both a slow tip and a fast flip deliver the full amount', slow.d.poured > 249e-6 && fast.d.poured > 249e-6,
    `${ml(slow.d.poured)} and ${ml(fast.d.poured)}`, 'mass conservation');
}
{
  const B = Fizz.Bottle, fl = Fizz.Props.fluid(Fizz.Props.BEVERAGES.cola, 277);
  const drain = (type) => { const b = new B(B.TYPES[type]); b.open(101325); let t = 0; while (b.V > 1e-7 && t < 120) { b.step(1 / 240, { holding: true, tiltSpeed: 300 }, fl); t += 1 / 240; } return t; };
  const t500 = drain('pet500'), t2l = drain('pet2l'), tg = drain('glass355');
  expect('upturned bottles with the same neck drain at about the same rate', Math.abs(500 / t500 - 2000 / t2l) / (500 / t500) < 0.25,
    `500 ml: ${(500 / t500).toFixed(0)} ml/s, 2 L: ${(2000 / t2l).toFixed(0)} ml/s`, 'Clanet & Searby 2004: rate set by neck diameter, ∝ d^2.5');
  expect('a narrower neck drains more slowly', 355 / tg < 500 / t500, `17 mm neck: ${(355 / tg).toFixed(0)} ml/s vs 21.7 mm: ${(500 / t500).toFixed(0)} ml/s`, 'Clanet & Searby 2004');
}

// ---------------------------------------------------------------------------
section('What is in the glass');
{
  const r = [2.0, 3.0, 4.0].map(v => run({ carbonation: v }));
  expect('more carbonation → more foam', rising(r.map(x => x.foamGasPeak)),
    r.map((x, i) => `${[2, 3, 4][i]} vol → ${ml(x.foamGasPeak)}`).join(', '), 'supersaturation drives bubble growth (Liger-Belair 2005)');
}
{
  // What Coffey actually showed: diet's lower surface tension makes it nucleate harder — a bigger Mentos eruption
  const mentosAt = { at: { 12: (s) => s.dropMentos() }, style: 'tilted', watch: 15 };
  const diet = run({ beverage: 'diet', carbonation: 3.8, tilt: 45, pourHeight: 0 }, mentosAt);
  const reg = run({ beverage: 'cola', carbonation: 3.8, tilt: 45, pourHeight: 0 }, mentosAt);
  // Evidence is mixed: Coffey (2008) — aspartame/benzoate lower σ, favouring diet;
  // Kuntzleman et al. (2017) — sucrose, glucose, citric acid ALSO raise geysers
  // (they inhibit coalescence). At equal CO2 neither should dominate strongly.
  const rel = Math.abs(diet.foamGasPeak - reg.foamGasPeak) / reg.foamGasPeak;
  expect('diet and regular cola erupt comparably with a Mentos at equal CO2 (within ±25 %)', rel < 0.25,
    `diet ${ml(diet.foamGasPeak)} vs regular ${ml(reg.foamGasPeak)} of foam`,
    'Coffey 2008, Am. J. Phys. 76:551; Kuntzleman et al. 2017, J. Chem. Educ. 94:569 (mixed evidence)');
}
{
  const club = run({ beverage: 'club', carbonation: 3.0 }), root = run({ beverage: 'rootbeer', carbonation: 3.7 }, { watch: 240 }), cola = run({}, { watch: 240 });
  expect('club soda forms almost no lasting head', club.headLife < 5 && club.maxFoamH < 0.01,
    `head lasts ${club.headLife.toFixed(1)} s, peak ${mm(club.maxFoamH)}`, 'no surfactants → films rupture immediately');
  expect('root beer\'s head outlasts cola\'s', root.headLife > cola.headLife,
    `${root.headLife.toFixed(0)} s vs ${cola.headLife.toFixed(0)} s`, 'saponin foaming agents (yucca/quillaja) are added to root beer for its head');
}
{
  const orange = run({ beverage: 'orange', carbonation: 1.8 }), cola = run({});
  expect('lightly carbonated orange soda (1.8 vol) foams far less than cola', orange.foamGasPeak < 0.5 * cola.foamGasPeak,
    `${ml(orange.foamGasPeak)} vs ${ml(cola.foamGasPeak)}`, 'Ali et al. 2022 measured 1.8 vol');
}

// ---------------------------------------------------------------------------
section('The cup');
{
  const narrow = run({ cupDiameter: 6, cupHeight: 20 }), wide = run({ cupDiameter: 10, cupHeight: 20 });
  expect('the same pour gives a lower head in a wider cup', wide.maxFoamH < narrow.maxFoamH,
    `Ø10 cm: ${mm(wide.maxFoamH)} vs Ø6 cm: ${mm(narrow.maxFoamH)}`, 'geometry: head height = foam volume / area');
}
{
  const dry = run({}), rinsed = run({ rinsed: true });
  expect('a rinsed glass fizzes less after the pour', rinsed.emissionAfter < dry.emissionAfter,
    `${rinsed.emissionAfter.toFixed(0)} vs ${dry.emissionAfter.toFixed(0)} bubbles/s`, 'pre-wetting floods gas-trapping cavities (Bankoff 1958; Liger-Belair 2005)');
}
{
  // hold temperature equal (cup and room at soda temperature) so only the surface differs
  const iso = { cupTemp: 4, roomTemp: 4 };
  const r = ['glass', 'plastic', 'styrofoam'].map(m => run(Object.assign({ material: m }, iso), { watch: 120 }));
  const after = r.map(x => x.cAfterPour - x.cEnd);
  expect('[model assumption] rougher, hydrophobic cups degas the soda faster than glass', after[1] > after[0] && after[2] > after[0],
    r.map((x, i) => `${['glass', 'plastic', 'styrofoam'][i]} loses ${gL(after[i])} in 2 min`).join(', '),
    'direction follows Bankoff gas trapping (1958); the site densities themselves are estimates');
}
{
  const t0 = run({ tilt: 0 }), t45 = run({ tilt: 45, pourHeight: 1 }, { style: 'tilted' });
  expect('a tilted glass holds less before spilling', t45.sim.tiltGeometry && Fizz.Tilt.make(0.075, 0.15, Math.PI / 4).rimLevel < 0.15,
    `upright rim 150 mm; at 45° liquid spills at ${(Fizz.Tilt.make(0.075, 0.15, Math.PI / 4).rimLevel * 1000).toFixed(0)} mm equivalent`, 'geometry');
}

// ---------------------------------------------------------------------------
section('Ice, Mentos, stirring, altitude');
{
  const r = [0, 6].map(n => run({ iceCubes: n }));
  expect('ice makes more foam', r[1].foamGasPeak > r[0].foamGasPeak, `${ml(r[0].foamGasPeak)} → ${ml(r[1].foamGasPeak)}`, 'common observation; stream cascades through the pile');
  expect('ice chills the soda', r[1].Tend < r[0].Tend, `${r[0].Tend.toFixed(1)} → ${r[1].Tend.toFixed(1)} °C`, 'melting absorbs 334 kJ/kg');
}
{
  const plain = run({ tilt: 45, pourHeight: 0 }, { style: 'tilted', watch: 20 });
  const mentos = run({ tilt: 45, pourHeight: 0 }, { style: 'tilted', watch: 20, at: { 12: (s) => s.dropMentos() } });
  expect('a Mentos makes a burst of foam and strips CO2', mentos.foamGasPeak > 3 * plain.foamGasPeak && mentos.cEnd < plain.cEnd - 0.5,
    `foam ${ml(plain.foamGasPeak)} → ${ml(mentos.foamGasPeak)}, CO2 ${gL(plain.cEnd)} → ${gL(mentos.cEnd)}`, 'Coffey 2008');
}
{
  const still = run({}, { watch: 25 }), stirred = run({}, { watch: 25, at: { 15: (s) => s.setStir(true), 25: (s) => s.setStir(false) } });
  expect('stirring flattens soda faster', stirred.cEnd < still.cEnd - 0.2, `${gL(still.cEnd)} → ${gL(stirred.cEnd)}`, 'agitation raises gas transfer (Lamont & Scott 1970)');
}
{
  const sea = run({ pressure: 101.3 }), denver = run({ pressure: 83.5 });
  expect('at altitude the same soda loses more CO2', denver.lostDuringPour > sea.lostDuringPour,
    `${gL(denver.lostDuringPour)} vs ${gL(sea.lostDuringPour)}`, 'Henry\'s law: lower ambient pressure, higher supersaturation');
}

// ---------------------------------------------------------------------------
section('Conservation');
for (const [name, over] of [['plain pour', {}], ['ice pour', { iceCubes: 6 }], ['overflowing pour', { pourHeight: 25, cupHeight: 9 }]]) {
  const r = run(over, { watch: 30 }), s = r.sim;
  const inV = s.pour.poured + s.ice.melted / Fizz.Props.rhoWater(273.15);
  const outV = s.cupVolume + s.foam.liquidVolume + s.stats.spilledV + s.stream.flyingV - s.ice.tableMelt / Fizz.Props.rhoWater(273.15);
  expect(`liquid is conserved (${name})`, Math.abs(inV - outV) / inV < 0.01,
    `in ${ml(inV)} (poured + melt), accounted ${ml(outV)} (cup incl. meltwater layer + foam + spilled + in the stream)`, 'mass balance');
  const dissolved = s.liquid.n + s.water.n + s.foam.co2Moles;
  expect(`dissolved CO2 never exceeds what was poured (${name})`, dissolved <= s.stats.co2In * 1.0001 && dissolved >= 0,
    `${(dissolved * 44).toFixed(3)} g ≤ ${(s.stats.co2In * 44).toFixed(3)} g`, 'mass balance');
}

process.exitCode = summary() ? 1 : 0;
