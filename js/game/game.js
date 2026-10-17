/* Fizz Lab — gamification: experiment presets, the "Perfect Pour" challenge, achievements. */
(function (Fizz) {
  'use strict';
  const { C, Simulation } = Fizz;

  // ---------------------------------------------------------------------
  // Experiments: each answers one "what happens if…" question.
  // ---------------------------------------------------------------------
  const EXPERIMENTS = [
    { name: '5 ml onto ice', set: { iceCubes: 6, pourAmount: 5 },
      look: 'Tiny volume, huge ice area: it fizzes hard on the cubes but holds too little CO₂ to build a head.' },
    { name: '50 ml onto ice', set: { iceCubes: 6, pourAmount: 50 },
      look: 'The stream tumbles down through the cubes, shattering at each one: several times the air of a clean pour. Watch the foam climb the pile.' },
    { name: 'Packed with ice', set: { iceCubes: 24, cupHeight: 15, pourAmount: 250 },
      look: 'A glass filled to the brim with ice: only the gaps hold soda, the stream shatters down the whole pile, and the cubes chill it toward its freezing point.' },
    { name: 'Full glass on ice', set: { iceCubes: 6, pourAmount: 330 },
      look: 'Will it overflow? Ice displaces ~94 ml and chills the soda, which partly offsets the extra nucleation.' },
    { name: 'Fridge-cold vs warm', set: { sodaTemp: 25 },
      look: 'Same CO₂, warm soda: k_H drops ~40 %, so supersaturation more than doubles.' },
    { name: 'Bartender tilt', set: { tilt: 30, pourHeight: 2, pourAmount: 300 },
      look: 'Stream slides down the wall: little air entrained, far more CO₂ kept in the drink.' },
    { name: 'Waterfall pour', set: { pourRate: 100, pourHeight: 25 },
      look: '2.4 m/s impact. Massive entrainment strips CO₂ and the head blows over the rim.' },
    { name: 'Wide bowl', set: { cupDiameter: 11.5, cupHeight: 8 },
      look: 'Same pour into a wide vessel: foam volume spreads over 2.3× the area, so the head stays low.' },
    { name: 'Styrofoam cup', set: { material: 'styrofoam' },
      look: 'Cavity-rich hydrophobic walls keep streams of bubbles going long after the pour.' },
    { name: 'Rinsed glass', set: { rinsed: true },
      look: 'Wet walls: cavities flooded, no air trapped at the wetting front. A calmer pour.' },
    { name: 'Frozen mug', set: { material: 'ceramic', cupTemp: -15 },
      look: 'Heavy cold wall pulls heat out of the soda: more CO₂ stays dissolved.' },
    { name: 'Club soda', set: { beverage: 'club' },
      look: 'Plenty of fizz, almost no head: without surfactants, films pop even when wet (φc ≈ 0.5).' },
    { name: 'Orange soda', set: { beverage: 'orange' },
      look: 'Measured at only 1.8 vol: barely supersaturated in a cold glass, so it pours almost flat.' },
    { name: 'Root beer head', set: { beverage: 'rootbeer' },
      look: 'Saponin foaming agents let films survive down to φ ≈ 1 %: a slow, dense, creamy head.' },
    { name: 'Mile-high city', set: { pressure: 83.5 },
      look: 'Denver: 18 % less air pressure means the same can is more supersaturated.' },
    { name: 'Nearly flat', set: { carbonation: 1.4 },
      look: 'R* grows past most cavity sizes: nucleation shuts down.' },
    { name: 'Stir it up', set: { tilt: 45, pourHeight: 0, pourRate: 30, pourAmount: 300 }, stir: true,
      look: 'A gentle pour, then a spoon: a new moving surface plus air dragged under by every stroke. Watch CO₂ fall.' },
    { name: 'Mentos geyser', set: { tilt: 45, pourHeight: 0, pourRate: 30, pourAmount: 300 }, mentos: true,
      look: 'Pour gently, then a Mentos lands: ~10⁵ sites/cm² and lowered σ. A fine-bubbled head erupts; bubbling dies within ~1–2 min as supersaturation collapses.' },
  ];

  // ---------------------------------------------------------------------
  // Achievements
  // ---------------------------------------------------------------------
  const ACHIEVEMENTS = [
    { id: 'firstPour', name: 'First Pour', desc: 'Pour anything.', test: (d) => d.poured > 1e-6 },
    { id: 'overflow', name: 'Oops', desc: 'Spill over the rim.', test: (d) => d.overRim > 1e-6 },
    { id: 'baby', name: 'Like a Baby', desc: 'Pour 200 ml straight onto the table, missing the glass.', test: (d) => d.missed > 200e-6 && d.missed > 0.9 * d.poured },
    { id: 'geyser', name: 'Geyser!', desc: 'Spill 100 ml of foam.', test: (d) => d.foamSpilled > 100e-6 },
    { id: 'tower', name: 'Foam Tower', desc: 'Build a 6 cm head.', test: (d) => d.foamH > 0.06 },
    { id: 'steady', name: 'Steady Hand', desc: 'Pour 250 ml with a head under 1 cm and no spill.',
      test: (d) => d.poured > 250e-6 && d.spilled === 0 && d.maxHead < 0.01 },
    { id: 'flat', name: 'Flat as a Pancake', desc: `Let soda go below ${Simulation.FLAT_VOLUMES} vol.`,
      test: (d) => d.volume > 20e-6 && d.cVol < Simulation.FLAT_VOLUMES && d.poured > 20e-6 },
    { id: 'chill', name: 'Brain Freeze', desc: 'Get the soda below 1 °C.', test: (d) => d.volume > 20e-6 && d.Tliq < 1 },
    { id: 'meltdown', name: 'Meltdown', desc: 'Melt 20 g of ice.', test: (d) => d.iceMelted > 0.02 },
    { id: 'avalanche', name: 'Avalanche', desc: 'Overfill the glass until ice tumbles out over the rim.', test: (d) => d.iceHeapedOut > 0 },
    { id: 'curveball', name: 'Curveball', desc: 'Fling an ice cube clean out of the glass.', test: (d) => d.iceThrown > 0 },
    { id: 'podium', name: 'Podium Finish', desc: 'Shake a sealed bottle and pop it like a race winner\'s champagne: spray 150 ml of foam.', test: (d) => d.gushV > 150e-6 },
    { id: 'shaken', name: 'Shaken, Not Stirred', desc: 'Shake the bottle until it foams out of the neck.', test: (d) => d.bottleSpew > 5e-6 },
    { id: 'tablefizz', name: 'Table Volcano', desc: 'Get a Mentos or salt fizzing in a puddle on the table.', test: (d) => d.tableFrothing > 0 },
    { id: 'altitude', name: 'Thin Air', desc: 'Pour above 2 000 m.', test: (d, s) => d.poured > 1e-6 && s.params.pressure < 79.5 },
    { id: 'perfect', name: 'Perfect Pour', desc: 'Score 900+ in a challenge round.', test: () => false },
  ];

  const STORE = 'fizzlab.v1';
  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* private mode */ } }

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  class Game {
    constructor(sim, hooks) {
      this.sim = sim;
      this.hooks = hooks;          // { toast, banner, onParamsChanged, lock }
      this.store = load();
      this.store.unlocked = this.store.unlocked || {};
      this.store.best = this.store.best || 0;
      this.challenge = null;
      this.maxHead = 0;
      this._pendingMentos = false;
      sim.on('reset', () => { this.maxHead = 0; });
      sim.on('pourDone', () => {
        if (this._pendingMentos) { this._pendingMentos = false; setTimeout(() => sim.dropMentos(), 1200); }
        if (this._pendingStir) {
          this._pendingStir = false;
          setTimeout(() => { sim.setStir(true); this.hooks.onParamsChanged(); }, 1200);
          setTimeout(() => { sim.setStir(false); this.hooks.onParamsChanged(); }, 9200);
        }
      });
    }

    get target() { return this.challenge ? this.challenge.target : null; }

    // --- experiments --------------------------------------------------
    runExperiment(ex) {
      if (this.challenge) this.quitChallenge();
      Object.assign(this.sim.params, Simulation.DEFAULTS, ex.set);
      Game.matchCarbonation(this.sim.params, ex.set);
      this.sim.reset();
      this.hooks.onParamsChanged();
      this.sim.startPour(true);
      this._pendingMentos = !!ex.mentos;
      this._pendingStir = !!ex.stir;
      this.hooks.banner(ex.name, ex.look);
    }

    // --- challenge ----------------------------------------------------
    startChallenge() {
      this.challenge = { round: 0, rounds: 5, total: 0, target: null, log: [] };
      this.hooks.lock(true);
      this.nextRound();
    }

    nextRound() {
      const ch = this.challenge;
      ch.round++;
      if (ch.round > ch.rounds) return this._finish();
      const p = this.sim.params;
      Object.assign(p, Simulation.DEFAULTS, {
        beverage: pick(Object.keys(Fizz.Props.BEVERAGES)),
        material: pick(['glass', 'plastic', 'paper', 'styrofoam', 'ceramic', 'steel']),
        cupDiameter: +rand(6, 10).toFixed(1),
        cupHeight: +rand(9, 15).toFixed(1),
        sodaTemp: +rand(3, 24).toFixed(0),
        iceCubes: Math.random() < 0.45 ? (2 + Math.random() * 6) | 0 : 0,
        pourRate: p.pourRate, pourHeight: p.pourHeight, tilt: p.tilt,
      });
      Game.matchCarbonation(p, { beverage: p.beverage });
      this.sim.reset();
      ch.target = this.sim.H * rand(0.6, 0.85);
      this.hooks.onParamsChanged();
      const bev = Fizz.Props.BEVERAGES[p.beverage].name, mat = Fizz.Props.SURFACES[p.material].name;
      this.hooks.banner(`Round ${ch.round} / ${ch.rounds}`,
        `${bev}, ${p.sodaTemp} °C, into a ${p.cupDiameter}×${p.cupHeight} cm ${mat.toLowerCase()} cup` +
        `${p.iceCubes ? ` with ${p.iceCubes} ice cubes` : ''}. Fill the liquid to the green line, then SERVE. Pour rate, height and tilt are yours.`);
    }

    /** Score the current round. */
    serve() {
      const ch = this.challenge;
      if (!ch || ch.target == null) return;
      const d = this.sim.diagnostics();
      const liquidTop = d.level + 0.25 * d.foamH;          // a quarter of the head settles to liquid
      const errMm = Math.abs(liquidTop - ch.target) * 1000;
      const accuracy = Math.max(0, 600 - errMm * 45);
      const spillPenalty = Math.min(600, d.spilled * 1e6 * 15);
      const elapsed = this.sim.stats.firstPour >= 0 ? this.sim.time - this.sim.stats.firstPour : 99;
      const speed = Math.max(0, 250 - elapsed * 8);
      const headMm = d.foamH * 1000;
      const head = headMm >= 3 && headMm <= 15 ? 100 : 0;
      const clean = d.spilled === 0 && d.poured > 0 ? 50 : 0;
      const score = Math.max(0, Math.round(accuracy + speed + head + clean - spillPenalty));
      ch.total += score;
      ch.log.push(score);
      ch.target = null;
      if (score >= 900) this._unlock('perfect');
      this.hooks.banner(`Round ${ch.round}: ${score} pts`,
        `Off by ${errMm.toFixed(1)} mm (+${accuracy.toFixed(0)}) · speed +${speed.toFixed(0)} · ` +
        `head ${headMm.toFixed(1)} mm (+${head}) · clean +${clean} · spill −${spillPenalty.toFixed(0)}. Total ${ch.total}.`,
        { label: ch.round < ch.rounds ? 'NEXT ROUND' : 'FINISH', fn: () => this.nextRound() });
    }

    _finish() {
      const ch = this.challenge;
      const best = ch.total > this.store.best;
      if (best) { this.store.best = ch.total; save(this.store); }
      this.hooks.banner(`Challenge complete: ${ch.total}`, `${ch.log.join(' + ')}${best ? ' — NEW BEST!' : ` (best ${this.store.best})`}`);
      this.quitChallenge();
    }

    quitChallenge() {
      this.challenge = null;
      this.hooks.lock(false);
    }

    // --- achievements -------------------------------------------------
    check(d) {
      this.maxHead = Math.max(this.maxHead, d.foamH);
      d.maxHead = this.maxHead;
      for (const a of ACHIEVEMENTS) {
        if (!this.store.unlocked[a.id] && a.test(d, this.sim)) this._unlock(a.id);
      }
    }

    _unlock(id) {
      if (this.store.unlocked[id]) return;
      this.store.unlocked[id] = Date.now();
      save(this.store);
      const a = ACHIEVEMENTS.find(x => x.id === id);
      this.hooks.toast(`★ ${a.name}`, a.desc);
      this.hooks.onAchievements && this.hooks.onAchievements();
    }
  }

  /** A drink comes with its own measured carbonation unless the setup overrides it. */
  Game.matchCarbonation = (params, set) => {
    if (set.beverage && set.carbonation == null) params.carbonation = Fizz.Props.BEVERAGES[set.beverage].carbonation;
  };

  Game.EXPERIMENTS = EXPERIMENTS;
  Game.ACHIEVEMENTS = ACHIEVEMENTS;
  Fizz.Game = Game;
})(window.Fizz = window.Fizz || {});
