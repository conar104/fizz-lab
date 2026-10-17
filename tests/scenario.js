// Shared scenario runner: pour, watch, and report the numbers a person would notice.
const { load, seed } = require('./harness');
const Fizz = load();
const { Simulation, C } = Fizz;

/**
 * Run one pour.
 *   params      Simulation parameters
 *   opts.style  'auto' (default) | 'tilted' (beer-like: tilt straightens as it fills)
 *   opts.watch  seconds to keep simulating after the pour ends
 *   opts.at     { seconds: fn(sim) } — actions at given times (Mentos, stir, ice…)
 */
function pour(params, opts = {}) {
  seed(opts.seed || 11);
  const sim = new Simulation(params);
  const watch = opts.watch == null ? 30 : opts.watch;
  const actions = Object.entries(opts.at || {}).map(([t, fn]) => ({ t: +t, fn, done: false }));
  sim.startPour(true);
  const tilt0 = params.tilt || 0;
  let endedAt = -1, cAfterPour = null, maxFoamH = 0, maxFoamTop = 0, gasPeak = 0, headLast = 0, emissionSum = 0, emissionN = 0;
  const conc = () => {
    const liq = sim.liquid.V + sim.foam.liquidVolume;
    return liq > 1e-9 ? (sim.liquid.n + sim.foam.co2Moles) / liq * C.M_CO2 : NaN;
  };
  for (let i = 0; i < 400 * 120; i++) {
    if (opts.style === 'tilted') sim.params.tilt = Math.max(0, tilt0 * (1 - sim.pour.poured / (params.pourAmount * 1e-6)));
    for (const a of actions) if (!a.done && sim.time >= a.t) { a.fn(sim); a.done = true; }
    sim.step(1 / 120);
    const g = sim.geom;
    maxFoamH = Math.max(maxFoamH, g.foamHeight);
    maxFoamTop = Math.max(maxFoamTop, g.foamTop);
    gasPeak = Math.max(gasPeak, sim.foam.gasVolume);
    if (g.foamHeight > 0.003) headLast = sim.time;
    if (endedAt < 0 && !sim.pour.active && sim.pour.Q === 0 && sim.time > 0.5) endedAt = sim.time;
    if (endedAt > 0 && cAfterPour == null && sim.time > endedAt + 1) cAfterPour = conc();
    if (endedAt > 0 && sim.time > endedAt + 2 && sim.time < endedAt + 12) { emissionSum += sim.stats.emissionRate; emissionN++; }
    if (endedAt > 0 && sim.time > endedAt + watch) break;
  }
  const d = sim.diagnostics();
  return {
    sim, d,
    cStart: params.carbonation * C.MOL_PER_VOLUME * C.M_CO2,
    cAfterPour, cEnd: conc(),
    lostDuringPour: params.carbonation * C.MOL_PER_VOLUME * C.M_CO2 - cAfterPour,
    maxFoamH, maxFoamTop, foamGasPeak: gasPeak,
    headLife: Math.max(0, headLast - endedAt),
    spilled: d.spilled, Tend: d.Tliq, pourEnded: endedAt,
    emissionAfter: emissionN ? emissionSum / emissionN : 0,
  };
}

const BASE = { beverage: 'cola', carbonation: 3.8, sodaTemp: 4, material: 'glass', cupDiameter: 7.5, cupHeight: 15,
  cupTemp: 21, roomTemp: 21, pourAmount: 250, pourRate: 35, pourHeight: 5, tilt: 0, bottle: 'pet500', tiltSpeed: 45 };

module.exports = { Fizz, pour, BASE };
