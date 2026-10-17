/* Fizz Lab — control panel and live readouts.
 *
 * Controls are declared as data (SCHEMA) and rendered generically. A control
 * flagged `reset` changes the physical setup (cup, drink, ice…) and restarts
 * the simulation; the others (pour, room) act live.
 */
(function (Fizz) {
  'use strict';
  const { C, Props, Simulation } = Fizz;

  const SCHEMA = [
    { group: 'Drink', items: [
      { key: 'beverage', type: 'drinks', label: 'Drink', reset: true,
        tip: 'Sets viscosity, surface tension, CO₂ solubility (sugar salts it out) and the foam-stability constants φc (critical liquid fraction), film thickness and interface mobility.' },
      { key: 'carbonation', label: 'Carbonation (bottle)', min: 0, max: 6, step: 0.1,
        fmt: v => `${v.toFixed(1)} vol · ${(v * C.MOL_PER_VOLUME * C.M_CO2).toFixed(1)} g/L`,
        tip: 'Dissolved CO₂ in the bottle. 1 volume = 1 L of gas (0 °C, 1 atm) per litre ≈ 1.96 g/L. Picking a drink loads its measured level; drag to override.' },
      { key: 'sodaTemp', label: 'Soda temperature (bottle)', min: 0, max: 40, step: 0.5, fmt: v => `${v.toFixed(1)} °C`,
        tip: 'CO₂ solubility falls ~3–4 %/K (Weiss 1974), so warm soda is far more supersaturated and foams harder. Measured: warmer champagne loses more CO₂ while pouring (Liger-Belair 2010).' },
    ]},
    { group: 'Ice', items: [
      { type: 'action', action: 'addIce', label: '+ DROP A CUBE IN NOW', tip: 'Adds one cube live, without restarting. A plunging cube drags air under and bares fresh frosty surface, so expect a fizz-up. Shortcut: I.' },
      { key: 'iceCubes', label: 'Cubes in the glass', min: 0, max: 40, step: 1, live: 'setIceCount', fmt: v => `${v | 0}`,
        tip: 'Changes the ice in the glass you have, live: more cubes drop in, fewer are fished out; the drink stays. Real cubes: they stack, float, slide when you tilt the glass, and heap up and tumble out if you add more than fit. Poured onto, the stream shatters down through the pile (much more air, more foam). Each cube melts by its own wetted area.' },
      { key: 'iceSize', label: 'Cube edge (next cubes)', min: 1, max: 4, step: 0.1, fmt: v => `${v.toFixed(1)} cm`, tip: 'Same total ice in smaller cubes = more surface area (area ∝ 1/edge).' },
      { key: 'iceTemp', label: 'Ice temperature (next cubes)', min: -30, max: 0, step: 1, fmt: v => `${v.toFixed(0)} °C`,
        tip: 'Freezer-cold ice is frosty (lots of trapped air) and absorbs sensible heat before it starts melting.' },
    ]},
    { group: 'Glass', items: [
      { key: 'material', type: 'select', label: 'Material', options: Props.CUP_MATERIALS.map(id => ({ value: id, label: Props.SURFACES[id].name })), reset: true,
        tip: 'Sets nucleation-site density, contact angle (gas trapping), air trapped on wetting, and the wall’s conductivity / heat capacity.' },
      { key: 'cupDiameter', label: 'Diameter', min: 4, max: 12, step: 0.1, reset: true, fmt: v => `${v.toFixed(1)} cm`,
        tip: 'Wider cups spread the same foam volume thinner (height = volume / area), but expose more wall and surface.' },
      { key: 'cupHeight', label: 'Height', min: 5, max: 20, step: 0.1, reset: true, fmt: v => `${v.toFixed(1)} cm`, tip: 'Headroom before overflow; deeper liquid also raises hydrostatic pressure on bubbles near the floor.' },
      { key: 'cupTemp', label: 'Cup temperature', min: -18, max: 70, step: 1, reset: true, fmt: v => `${v.toFixed(0)} °C`,
        tip: 'A frosty mug chills the soda (more soluble, less fizz); a hot dishwasher mug warms it (more fizz). Heat flow depends on the wall’s mass, cp and k.' },
      { key: 'rinsed', type: 'check', label: 'Rinsed (wet walls)', reset: true,
        tip: 'Pre-wetting floods surface cavities: ~70 % fewer gas-trapping sites and no air trapped by the advancing wetting front. A bartender trick.' },
    ]},
    { group: 'Pour', more: true, items: [
      { key: 'bottle', type: 'select', label: 'Bottle', reset: true,
        options: Object.values(Fizz.Bottle.TYPES).map(b => ({ value: b.id, label: b.name })),
        tip: 'Body, shoulder and neck geometry. The neck bore sets how fast air can get back in, which caps the flow: a flooded neck only admits air as bubbles rising at 0.35·√(g·d).' },
      { key: 'tiltSpeed', label: 'Tilt speed (HOLD)', min: 5, max: 300, step: 5, fmt: v => `${v.toFixed(0)} °/s`,
        tip: 'How fast your hand tips the bottle while HOLD is pressed. Slow: the mouth stays partly clear, air and soda share it, smooth pour. Fast: the neck floods and the flow is throttled into glugs.' },
      { key: 'pourAmount', label: 'Auto-pour amount', min: 0, max: 1000, step: 1, scale: 'log', lo: 1, hi: 1000, fmt: v => `${v.toFixed(v < 10 ? 1 : 0)} ml`,
        tip: 'How much AUTO POUR delivers. Try 5 ml vs 50 ml onto ice.' },
      { key: 'pourRate', label: 'AUTO aims for', min: 5, max: 120, step: 1, fmt: v => `${v.toFixed(0)} ml/s`,
        tip: 'AUTO tips the bottle until the flow reaches this, then holds it, tipping further as the bottle empties. The bottle decides what is possible: a 500 ml bottle tops out near 70 ml/s smooth, about 60 ml/s glugging.' },
      { key: 'pourHeight', label: 'Lip above rim', min: 0, max: 30, step: 0.5, fmt: v => `${v.toFixed(1)} cm`,
        tip: 'The stream leaves the lip along the bottle axis and falls ballistically. Impact speed v = √(v₀² + 2gh); above ~0.9 m/s the jet starts dragging air under.' },
      { key: 'tilt', label: 'Cup tilt', min: 0, max: 90, step: 1, fmt: v => `${v.toFixed(0)}°`,
        tip: 'Or drag the glass / use ← →. Your hand swings the cup there in a few tenths of a second, and the drink sloshes (Lamb’s first mode, ~3.5 Hz in a tumbler). Swing a full glass fast and the drink flies off the rim; tip it slowly and it runs down the outside. Tilted, the stream slides down the low wall as a film and the low rim drops, so a tilted glass spills sooner.' },
    ]},
    { group: 'Room', more: true, items: [
      { key: 'roomTemp', label: 'Room temperature', min: -5, max: 45, step: 0.5, fmt: v => `${v.toFixed(1)} °C`, tip: 'Heats the cup wall, the free surface and any ice sticking out.' },
      { key: 'pressure', label: 'Air pressure', min: 55, max: 105, step: 0.1,
        fmt: v => `${v.toFixed(1)} kPa · ${Math.max(0, -8434 * Math.log(v / 101.325)).toFixed(0)} m`,
        tip: 'Lower pressure (altitude) → lower equilibrium CO₂ → higher supersaturation and bigger bubbles.' },
    ]},
  ];

  // ---------------------------------------------------------------------
  // Readouts: [label, value(d), tooltip]
  // ---------------------------------------------------------------------
  const f = (v, n = 2) => (isFinite(v) ? v.toFixed(n) : '—');
  const sci = (v) => (isFinite(v) && v !== 0 ? v.toExponential(1) : '0');
  const cm2 = (a) => `${f(a * 1e4, 0)} cm²`;
  const ml = (v) => `${f(v * 1e6, v * 1e6 < 10 ? 1 : 0)} ml`;

  const READOUTS = [
    { group: 'Gas chemistry', rows: [
      ['Dissolved CO₂', d => `${f(d.cGL)} g/L · ${f(d.cVol, 2)} vol`, 'c — bulk dissolved CO₂ (well-mixed liquid).'],
      ['Equilibrium @ room air', d => `${f(d.ceqGL)} g/L`, 'c_eq = k_H(T)·P — what the soda would hold in a pure-CO₂ atmosphere at this pressure.'],
      ['Supersaturation S', d => f(d.S, 2), 'S = c/c_eq − 1. Bubbles can only grow while S > 0 (plus hydrostatic and Laplace pressure).'],
      ['Henry k_H', d => `${f(d.kH, 4)} mol/L·atm`, 'Weiss (1974): ln K₀ = −58.0931 + 90.5069·(100/T) + 22.2940·ln(T/100), × estimated sugar salting-out.'],
      ['Critical radius R*', d => `${f(d.Rstar * 1e6, 2)} µm`, 'R* = 2σ / (c/k_H − P_L) at mid-depth. Only gas pockets wider than this can grow.'],
      ['Homogeneous J', d => (isFinite(d.logJ) ? `10^${d.logJ.toExponential(1)}` : '0'), 'J = J₀·exp(−16πσ³ / 3k_BTΔP²) per m³·s. Effectively zero: every bubble is born on a surface.'],
    ]},
    { group: 'Motion & spills', rows: [
      ['Cup angle', d => `${f(d.tiltNow, 0)}° · surface ${d.sloshDeg >= 0 ? '+' : ''}${f(d.sloshDeg, 1)}°`, 'The hand moves the cup like a critically damped spring (ω = 14 rad/s, ≤ 12 rad/s). The surface tilts by the slosh angle δ on top of that.'],
      ['Slosh', d => (d.volume > 1e-7 ? `${f(d.sloshHz, 2)} Hz · ζ ${f(d.sloshZeta, 3)}` : '—'), 'First mode ω² = (gξ₁/R)·tanh(ξ₁h/R), ξ₁ = 1.8412 (Lamb). Damping: Stokes layers on wall and floor, contact-line friction, and strongly a head of foam (Sauret et al. 2015).'],
      ['Meltwater layer', d => (d.layerV > 1e-7 ? `${f(d.layerH * 1000, 1)} mm · ${ml(d.layerV)} · ${f(d.layerT, 1)} °C · Ri ${f(d.layerRi, 0)}` : '—'), 'Fresh meltwater is lighter than sugary or salty soda and floats as a layer: no CO₂ (a lid on the fizz, bubbles shrink in it), no surfactants (its foam collapses faster), ice touching it melts slowly. Turbulence erodes it: u_e = 0.1·u/Ri (Turner).'],
      ['Foam eruption', d => (d.eruption > 1e-3 || d.thrownFoam > 0 ? `${f(d.eruption * 100, 0)} cm/s · ${ml(d.thrownFoam)} flung` : '—'), 'Speed the head leaves the mouth = foam volume rate / mouth area. Foam is flung off once ρ_f·u² beats its yield stress and rim adhesion; slower foam oozes down the outside.'],
      ['Thrown drink', d => (d.thrownLiquid > 0 ? ml(d.thrownLiquid) : '—'), 'Liquid leaving the rim with the rim’s own speed (the cup turning about its corner), the slosh wave and the weir outflow. Below ~0.3 m/s it clings and runs down the outside (teapot effect).'],
      ['On the table', d => (d.puddles || d.flying > 0 ? `${d.puddles} puddle${d.puddles === 1 ? '' : 's'} · ${ml(d.puddleV)}${d.flying > 0 ? ` · ${ml(d.flying)} in the air` : ''}` : '—'), 'Puddles spread as viscous gravity currents (Huppert 1982, r ∝ t^⅛) until they are ~3 mm thick (h = 2·l_c·sin(θ/2)), and merge when they touch.'],
      ['Stream', d => (d.inStream > 0 || d.streamMissed > 0 ? `${ml(d.inStream)} in the air${d.streamMissed > 1e-7 ? ` · ${ml(d.streamMissed)} missed` : ''}` : '—'), 'Each step’s outflow flies from the lip as a parcel. It stays a jet for L_b = 19.5·d·[√We(1+3Oh)]^0.85 (Grant & Middleman), then drops; slow flow dribbles down the neck.'],
    ]},
    { group: 'Temperature & liquid', rows: [
      ['Soda', d => `${f(d.Tliq, 1)} °C`, 'Lumped liquid temperature: wall exchange, ice, surface air, fizz cooling (≈20 kJ/mol desorbed).'],
      ['Cup wall', d => `${f(d.Twall, 1)} °C`, 'Lumped wall: U = 1/(1/h + t/2k) on both faces; heat capacity ρ·t·A·c_p.'],
      ['Ice', d => (d.iceCount > 0 ? `${d.iceCount} cubes · ${f(d.iceMass * 1000, 0)} g · ${f(d.iceT, 1)} °C${d.iceFloating ? ' · floating' : ''}` : '—'), 'Each cube is a rigid body: gravity, buoyancy (ρ_l·g·V_sub), drag (C_d = 1.05), stacking. It warms to 0 °C, then melts at L_f = 334 kJ/kg.'],
      ['Ice room / spilled', d => `${d.iceCount} of ~${d.iceCapacity} fit · ${d.iceOnTable} on the table`, 'Capacity from the cup geometry: cubes per depth lane = chord of the circle ÷ edge; layers to the rim. Heaped above the rim, cubes tip over and fall out.'],
      ['Ice melt coefficient', d => (d.iceH > 0 ? `${f(d.iceH, 0)} W/m²K` : '—'), 'Churchill (1983) sphere natural convection driven by the boundary-layer density difference (water is densest at 4 °C; flow reverses near 5 °C), blended with Ranz–Marshall forced convection while pouring or stirring.'],
      ['Melting', d => (d.iceCount || d.iceMelted > 0 ? `${f(d.meltRate * 6e4, 2)} g/min · ${f(d.iceMelted * 1000, 1)} g so far` : '—'), 'Stefan condition: once a cube reaches the melting point, m = q / L_f with L_f = 334 kJ/kg; q from Churchill convection on its wetted faces plus room air on its dry ones. Ice in soda melts at the soda’s freezing point (sugar, salt and ethanol lower it).'],
      ['Dissolved salt', d => (d.saltGrams > 0 ? `${f(d.saltGrams, 2)} g · ${f(d.saltMolal, 3)} mol/kg` : '—'), 'Each SALT press adds a pinch (~0.4 g) that dissolves in seconds. It lowers the freezing point by 1.87 × 1.86 K·kg/mol × molality and salts out CO₂ (K_s ≈ 0.11 L/mol). A pinch barely matters (−0.1 °C); a spoonful (~15 pinches) does.'],
      ['Meltwater in drink', d => `${f((1 - d.strength) * 100, 1)} % · freezes at ${f(d.freezingPoint, 2)} °C`, 'Meltwater carries no CO₂ and no sugar: it dilutes both, thinning the syrup. Soda chilled past its freezing point (1.86 K·kg/mol × sugar molality) freezes onto the ice.'],
      ['Surface tension σ', d => `${f(d.sigma * 1000, 1)} mN/m`, 'IAPWS σ(T) × beverage factor. Lower σ → smaller R* and more nucleation.'],
      ['Viscosity μ', d => `${f(d.mu * 1000, 2)} mPa·s`, 'CRC water viscosity (±0.3 % vs IAPWS) × sugar factor from the CRC sucrose table. Slows bubble rise and foam drainage.'],
      ['CO₂ diffusivity D', d => `${f(d.D * 1e9, 2)}e-9 m²/s`, 'Versteeg & van Swaaij (1988): D = 2.35·10⁻⁶·e^(−2119/T), with D·μ^0.8 = const in syrups.'],
    ]},
    { group: 'Contact surface', closed: true, rows: [
      ['Cup wall wetted', d => cm2(d.contact.wall), 'πD·h — side wall below the liquid line.'],
      ['Cup floor', d => cm2(d.contact.floor), 'πD²/4.'],
      ['Ice submerged', d => cm2(d.contact.ice), '6a² per cube × submerged fraction.'],
      ['Ice running film', d => cm2(d.contact.iceFilm), 'Exposed ice wetted by the stream; drains over ~1.5 s after the pour stops.'],
      ['Additives', d => cm2(d.contact.additives), 'Mentos / salt surface still undissolved.'],
      ['Total contact', d => cm2(d.contact.total), 'Every wetted area feeds the nucleation-site count N_a·A.'],
    ]},
    { group: 'Bubbles', rows: [
      ['Emission', d => `${sci(d.emission)} /s`, 'Σ over surfaces of A · N_a · f_site.'],
      ['By surface', d => topPatches(d.patches), 'Bubbles per second from each surface type.'],
      ['In liquid', d => `${sci(d.bubbles)} (${d.particles} particles)`, 'Real bubbles currently rising (each particle carries a weight).'],
      ['Mean rise speed', d => `${f(d.rise * 1000, 1)} mm/s`, 'Schiller–Naumann drag (rigid ↔ mobile skin), Tomiyama cap, plus plume flow and bubble-swarm drift.'],
      ['Gas holdup', d => ml(d.holdup), 'Gas volume suspended in the liquid — it lifts the liquid level.'],
    ]},
    { group: 'Bottle & jet', rows: [
      ['Bottle', d => `${f(d.bottle.left * 1e6, 0)} ml left · ${f(d.bottle.angle, 0)}°`, 'Liquid left and axis angle (0° upright, 90° horizontal, 180° upside-down).'],
      ['Flow out', d => (d.bottle.Q > 0 ? `${f(d.bottle.Q * 1e6, 0)} ml/s · ${d.bottle.regime.toUpperCase()}` : (d.bottle.regime === 'empty' ? 'empty' : '—')),
        'SMOOTH: air enters over the liquid in the mouth; flow set by Q_liquid(head − ΔP/ρg) = Q_air(ΔP). GLUG: mouth flooded; air only as neck bubbles, capped at (πd²/4)·0.35√(gd).'],
      ['Head over lip', d => (d.bottle.head > 0 ? `${f(d.bottle.head * 1000, 1)} mm` : '—'), 'Height of the liquid surface inside the bottle above the lowest point of the lip.'],
      ['Headspace suction', d => (d.bottle.Q > 0 ? `${f(d.bottle.suction, 0)} Pa` : '—'), 'How far the trapped air is pulled below atmospheric to drag air in — it eats into the head.'],
      ['Glug ceiling', d => `${f(d.bottle.glugLimit * 1e6, 0)} ml/s`, 'Davies–Taylor bubble rise through the neck; matches Clanet & Searby (2004) ≈ (π/12)√g·d^2.5.'],
    ]},
    { group: 'Pour jet', closed: true, rows: [
      ['Impact speed', d => (d.jet ? `${f(d.jet.vEff, 2)} m/s` : '—'), 'v = √(v₀² + 2gh), × cos(tilt).'],
      ['Jet diameter', d => (d.jet ? `${f(d.jet.dj * 1000, 1)} mm` : '—'), 'Continuity: d_j = d₀√(v₀/v).'],
      ['Froude / Weber', d => (d.jet ? `${f(d.jet.Fr, 0)} / ${f(d.jet.We, 0)}` : '—'), 'Fr = v²/(g·d_j), We = ρv²d_j/σ.'],
      ['Air entrained', d => (d.jet ? `${f(d.jet.Qair * 1e6, 1)} ml/s (${f(d.jet.ratio * 100, 0)} %)` : '—'), 'Bin (1993): Q_air/Q = 0.04·Fr^0.28·(h/d₀)^0.4, × onset and splash factors.'],
      ['Plume turbulence ε', d => (d.jet ? `${f(d.jetEps, 1)} W/kg` : '—'), 'Jet power ½ρQv² spread over the submerged cone.'],
      ['Max bubble (Hinze)', d => (d.jet ? `${f(d.jetRmax * 2000, 2)} mm` : '—'), 'd_max = 0.725·(σ/ρ)^0.6·ε^−0.4.'],
    ]},
    { group: 'Foam head', rows: [
      ['Height', d => `${f(d.foamH * 1000, 1)} mm`, 'Σ layer volume / free cross-section.'],
      ['Liquid fraction φ', d => (d.foamLayers ? f(d.foamPhi, 3) : '—'), 'Wet foam ≈ 0.2–0.36; dry foam < 0.05 and fragile.'],
      ['Bubble size', d => (d.foamLayers ? `${f(d.foamR * 2000, 2)} mm` : '—'), 'Coarsening: d⟨R²⟩/dt = 4σD·He/(P·h)·(1 − √(φ/φ*))².'],
      ['Capillary Pc (top)', d => (d.foamLayers ? `${f(d.foamPc, 0)} Pa` : '—'), 'Pc = σ/r_pb, r_pb = R√(φ/0.33): suction pulling liquid out of the films. Collapse is triggered when φ drops below the drink’s φc.'],
      ['Gas in foam', d => ml(d.foamGas), ''],
    ]},
    { group: 'Totals', rows: [
      ['Poured', d => ml(d.poured), ''],
      ['In cup', d => ml(d.volume), 'Bulk liquid (excluding foam liquid).'],
      ['CO₂ released', d => `${f(d.released, 3)} g`, 'Poured CO₂ − still dissolved − spilled while dissolved.'],
      ['Spilled', d => ml(d.spilled), ''],
      ['Bubbling stops in', d => eta(d.tStop, 'stopped'), 'Extrapolated until S < 0.15: R* has outgrown almost every cavity, so nucleation (even on Mentos or ice) dies out. The soda looks flat but still holds about c_eq of CO₂.'],
      ['Taste-flat in', d => eta(d.tFlat, 'flat!'), `Extrapolated until < ${Simulation.FLAT_VOLUMES} vol. Close to saturation only slow diffusion through the free surface removes CO₂, so this is minutes to hours.`],
    ]},
  ];

  function topPatches(p) {
    const items = Object.values(p || {}).filter(x => x.rate > 0).sort((a, b) => b.rate - a.rate).slice(0, 3);
    return items.length ? items.map(x => `${x.name.split(' ')[0]} ${sci(x.rate)}`).join(' · ') : '—';
  }
  function eta(t, done) { return t === 0 ? done : isFinite(t) ? fmtTime(t) : '—'; }
  function fmtTime(s) {
    if (s < 120) return `${s.toFixed(0)} s`;
    if (s < 7200) return `${(s / 60).toFixed(0)} min`;
    return `${(s / 3600).toFixed(1)} h`;
  }

  // ---------------------------------------------------------------------
  class ControlPanel {
    constructor(sim, root, onSetupChange, actions = {}) {
      this.sim = sim;
      this.actions = actions;
      this.root = root;
      this.onSetupChange = onSetupChange;
      this.inputs = {};
      this.locked = false;
      this._build();
    }

    _build() {
      // the everyday groups open; the rarely touched ones folded under "More"
      let more = null;
      for (const grp of SCHEMA) {
        const fs = document.createElement('fieldset');
        fs.innerHTML = `<legend>${grp.group}</legend>`;
        for (const it of grp.items) fs.appendChild(this._control(it));
        if (grp.more) {
          if (!more) { more = document.createElement('details'); more.className = 'more-settings'; more.innerHTML = '<summary>MORE SETTINGS <span>pour, room</span></summary>'; this.root.appendChild(more); }
          more.appendChild(fs);
        } else this.root.appendChild(fs);
      }
    }

    _control(it) {
      if (it.type === 'drinks') return this._drinkPicker(it);
      if (it.type === 'action') {
        const b = document.createElement('button');
        b.className = 'ctl-action'; b.textContent = it.label; b.title = it.tip || '';
        b.onclick = () => this.actions[it.action]();
        return b;
      }
      const row = document.createElement('label');
      row.className = 'ctl';
      row.title = it.tip || '';
      const p = this.sim.params;
      const name = document.createElement('span');
      name.className = 'ctl-name';
      name.textContent = it.label + (it.reset ? '' : ' ⚡');
      const val = document.createElement('span');
      val.className = 'ctl-val';
      let input;
      if (it.type === 'select') {
        input = document.createElement('select');
        for (const o of it.options) input.add(new Option(o.label, o.value));
      } else if (it.type === 'check') {
        input = document.createElement('input');
        input.type = 'checkbox';
      } else {
        input = document.createElement('input');
        input.type = 'range';
        if (it.scale === 'log') { input.min = 0; input.max = 1000; input.step = 1; } else { input.min = it.min; input.max = it.max; input.step = it.step; }
      }
      const read = () => {
        if (it.type === 'select') return input.value;
        if (it.type === 'check') return input.checked;
        const raw = parseFloat(input.value);
        if (it.scale === 'log') {
          const v = it.lo * Math.pow(it.hi / it.lo, raw / 1000);
          return v < 10 ? Math.round(v * 2) / 2 : Math.round(v);
        }
        return raw;
      };
      const write = (v) => {
        if (it.type === 'select') input.value = v;
        else if (it.type === 'check') input.checked = !!v;
        else if (it.scale === 'log') input.value = Math.round(1000 * Math.log(v / it.lo) / Math.log(it.hi / it.lo));
        else input.value = v;
        val.textContent = it.fmt ? it.fmt(v) : '';
      };
      input.addEventListener('input', () => {
        const v = read();
        this.sim.params[it.key] = v;
        val.textContent = it.fmt ? it.fmt(v) : '';
        if (it.live && this.actions[it.live]) this.actions[it.live](v);   // acts on the glass you have
        else if (it.reset) this.onSetupChange();
      });
      write(p[it.key]);
      this.inputs[it.key] = { input, write, it };
      row.append(name, input, val);
      return row;
    }

    /** A grid of cans, one per drink; picking one also loads its measured carbonation. */
    _drinkPicker(it) {
      const wrap = document.createElement('div');
      wrap.className = 'drinks';
      const grid = document.createElement('div');
      grid.className = 'drink-grid';
      const info = document.createElement('p');
      info.className = 'drink-info';
      const buttons = {};
      for (const b of Object.values(Props.BEVERAGES)) {
        const btn = document.createElement('button');
        btn.className = 'drink';
        btn.style.setProperty('--liq', b.liquid);
        btn.style.setProperty('--lab', b.label);
        btn.innerHTML = `<i class="can"></i><b>${b.name}</b><span>${b.carbonation.toFixed(1)} vol</span>`;
        btn.title = `${b.name} (${b.eg}) — ${b.carbonation} vol CO₂. Source: ${b.source}`;
        btn.onclick = () => {
          if (this.locked) return;
          this.sim.params.beverage = b.id;
          this.sim.params.carbonation = b.carbonation;
          write(b.id);
          this.inputs.carbonation.write(b.carbonation);
          this.onSetupChange();
        };
        buttons[b.id] = btn;
        grid.appendChild(btn);
      }
      const write = (id) => {
        for (const k in buttons) buttons[k].classList.toggle('on', k === id);
        const b = Props.BEVERAGES[id];
        info.innerHTML = `<b>${b.name}</b> <em>${b.eg}</em><br>${b.carbonation} vol CO₂ (${(b.carbonation * C.MOL_PER_VOLUME * C.M_CO2).toFixed(1)} g/L) · <span class="src">${b.source}</span><br>${b.note}`;
      };
      write(this.sim.params[it.key]);
      this.inputs[it.key] = { input: { set disabled(v) { for (const k in buttons) buttons[k].disabled = v; } }, write, it };
      wrap.append(grid, info);
      return wrap;
    }

    /** Push sim.params back into the widgets (after a preset or challenge). */
    sync() { for (const k in this.inputs) this.inputs[k].write(this.sim.params[k]); }

    lockSetup(lock) {
      this.locked = lock;
      for (const k in this.inputs) if (this.inputs[k].it.reset) this.inputs[k].input.disabled = lock;
    }
  }

  // ---------------------------------------------------------------------
  class Readouts {
    constructor(root) {
      this.cells = [];
      for (const grp of READOUTS) {
        const box = document.createElement('details');
        box.className = 'ro-group';
        box.open = !grp.closed;
        box.innerHTML = `<summary>${grp.group}</summary>`;
        const dl = document.createElement('dl');
        for (const [label, get, tip] of grp.rows) {
          const dt = document.createElement('dt'); dt.textContent = label; dt.title = tip;
          const dd = document.createElement('dd'); dd.title = tip;
          dl.append(dt, dd);
          this.cells.push({ dd, get });
        }
        box.appendChild(dl);
        root.appendChild(box);
      }
    }
    update(d) {
      for (const c of this.cells) {
        let s;
        try { s = c.get(d); } catch (e) { s = '—'; }
        if (c.dd.textContent !== s) c.dd.textContent = s;
      }
    }
  }

  Fizz.UI = { ControlPanel, Readouts, SCHEMA };
})(window.Fizz = window.Fizz || {});
