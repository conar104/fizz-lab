/* Fizz Lab — line charts for the lab, fed from Simulation.history.
 *
 * Each chart has a real scale: "nice" ticks on the value axis, a tick every
 * 10 s on the time axis, labelled guide lines (the rim, saturation, the
 * freezing point…), an optional filled band between two series, and a legend
 * with each series' live value. Drawn at the canvas's own pixel size so lines
 * and text stay crisp.
 */
(function (Fizz) {
  'use strict';

  const INK = '#f4f4f4', DIM = '#94b0c2', GRID = '#2a3150', BG = '#1a1c2c';

  /** A step of 1, 2 or 5 × 10ⁿ giving about `n` ticks over `span`. */
  function niceStep(span, n = 4) {
    const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  class Chart {
    /**
     * opts = {
     *   series: [{ get(sample), color, label, fmt(v) }],
     *   band:   [i, j]  fill between series i (lower) and j (upper)
     *   guides: [{ value | value(), color, label }],
     *   window: seconds shown, yMin, yMax (number or fn(visible)), unit
     * }
     */
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      Object.assign(this, { window: 45, yMin: 0, guides: [], band: null, unit: '' }, opts);
      this.legend = opts.legend || null;              // an element to write the live values into
    }

    _fit() {
      // match the canvas's backing store to its displayed size (crisp at any zoom)
      const c = this.canvas, r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(200, Math.round(r.width * dpr)), h = Math.max(90, Math.round(r.height * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      return { w, h, dpr };
    }

    draw(history) {
      const { ctx } = this;
      const { w, h, dpr } = this._fit();
      const fs = Math.round(13 * dpr);
      const padL = Math.round(38 * dpr), padR = Math.round(8 * dpr), padT = Math.round(8 * dpr), padB = Math.round(18 * dpr);
      const pw = w - padL - padR, ph = h - padT - padB;
      ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
      ctx.font = `${fs}px VT323, ui-monospace, monospace`;
      ctx.textBaseline = 'middle';

      const tEnd = history.length ? history[history.length - 1].t : 0;
      const tStart = Math.max(0, tEnd - this.window);
      const vis = history.filter(s => s.t >= tStart);
      let yMax = typeof this.yMax === 'function' ? this.yMax(vis) : this.yMax;
      if (yMax == null) {
        yMax = 1e-9;
        for (const s of vis) for (const sr of this.series) { const v = sr.get(s); if (isFinite(v)) yMax = Math.max(yMax, v); }
        yMax *= 1.12;
      }
      const yMin = typeof this.yMin === 'function' ? this.yMin(vis) : this.yMin;
      const span = Math.max(1e-9, yMax - yMin);
      const X = (t) => padL + (t - tStart) / Math.max(this.window, 1) * pw;
      const Y = (v) => padT + ph - (v - yMin) / span * ph;

      // value grid + ticks
      const step = niceStep(span);
      ctx.textAlign = 'right';
      for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.fillStyle = GRID; ctx.fillRect(padL, y, pw, 1);
        ctx.fillStyle = DIM; ctx.fillText(+v.toFixed(6) + '', padL - 4 * dpr, y);
      }
      if (this.unit) { ctx.textAlign = 'left'; ctx.fillStyle = DIM; ctx.fillText(this.unit, 2 * dpr, padT + 2 * dpr); }
      // time ticks every 10 s
      ctx.textAlign = 'center';
      for (let t = Math.ceil(tStart / 10) * 10; t <= tStart + this.window; t += 10) {
        const x = Math.round(X(t)) + 0.5;
        ctx.fillStyle = GRID; ctx.fillRect(x, padT, 1, ph);
        ctx.fillStyle = DIM; ctx.fillText(`${t}s`, x, h - padB / 2);
      }

      // labelled guides
      for (const gd of this.guides) {
        const v = typeof gd.value === 'function' ? gd.value() : gd.value;
        if (v == null || !isFinite(v) || v < yMin || v > yMax) continue;
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = gd.color; ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
        ctx.setLineDash([]);
        if (gd.label) { ctx.textAlign = 'right'; ctx.fillStyle = gd.color; ctx.fillText(gd.label, padL + pw - 2 * dpr, y - 7 * dpr); }
      }

      if (vis.length > 1) {
        // the band between two series (e.g. the head between the liquid and the foam top)
        if (this.band) {
          const [lo, hi] = this.band.map(i => this.series[i]);
          ctx.fillStyle = this.bandColor || 'rgba(247, 236, 210, 0.18)';
          ctx.beginPath();
          vis.forEach((s, k) => { const x = X(s.t), y = Y(hi.get(s)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
          for (let k = vis.length - 1; k >= 0; k--) ctx.lineTo(X(vis[k].t), Y(lo.get(vis[k])));
          ctx.closePath(); ctx.fill();
        }
        ctx.lineWidth = Math.max(1.5, 1.5 * dpr); ctx.lineJoin = 'round';
        for (const sr of this.series) {
          ctx.strokeStyle = sr.color;
          ctx.beginPath();
          let started = false;
          for (const s of vis) {
            const v = sr.get(s);
            if (!isFinite(v)) { started = false; continue; }
            const x = X(s.t), y = Math.max(padT, Math.min(padT + ph, Y(v)));
            started ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            started = true;
          }
          ctx.stroke();
          // the latest value, emphasised
          const last = vis[vis.length - 1], v = sr.get(last);
          if (isFinite(v)) { ctx.fillStyle = sr.color; ctx.beginPath(); ctx.arc(X(last.t), Y(v), 2.5 * dpr, 0, 2 * Math.PI); ctx.fill(); }
        }
      }
      // frame
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.strokeRect(padL + 0.5, padT + 0.5, pw - 1, ph - 1);

      // live legend
      if (this.legend && vis.length) {
        const last = vis[vis.length - 1];
        const html = this.series.map(sr => {
          const v = sr.get(last);
          return `<span><i style="background:${sr.color}"></i>${sr.label} <b>${isFinite(v) ? (sr.fmt ? sr.fmt(v) : v.toFixed(1)) : '—'}</b></span>`;
        }).join('');
        if (this.legend._html !== html) { this.legend.innerHTML = html; this.legend._html = html; }
      }
    }
  }

  Fizz.Chart = Chart;
})(window.Fizz = window.Fizz || {});
