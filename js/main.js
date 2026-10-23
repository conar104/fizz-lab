/* Fizz Lab — wiring: simulation loop, input, panels. */
(function (Fizz) {
  'use strict';
  const { Simulation, Renderer, Chart, UI, Game, Hud, C } = Fizz;

  const $ = (id) => document.getElementById(id);
  const DT = 1 / 120;           // physics step at 1× speed
  const MAX_SUBSTEPS = 64;
  const MAX_DT = 1 / 30;        // the coarsest physics step a time-lapse may take
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 64];          // 64×: time-lapse, to watch ice melt

  const sim = new Simulation();
  const renderer = new Renderer($('view'));
  let speed = 1, paused = false;

  // --- your setup is remembered between visits (this browser only) ----------
  const STORE_KEY = 'fizzlab.params.v1';
  function loadParams() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!saved) return;
      for (const k of Object.keys(Simulation.DEFAULTS)) {
        if (k in saved && typeof saved[k] === typeof Simulation.DEFAULTS[k]) sim.params[k] = saved[k];
      }
      sim.params.tilt = 0;                                   // always start with the glass standing
      sim.reset();
    } catch (e) { /* storage unavailable: start from the defaults */ }
  }
  let savedJSON = '';
  function saveParams() {
    try {
      const j = JSON.stringify(Object.assign({}, sim.params, { tilt: 0 }));
      if (j !== savedJSON) { localStorage.setItem(STORE_KEY, j); savedJSON = j; }
    } catch (e) { /* ignore */ }
  }
  loadParams();

  // --- panels -----------------------------------------------------------
  const panel = new UI.ControlPanel(sim, $('controls'), () => sim.reset(), { addIce: () => addIce(), setIceCount: (n) => sim.setIceCount(n) });
  const hud = new Hud($('hud'));
  const readouts = new UI.Readouts($('readouts'));

  const gL = (vol) => vol * C.MOL_PER_VOLUME * C.M_CO2;
  const charts = {
    height: new Chart($('chart-height'), {
      legend: $('legend-height'),
      series: [
        { get: s => s.level * 1000, color: '#a7f070', label: 'liquid', fmt: v => `${v.toFixed(0)} mm` },
        { get: s => s.foamTop * 1000, color: '#f7ecd2', label: 'foam top', fmt: v => `${v.toFixed(0)} mm` },
      ],
      band: [0, 1],
      yMax: () => sim.H * 1000 * 1.15,
      guides: [{ value: () => sim.H * 1000, color: '#ef7d57', label: 'rim' }],
    }),
    co2: new Chart($('chart-co2'), {
      legend: $('legend-co2'),
      series: [
        { get: s => (s.has ? s.c : NaN), color: '#41a6f6', label: 'dissolved', fmt: v => `${v.toFixed(2)} g/L` },
        { get: s => s.ceq, color: '#566c86', label: 'holds at rest', fmt: v => `${v.toFixed(2)} g/L` },
      ],
      yMax: () => Math.max(gL(sim.params.carbonation) * 1.12, 3),
      guides: [{ value: () => gL(sim.params.carbonation), color: '#94b0c2', label: 'in the bottle' },
               { value: gL(Simulation.FLAT_VOLUMES), color: '#b13e53', label: 'tastes flat' }],
    }),
    temp: new Chart($('chart-temp'), {
      legend: $('legend-temp'),
      series: [
        { get: s => (s.has ? s.T : NaN), color: '#ffcd75', label: 'soda', fmt: v => `${v.toFixed(1)} °C` },
        { get: s => s.Tw, color: '#94b0c2', label: 'glass', fmt: v => `${v.toFixed(1)} °C` },
        { get: s => s.Tice, color: '#73eff7', label: 'ice', fmt: v => `${v.toFixed(1)} °C` },
      ],
      yMin: (vis) => Math.min(0, ...vis.map(s => (isFinite(s.Tice) ? s.Tice : 0)), ...vis.map(s => s.Tf)) - 1,
      yMax: (vis) => Math.max(5, ...vis.map(s => Math.max(s.Tw, s.has ? s.T : 0))) + 2,
      guides: [{ value: () => sim.freezingPoint() - C.T0, color: '#73eff7', label: 'freezes' }],
    }),
  };

  // --- key numbers: the five things worth watching, with what they mean ----------
  const KEYS = [
    { id: 'co2', label: 'CO₂ LEFT', get: d => [`${d.cVol.toFixed(2)} vol`, `${Math.round(100 * d.cVol / Math.max(sim.params.carbonation, 0.01))} % of the bottle`,
      d.cVol < Simulation.FLAT_VOLUMES ? 'bad' : d.cVol < 2.5 ? 'warn' : 'good'] },
    { id: 'fizz', label: 'FIZZ', get: d => [`S ${d.S.toFixed(2)}`, d.S > 1 ? 'strongly supersaturated' : d.S > 0.15 ? 'bubbling' : 'calm: no new bubbles',
      d.S > 1 ? 'hot' : d.S > 0.15 ? 'good' : 'idle'] },
    { id: 'bubbles', label: 'BUBBLES', get: d => [d.emission >= 1e3 ? `${(d.emission / 1e3).toFixed(1)}k/s` : `${d.emission.toFixed(0)}/s`, `${(d.bubbles || 0) >= 1e3 ? ((d.bubbles / 1e3).toFixed(1) + 'k') : (d.bubbles || 0).toFixed(0)} rising now`, d.emission > 2e4 ? 'hot' : d.emission > 50 ? 'good' : 'idle'] },
    { id: 'head', label: 'HEAD', get: d => [`${(d.foamH * 1000).toFixed(0)} mm`, d.foamTop > sim.H ? 'over the rim!' : d.foamH > 0.015 ? 'tall' : d.foamH > 0.003 ? 'a nice head' : 'none',
      d.foamTop > sim.H ? 'bad' : d.foamH > 0.015 ? 'warn' : d.foamH > 0.003 ? 'good' : 'idle'] },
    { id: 'temp', label: 'SODA', get: d => [`${d.Tliq.toFixed(1)} °C`, d.iceCount ? `${d.iceCount} cubes, melting ${(d.meltRate * 6e4).toFixed(1)} g/min` : 'no ice',
      d.Tliq < 4 ? 'cold' : d.Tliq > 15 ? 'warn' : 'good'] },
  ];
  $('keystats').innerHTML = KEYS.map(k => `<div class="key" data-key="${k.id}"><span class="key-label">${k.label}</span><b class="key-val"></b><span class="key-note"></span></div>`).join('');
  const keyEls = KEYS.map(k => { const el = $('keystats').querySelector(`[data-key="${k.id}"]`); return { k, el, val: el.querySelector('.key-val'), note: el.querySelector('.key-note') }; });
  const updateKeys = (d) => {
    for (const { k, el, val, note } of keyEls) {
      let r; try { r = k.get(d); } catch (e) { r = ['—', '', 'idle']; }
      if (val.textContent !== r[0]) val.textContent = r[0];
      if (note.textContent !== r[1]) note.textContent = r[1];
      if (el.dataset.state !== r[2]) el.dataset.state = r[2];
    }
  };

  // --- feedback: toasts & banner ---------------------------------------
  function toast(title, text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<b>${title}</b><span>${text}</span>`;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
  }
  function banner(title, text, action) {
    $('banner-title').textContent = title;
    $('banner-text').textContent = text;
    const btn = $('banner-action');
    btn.hidden = !action;
    if (action) { btn.textContent = action.label; btn.onclick = () => { hideBanner(); action.fn(); }; }
    $('banner').hidden = false;
  }
  function hideBanner() { $('banner').hidden = true; }
  $('banner-close').onclick = hideBanner;

  const game = new Game(sim, {
    toast, banner,
    onParamsChanged: () => panel.sync(),
    onAchievements: () => renderAchievements(),
  });

  // --- experiments & achievements lists ----------------------------------
  for (const ex of Game.EXPERIMENTS) {
    const b = document.createElement('button');
    b.className = 'exp';
    b.innerHTML = `<b>${ex.name}</b><span>${ex.look}</span>`;
    b.onclick = () => game.runExperiment(ex);
    $('experiments').appendChild(b);
  }
  function renderAchievements() {
    const got = Game.ACHIEVEMENTS.filter(a => game.store.unlocked[a.id]).length;
    $('ach-count').textContent = `${got} / ${Game.ACHIEVEMENTS.length}`;
    $('achievements').innerHTML = Game.ACHIEVEMENTS.map(a =>
      `<li class="${game.store.unlocked[a.id] ? 'got' : ''}"><b>${game.store.unlocked[a.id] ? '★' : '☆'} ${a.name}</b> ${a.desc}</li>`).join('');
  }
  renderAchievements();

  // --- the lab's tabs ------------------------------------------------------
  let labTab = 'setup';
  // each lab tab says what it is for
  const TAB_DESC = {
    setup: 'Build the scene: the drink, the glass, the ice and the pour.',
    experiments: 'One-click "what if" questions, poured for you.',
    awards: 'How to pour, and the things you have done to a soda so far.',
    model: 'The physics behind every number, with sources.',
  };
  const showTabDesc = () => { $('tab-desc').textContent = TAB_DESC[labTab] || ''; };
  $('tabs').addEventListener('click', () => setTimeout(showTabDesc, 0));
  showTabDesc();


  // --- tabs --------------------------------------------------------------
  $('tabs').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    for (const b of $('tabs').children) b.classList.toggle('on', b === t);
    for (const el of document.querySelectorAll('.tab')) el.hidden = el.id !== 'tab-' + t.dataset.tab;
    labTab = t.dataset.tab;
  });

  // --- actions -------------------------------------------------------------
  const pourBtn = $('btn-pour');
  const holdStart = () => { sim.startPour(false); pourBtn.classList.add('held'); };
  const holdEnd = () => { if (!sim.pour.auto) sim.stopPour(); pourBtn.classList.remove('held'); };
  pourBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); holdStart(); });
  pourBtn.addEventListener('pointerup', holdEnd);
  pourBtn.addEventListener('pointerleave', holdEnd);
  // AUTO and STIR are sticky toggles: click to start, click again to stop.
  const toggleAuto = () => (sim.pour.active && sim.pour.auto ? sim.stopPour() : sim.startPour(true));
  const addIce = () => sim.addIce();
  let lastOverflowToast = -10;
  sim.on('iceOverflow', () => {
    if (sim.time - lastOverflowToast > 4) { lastOverflowToast = sim.time; toast('Ice overflow', 'The glass is heaped full: cubes are tumbling onto the table.'); }
  });
  let lastThrowToast = -10;
  sim.on('iceThrown', () => {
    if (sim.time - lastThrowToast > 4) { lastThrowToast = sim.time; toast('Ice flung!', 'You swung the glass hard enough to throw the cubes out of it.'); }
  });

  // --- the glass and the table ------------------------------------------------
  const upright = () => { setTilt(0); };
  const cleanTable = () => { sim.cleanTable(); toast('Table cleaned', 'Puddles, foam and spilled ice wiped away.'); };
  const stopAll = () => { sim.stopAll(); };
  const restoreDefaults = () => {
    Object.assign(sim.params, Simulation.DEFAULTS);
    sim.reset(); panel.sync(); saveParams();
    toast('Defaults', 'Every setting is back to the default diet cola pour.');
  };
  const helpCard = $('help');
  const toggleHelp = () => { helpCard.hidden = !helpCard.hidden; };
  $('help-close').onclick = () => { helpCard.hidden = true; };
  $('btn-upright').onclick = upright;
  $('btn-clean').onclick = cleanTable;
  $('btn-defaults').onclick = restoreDefaults;
  $('q-reset').onclick = () => $('btn-reset').click();
  $('q-upright').onclick = upright;
  $('q-clean').onclick = cleanTable;
  $('q-stop').onclick = stopAll;
  $('q-help').onclick = toggleHelp;
  $('btn-auto').onclick = toggleAuto;
  $('btn-ice').onclick = addIce;
  $('btn-mentos').onclick = () => sim.dropMentos();
  $('btn-salt').onclick = () => sim.addSalt();
  $('btn-cap').onclick = () => sim.toggleCap();
  $('q-cap').onclick = () => sim.toggleCap();
  sim.on('sealedTip', () => toast('The cap is on', 'A sealed bottle will not pour. Click the cap (or POP / O) to pop it.'));
  sim.on('bottleOpened', (o) => {
    const bar = (o.dP / 1e5).toFixed(1);
    if (o.Vb > 5e-6) toast('POP! Gusher!', `It was shaken: ${(o.Vb * 1e6).toFixed(0)} ml of trapped bubbles swelled as ${bar} bar vented, and the soda is suddenly supersaturated.`);
    else toast('Pssst…', `${bar} bar of CO₂ vented. Unshaken, there is almost nothing for the gas to grow on.`);
  });
  sim.on('bottleCapped', () => toast('Cap on', 'The drink will refill the headspace with CO₂ and keep the rest of its fizz. Shake it, then open it…'));
  $('btn-stir').onclick = () => sim.toggleStir();
  const hudBtn = $('btn-hud');
  // one HUD switch for both modes; the window painted behind it goes when it is up
  let hudOn = true;
  const toggleHud = () => {
    hudOn = !hudOn;
    $('hud').hidden = !hudOn;
    renderer.setWindow(!hudOn);
    hudBtn.classList.toggle('on', hudOn);
    hudBtn.setAttribute('aria-pressed', hudOn);
  };
  renderer.setWindow(false);
  hudBtn.onclick = toggleHud;
  // 3D (looking down on the table, ray-cast glass) or the flat cut-away SECTION
  const viewBtn = $('btn-view');
  const toggleView = () => {
    const mode = renderer.view.mode === '3d' ? 'section' : '3d';
    renderer.setView(mode);
    viewBtn.innerHTML = (mode === '3d' ? '3D' : 'SECTION') + ' <kbd>V</kbd>';
    viewBtn.setAttribute('aria-label', 'View: ' + mode);
  };
  viewBtn.onclick = toggleView;

  // --- tilting the cup: drag it sideways on the canvas, or ← / → -------------
  const MAX_TILT = 90;
  function setTilt(deg) {
    sim.params.tilt = Math.round(Math.max(0, Math.min(MAX_TILT, deg)));
    panel.sync();
  }
  const view = $('view');
  let drag = null;
  const canvasXY = (e) => {
    const r = view.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * view.width, (e.clientY - r.top) / r.height * view.height];
  };
  // --- the bottle in your hand: grab the neck to move it, the body to tip it ---
  let held = null;
  const lipAngle = (wx, wy) => {
    const m = sim.pour.mouth;                                   // axis lip -> base = (-sin phi, -cos phi)
    return Math.atan2(-(wx - m.x), -(wy - m.y)) * 180 / Math.PI;
  };
  let grabHintShown = false;
  view.addEventListener('pointermove', (e) => {
    const [x, y] = canvasXY(e);
    if (held) {
      const [wx, wy] = renderer.screenToWorld(x, y);
      if (held.part === 'neck') sim.moveBottle(wx - held.ox, wy - held.oy);
      else {
        let a = lipAngle(wx, wy) - held.a0;
        a = ((a + 540) % 360) - 180;                             // the shortest way round
        sim.tipBottle(held.phi0 + a);
      }
      return;
    }
    if (drag) {
      // dragging left leans the mouth toward the bottle (positive tilt)
      setTilt(drag.tilt0 + (drag.x0 - x) * 0.8);          // 0.8° per canvas pixel
      return;
    }
    const onBottle = renderer.hitBottle(x, y);
    view.classList.toggle('grab', !!onBottle && onBottle !== 'cap');
    view.style.cursor = onBottle === 'cap' ? 'pointer' : onBottle ? '' : renderer.hitCup(x, y) ? 'ew-resize' : 'default';
    view.title = onBottle === 'cap' ? 'Click to pop the cap' : '';
  });
  view.addEventListener('pointerdown', (e) => {
    const [x, y] = canvasXY(e);
    const part = renderer.hitBottle(x, y);
    if (part === 'cap') { sim.openBottle(); e.preventDefault(); return; }
    if (part) {
      sim.grabBottle();
      const [wx, wy] = renderer.screenToWorld(x, y);
      const m = sim.pour.mouth;
      held = { part, ox: wx - m.x, oy: wy - m.y, phi0: sim.bottle.phi, a0: lipAngle(wx, wy) };
      view.classList.add('grabbing');
      view.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (!grabHintShown) {
        grabHintShown = true;
        toast('Bottle in hand', part === 'neck' ? 'Moving it by the neck. Grab the body to tip it (or scroll).' : 'Tipping it about the lip. Grab the neck to move it.');
      }
      return;
    }
    if (!renderer.hitCup(x, y)) return;
    drag = { x0: x, tilt0: sim.params.tilt };
    view.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  view.addEventListener('wheel', (e) => {
    const [x, y] = canvasXY(e);
    if (!held && !renderer.hitBottle(x, y)) return;
    e.preventDefault();
    if (!held) sim.grabBottle();
    sim.tipBottle((sim.pour.manual ? sim.pour.manual.phi : sim.bottle.phi) + (e.deltaY < 0 ? 4 : -4));
    if (!held) { clearTimeout(view._wheelRelease); view._wheelRelease = setTimeout(() => { if (!held) sim.releaseBottle(); }, 1500); }
  }, { passive: false });
  const endDrag = () => {
    drag = null;
    if (held) { held = null; sim.releaseBottle(); view.classList.remove('grabbing'); }
  };
  view.addEventListener('dblclick', (e) => { const [x, y] = canvasXY(e); if (renderer.hitCup(x, y)) upright(); });
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);

  /** Reflect live state on the toggle buttons (they can change from physics, e.g. auto-pour finishing). */
  function syncButtons() {
    const P = sim.pour;
    const auto = P.active && P.auto;
    const ab = $('btn-auto');
    ab.classList.toggle('on', auto);
    ab.setAttribute('aria-pressed', auto);
    const amount = sim.params.pourAmount;
    const label = auto ? `STOP ${amount} ml` : `AUTO ${amount} ml`;
    if ($('auto-label').textContent !== label) $('auto-label').textContent = label;
    const done = auto ? 1 - (P.target - P.poured) / (amount * 1e-6) : 0;
    $('auto-prog').style.width = `${Math.max(0, Math.min(1, done)) * 100}%`;
    const capLabel = sim.bottle.sealed ? 'POP CAP' : 'RECAP';
    const cb = $('btn-cap');
    if (cb.firstChild.textContent.trim() !== capLabel) cb.firstChild.textContent = capLabel + ' ';
    cb.classList.toggle('sealed', sim.bottle.sealed);
    const qc = $('q-cap'), ql = sim.bottle.sealed ? '◉ POP' : '◎ RECAP';
    if (qc.textContent !== ql) qc.textContent = ql;
    const st = sim.additives.stirring;
    $('btn-stir').classList.toggle('on', st);
    $('btn-stir').setAttribute('aria-pressed', st);
  }
  $('btn-reset').onclick = () => sim.reset();

  const speedBox = $('speeds');
  const setSpeed = (s) => {
    speed = s;
    SPEEDS.forEach((v, i) => speedBox.children[i].classList.toggle('on', v === s));
  };
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.textContent = `${s}×`;
    b.classList.toggle('on', s === speed);
    b.onclick = () => setSpeed(s);
    speedBox.appendChild(b);
  }
  const stepSpeed = (d) => setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + d))]);
  const pauseBtn = $('btn-pause');
  const togglePause = () => { paused = !paused; pauseBtn.classList.toggle('on', paused); };
  pauseBtn.onclick = togglePause;

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { if (e.code !== 'Space') return; }
    if (e.repeat && !e.code.startsWith('Arrow')) return;
    switch (e.code) {
      case 'Space': e.preventDefault(); holdStart(); break;
      case 'KeyA': toggleAuto(); break;
      case 'KeyI': addIce(); break;
      case 'KeyS': sim.toggleStir(); break;
      case 'KeyH': toggleHud(); break;
      case 'KeyV': toggleView(); break;
      case 'ArrowLeft': e.preventDefault(); setTilt(sim.params.tilt + 5); break;
      case 'ArrowRight': e.preventDefault(); setTilt(sim.params.tilt - 5); break;
      case 'KeyM': sim.dropMentos(); break;
      case 'KeyO': sim.toggleCap(); break;
      case 'KeyR': $('btn-reset').click(); break;
      case 'KeyP': togglePause(); break;
      case 'KeyU': upright(); break;
      case 'KeyC': cleanTable(); break;
      case 'Escape': if (!helpCard.hidden) helpCard.hidden = true; else stopAll(); break;
      case 'BracketLeft': stepSpeed(-1); break;
      case 'BracketRight': stepSpeed(+1); break;
      case 'Slash': if (e.shiftKey) toggleHelp(); break;
      case 'F1': e.preventDefault(); toggleHelp(); break;
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') holdEnd(); });

  // --- loop ----------------------------------------------------------------
  let last = performance.now(), uiTimer = 0, chartTimer = 0;
  let loopErrors = 0;
  function frame(now) {
    // Whatever happens inside one frame, the next one is always scheduled, so a
    // single failure can never freeze the game. Errors are reported, not hidden.
    requestAnimationFrame(frame);
    try { tick(now); } catch (err) {
      if (loopErrors++ < 3) console.error('[Fizz] frame error (the simulation keeps running):', err);
    }
  }
  function tick(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      const simDt = real * speed;
      // steps no longer than MAX_DT, so a time-lapse never under-resolves the physics
      // (on a slow frame the clock runs a little behind rather than stepping coarser)
      const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(simDt / DT)));
      const h = Math.min(simDt / n, MAX_DT);
      for (let i = 0; i < n; i++) sim.step(h);
    }
    renderer.render(sim, {}, real);
    syncButtons();

    uiTimer += real; chartTimer += real;
    if (uiTimer > 0.15) {
      uiTimer = 0;
      const d = sim.diagnostics();
      readouts.update(d);
      if (hudOn) hud.update(sim, d);
      updateKeys(d);
      game.check(d);
      $('clock').textContent = `t = ${sim.time.toFixed(1)} s${paused ? ' · paused' : ''}`;
      saveParams();
    }
    if (chartTimer > 0.25) {
      chartTimer = 0;
      charts.height.draw(sim.history); charts.co2.draw(sim.history); charts.temp.draw(sim.history);
    }
  }
  requestAnimationFrame(frame);


  Fizz.app = { sim, renderer, game, panel };
})(window.Fizz = window.Fizz || {});
