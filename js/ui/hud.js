/* Fizz Lab — on-screen HUD: the handful of numbers you watch while pouring. */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  const T_MIN = -2, T_MAX = 40;    // thermometer scale [°C]

  /** Thermometer colour: icy blue → cola-safe amber → hot red. */
  function tempColor(t) {
    if (t < 4) return '#73eff7';
    if (t < 12) return '#41a6f6';
    if (t < 24) return '#ffcd75';
    return '#ef7d57';
  }

  class Hud {
    constructor(root) {
      this.root = root;
      root.innerHTML = `
        <div class="hud-row"><span class="hud-k">SODA</span><span class="hud-v" data-k="soda"></span><i class="bar"><b data-b="soda"></b></i></div>
        <div class="hud-row"><span class="hud-k">CUP</span><span class="hud-v" data-k="cup"></span><i class="bar"><b data-b="cup"></b></i></div>
        <div class="hud-row"><span class="hud-k">ICE</span><span class="hud-v" data-k="ice"></span></div>
        <div class="hud-row"><span class="hud-k">CO₂</span><span class="hud-v" data-k="co2"></span><i class="bar"><b data-b="co2"></b><u data-m="sat"></u></i></div>
        <div class="hud-row"><span class="hud-k">FIZZ</span><span class="hud-v" data-k="fizz"></span></div>
        <div class="hud-row"><span class="hud-k">HEAD</span><span class="hud-v" data-k="head"></span><i class="bar"><b data-b="head"></b></i></div>
        <div class="hud-row"><span class="hud-k">POUR</span><span class="hud-v" data-k="pour"></span><i class="bar"><b data-b="pour"></b></i></div>
        <div class="hud-row"><span class="hud-k">FILL</span><span class="hud-v" data-k="fill"></span><i class="bar"><b data-b="fill"></b></i></div>
        <div class="hud-row hud-status" data-k="status"></div>`;
      this.v = {}; this.b = {}; this.m = {};
      root.querySelectorAll('[data-k]').forEach(el => { this.v[el.dataset.k] = el; });
      root.querySelectorAll('[data-b]').forEach(el => { this.b[el.dataset.b] = el; });
      root.querySelectorAll('[data-m]').forEach(el => { this.m[el.dataset.m] = el; });
    }

    _set(k, text) { if (this.v[k].textContent !== text) this.v[k].textContent = text; }
    _bar(k, frac, color) {
      const el = this.b[k];
      el.style.width = `${(U.clamp(frac, 0, 1) * 100).toFixed(1)}%`;
      if (color) el.style.background = color;
    }

    update(sim, d) {
      const tFrac = (t) => (t - T_MIN) / (T_MAX - T_MIN);
      this._set('soda', d.volume > 1e-7 ? `${d.Tliq.toFixed(1)}°C` : `${sim.params.sodaTemp.toFixed(1)}°C`);
      this._bar('soda', tFrac(d.Tliq), tempColor(d.Tliq));
      this._set('cup', `${d.Twall.toFixed(1)}°C`);
      this._bar('cup', tFrac(d.Twall), tempColor(d.Twall));
      this._set('ice', d.iceCount > 0
        ? `${d.iceCount}/${d.iceCapacity} ${(d.iceMass * 1000).toFixed(0)}g ${d.meltRate > 1e-7 ? `−${(d.meltRate * 6e4).toFixed(1)}g/min` : `${d.iceT.toFixed(0)}°C`}${d.iceOnTable ? ` +${d.iceOnTable}↓` : ''}`
        : 'none · press I');
      // the meltwater layer floating on the drink, when there is one worth seeing
      if (d.layerH > 0.3e-3) this._set('ice', `${this.v.ice.textContent} ≈${(d.layerH * 1000).toFixed(1)}mm water`);

      // CO2 bar: full scale = the bottle's carbonation; tick = saturation at this T & P
      const full = Math.max(sim.params.carbonation, 0.1);
      const satVol = d.ceqGL / (C.MOL_PER_VOLUME * C.M_CO2);
      this._set('co2', `${d.cVol.toFixed(2)} vol`);
      this._bar('co2', d.cVol / full, d.S > 0.15 ? '#41a6f6' : '#566c86');
      this.m.sat.style.left = `${(U.clamp(satVol / full, 0, 1) * 100).toFixed(1)}%`;
      this._set('fizz', d.volume > 1e-7
        ? (d.S > 0.15 ? `S ${d.S.toFixed(2)} · ${fmtRate(d.emission)}` : 'no new bubbles')
        : `S ${d.S.toFixed(2)} in bottle`);

      const room = sim.H - d.level;
      this._set('head', `${(d.foamH * 1000).toFixed(0)} mm`);
      this._bar('head', room > 0 ? d.foamH / room : 1, d.foamH > 0.9 * room ? '#b13e53' : '#f7ecd2');
      const cap = sim.A * sim.H;
      this._set('fill', `${(d.volume * 1e6).toFixed(0)}/${(cap * 1e6).toFixed(0)}ml${d.spilled > 1e-7 ? ` ⚠${(d.spilled * 1e6).toFixed(0)}` : ''}`);
      this._bar('fill', d.level / sim.H, '#a7f070');

      // bottle: flow and how much is left (bar = liquid left)
      const B = d.bottle;
      this._set('pour', B.Q > 0 ? `${(B.Q * 1e6).toFixed(0)} ml/s ${B.regime === 'glug' ? 'GLUG' : '~'} ${B.angle.toFixed(0)}°`
        : B.regime === 'empty' ? 'bottle empty' : `${(B.left * 1e6).toFixed(0)} ml in bottle`);
      this._bar('pour', B.left / sim.bottle.type.fill, B.regime === 'glug' ? '#ef7d57' : '#41a6f6');
      const P = sim.pour, parts = [];
      if (P.active && P.auto) {
        const done = sim.params.pourAmount - (P.target - P.poured) * 1e6;
        parts.push(`▶ ${Math.max(0, done).toFixed(0)}/${sim.params.pourAmount} ml`);
      } else if (P.active) parts.push(`▶ TIPPING ${sim.params.tiltSpeed}°/s`);
      if (sim.additives.stirring) parts.push('⟲ STIR');
      if (sim.additives.mentos.length) parts.push(`◉×${sim.additives.mentos.length}`);
      if (d.eruption > 0.05) parts.push(`ERUPTING ${(d.eruption * 100).toFixed(0)}cm/s`);
      if (Math.abs(d.sloshDeg) > 2) parts.push(`SLOSH ${d.sloshDeg > 0 ? '↗' : '↖'}${Math.abs(d.sloshDeg).toFixed(0)}°`);
      if (Math.abs(d.tiltNow) > 1) parts.push(`∠${d.tiltNow.toFixed(0)}°`);
      if (d.flying > 1e-7) parts.push(`✦${(d.flying * 1e6).toFixed(0)}ml flying`);
      this._set('status', parts.join('  ') || (d.poured > 0 ? '' : 'hold SPACE to pour'));
    }
  }

  function fmtRate(r) {
    if (r >= 1e6) return `${(r / 1e6).toFixed(1)}M/s`;
    if (r >= 1e3) return `${(r / 1e3).toFixed(1)}k/s`;
    return `${r.toFixed(0)}/s`;
  }

  /**
   * The game's HUD: just what you need to pour well — the round and score, a
   * little glass showing the liquid and the head against the target line, the
   * head against its scoring band (3–15 mm), the time, and spill warnings.
   */
  class GameHud {
    constructor(root) {
      this.root = root;
      root.innerHTML = `
        <div class="gh-top"><span class="gh-round" data-k="round"></span><span class="gh-score" data-k="score"></span></div>
        <div class="gh-main">
          <div class="gh-glass"><i class="gh-liq" data-b="liq"></i><i class="gh-foam" data-b="foam"></i><u class="gh-target" data-m="target"></u></div>
          <div class="gh-stats">
            <div><span class="hud-k">FILL</span><b data-k="fill"></b></div>
            <div><span class="hud-k">HEAD</span><b data-k="head"></b></div>
            <i class="gh-headbar"><b data-b="head"></b><em></em></i>
            <div><span class="hud-k">TIME</span><b data-k="time"></b></div>
            <div class="gh-warn" data-k="warn"></div>
          </div>
        </div>`;
      this.v = {}; this.b = {}; this.m = {};
      root.querySelectorAll('[data-k]').forEach(el => { this.v[el.dataset.k] = el; });
      root.querySelectorAll('[data-b]').forEach(el => { this.b[el.dataset.b] = el; });
      root.querySelectorAll('[data-m]').forEach(el => { this.m[el.dataset.m] = el; });
    }
    _set(k, text) { if (this.v[k].textContent !== text) this.v[k].textContent = text; }
    update(sim, d, game) {
      const ch = game && game.challenge, H = sim.H;
      this._set('round', ch ? `ROUND ${Math.min(ch.round, ch.rounds)}/${ch.rounds}` : 'FREE POUR');
      this._set('score', ch ? `${ch.total} pts` : `best ${game ? game.store.best : 0}`);
      const lv = U.clamp(d.level / H, 0, 1.1), fh = U.clamp(d.foamH / H, 0, 1.2 - lv);
      this.b.liq.style.height = `${(Math.min(lv, 1) * 100).toFixed(1)}%`;
      this.b.foam.style.bottom = `${(Math.min(lv, 1) * 100).toFixed(1)}%`;
      this.b.foam.style.height = `${(Math.min(fh, 1 - Math.min(lv, 1)) * 100).toFixed(1)}%`;
      this.b.liq.style.background = sim.bev.clear ? sim.bev.liquid : '#8a5a32';
      const target = game && game.target;
      this.m.target.style.display = target != null ? 'block' : 'none';
      if (target != null) this.m.target.style.bottom = `${(target / H * 100).toFixed(1)}%`;
      const fill = target != null ? `${((d.level - target) * 1000 >= 0 ? '+' : '')}${((d.level - target) * 1000).toFixed(0)} mm` : `${(d.volume * 1e6).toFixed(0)} ml`;
      this._set('fill', fill);
      const headMm = d.foamH * 1000;
      this._set('head', `${headMm.toFixed(0)} mm`);
      const hb = this.b.head;
      hb.style.width = `${(U.clamp(headMm / 30, 0, 1) * 100).toFixed(1)}%`;
      hb.style.background = headMm >= 3 && headMm <= 15 ? '#a7f070' : headMm > 15 ? '#ef7d57' : '#41a6f6';
      const t0 = sim.stats.firstPour;
      this._set('time', t0 >= 0 ? `${(sim.time - t0).toFixed(1)} s` : '—');
      const aim = sim.bottleHeld ? (sim.pour.aimHit !== 'cup' ? 'aim: it will miss!' : !sim.pour.lipOver ? 'lip outside the rim: drips miss' : 'aim: in the glass') : '';
      const warn = aim || (d.foamTop > H ? 'OVERFLOW!' : d.spilled > 1e-6 ? `spilled ${(d.spilled * 1e6).toFixed(0)} ml` : '');
      this._set('warn', warn);
    }
  }

  Fizz.Hud = Hud;
  Fizz.GameHud = GameHud;
})(window.Fizz = window.Fizz || {});
