// Fizz Lab — things that move or leave the glass: sloshing, throwing, the stream,
// erupting foam, puddles; and the meltwater layer and salt's heat.
//   Run: node tests/motion.test.js
const { section, near, expect, summary, seed } = require('./harness');
const { Fizz } = require('./scenario');
const { Simulation, Slosh, Table, Stream, Ice, Props, C } = Fizz;
const K = (t) => t + C.T0;
const ml = (v) => `${(v * 1e6).toFixed(1)} ml`;

/** A glass that already holds still liquid (no pour). */
function still(params, mlV, t, extra = {}) {
  seed(extra.seed || 5);
  const sim = new Simulation(Object.assign({ beverage: 'club', carbonation: 0, iceCubes: 0 }, params));
  sim.liquid.V = mlV * 1e-6; sim.liquid.T = K(t); sim.liquid.n = extra.n || 0; sim.liquid.s = 1;
  sim.wall.T = K(params.cupTemp != null ? params.cupTemp : t);
  sim.geom = sim.computeGeometry();
  return sim;
}

// ---------------------------------------------------------------------------
section('Sloshing');
{
  // Lamb's first mode in a 7.5 cm glass with 8 cm of water, measured from the simulated oscillation
  const R = 0.0375, h = 0.08;
  const fTheory = Slosh.frequency(R, h) / (2 * Math.PI);
  const sim = still({ cupDiameter: 7.5, cupHeight: 12 }, Math.PI * R * R * h * 1e6, 20);
  sim.slosh.delta = 0.05;                                       // start it rocking, then let it ring
  const ts = [];
  let last = sim.slosh.delta;
  for (let i = 0; i < 4 * 1200; i++) {
    sim.step(1 / 1200);
    const d = sim.slosh.delta;
    if (last > 0 && d <= 0) ts.push(sim.time);
    last = d;
  }
  const period = (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
  near('first sloshing mode, 7.5 cm glass, 8 cm water (Hz)', 1 / period, 3.49, 0.03,
    'Lamb (1932): ω² = (gξ₁/R)·tanh(ξ₁h/R), ξ₁ = 1.8412 → 3.49 Hz');
  near('…the simulation rings at the theoretical frequency (Hz)', 1 / period, fTheory, 0.02, 'integrator check');
  const zeta = Slosh.damping(R, h, 1e-6, 0), zFoam = Slosh.damping(R, h, 1e-6, 0.02);
  expect('a head of foam damps the slosh (2 cm of foam ≫ wall friction)', zFoam > 3 * zeta,
    `ζ = ${zeta.toFixed(4)} clean (Stokes ${Slosh.viscousDamping(R, h, 1e-6).toFixed(4)} + contact line), ${zFoam.toFixed(3)} under 2 cm of foam`,
    'Mikishev & Dorozhkin 1961 (viscous); Keulegan 1959 (contact line); Sauret et al. 2015 (foam)');
}
{
  // the hand: slow vs fast to 50°, glass 90 % full of water
  const run = (fast) => {
    const sim = still({ cupDiameter: 7.5, cupHeight: 12 }, 480, 20, { seed: 7 });
    for (let i = 0; i < 60; i++) sim.step(1 / 120);
    const steps = fast ? 1 : 300;                              // 1: snap the target; 300: ease it over 2.5 s
    let thrownMax = 0;
    for (let i = 0; i < 6 * 120; i++) {
      sim.params.tilt = Math.min(50, 50 * (i + 1) / steps);
      sim.step(1 / 120);
    }
    const far = sim.table.puddles.filter(p => Math.abs(p.x) > 0.03 + sim.D);   // well clear of the glass's foot
    return { sim, thrown: sim.eject.liquidV, spilled: sim.stats.spilledV, far: far.reduce((s, p) => s + p.V, 0) };
  };
  const slow = run(false), fast = run(true);
  expect('the cup follows a hand, not a teleport: it takes a few tenths of a second to swing over', (() => {
    const sim = still({}, 100, 20); sim.params.tilt = 40;
    for (let i = 0; i < 12; i++) sim.step(1 / 120);           // 0.1 s
    return sim.tiltDeg > 5 && sim.tiltDeg < 35;
  })(), 'after 0.1 s the cup is part-way to a 40° target', 'critically damped hand, ω_h = 14 rad/s');
  expect('tipping a full glass slowly pours it over the rim, down the outside', slow.spilled > 50e-6 && slow.thrown < 0.2 * slow.spilled,
    `${ml(slow.spilled)} over the rim, ${ml(slow.thrown)} of it flying`, 'teapot effect: slow liquid clings to the rim');
  expect('swinging it over fast throws drink clear of the glass, onto the table', fast.thrown > 2 * slow.thrown && fast.thrown > 10e-6,
    `${ml(fast.thrown)} thrown (vs ${ml(slow.thrown)} tipping slowly); ${ml(fast.far)} landed > 3 cm beyond the glass`, 'rim velocity + slosh wave vs u_c (Duez et al. 2010)');
}

{
  // ice: a slow tip keeps the cubes in; a hard flick throws them out of the mouth
  const swing = (fast) => {
    seed(4);
    const sim = new Simulation({ beverage: 'cola', iceCubes: 8, pourAmount: 0.0001 });
    for (let i = 0; i < 240; i++) sim.step(1 / 120);
    for (let i = 0; i < 4 * 120; i++) { sim.params.tilt = fast ? 90 : Math.min(90, i / 120 * 25); sim.step(1 / 120); }
    return { thrown: sim.stats.iceThrown || 0, out: sim.ice.cubes.filter(c => c.where !== 'cup'),
             far: Math.max(0, ...sim.ice.cubes.filter(c => c.where === 'table').map(c => -c.x)) };
  };
  const slowI = swing(false), fastI = swing(true);
  expect('tipping a glass of ice slowly onto its side keeps the cubes in it', slowI.out.length === 0,
    `${slowI.out.length} of 8 left the glass`, 'they rest on the low wall');
  expect('flicking it over hard throws the ice out (centrifugal + the sudden stop)', fastI.thrown >= 3 && fastI.far > 0.05,
    `${fastI.thrown} flung out of the mouth, landing up to ${(fastI.far * 100).toFixed(0)} cm away`, 'rigid-body dynamics in the swinging frame: −(α×r − ω²r) − 2Ω×w');
}

{
  // a violent slosh breaks and dies instead of ringing (and sloshing the drink back out)
  seed(5);
  const sim = new Simulation({ beverage: 'cola', pourAmount: 420 });
  sim.startPour(true);
  while (sim.pour.active || sim.pour.Q > 0 || sim.pour.Qin > 0) sim.step(1 / 120);
  for (let i = 0; i < 600; i++) sim.step(1 / 120);
  sim.params.tilt = 70;
  for (let i = 0; i < 60; i++) sim.step(1 / 120);
  let late = 0;
  for (let i = 0; i < 240; i++) { sim.step(1 / 120); if (i > 120) late = Math.max(late, Math.abs(sim.slosh.delta)); }
  expect('after a fling the wave breaks and the surface settles within a second', late < 0.15,
    `|δ| ≤ ${(late * 57.3).toFixed(1)}° from 1.5 s on (it rang at ±50° for seconds without breaking)`, 'wave breaking when η ≳ 0.5·h or η/λ ≳ 0.2');
}
{
  // Mentos and salt are thrown by a hard swing too
  seed(4);
  const sim = new Simulation({ beverage: 'diet', pourAmount: 150 });
  sim.startPour(true);
  while (sim.pour.active || sim.pour.Q > 0 || sim.pour.Qin > 0) sim.step(1 / 120);
  for (let i = 0; i < 3; i++) sim.dropMentos();
  for (let i = 0; i < 240; i++) sim.step(1 / 120);
  for (let i = 0; i < 3 * 120; i++) { sim.params.tilt = 90; sim.step(1 / 120); }
  const out = sim.additives.mentos.filter(m => m.where !== 'cup');
  expect('a flick throws Mentos out of the glass onto the table', out.length >= 1 && out.every(m => m.where === 'table' && m.ty < 0.01),
    `${out.length} of 3 on the table, ${out.map(m => (Math.abs(m.tx) * 100).toFixed(0) + ' cm').join(', ')} from the glass's corner`, 'the same swing forces as the ice');
}

// ---------------------------------------------------------------------------
section('Puddles');
{
  // Huppert's similarity solution for a viscous gravity current, checked with a glycerol-like liquid
  const fl = { rho: 1260, mu: 1.4, sigma: 0.063, D: 1e-9 };
  const T = new Table.Table();
  const V = 50e-6;
  T.deposit(0, 0, V, 0, 1);
  T.puddles[0].r = 0.01;                                       // start small; the solution forgets its start
  for (let i = 0; i < 2000; i++) T.step(0.001, { fl, catchCup: () => false, hitsCup: () => false });
  const huppert = 0.894 * Math.pow(fl.rho * C.G * V ** 3 / (3 * fl.mu), 1 / 8) * Math.pow(2, 1 / 8);
  near('a viscous puddle spreads as r ∝ t^(1/8): radius at 2 s (cm)', T.puddles[0].r * 100, huppert * 100, 0.03,
    'Huppert 1982, J. Fluid Mech. 121:43 (r = 0.894(ρgV³/3μ)^⅛ t^⅛; matched his silicone-oil experiments)');
  const water = Props.fluid(Props.BEVERAGES.club, K(20));
  const W = new Table.Table();
  W.deposit(0, 0, 100e-6, 0, 1);
  for (let i = 0; i < 1000; i++) W.step(0.002, { fl: water, catchCup: () => false, hitsCup: () => false });
  const h = W.puddles[0].V / (Math.PI * W.puddles[0].r ** 2);
  near('spilled water stops spreading at its puddle height (mm)', h * 1000, 2 * Math.sqrt(water.sigma / (water.rho * C.G)) * Math.sin(35 * Math.PI / 180) * 1000, 0.02,
    'gravity–capillary balance h = 2 l_c sin(θ/2), θ ≈ 70° on varnished wood (de Gennes et al., Capillarity and Wetting Phenomena)');
  expect('…about 3 mm: 100 ml covers a disc ~20 cm across', h > 2.5e-3 && h < 3.6e-3 && W.puddles[0].r > 0.09,
    `${(h * 1000).toFixed(2)} mm thick, ${(W.puddles[0].r * 200).toFixed(1)} cm across`, 'everyday observation');
  const M = new Table.Table();
  M.deposit(0, 0, 20e-6, 0, 1); M.deposit(0.06, 0, 20e-6, 0, 0);
  for (let i = 0; i < 1000; i++) M.step(0.002, { fl: water, catchCup: () => false, hitsCup: () => false });
  expect('puddles that spread into each other merge', M.puddles.length === 1 && Math.abs(M.puddles[0].V - 40e-6) < 1e-9,
    `${M.puddles.length} puddle, ${ml(M.puddles[0].V)}, ${(M.puddles[0].s * 100).toFixed(0)} % soda`, 'mass balance');
}

{
  // the table's back edge: a puddle pins at a square edge until it stands thicker than h_edge
  const water = Props.fluid(Props.BEVERAGES.club, K(20));
  const ctx = { fl: water, bev: Props.BEVERAGES.club, catchCup: () => false, hitsCup: () => false };
  const slow = new Table.Table();
  for (let i = 0; i < 300; i++) { slow.deposit(0, Table.EDGE.back + 0.03, 1e-6, 1); for (let k = 0; k < 10; k++) slow.step(0.01, ctx); }
  for (let i = 0; i < 300; i++) slow.step(0.01, ctx);
  expect('a spill that spreads to the back edge of the table pins there instead of running off', slow.floorV < 1e-6 && slow.puddles[0].atEdge,
    `${ml(slow.floorV)} of 300 ml went over; the puddle (${(slow.puddles[0].h * 1000).toFixed(2)} mm) is held at the edge`,
    'Gibbs pinning at a 90° edge: passes only above 2·l_c·sin(α/2) ≈ 3.9 mm');
  const dump = new Table.Table();
  dump.deposit(0, Table.EDGE.back + 0.005, 300e-6, 1);
  for (let i = 0; i < 300; i++) dump.step(0.002, ctx);
  expect('…but 300 ml dumped right at the edge piles up past that and runs over onto the floor', dump.floorV > 5e-6,
    `${ml(dump.floorV)} ran off before the rest could spread`, 'Gibbs pinning; Huppert spreading');
}

// ---------------------------------------------------------------------------
section('The stream');
{
  const fl = Props.fluid(Props.BEVERAGES.cola, K(4));
  near('a pouring stream (8 mm, 1 m/s) stays whole for (m)', Stream.breakupLength(0.008, 1, fl), 0.008 * 19.5 * Math.pow(Math.sqrt(fl.rho * 0.008 / fl.sigma) * (1 + 3 * fl.mu / Math.sqrt(fl.rho * fl.sigma * 0.008)), 0.85), 1e-9,
    'Grant & Middleman 1966: L/d = 19.5[√We(1 + 3Oh)]^0.85');
  expect('…over a metre; a 2 mm trickle at 0.3 m/s breaks into drops within centimetres',
    Stream.breakupLength(0.008, 1, fl) > 1 && Stream.breakupLength(0.002, 0.3, fl) < 0.15,
    `${Stream.breakupLength(0.008, 1, fl).toFixed(2)} m vs ${(Stream.breakupLength(0.002, 0.3, fl) * 100).toFixed(1)} cm`, 'Rayleigh–Plateau');
  seed(3);
  const sim = new Simulation({ beverage: 'diet', pourAmount: 250, pourHeight: 5 });
  sim.startPour(true);
  let tOut = -1, tIn = -1;
  for (let i = 0; i < 12 * 120; i++) {
    sim.step(1 / 120);
    if (tOut < 0 && sim.pour.Q > 0) tOut = sim.time;
    if (tIn < 0 && sim.pour.Qin > 0) tIn = sim.time;
  }
  const P = sim.pour, d = sim.diagnostics();
  const fall = P.mouth.y - 0.01;                                 // to an (almost) empty glass
  const tBall = Math.sqrt(2 * fall / C.G);
  expect('the stream takes its time to arrive: delay ≈ free-fall time', tIn - tOut > 0.6 * tBall && tIn - tOut < 1.5 * tBall,
    `${((tIn - tOut) * 1000).toFixed(0)} ms from lip to drink; √(2h/g) = ${(tBall * 1000).toFixed(0)} ms`, 'ballistics');
  expect('a steady pour leaves the lip cleanly (≲ 1 % dribbles onto the table)', d.streamMissed < 0.01 * P.poured,
    `${ml(d.streamMissed)} of ${ml(P.poured)} missed`, 'teapot effect: fast flow separates (Duez et al. 2010)');
  const u = 0.05, uc = Stream.separationSpeed(fl, 72, Stream.BOTTLE_LIP_K);
  expect('…while a trickle mostly dribbles down the neck', Stream.clingFraction(u, uc) > 0.5 && Stream.clingFraction(0.5, uc) < 0.01,
    `clinging share ${(Stream.clingFraction(u, uc) * 100).toFixed(0)} % at 5 cm/s, ${(Stream.clingFraction(0.5, uc) * 100).toFixed(2)} % at 50 cm/s`, 'teapot effect');
}
{
  // swing the glass out from under the stream: the pour lands on the table
  seed(3);
  const sim = new Simulation({ beverage: 'diet', pourAmount: 300, pourHeight: 5, cupDiameter: 6 });
  sim.startPour(true);
  for (let i = 0; i < 4 * 120; i++) sim.step(1 / 120);
  const before = sim.diagnostics().streamMissed;
  sim.params.tilt = 70;                                         // the glass leans right away
  for (let i = 0; i < 2 * 120; i++) sim.step(1 / 120);
  const missed = sim.diagnostics().streamMissed - before;
  expect('tip the glass away mid-pour and the stream lands on the table', missed > 5e-6 && sim.table.puddles.length > 0,
    `${ml(missed)} missed in 2 s; ${sim.table.puddles.length} puddle(s)`, 'ballistics');
}

{
  // the bottle in your hand: you set the angle, the bottle physics sets the flow
  seed(3);
  const sim = new Simulation({ beverage: 'diet' });
  sim.grabBottle(); sim.moveBottle(-0.02, sim.H + 0.06);
  for (let i = 0; i < 60; i++) sim.step(1 / 120);
  const flowAt = (phi) => { sim.tipBottle(phi); let q = 0, n = 0; for (let i = 0; i < 240; i++) { sim.step(1 / 120); if (i > 120) { q += sim.pour.Q; n++; } } return q / n; };
  const q70 = flowAt(70), q90 = flowAt(90), q150 = flowAt(150);
  expect('held by the cursor, tipping the bottle further pours faster, up to the glug limit', q70 < q90 && q90 <= q150 * 1.05 && q150 > 30e-6,
    `${(q70 * 1e6).toFixed(0)} → ${(q90 * 1e6).toFixed(0)} → ${(q150 * 1e6).toFixed(0)} ml/s at 70°, 90°, 150° (${sim.bottle.regime})`, 'weir flow over the lip; Davies–Taylor glug ceiling (bottle.js)');
  const inGlass = sim.cupVolume;
  sim.releaseBottle();
  for (let i = 0; i < 2 * 120; i++) sim.step(1 / 120);
  expect('…the stream lands where its arc takes it (here: in the glass), and letting go stops the pour', inGlass > 100e-6 && sim.pour.Q === 0 && !sim.bottleHeld,
    `${(inGlass * 1e6).toFixed(0)} ml in the glass; after letting go the flow is ${(sim.pour.Q * 1e6).toFixed(1)} ml/s`, 'ballistic stream (stream.js)');
}

// ---------------------------------------------------------------------------
section('Erupting foam');
{
  const erupt = (T, D) => {
    seed(3);
    const sim = new Simulation({ beverage: 'diet', sodaTemp: T, pourAmount: 300, cupDiameter: D, cupHeight: 12 });
    sim.startPour(true);
    while (sim.pour.active || sim.pour.Q > 0 || sim.pour.Qin > 0) sim.step(1 / 120);
    for (let i = 0; i < 120; i++) sim.step(1 / 120);
    for (let i = 0; i < 6; i++) sim.dropMentos();
    let uMax = 0;
    for (let i = 0; i < 15 * 120; i++) { sim.step(1 / 120); uMax = Math.max(uMax, sim.eject.u); }
    return { sim, uMax, thrown: sim.eject.flungV || 0, broken: sim.eject.brokenV || 0, out: sim.stats.foamSpilledV };
  };
  const cold = erupt(4, 7.5), warm = erupt(20, 7.5);
  expect('six Mentos push the head out of the glass, faster in warm soda', warm.uMax > 2 * cold.uMax && cold.uMax > 0.03,
    `foam leaves the mouth at up to ${(cold.uMax * 100).toFixed(0)} cm/s (4 °C) vs ${(warm.uMax * 100).toFixed(0)} cm/s (20 °C)`, 'u = foam volume rate / mouth area');
  const share = (r) => r.thrown / Math.max(r.out, 1e-12);
  expect('the eruption is graded: the faster the head comes out, the more of it is flung upward', share(warm) > 1.5 * share(cold) && share(warm) > 0.3,
    `${(share(cold) * 100).toFixed(0)} % flung up at 4 °C, ${(share(warm) * 100).toFixed(0)} % at 20 °C`,
    'ρ_f u² against yield stress + rim adhesion (foam rheology; teapot effect)');
  const off = (r) => (r.thrown + r.broken) / Math.max(r.out, 1e-12);
  expect('an aggressive head is too much for the outside of the glass to carry: it breaks off the rim', off(cold) > 0.4,
    `${(off(cold) * 100).toFixed(0)} % of the 4 °C overflow leaves the glass in clumps — the surge breaks off, the slow tail creeps (${(cold.broken * 1e6).toFixed(0)} ml broke off the rim)`,
    'a Bingham film clings up to ~2τ_y/ρ_f g thick and drains at only ~1 ml/s round a 7.5 cm rim');
  const axisX = warm.sim.worldToTable(0, 0)[0], Ro = warm.sim.D / 2 + 0.003;
  const reach = Math.max(...warm.sim.table.puddles.map(p => Math.hypot(p.x - axisX, p.z) + p.r));
  expect('…and it lands on the table around the glass', warm.sim.table.landedV > 0 && reach > Ro + 0.01,
    `${ml(warm.sim.table.landedV)} landed; the wet ring reaches ${((reach - Ro) * 100).toFixed(1)} cm beyond the glass`, 'ballistics with drag');
}

{
  // a slow overflow creeps down the outside instead
  seed(3);
  const sim = new Simulation({ beverage: 'rootbeer' in Props.BEVERAGES ? 'rootbeer' : 'cola', sodaTemp: 4, pourAmount: 330, cupHeight: 9, pourRate: 15 });
  sim.startPour(true);
  for (let i = 0; i < 40 * 120; i++) sim.step(1 / 120);
  const out = sim.stats.foamSpilledV, off = (sim.eject.flungV || 0) + (sim.eject.brokenV || 0);
  expect('…while a head that creeps over the rim slowly runs down the outside of the glass', out > 0 ? off < 0.9 * out : true,
    `${ml(out)} over the rim, ${ml(off)} of it fell off`, 'Bingham film on the glass (capillary.js)');
}
{
  // foam on the table: a yield-stress heap (Nye profile), then it bursts and drains away
  const T = new Table.Table();
  const fl = Props.fluid(Props.BEVERAGES.cola, K(10)), bev = Props.BEVERAGES.cola;
  T.depositFoam(0, 0, 40e-6, 10e-6, 3e-4, 1);
  T.step(1e-3, { fl, bev, catchCup: () => false, hitsCup: () => false });
  const p = T.piles[0];
  const tau = Fizz.Capillary.foamYieldStress(fl.sigma, 3e-4, 0.2), rhoF = 0.2 * fl.rho;
  const nye = Table.heapShape(50e-6, tau, rhoF);
  near('50 ml of foam on the table stands this tall (mm)', p.h * 1000, nye.h * 1000, 0.03,
    'plastic heap h² = 2τ_y(r₀ − r)/ρ_f g (Nye 1951; Coussot 2005), τ_y from Mason et al. 1996');
  expect('…a low mound, not a film: surface tension in its films holds it up', p.h > 5e-3 && p.r < 0.08,
    `${(p.h * 1000).toFixed(1)} mm tall, ${(p.r * 200).toFixed(1)} cm across (τ_y = ${tau.toFixed(2)} Pa)`, 'foam yield stress');
  let t = 0;
  while (T.piles.length && t < 300) { T.step(0.05, { fl, bev, catchCup: () => false, hitsCup: () => false }); t += 0.05; }
  const liq = T.puddles.reduce((s, q) => s + q.V, 0);
  expect('…then it collapses into a puddle of its liquid', T.piles.length === 0 && Math.abs(liq - 10e-6) < 1e-8,
    `gone after ${t.toFixed(0)} s, leaving ${ml(liq)} of liquid`, 'bursting and drainage as in the head (foam.js)');
}

{
  // the fizz spray: bubbles bursting at the surface fling droplets centimetres up
  seed(3);
  const sim = new Simulation({ beverage: 'champagne', carbonation: 5.8, pourAmount: 120, cupDiameter: 5, cupHeight: 18, bottle: 'glass355' });
  sim.startPour(true);
  let top = 0;
  for (let i = 0; i < 15 * 120; i++) {
    sim.step(1 / 120);
    for (const d of sim.table.drops) if (d.spray) top = Math.max(top, sim.tableToCup(d.x, d.y)[1] - sim.geom.level);
  }
  expect('bursting bubbles throw a fine spray a few centimetres above the drink', top > 0.01 && top < 0.25 && sim.diagnostics().sprayV > 0,
    `droplets reached ${(top * 100).toFixed(1)} cm above the surface; ${(sim.diagnostics().sprayV * 1e6).toFixed(4)} ml sprayed in all`,
    'jet drops (Blanchard 1963; Spiel 1997; Ghabache & Séon 2016); champagne aerosols rise several cm');
}
{
  // Mentos and salt land at random spots in the glass, in 3-D, and stay inside it
  seed(8);
  const sim = new Simulation({ beverage: 'diet', pourAmount: 250, cupDiameter: 7.5 });
  sim.startPour(true);
  while (sim.pour.active || sim.pour.Q > 0 || sim.pour.Qin > 0) sim.step(1 / 120);
  for (let i = 0; i < 5; i++) sim.dropMentos();
  sim.addSalt();
  for (let i = 0; i < 3 * 120; i++) sim.step(1 / 120);
  const M = sim.additives.mentos, R = sim.D / 2;
  const spreadZ = Math.max(...M.map(m => m.z)) - Math.min(...M.map(m => m.z));
  expect('Mentos land at random spots across the glass (and in depth), lying on its floor', spreadZ > 0.005 && M.every(m => Math.hypot(m.x, m.z) <= R - 0.0095 + 1e-9 && m.y <= 0.0046),
    M.map(m => `(${(m.x * 100).toFixed(1)}, ${(m.z * 100).toFixed(1)}) cm`).join(' '), 'random release + wall contact');
  // the spoon: one steady clockwise circle seen from above
  sim.setStir(true);
  const pts = [];
  for (let i = 0; i < 60; i++) { sim.step(1 / 120); pts.push([sim.spoonX(), sim.spoonZ()]); }
  let turn = 0;
  for (let i = 1; i < pts.length; i++) turn += pts[i - 1][0] * pts[i][1] - pts[i - 1][1] * pts[i][0];
  const r0 = Math.hypot(...pts[0]), rN = Math.hypot(...pts[pts.length - 1]);
  expect('the spoon goes round one circle, clockwise from above, at its stroke speed', turn > 0 && Math.abs(r0 - 0.3 * sim.D) < 1e-9 && Math.abs(rN - r0) < 1e-9,
    `radius ${(r0 * 100).toFixed(2)} cm; angle increases with x right, z toward the viewer (clockwise on the top view)`, 'geometry');
}

// ---------------------------------------------------------------------------
section('Meltwater layer');
{
  const layer = (bev, t) => {
    const sim = still({ beverage: bev, cupDiameter: 7.5, cupHeight: 12, iceSize: 2.5, iceTemp: 0, cupTemp: t, roomTemp: t }, 300, t, { seed: 9 });
    for (let i = 0; i < 3; i++) sim.addIce();
    let maxH = 0;
    for (let i = 0; i < 300 * 30; i++) { sim.step(1 / 30); maxH = Math.max(maxH, sim.diagnostics().layerH); }
    return { sim, maxH, V: sim.water.V };
  };
  const regular = layer('cola', 10), diet = layer('diet', 10);
  expect('fresh meltwater floats on sugary cola as its own layer', regular.maxH > 1e-3,
    `up to ${(regular.maxH * 1000).toFixed(1)} mm of water on top (${ml(regular.V)} after 5 min)`, 'ρ: cola 1043 kg/m³ vs meltwater 1000');
  expect('…but barely forms on diet cola, whose density is close to water’s', diet.maxH < 0.3 * regular.maxH,
    `${(diet.maxH * 1000).toFixed(2)} mm on diet (stirred in by the faintest flow: low Richardson number)`, 'Turner 1973: entrainment E ≈ 0.1/Ri');
}
{
  // The classic classroom experiment: a floating cube melts slower in salt water
  // than in fresh, because its cold fresh meltwater cannot sink and stays around
  // it (SERC/Carleton "Melting ice cubes"; MIT BLOSSOMS; Glessmer, 100+ runs).
  // The model has the mechanism — a floating fresh layer that insulates — but in
  // a glass that layer is a few mm deep against a 2.3 cm draft and is warmed by
  // the drink below and the glass around it, while a real cube sits wrapped in a
  // cold lens of its own meltwater. KNOWN GAP: here salt's lower melting point and
  // the layer roughly cancel, instead of salt being clearly slower.
  let layerSeen = 0;
  const meltTime = (salt, mixLayer) => {
    const sim = still({ beverage: 'club', cupDiameter: 7.5, cupHeight: 12, iceSize: 2.5, iceTemp: -18, cupTemp: 20, roomTemp: 20 }, 300, 20, { seed: 4 });
    sim.liquid.salt = salt * 1e-3 * 0.3 / 0.05844;              // g per kg × 0.3 kg → mol
    if (mixLayer) sim._stepLayer = function (dt, fl) { if (this.water.V > 0) this._mixLayer(this.water.V, fl, this._layerFluid()); };
    sim.addIce();
    let t = 0;
    while (t < 3600 && sim.ice.cubes.length && sim.ice.cubes[0].m > 0.05 * 14.3e-3) {
      sim.step(1 / 30); t += 1 / 30;
      if (salt && !mixLayer) layerSeen = Math.max(layerSeen, sim.diagnostics().layerH);
    }
    return t;
  };
  const fresh = meltTime(0), sea = meltTime(35), seaMixed = meltTime(35, true);
  expect('in salt water the cube’s meltwater floats on top as a fresh layer', layerSeen > 1.5e-3 && sea >= seaMixed,
    `up to ${(layerSeen * 1000).toFixed(1)} mm; melt time ${(seaMixed / 60).toFixed(1)} min if it mixed in, ${(sea / 60).toFixed(1)} min floating`, 'stratification (Huppert & Turner 1978)');
  expect('…so salt no longer speeds the melting of a floating cube [known gap: measured slower]', sea > 0.85 * fresh,
    `${(fresh / 60).toFixed(1)} min fresh vs ${(sea / 60).toFixed(1)} min at 35 g/kg; classroom runs find salt clearly slower`, 'SERC/Carleton; MIT BLOSSOMS; Glessmer 2018');
}
{
  // a water lid quietens the surface: foam made of watery liquid collapses faster
  const F = new Fizz.Foam();
  const bev = Props.BEVERAGES.cola, fl = Props.fluid(bev, K(4));
  const life = (s) => {
    F.clear(); F.add(50e-6, 50e-6 / Fizz.U.sphereVolume(3e-4), 12e-6, 0, 0.0044, s);
    let t = 0;
    while (F.gasVolume > 5e-6 && t < 300) { F.step(0.05, { fl, bev, Pamb: 101325, base: 0.05, areaAt: () => 0.0044 }); t += 0.05; }
    return t;
  };
  const soda = life(1), watery = life(0.2);
  expect('foam whose liquid is mostly meltwater collapses faster (fewer surfactants)', watery < 0.7 * soda,
    `head life ${soda.toFixed(1)} s (soda) vs ${watery.toFixed(1)} s (80 % meltwater)`, 'foam films need surfactants (estimate of the strength)');
}

// ---------------------------------------------------------------------------
section('Salt and heat');
{
  const sim = still({ beverage: 'club', cupDiameter: 7.5, cupHeight: 12, cupTemp: 20, roomTemp: 20 }, 300, 20);
  const saved = Object.assign({}, Simulation.HEAT);
  Simulation.HEAT.hAir = 0; Simulation.HEAT.hWall = 0;
  sim.wall.heatCapacity = 1e-9;
  for (let k = 0; k < 15; k++) sim.addSalt();
  for (let i = 0; i < 60 * 60; i++) sim.step(1 / 60);
  const mol = sim.liquid.salt;
  const expected = -mol * 3.88e3 / (300e-6 * sim.fluid.rho * sim.fluid.cp);
  near('dissolving 6 g of salt in 300 ml chills it (K)', sim.liquid.T - K(20), expected, 0.1, 'ΔH_sol(NaCl) = +3.88 kJ/mol (CRC)');
  Object.assign(Simulation.HEAT, saved);
  const brine = still({ beverage: 'club' }, 1000, 20);
  brine.liquid.salt = 0.035 / 0.05844;                         // 35 g in the litre
  const base = Props.fluid(Props.BEVERAGES.club, K(20)), b = brine._saltedFluid(base);
  near('brine at 35 g/kg: density gain (kg/m³)', b.rho - base.rho, 26.6, 0.05, 'Sharqawy et al. 2010 (seawater: 1024.8 vs 998.2)');
  near('brine at 35 g/kg: heat capacity (J/kg·K)', b.cp, base.cp * 3993 / 4182, 0.01, 'Sharqawy et al. 2010 (seawater: 3993 vs 4182)');
}

{
  // salt dissolves at a measured rate, faster stirred, and stops at saturation
  const glass = (V) => {
    seed(5);
    const sim = new Simulation({ beverage: 'club', carbonation: 0, cupTemp: 20, roomTemp: 20 });
    sim.liquid.V = V; sim.liquid.T = K(20); sim.liquid.n = 0; sim.geom = sim.computeGeometry();
    return sim;
  };
  const time = (stir) => {
    const sim = glass(300e-6);
    if (stir) sim.setStir(true);
    sim.addSalt();
    let t = 0;
    while (t < 400 && sim.additives.salt.reduce((a, q) => a + q.m, 0) > 0.05 * 0.4e-3) { sim.step(1 / 60); t += 1 / 60; }
    return t;
  };
  const tStill = time(false), tStir = time(true);
  expect('a pinch of salt on the bottom of a still glass takes a minute or two to dissolve; stirred, seconds', tStill > 40 && tStill < 300 && tStir < 0.15 * tStill,
    `95 % dissolved after ${tStill.toFixed(0)} s still, ${tStir.toFixed(1)} s stirred`, 'mass transfer Sh = 2 + 0.6Re^½Sc^⅓ (Ranz–Marshall), D(NaCl) = 1.61·10⁻⁹ m²/s');
  const sat = glass(100e-6);
  sat.setStir(true);
  for (let k = 0; k < 120; k++) sat.addSalt();                     // 48 g into 100 ml
  for (let i = 0; i < 300 * 60; i++) sat.step(1 / 60);
  near('…and no more dissolves past saturation (mol/kg)', sat.saltMolal, sat._saltSat(sat.liquid.T), 0.03, 'NaCl solubility 35.7–36.0 g per 100 g water (CRC)');
  expect('…leaving the excess as crystals on the bottom', sat.additives.salt.reduce((a, q) => a + q.m, 0) > 0.01,
    `${(sat.additives.salt.reduce((a, q) => a + q.m, 0) * 1000).toFixed(1)} g undissolved; the brine cooled to ${(sat.liquid.T - C.T0).toFixed(1)} °C`, 'saturation; endothermic dissolution');
}
{
  // salt on ice: it melts the ice into cold brine and the ice gets colder
  seed(2);
  const sim = new Simulation({ beverage: 'club', carbonation: 0, iceCubes: 12, iceTemp: -5, pourAmount: 60, roomTemp: 20 });
  sim.startPour(true);
  while (sim.pour.active || sim.pour.Q > 0 || sim.pour.Qin > 0) sim.step(1 / 120);
  for (let i = 0; i < 240; i++) sim.step(1 / 120);
  const T0 = sim.ice.T;
  for (let k = 0; k < 5; k++) sim.addSalt();
  for (let i = 0; i < 30 * 60; i++) sim.step(1 / 60);
  expect('salt on ice cubes above the drink melts them into brine and chills them', sim.ice.T < T0 - 2 && sim.liquid.salt > 0,
    `ice ${(T0 - C.T0).toFixed(1)} → ${(sim.ice.T - C.T0).toFixed(1)} °C; ${(sim.liquid.salt * 58.44).toFixed(2)} g of salt ran off into the drink as brine`,
    'brine in equilibrium with the ice (T_f = T_ice); heat of melting and dissolving from the ice');
}
{
  // salt dropped onto a floating meltwater layer dissolves into it
  const sim = still({ beverage: 'cola', cupDiameter: 7.5, cupHeight: 12 }, 250, 8);
  sim.water.V = 15e-6; sim.water.T = K(2); sim.water.s = 0;
  sim.geom = sim.computeGeometry();
  sim.addSalt();
  for (const g of sim.additives.salt) { g.y = sim.geom.level - 0.001; g.vy = 0; }   // set them in the layer
  sim.slosh.reset();
  for (let i = 0; i < 6; i++) sim.step(1 / 120);
  expect('salt landing in the meltwater layer dissolves into it (its freezing point drops)', sim.water.salt > 0 && sim.layerSaltMolal > 0,
    `${((sim.water.salt || 0) * 58.44 * 1000).toFixed(1)} mg in the layer in 0.05 s while the grains sink through it`, 'mass transfer into whichever liquid touches the grain');
}

// ---------------------------------------------------------------------------
section('Energy: once nothing drives it, every motion runs down');
{
  // a cube dropped into still water: its fall's energy goes into drag, waves (heave damping) and splash
  const sim = still({ beverage: 'club', cupDiameter: 7.5, cupHeight: 12, iceTemp: -5, cupTemp: 15, roomTemp: 15 }, 250, 15, { seed: 2 });
  sim.addIce();
  const c = sim.ice.cubes[0];
  let peak = 0;
  for (let i = 0; i < 120; i++) { sim.step(1 / 120); peak = Math.max(peak, Math.abs(c.wv)); }
  let late = 0;
  for (let i = 0; i < 3 * 120; i++) { sim.step(1 / 120); if (i > 180) late = Math.max(late, Math.hypot(c.wu, c.wv)); }
  expect('a dropped cube stops bobbing within a couple of seconds', late < 2e-3 && peak > 0.3,
    `hits at ${peak.toFixed(2)} m/s; from 2.5 s on its speed is ${(late * 1000).toFixed(2)} mm/s`,
    'added mass, heave radiation damping (ζ ≈ 0.2), drag');
}
{
  // the slosh: with the hand still, its energy ½(δ̇² + ω²δ²) can only fall
  seed(5);
  const sim = new Simulation({ beverage: 'club', carbonation: 0, pourAmount: 300 });
  sim.startPour(true);
  while (sim.pour.active || sim.pour.Q > 0 || sim.pour.Qin > 0) sim.step(1 / 120);
  sim.params.tilt = 30;
  for (let i = 0; i < 60; i++) sim.step(1 / 120);
  sim.params.tilt = 0;
  for (let i = 0; i < 90; i++) sim.step(1 / 120);                 // let the hand come to rest
  const E = () => 0.5 * (sim.slosh.rate ** 2 + sim.slosh.omega1 ** 2 * sim.slosh.delta ** 2);
  let prev = E(), rises = 0, E0 = prev;
  for (let i = 0; i < 4 * 120; i++) {
    sim.step(1 / 120);
    const e = E();
    if (Math.abs(sim.hand.omega) < 1e-3 && e > prev * (1 + 1e-6) + 1e-12) rises++;
    prev = e;
  }
  expect('the slosh only ever loses energy once the glass is still', rises === 0 && prev < 0.5 * E0,
    `${rises} steps gained energy; energy fell to ${(100 * prev / Math.max(E0, 1e-12)).toFixed(1)} % in 4 s`, 'viscous + contact-line damping (no energy source)');
}
{
  // Mentos and thrown ice come to rest
  seed(4);
  const sim = new Simulation({ beverage: 'diet', pourAmount: 150, iceCubes: 6 });
  sim.startPour(true);
  while (sim.pour.active || sim.pour.Q > 0 || sim.pour.Qin > 0) sim.step(1 / 120);
  sim.dropMentos(); sim.dropMentos();
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  for (let i = 0; i < 2 * 120; i++) { sim.params.tilt = 90; sim.step(1 / 120); }
  for (let i = 0; i < 4 * 120; i++) sim.step(1 / 120);
  const moving = [...sim.ice.cubes.map(c => Math.hypot(c.wu, c.wv)), ...sim.additives.mentos.map(m => Math.hypot(m.vx, m.vy || 0, m.vz))];
  expect('after a fling, cubes and Mentos (in the glass or on the table) all come to rest', Math.max(...moving) < 5e-3,
    `fastest still moving: ${(Math.max(...moving) * 1000).toFixed(2)} mm/s`, 'Coulomb friction on glass and table; drag; inelastic landings');
}

// ---------------------------------------------------------------------------
section('Time-lapse, flings and spills from the player\'s side');
{
  // nearly melted slivers bob fast; a 64× time-lapse step must not launch them
  let thrown = 0;
  seed(3);
  const sim = new Simulation({ beverage: 'cola', iceCubes: 3 });
  sim.on('iceThrown', () => thrown++);
  sim.startPour(true);
  for (let i = 0; i < 20 * 120; i++) sim.step(1 / 120);
  for (const c of sim.ice.cubes) { c.m *= (0.004 / c.a) ** 3; c.a = 0.004; }
  for (let t = 0; t < 600 && sim.ice.cubes.length; t += 1 / 30) sim.step(1 / 30);
  expect('melting cubes are never "thrown" out of a standing glass at time-lapse steps', thrown === 0 && sim.ice.cubes.every(c => c.where === 'cup'),
    `${thrown} thrown, ${sim.ice.cubes.filter(c => c.where !== 'cup').length} on the table`, 'cube motion sub-stepped below its bobbing period');
}
{
  seed(4);
  const sim = new Simulation({ beverage: 'club', iceCubes: 0, pourAmount: 300 });
  sim.startPour(true);
  for (let i = 0; i < 30 * 120; i++) sim.step(1 / 120);
  const V0 = sim.liquid.V;
  sim.params.tilt = 55;
  for (let i = 0; i < 18; i++) sim.step(1 / 120);
  sim.params.tilt = 0;
  for (let i = 0; i < 4 * 120; i++) sim.step(1 / 120);
  expect('a quick hard flick throws out most of the drink (the rim\'s meniscus lets go under the swing)', sim.liquid.V < 0.1 * V0,
    `${ml(sim.liquid.V)} of ${ml(V0)} left`, 'meniscus pinning holds against g only: bulge × g/(g + a_swing)');
}
{
  seed(5);
  const sim = new Simulation({ beverage: 'cola', iceCubes: 0 });
  sim.grabBottle(); sim.moveBottle(0.0375 + 0.06, 0.12); sim.tipBottle(110);
  for (let i = 0; i < 6 * 120; i++) sim.step(1 / 120);
  const d = sim.diagnostics();
  expect('pouring straight onto the table is a miss, not a spill over the rim', d.missed > 100e-6 && d.overRim < 1e-7,
    `missed ${ml(d.missed)}, over the rim ${ml(d.overRim)}`, 'achievement bookkeeping');
  const n0 = d.tableCO2, fizz0 = Math.max(...sim.table.puddles.map(q => q.fizz || 0));
  for (let i = 0; i < 300 * 30; i++) sim.step(1 / 30);
  const n1 = sim.diagnostics().tableCO2;
  expect('soda on the table fizzes and goes flat within minutes (a thin film: lots of surface)', fizz0 > 0 && n1 < 0.3 * n0,
    `bubbling ${(fizz0 / 1e4).toFixed(1)} /cm²·s at first; CO₂ after 5 min ${(100 * n1 / n0).toFixed(0)} % of what landed`, 'k_L·c through the surface + wood-grain nucleation');
}
{
  seed(5);
  const sim = new Simulation({ beverage: 'cola', iceCubes: 0 });
  sim.grabBottle(); sim.moveBottle(0.0375 + 0.06, 0.12); sim.tipBottle(110);
  for (let i = 0; i < 6 * 120; i++) sim.step(1 / 120);
  const q = sim.table.puddles.reduce((a, b) => (a.V > b.V ? a : b));
  sim.dropMentos();
  const m = sim.additives.mentos[sim.additives.mentos.length - 1];
  Object.assign(m, { where: 'table', tx: q.x, ty: 0.003, tz: q.z, vx: 0, vy: 0, vz: 0 });
  for (let i = 0; i < 10 * 120; i++) sim.step(1 / 120);
  const pile = sim.table.piles.reduce((a, p) => a + p.vg + p.vl, 0);
  expect('a Mentos dropped in a puddle froths it into a foam mound', pile > 1e-6,
    `${ml(pile)} of foam on the table after 10 s`, 'the same Mentos nucleation as in the glass, wetted to the film depth');
}
{
  const shake = (amp, hz, secs) => {
    seed(1);
    const sim = new Simulation({ beverage: 'cola', iceCubes: 0 });
    sim.grabBottle(); sim.tipBottle(0);
    for (let i = 0; i < 60; i++) sim.step(1 / 120);
    const x0 = sim.pour.mouth.x, y0 = sim.pour.mouth.y;
    for (let f = 0; f < secs * 60; f++) { sim.moveBottle(x0 + amp * Math.sin(2 * Math.PI * hz * f / 60), y0); sim.step(1 / 120); sim.step(1 / 120); }
    return sim.diagnostics();
  };
  const gentle = shake(0.05, 0.5, 3), hard = shake(0.04, 6, 4);
  expect('dragging the bottle slowly only sloshes it; shaking it hard foams it out of the neck and leaves it flatter',
    gentle.bottleSpew < 1e-6 && hard.bottleSpew > 20e-6 && hard.cBottle < 0.9 * gentle.cBottle,
    `gentle: ${ml(gentle.bottleSpew)} out; hard: ${ml(hard.bottleSpew)} out, bottle CO₂ ${(hard.cBottle / 44.6).toFixed(2)} vs ${(gentle.cBottle / 44.6).toFixed(2)} vol`,
    'slosh mode breaking → trapped bubbles growing by diffusion (Epstein–Plesset)');
}
{
  const sim = new Simulation({});
  sim.grabBottle(); sim.moveBottle(0.01, 0.15); sim.releaseBottle();
  for (let i = 0; i < 240; i++) sim.step(1 / 120);
  const reach = sim.bottle.L * Math.sin(35 * Math.PI / 180), x = sim.pour.mouth.x, clear = sim.D / 2;
  expect('a bottle let go of over the glass is set down clear of it, not hanging in front of it', x <= -clear || x - reach >= clear,
    `lip at ${(x * 100).toFixed(1)} cm, glass ±${(clear * 100).toFixed(1)} cm`, 'UI');
}

// ---------------------------------------------------------------------------
section('Conservation with everything that can leave the glass');
{
  seed(6);
  const sim = new Simulation({ beverage: 'cola', pourAmount: 350, cupDiameter: 7, cupHeight: 10, iceCubes: 6, pourHeight: 15, sodaTemp: 15 });
  sim.startPour(true);
  for (let i = 0; i < 6 * 120; i++) sim.step(1 / 120);
  sim.params.tilt = 60;
  for (let i = 0; i < 3 * 120; i++) sim.step(1 / 120);
  sim.dropMentos();
  for (let i = 0; i < 20 * 120; i++) sim.step(1 / 120);
  const inV = sim.pour.poured + (sim.ice.melted - sim.ice.frozen - sim.ice.tableMelt) / Props.rhoWater(C.T0);
  const outV = sim.cupVolume + sim.foam.liquidVolume + sim.stats.spilledV + sim.stream.flyingV;
  expect('liquid is conserved through pouring, throwing, eruption and melting', Math.abs(inV - outV) / inV < 0.01,
    `in ${ml(inV)} (poured + melted in the glass), accounted ${ml(outV)} (glass ${ml(sim.cupVolume)} incl. ${ml(sim.water.V)} meltwater layer, foam, spilled ${ml(sim.stats.spilledV)})`, 'mass balance');
  const onTable = sim.table.puddles.reduce((s, p) => s + p.V, 0) + sim.table.flyingV;
  expect('…and what left is on the table (puddles + in flight), less what clings to the outside of the glass', onTable <= sim.stats.spilledV + sim.ice.tableMelt / 1000 + 1e-9,
    `${ml(onTable)} on the table vs ${ml(sim.stats.spilledV)} spilled`, 'mass balance');
}

process.exitCode = summary() ? 1 : 0;
