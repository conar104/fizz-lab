// Fizz Lab — whole-model validation against a measured experiment.
//
// Liger-Belair, Bourget, Villaume, Jeandet, Pron & Polidori (2010),
// "On the losses of dissolved CO2 during champagne serving",
// J. Agric. Food Chem. 58:8768–8775, Table 1: loss of dissolved CO2 while
// pouring 100 mL of champagne (11.4 g/L) into a dry flute at room temperature.
//
// The entrainment calibration (Jet.tuning.cal = 0.35) was fitted to the three
// vertical pours; the three tilted pours are an out-of-sample check.
const { section, near, expect, summary } = require('./harness');
const { pour } = require('./scenario');

const MEASURED = { 4: { vertical: 3.0, tilted: 1.6 }, 12: { vertical: 3.3, tilted: 2.0 }, 18: { vertical: 4.0, tilted: 3.7 } };
const flute = (T, style) => ({
  beverage: 'champagne', carbonation: 11.4 / 1.964, sodaTemp: T, cupTemp: 20, roomTemp: 20,
  material: 'glass', cupDiameter: 5.0, cupHeight: 18, bottle: 'glass355', pourAmount: 100, pourRate: 35,
  pourHeight: style === 'vertical' ? 6 : 1, tilt: style === 'vertical' ? 0 : 45, tiltSpeed: 45,
});

section('Champagne pouring losses — Liger-Belair et al. 2010, Table 1');
const model = {};
for (const T of [4, 12, 18]) {
  model[T] = {};
  for (const style of ['vertical', 'tilted']) {
    const r = pour(flute(T, style), { style: style === 'tilted' ? 'tilted' : 'auto', watch: 1.5, seed: 3 });
    model[T][style] = r.lostDuringPour;
    // KNOWN GAP (tilted): the paper does not say how the flute was brought back
    // upright. Here it straightens steadily; once no arc can reach the low wall
    // (≲ 15°), the rest is poured straight in from 1 cm above the rim — a 13 cm
    // plunge into the flute, which costs CO2. Holding the stream on a wall to the
    // end instead gives ~27 % too little; the measurement lies between the two.
    const tol = style === 'vertical' ? 0.15 : 0.35;
    near(`${style} pour at ${T} °C, CO2 lost (g/L)${style === 'tilted' ? ' [known gap]' : ''}`,
         r.lostDuringPour, MEASURED[T][style], tol, `measured ±${style === 'vertical' ? '0.2–0.5' : '0.2–0.3'} g/L`);
  }
}
expect('tilted ("beer-like") pours keep more CO2 than vertical at every temperature',
  [4, 12, 18].every(T => model[T].tilted < model[T].vertical),
  [4, 12, 18].map(T => `${T}°C: ${model[T].tilted.toFixed(2)} < ${model[T].vertical.toFixed(2)}`).join(', '),
  'Liger-Belair et al. 2010');
expect('warmer wine loses more CO2 while pouring (both styles)',
  model[4].vertical < model[12].vertical && model[12].vertical < model[18].vertical &&
  model[4].tilted < model[12].tilted && model[12].tilted < model[18].tilted,
  `vertical ${[4, 12, 18].map(T => model[T].vertical.toFixed(2)).join(' → ')}; tilted ${[4, 12, 18].map(T => model[T].tilted.toFixed(2)).join(' → ')}`,
  'Liger-Belair et al. 2010');
const sq = [4, 12, 18].flatMap(T => ['vertical', 'tilted'].map(s => ((model[T][s] - MEASURED[T][s]) / MEASURED[T][s]) ** 2));
console.log(`\nRMS relative error over all six measurements: ${(Math.sqrt(sq.reduce((a, b) => a + b) / sq.length) * 100).toFixed(0)} %`);

process.exitCode = summary() ? 1 : 0;
