/* Fizz Lab — 8-bit renderer.
 *
 * Everything is drawn pixel-by-pixel into a 320×300 frame buffer which CSS
 * scales up with `image-rendering: pixelated`. The scene is a cut-away
 * cross-section of the cup, so you see inside regardless of the material.
 * The camera zooms so 1 pixel ≈ 0.9–2.4 mm, and the cup can tilt (see _frame).
 */
(function (Fizz) {
  'use strict';
  const { U } = Fizz;

  const W = 320, H = 300;
  // Camera zoom in pixels per metre. Recomputed each frame so the cup plus the
  // pour height fill the scene (1 px ≈ 0.9 mm for a small glass, ≈ 2 mm when
  // pouring from 30 cm).
  let PX = 480;
  const PX_MIN = 250, PX_MAX = 1100;
  const TABLE_Y = 270;          // first row of the table top
  const CUP_X = 204;            // cup centre column

  // --- palette (Sweetie-16 plus a few cola browns) ---
  function hex(h) {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function pack(c) { return (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]; }
  const P = {};
  const PAL = {
    night: '#1a1c2c', plum: '#5d275d', red: '#b13e53', orange: '#ef7d57', yellow: '#ffcd75',
    lime: '#a7f070', green: '#38b764', teal: '#257179', navy: '#29366f', blue: '#3b5dc9',
    sky: '#41a6f6', cyan: '#73eff7', white: '#f4f4f4', silver: '#94b0c2', slate: '#566c86', ink: '#333c57',
    wood: '#7a4a2a', woodDark: '#5d3420', woodHi: '#a0663a',
    foamDry: '#f7ecd2', foamMid: '#e3c99b', foamWet: '#b98a52', foamEdge: '#c9a675',
    bubble: '#d9b27c', bubbleBig: '#f4f4f4', bubbleDim: '#8a5a32',
    ice: '#d6f1ff', iceSub: '#8fb8d0', iceEdge: '#f4f4f4', iceShade: '#73c2e0',
    puddle: '#4a230f',
  };
  for (const k in PAL) P[k] = pack(hex(PAL[k]));
  const RGB = {};
  for (const k in PAL) RGB[k] = hex(PAL[k]);

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

  function unpackRGB(p) { return [p & 255, (p >> 8) & 255, (p >> 16) & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t | 0, a[1] + (b[1] - a[1]) * t | 0, a[2] + (b[2] - a[2]) * t | 0]; }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = W; canvas.height = H;
      this.ctx = canvas.getContext('2d');
      this.img = this.ctx.createImageData(W, H);
      this.buf = new Uint32Array(this.img.data.buffer);
      this.bg = new Uint32Array(W * H);
      this._paintBackground();
      this.fx = [];               // cosmetic droplets
      this.colorCache = {};
      // VIEW: '3d' looks down on the table from `pitch` above (orthographic);
      // 'section' is the flat cut-away cross-section (pitch 0).
      this.view = { mode: '3d', pitch: 24 * Math.PI / 180 };
    }

    setView(mode) { this.view.mode = mode; }
    /** Show or hide the decorative window behind the HUD. */
    setWindow(on) { if (this.showWindow !== on) { this.showWindow = on; this._paintBackground(); } }

    /** Canvas pixel → world point (metres, the cup's tilt frame) in the plane of the bottle and glass. */
    screenToWorld(X, Y) {
      const F = this._lastF;
      if (!F) return [0, 0];
      return [(X - F.Ox) / PX, (F.Oy - Y) / (PX * F.cp)];
    }
    /**
     * Is the canvas pixel on the bottle? Returns 'neck' (the top third: grab it
     * there to move it) or 'body' (grab it there to tip it about the lip), or null.
     */
    hitBottle(X, Y) {
      const b = this._bottleGeom;
      if (!b) return null;
      const rx = X + 0.5 - b.tipX, ry = (Y + 0.5 - b.tipY) / b.cp;
      const u = rx * b.dx + ry * b.dy, v = -rx * b.dy + ry * b.dx;
      if (u < -4 || u > b.lenPx + 2 || Math.abs(v) > b.halfPx + 4) return null;
      // the cap (while it is on): its own few pixels, a little generous to make it easy to hit
      if (b.capPx > 0 && u < b.capPx + 2 && Math.abs(v) < b.neckPx + 4) return 'cap';
      return u < 0.35 * b.lenPx ? 'neck' : 'body';
    }

    // ---------------------------------------------------------------------
    // primitives
    // ---------------------------------------------------------------------
    px(x, y, c) { if (x >= 0 && y >= 0 && x < W && y < H) this.buf[y * W + x] = c; }
    rect(x, y, w, h, c) {
      const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
      const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
      for (let j = y0; j < y1; j++) this.buf.fill(c, j * W + x0, j * W + x1);
    }
    blend(x, y, rgb, a) {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x, d = this.buf[i];
      const r = d & 255, g = (d >> 8) & 255, b = (d >> 16) & 255;
      this.buf[i] = pack([r + (rgb[0] - r) * a | 0, g + (rgb[1] - g) * a | 0, b + (rgb[2] - b) * a | 0]);
    }
    /** Per-drink colours, derived once from the beverage's liquid and foam tints. */
    bevPalette(bev) {
      const key = 'bev:' + bev.id;
      if (this.colorCache[key]) return this.colorCache[key];
      const base = hex(bev.liquid), hi = hex(bev.liquidHi), tint = hex(bev.foamTint);
      const dark = !bev.clear;
      const pal = {
        base, hi, deep: mix(base, [0, 0, 0], 0.35),
        foamWet: mix(tint, base, dark ? 0.35 : 0.2),
        foamMid: tint,
        foamDry: mix(tint, RGB.white, 0.75),
        foamEdge: mix(tint, base, dark ? 0.2 : 0.12),
        bubble: dark ? P.bubble : P.white,
        bubbleDim: dark ? P.bubbleDim : pack(mix(hi, RGB.silver, 0.5)),
        puddle: dark ? P.puddle : pack(mix(base, RGB.wood, 0.5)),
        // meltwater: nearly clear, with a hint of the drink and of the cold
        water: mix(mix(hi, [214, 236, 244], 0.72), base, dark ? 0.12 : 0.05),
      };
      return (this.colorCache[key] = pal);
    }

    colorOf(hexStr) {
      return this.colorCache[hexStr] || (this.colorCache[hexStr] = { p: pack(hex(hexStr)), rgb: hex(hexStr) });
    }

    _paintBackground() {
      const save = this.buf;
      this.buf = this.bg;
      // wall: dithered vertical gradient + tile seams
      const top = RGB.night, bot = RGB.navy;
      for (let y = 0; y < TABLE_Y; y++) {
        const t = y / TABLE_Y;
        for (let x = 0; x < W; x++) {
          let c = bayer(x, y) < t * 0.9 ? bot : top;
          if (y % 24 === 0 || (x + (((y / 24) | 0) % 2) * 12) % 24 === 0) c = mix(c, RGB.ink, 0.5);
          this.buf[y * W + x] = pack(c);
        }
      }
      if (this.showWindow !== false) this._paintWindow(16, 26, 80, 86);   // hidden while a HUD covers that corner
      // table
      for (let y = TABLE_Y; y < H; y++) for (let x = 0; x < W; x++) {
        let c = P.wood;
        if (y === TABLE_Y) c = P.woodHi;
        else if (U.hash2(x >> 3, y) < 0.18 || (y - TABLE_Y) % 9 === 4) c = P.woodDark;
        this.buf[y * W + x] = c;
      }
      this.buf = save;
    }

    /** A diner window at night: sky, moon, stars, skyline, wooden frame and sill. Pure decoration. */
    _paintWindow(x0, y0, w, h) {
      const x1 = x0 + w, y1 = y0 + h;
      const skyTop = [16, 20, 48], skyBot = RGB.plum;
      const moon = { x: x0 + 20, y: y0 + 18, r: 7 };
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const t = (y - y0) / h;
        let c = bayer(x, y) < t * t ? skyBot : skyTop;
        if (U.hash2(x * 7, y * 3) < 0.012 && t < 0.6) c = RGB.white;                     // stars
        const dm = Math.hypot(x - moon.x, y - moon.y), dc = Math.hypot(x - moon.x - 3, y - moon.y - 2);
        if (dm < moon.r && dc > moon.r - 1) c = RGB.yellow;                                // crescent moon
        // skyline: blocky buildings with lit windows
        const bx = ((x - x0) / 9) | 0;
        const bh = 14 + ((U.hash2(bx, 99) * 26) | 0);
        if (y > y1 - bh) {
          c = [20, 18, 34];
          if ((x - x0) % 9 > 1 && (x - x0) % 9 < 7 && (y1 - y) % 5 === 2 && (x & 1) === 0 && U.hash2(x, y) < 0.45) c = RGB.yellow;
        }
        this.buf[y * W + x] = pack(c);
      }
      // frame, mullions, sill
      const frame = P.woodDark, hi = P.woodHi;
      for (let x = x0 - 3; x < x1 + 3; x++) {
        for (let k = 0; k < 3; k++) { this.px(x, y0 - 3 + k, frame); this.px(x, y1 + k, frame); }
        this.px(x, y1 + 3, hi); this.px(x, y1 + 4, frame);
      }
      for (let x = x0 - 6; x < x1 + 6; x++) { this.px(x, y1 + 5, hi); this.px(x, y1 + 6, frame); }   // sill
      for (let y = y0 - 3; y < y1 + 3; y++) for (let k = 0; k < 3; k++) {
        this.px(x0 - 3 + k, y, frame); this.px(x1 + k, y, frame);
      }
      const mx = x0 + (w >> 1), my = y0 + (h >> 1);
      for (let y = y0; y < y1; y++) { this.px(mx, y, frame); this.px(mx + 1, y, frame); }
      for (let x = x0; x < x1; x++) { this.px(x, my, frame); this.px(x, my + 1, frame); }
    }

    // ---------------------------------------------------------------------
    // The cup frame
    //
    // The cup is drawn in its own local pixel frame (u right, v up, origin at
    // the centre of the inner floor), rotated by the tilt about its low bottom
    // corner, which stays on the table. Every interior pixel is classified by
    // its *world* height, converted to the physics' equivalent upright level
    // z with the tilt mapping — so liquid and foam surfaces stay horizontal at
    // any angle, and the upright case is just θ = 0.
    // ---------------------------------------------------------------------
    _frame(sim) {
      // the cup is drawn at its real angle (cupTilt); the liquid lives in its own
      // frame (g.tilt), rotated from the world by the slosh angle δ
      const g = sim.geom, tilt = g.cupTilt || g.tilt, lt = g.tilt;
      const dl = g.delta || 0, cd = Math.cos(dl), sd = Math.sin(dl);
      const pitch = this.view.mode === '3d' ? this.view.pitch : 0;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const id = sim.params.material;
      const wallPx = Math.max(2, Math.round(sim.mat.wall * PX));
      const baseRows = id === 'ceramic' ? 4 : id === 'styrofoam' ? 3 : 2;
      const hw = sim.D / 2 * PX, Hp = sim.H * PX, hwO = hw + wallPx;
      const c = tilt.cos, s = tilt.sin;
      // pivot: the low outer bottom corner stays planted on the table (the physics' own pivot)
      const pl = sim.pivotLocal ? sim.pivotLocal() : [-hwO / PX, -baseRows / PX];
      const pu = pl[0] * PX, pv = pl[1] * PX;
      const Ox = CUP_X - (pu * c - pv * s), Oy = TABLE_Y + (pu * s + pv * c) * cp;
      // toScreen / toLocal map the cup's central plane (depth 0); heights are
      // foreshortened by cos(pitch) when the camera looks down on the scene.
      const F = {
        sim, g, tilt, lt, cd, sd, sloshing: Math.abs(dl) > 1e-4, id, wallPx, baseRows, hw, Hp, hwO, c, s, Ox, Oy, cp, sp, pitch,
        handle: id === 'ceramic',
        toScreen: (u, v) => [Ox + u * c - v * s, Oy - (u * s + v * c) * cp],
        toLocal: (X, Y) => { const dx = X - Ox, dy = (Oy - Y) / cp; return [dx * c + dy * s, -dx * s + dy * c]; },
        /** Full 3-D projection of a cup-local point (pixels): u across, v up the axis, w toward the viewer. */
        proj: (u, v, w) => [Ox + u * c - v * s, Oy - ((u * s + v * c) * cp - w * sp)],
      };
      // bounding box of the rotated outer cup (+ handle and spoon headroom)
      const ext = F.handle ? hwO + 12 : hwO;
      const pts = [[-hwO, -baseRows], [ext, -baseRows], [ext, Hp + 1], [-hwO, Hp + 1]].map(p => F.toScreen(p[0], p[1]));
      F.x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0]))) - 1);
      F.x1 = Math.min(W - 1, Math.ceil(Math.max(...pts.map(p => p[0]))) + 1);
      F.y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1]))) - 1);
      F.y1 = Math.min(TABLE_Y - 1, Math.ceil(Math.max(...pts.map(p => p[1]))));
      // per screen row: equivalent level z and the interior chord in screen x
      const n = F.y1 - F.y0 + 1;
      F.rowZ = new Float64Array(n);
      F.rowXa = new Float64Array(n); F.rowXb = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const h = (Oy - (F.y0 + k + 0.5)) / (PX * cp);        // world height of the row centre [m]
        F.rowZ[k] = lt.worldToLevel(h * cd);                     // (on the axis; per pixel below when sloshing)
        const ch = tilt.chord(h);
        F.rowXa[k] = ch ? Ox + ch[0] * PX : NaN;
        F.rowXb[k] = ch ? Ox + ch[1] * PX : NaN;
      }
      /** Screen row whose equivalent level is z (rows are monotonic: lower row → smaller z). */
      F.rowOf = (z) => {
        let lo = 0, hi = n - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (F.rowZ[m] > z) lo = m + 1; else hi = m; }
        return F.y0 + lo;
      };
      // equivalent level z → height in the liquid's frame, tabulated (bisection is slow)
      const zMax = Math.max(g.foamTop, g.level, sim.H) + 0.03, NZ = 160;
      const hTab = new Float64Array(NZ + 1);
      for (let i = 0; i <= NZ; i++) hTab[i] = lt.levelToWorld(zMax * i / NZ);
      F.hOf = (z) => {
        const f = U.clamp(z / zMax, 0, 1) * NZ, i = Math.min(NZ - 1, f | 0);
        return hTab[i] + (hTab[i + 1] - hTab[i]) * (f - i);
      };
      /** Liquid-frame point (x, h) → world. */
      F.liqToWorld = (x, h) => [x * cd - h * sd, x * sd + h * cd];
      /** Map a physics point (x across the cup, equivalent level z) to world [m], in the liquid's frame. */
      F.mapWorld = (x, z) => {
        const h = F.hOf(z), ch = lt.chord(h);
        const xe = ch ? ch[0] + ((x + sim.D / 2) / sim.D) * (ch[1] - ch[0]) : x;
        return F.liqToWorld(xe, h);
      };
      F.map = (x, z) => {
        const [wx, wy] = F.mapWorld(x, z);
        return [Math.round(Ox + wx * PX), Math.round(Oy - wy * cp * PX)];
      };
      /** Equivalent level at a screen pixel (row value on the axis unless the surface is sloshing). */
      F.zAt = (Y, X) => {
        if (Y < F.y0) return Infinity;
        if (Y > F.y1) return -Infinity;
        if (!F.sloshing || X == null) return F.rowZ[Y - F.y0];
        const x = (X + 0.5 - Ox) / PX, y = (Oy - (Y + 0.5)) / (PX * cp);
        return lt.worldToLevel(y * cd - x * sd);
      };
      return F;
    }

    // ---------------------------------------------------------------------
    // frame
    // ---------------------------------------------------------------------
    render(sim, overlay, realDt) {
      this.buf.set(this.bg);
      // Frame the cup AND the full-size bottle, which can point straight up from
      // its lip (upside-down) or lie out sideways (horizontal).
      const L = sim.bottle.L;
      const fitH = (TABLE_Y - 12) / (sim.H + sim.params.pourHeight / 100 + L);
      const park = Fizz.Simulation.BOTTLE_PARK || 0;
      const fitW = (CUP_X - 10) / (Math.max(L, 0.6 * L + park) + 0.5 * sim.D + 0.04);
      const fit = U.clamp(Math.min(fitH, fitW), PX_MIN, PX_MAX);
      this.zoom = this.zoom ? this.zoom + (fit - this.zoom) * Math.min(1, (realDt || 0.016) * 4) : fit;
      PX = this.zoom;
      const F = this._frame(sim);
      this._lastF = F;
      this.cupBox = { x0: F.x0, x1: F.x1, y0: F.y0, y1: F.y1 };
      const t = sim.time;

      if (this.view.mode === '3d') {
        this._draw3d(sim, F, t, overlay);                        // render3d.js
      } else {
        this._drawPuddle(sim, F);
        this._drawPiles(sim, F);
        this._drawContents(sim, F, t);
        this._drawCrown(sim, F);
        this._drawBubbles(sim, F);
        this._drawIce(sim, F);
        this._drawAdditives(sim, F, t);
        this._drawWalls(sim, F);
        this._drawRuns(sim, F);
        this._drawRuler(sim, F);
      }
      if (this.view.mode !== '3d') this._drawStream(sim, F, t);   // (3-D draws it behind the glass)
      this._drawBottle(sim, F);
      this._drawCapFly(sim, F);
      this._drawDrops(sim, F);
      this._drawAimMarker(sim, F, t);
      this._drawFx(sim, F, realDt);
      this._drawTopView(sim, F);                                  // render3d.js
      this.ctx.putImageData(this.img, 0, 0);
    }

    /** Table frame (origin: the cup's pivot corner on the table top) → screen. */
    _table(F, x, y, z = 0) { return [CUP_X + x * PX, TABLE_Y - (y * F.cp - z * F.sp) * PX]; }

    /** Colour of a puddle or drop: the drink, or (s → 0) clear meltwater. */
    _wetColor(sim, s, bev) {
      const pal = this.bevPalette(bev || sim.bev);
      return mix(pal.water, unpackRGB(pal.puddle), U.clamp(s, 0, 1));
    }

    /**
     * Puddles from the physics (table.js), edge-on: a thin lens as thick as the
     * puddle (~3 mm when it has spread out) with any foam still sitting on it.
     */
    _drawPuddle(sim, F) {
      const pal = this.bevPalette(sim.bev);
      for (const q of sim.table.puddles) {
        const [cx] = this._table(F, q.x, 0);
        const half = Math.round(q.r * PX);
        const h = q.V / (Math.PI * q.r * q.r);
        const thick = Math.max(1, Math.round(h * PX));
        const foam = 0;
        const c = pack(this._wetColor(sim, q.s, q.bev)), hi = pack(mix(this._wetColor(sim, q.s, q.bev), RGB.white, 0.35));
        for (let x = Math.round(cx) - half; x <= cx + half; x++) {
          const e = 1 - ((x - cx) / Math.max(half, 1)) ** 2;
          if (e <= 0) continue;
          const th = Math.max(1, Math.round(thick * Math.sqrt(e)));
          for (let k = 1; k <= th; k++) this.px(x, TABLE_Y - k + 1, k === th ? hi : c);
          // fizz: bubbles popping at the surface, twinkling
          const fz = Math.min(0.05, (q.fizz || 0) / 1e4 * 0.004 + (q.entrap || 0) * 2e-6);
          if (fz > 0.003 && U.hash2(x * 7 + Math.floor(sim.time * 10), 3) < fz) this.px(x, TABLE_Y - th, pack(mix(this._wetColor(sim, q.s, q.bev), RGB.white, 0.7)));
          const fh = Math.round(foam * Math.sqrt(e));
          for (let k = 1; k <= fh; k++) this.px(x, TABLE_Y - th - k + 1, U.hash2(x, k) < 0.2 ? pack(pal.foamEdge) : pack(pal.foamDry));
        }
      }
    }

    /** Foam heaps on the table, edge-on: the plastic profile h = h₀√(1 − |x − x₀|/r₀). */
    _drawPiles(sim, F) {
      const pal = this.bevPalette(sim.bev);
      for (const p of sim.table.piles) {
        if (!(p.r > 0)) continue;
        const [cx] = this._table(F, p.x, 0);
        const half = Math.round(p.r * PX);
        for (let X = Math.round(cx) - half; X <= cx + half; X++) {
          const rho = Math.abs(X + 0.5 - cx) / PX;
          if (rho >= p.r) continue;
          const hh = Math.round(p.h * Math.sqrt(1 - rho / p.r) * PX);
          for (let k = 0; k <= hh; k++) this.px(X, TABLE_Y - 1 - k, k === hh || U.hash2(X, k) < 0.18 ? pack(pal.foamEdge) : pack(pal.foamDry));
        }
      }
    }

    /**
     * Where the stream will land while you hold the bottle: a green ring in the
     * glass, red if it would hit the rim or the table.
     */
    _drawAimMarker(sim, F, t) {
      if (!sim.bottleHeld || !sim.pour.land) return;
      const ok = sim.pour.aimHit === 'cup';
      const [X, Y] = this._world(F, sim.pour.land.x, sim.pour.land.y);
      const col = ok ? RGB.lime : RGB.red, r = 3 + (Math.floor(t * 4) % 2);
      for (let a = 0; a < 16; a++) {
        const th = a / 16 * 2 * Math.PI;
        this.px(Math.round(X + r * Math.cos(th)), Math.round(Y + r * Math.sin(th) * Math.max(F.sp, 0.5)), pack(col));
      }
      this.px(Math.round(X), Math.round(Y), pack(col));
      // the lip is not over the glass: drips will fall here (a red tick under the lip, on the table)
      if (!sim.pour.lipOver) {
        const [DX, DY] = this._table(F, sim.worldToTable(sim.pour.mouth.x, 0)[0], 0);
        for (let d = -2; d <= 2; d++) { this.px(Math.round(DX) + d, Math.round(DY) - 1, pack(RGB.red)); this.px(Math.round(DX), Math.round(DY) - 1 + d, pack(RGB.red)); }
      }
    }

    /** Drops and foam clumps in flight (thrown drink, erupting foam). */
    _drawDrops(sim, F) {
      const pal = this.bevPalette(sim.bev);
      for (const d of sim.table.drops) {
        const [X, Y] = this._table(F, d.x, d.y, d.z);
        const x = Math.round(X), y = Math.round(Y);
        if (d.spray) {                                          // a burst droplet: a faint sparkle
          this.blend(x, y, mix(this._wetColor(sim, d.s), RGB.white, 0.6), 0.7);
          continue;
        }
        if (d.kind === 'foam') {
          const n = Math.max(1, Math.min(3, Math.round(Math.cbrt(d.V + d.vg) * PX * 0.6)));
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.px(x + i, y + j, (i + j) % 3 ? pack(pal.foamDry) : pack(pal.foamEdge));
        } else {
          // a flying blob of drink: as thick as the drop it holds, smeared along its flight
          // over ~1/60 s (the motion blur a frame shows), highlighted on its leading edge
          const c = pack(this._wetColor(sim, d.s)), hi = pack(mix(this._wetColor(sim, d.s), RGB.white, 0.45));
          const dia = Math.cbrt(6 * d.V / Math.PI) * PX, th = Math.max(1, Math.min(3, Math.round(dia)));
          const sx = d.vx * PX / 60, sy = -d.vy * F.cp * PX / 60, len = Math.min(8, Math.hypot(sx, sy));
          const n = Math.max(1, Math.ceil(len));
          for (let k = 0; k <= n; k++) {
            const f = k / n, px = Math.round(X - sx * f * (len / Math.max(Math.hypot(sx, sy), 1e-9))), py = Math.round(Y - sy * f * (len / Math.max(Math.hypot(sx, sy), 1e-9)));
            for (let j = 0; j < th; j++) for (let i = 0; i < th; i++) this.px(px + i - (th >> 1), py + j - (th >> 1), k === 0 ? hi : c);
          }
        }
      }
    }

    /** One pass over the cup interior: liquid, foam, or (glass) a faint back wall. */
    _drawContents(sim, F, t) {
      const g = F.g, level = g.level, foamTop = g.foamTop;
      const waterZ = sim.water && sim.water.V > 0 ? g.waterZ : Infinity;
      const pal = this.bevPalette(sim.bev);
      const { base, hi, deep } = pal;
      const pBase = pack(base), pHi = pack(hi), pDeep = pack(deep), pWater = pack(pal.water), pWaterHi = pack(mix(pal.water, RGB.white, 0.4));
      const opacity = sim.bev.clear;                 // 0 = opaque; else tint opacity of a see-through drink
      const glass = F.id === 'glass';
      const geo = sim.foam.geometry;
      const tick = Math.floor(t * 3);
      const men = { h: Fizz.Capillary.wallMeniscus(sim.fluid, sim.mat.contactAngle), lc: Fizz.Capillary.capillaryLength(sim.fluid) };
      // foam layer holding level z (binary search; the stack is ordered upward)
      const layerAt = (z) => {
        let lo = 0, hi2 = geo.length - 1;
        while (lo < hi2) { const m = (lo + hi2) >> 1; if (geo[m].z1 < z) lo = m + 1; else hi2 = m; }
        return lo;
      };
      const foamStyle = (k, top) => {
        const G = geo[k];
        const wet = U.clamp(G.phi / 0.3, 0, 1);
        const col = wet > 0.5 ? mix(pal.foamMid, pal.foamWet, (wet - 0.5) * 2) : mix(pal.foamDry, pal.foamMid, wet * 2);
        // bubble cells, drawn 9× larger than life so coarsening is visible
        return { base: pack(col), edge: pack(mix(col, pal.foamEdge, 0.8)),
                 cell: U.clamp(Math.round(G.R * PX * 9), 2, 10), off: (k * 7) % 10, top };
      };
      for (let Y = F.y1; Y >= F.y0; Y--) {
        const xa = F.rowXa[Y - F.y0], xb = F.rowXb[Y - F.y0];
        if (!(xb > xa)) continue;
        for (let X = Math.ceil(xa); X < xb; X++) {
        const z = F.zAt(Y, X), zUp = F.zAt(Y - 1, X);
        const inLiquid = z < level, inFoam = !inLiquid && z < foamTop && geo.length > 0;
        const fo = inFoam ? foamStyle(layerAt(z), zUp >= foamTop) : null;
        const surfaceRow = inLiquid && zUp >= level;
        const inWater = inLiquid && z >= waterZ;
        const depthT = inLiquid ? 1 - z / Math.max(level, 1e-9) : 0;
        const nearSurface = Math.abs(z - level) < Math.abs(men.h) + 1.5 / PX && level > 1e-3;
          let wet = inLiquid;
          if (nearSurface) {
            // Laplace–Young meniscus: the surface rises (θ<90°) or dips (θ>90°) by h·e^(−d/l_c) at distance d from the wall
            const [uu] = F.toLocal(X + 0.5, Y + 0.5);
            const d = Math.max(0, F.hw - Math.abs(uu)) / PX;
            wet = z < level + men.h * Math.exp(-d / men.lc);
          }
          if (wet && !inLiquid && !fo) {
            this.buf[Y * W + X] = pHi;                              // the thin film climbing the glass
            continue;
          }
          if (!wet && inLiquid) { if (glass) this.blend(X, Y, RGB.silver, 0.06); continue; }
          if (inWater) {
            // meltwater floating on the drink: a clear, cold band at the top
            this.buf[Y * W + X] = surfaceRow ? pWaterHi : pWater;
            continue;
          }
          if (inLiquid) {
            if (opacity) { this.blend(X, Y, surfaceRow ? hi : base, surfaceRow ? Math.min(1, opacity + 0.35) : opacity); continue; }
            let c = bayer(X, Y) < depthT * 0.6 ? pDeep : pBase;
            if (surfaceRow || X - xa < 1.5) c = pHi;
            this.buf[Y * W + X] = c;
          } else if (fo) {
            if (fo.top && U.hash2(X, tick) < 0.35) continue;      // ragged, popping top edge
            const cx = X + fo.off, cell = fo.cell;
            const edge = (cx % cell === 0) || ((Y + (((cx / cell) | 0) & 1) * (cell >> 1)) % cell === 0);
            this.buf[Y * W + X] = edge ? fo.edge : fo.base;
          } else if (glass) {
            this.blend(X, Y, RGB.silver, 0.06);
          }
        }
      }
    }

    _drawBubbles(sim, F) {
      const b = sim.bubbles;
      const pal = this.bevPalette(sim.bev);
      const cDim = pal.bubbleDim, cMid = pal.bubble;
      for (let i = 0; i < b.count; i++) {
        const [x, y] = F.map(b.x[i], b.y[i]);
        const R = b.R[i];
        if (R > 1.2e-3) {
          this.px(x, y, P.bubbleBig); this.px(x + 1, y, P.bubbleBig);
          this.px(x, y - 1, P.bubbleBig); this.px(x + 1, y - 1, cMid);
        } else {
          this.px(x, y, R > 0.25e-3 ? cMid : cDim);
        }
      }
    }

    /**
     * Every ice cube where the physics put it. Cubes in the glass live in the
     * glass's own frame (they tilt with it); back lanes are drawn first and a
     * little deeper in colour, so the front row reads as nearest. Cubes that
     * tumbled out lie on the table in the world frame.
     */
    _drawIce(sim, F) {
      const I = sim.ice, g = F.g;
      const cubes = I.cubes.slice().sort((p, q) => (p.where === 'cup' ? p.lane : 99) - (q.where === 'cup' ? q.lane : 99));
      const lanes = Math.max(1, I.laneDefs.length);
      for (const c of cubes) {
        const half = c.a * PX / 2;
        const depth = c.where === 'cup' ? 1 - c.lane / Math.max(1, lanes - 1) : 0;     // 1 = back, 0 = front
        const shade = (col) => (depth > 0 && lanes > 1 ? pack(mix(hex(col), RGB.slate, 0.25 * depth)) : this.colorOf(col).p);
        const cols = { face: shade(PAL.ice), sub: shade(PAL.iceSub), edge: shade(PAL.iceEdge), shadow: shade(PAL.iceShade) };
        let cx, cy, toLocal;
        if (c.where === 'cup') {
          [cx, cy] = F.toScreen(c.u * PX, c.v * PX);
          toLocal = (X, Y) => { const [u, v] = F.toLocal(X, Y); return [u - c.u * PX, v - c.v * PX]; };
        } else {
          [cx, cy] = this._table(F, c.x, c.y);
          toLocal = (X, Y) => [X - cx, cy - Y];
        }
        const r = Math.ceil(half * 1.5) + 1;
        for (let Y = Math.floor(cy - r); Y <= cy + r; Y++) {
          for (let X = Math.floor(cx - r); X <= cx + r; X++) {
            const under = c.where === 'cup' && F.zAt(Y, X) < g.level;
            const [lu, lv] = toLocal(X + 0.5, Y + 0.5);
            if (Math.abs(lu) > half || Math.abs(lv) > half) continue;
            let col = under ? cols.sub : cols.face;
            if (lv > half - 1 || lu < -half + 1) col = cols.edge;                 // lit top / left edges
            else if (lv < -half + 1 || lu > half - 1) col = cols.shadow;          // shaded bottom / right
            else if (lu < -half + 3 && lu > -half + 2 && lv > half - 5) col = P.white;   // glint
            this.px(X, Y, col);
          }
        }
      }
    }

    _drawAdditives(sim, F, t) {
      for (const m of sim.additives.mentos) {
        const [x, y] = m.where && m.where !== 'cup' ? this._table(F, m.tx, m.ty).map(Math.round)
          : m.y > sim.H ? F.toScreen(m.x * PX, m.y * PX).map(Math.round) : F.toScreen(m.x * PX, m.y * PX).map(Math.round);
        this.rect(x - 4, y - 1, 9, 3, P.white);
        this.px(x - 4, y - 1, P.silver); this.px(x + 4, y + 1, P.silver);
      }
      for (const s of sim.additives.salt) {
        const [x, y] = s.where && s.where !== 'cup' ? this._table(F, s.tx, s.ty).map(Math.round) : F.toScreen(s.x * PX, s.y * PX).map(Math.round);
        this.px(x, y, P.white);
      }
      if (sim.additives.stirring) {
        // the spoon hangs straight down from above the cup to just off the floor
        const [x, yBot] = F.map(sim.spoonX(), 0.004);
        const yTop = Math.round(F.Oy - (F.tilt.levelToWorld(F.tilt.rimLevel) * PX)) - 30;
        for (let y = yTop; y < yBot; y++) this.px(x, y, y < yTop + 8 ? P.slate : P.silver);
        this.rect(x - 1, yBot - 2, 3, 3, P.silver);
      }
    }

    /** Wall styles by material, evaluated in local (u, v) so patterns tilt with the cup. */
    _wallStyle(id) {
      return {
        glass:     { c: RGB.cyan, a: 0.45, hi: RGB.white },
        plastic:   { c: RGB.red, a: 1, hi: RGB.white },
        paper:     { c: RGB.white, a: 1, hi: RGB.silver },
        styrofoam: { c: RGB.white, a: 1, hi: [200, 200, 205] },
        ceramic:   { c: RGB.orange, a: 1, hi: RGB.yellow },
        steel:     { c: RGB.silver, a: 1, hi: RGB.white },
      }[id];
    }

    _drawWalls(sim, F) {
      const { id, hw, hwO, Hp, baseRows } = F;
      const style = this._wallStyle(id);
      const handleTop = Hp - 8, handleBot = Math.max(8, Hp - 42);
      for (let Y = F.y0; Y <= F.y1; Y++) {
        for (let X = F.x0; X <= F.x1; X++) {
          const [u, v] = F.toLocal(X + 0.5, Y + 0.5);
          if (v < -baseRows || v > Hp + 0.5) continue;
          const au = Math.abs(u);
          let col = null, a = style.a;
          if (au <= hwO && (au >= hw || v < 0)) {
            // wall or floor
            const ui = Math.floor(u), vi = Math.floor(v);
            col = style.c;
            if (id === 'paper' && (((vi >> 2) + (ui >> 1)) % 6 + 6) % 6 === 0) col = RGB.blue;
            if (id === 'styrofoam' && U.hash2(ui, vi) < 0.25) col = [205, 205, 210];
            if (id === 'plastic' && ((vi % 14) + 14) % 14 === 0 && v > 0) col = mix(col, [0, 0, 0], 0.3);
            if (id === 'steel' && au > hwO - 1) col = RGB.slate;
            if (v > Hp - 0.5) { col = style.hi; a = 1; }                          // rim
            if (id === 'plastic' && v > Hp - 1.5 && v <= Hp - 0.5 && au > hw) { col = RGB.white; a = 1; }
            if (id === 'glass' && v < 0 && v > -1) { this.blend(X, Y, RGB.white, 0.2); }
          } else if (F.handle && u > hwO && u < hwO + 10 && v > handleBot && v < handleTop) {
            const ring = v > handleTop - 3 || v < handleBot + 3 || u < hwO + 3 || u > hwO + 7;
            if (ring) col = style.c;
          } else if (id === 'glass' && au < hw && v > 3 && v < Hp - 2 && u > -hw + 1.5 && u < -hw + 3.5) {
            // vertical glint down the front face
            this.blend(X, Y, RGB.white, u < -hw + 2.5 ? 0.22 : 0.12);
          }
          if (!col) continue;
          if (a >= 1) this.buf[Y * W + X] = pack(col); else this.blend(X, Y, col, a);
        }
      }
    }

    _drawRuler(sim, F) {
      const u0 = F.hwO + (F.handle ? 13 : 3);
      const cm = PX / 100;
      for (let k = 0; k <= Math.floor(sim.H * 100 + 1e-6); k++) {
        const len = k % 5 === 0 ? 4 : 2;
        for (let i = 0; i < len; i++) {
          const [x, y] = F.toScreen(u0 + i, k * cm);
          this.px(Math.round(x), Math.round(y), k % 5 === 0 ? P.silver : P.slate);
        }
      }
    }

    /** World point (tilt frame, metres) → screen pixel. */
    _world(F, x, y, z = 0) { return [F.Ox + x * PX, F.Oy - (y * F.cp - z * F.sp) * PX]; }

    /**
     * The stream is the physics' ballistic arc: it leaves the lip along the
     * bottle axis at the exit speed and falls under gravity until it lands.
     * Its width follows continuity, d = d0·√(v0/v), so a glugging bottle
     * visibly pulses.
     */
    _drawStream(sim, F, t) {
      const P0 = sim.pour, j = P0.jet;
      const base = this.colorOf(sim.bev.liquid).p, hi = this.colorOf(sim.bev.liquidHi).p;
      // the stream is the physics' parcels in flight (stream.js): a continuous
      // jet between consecutive parcels, its width from continuity d = d0·√(v0/v);
      // drops once it has broken up (Rayleigh–Plateau) and drips from the neck
      const span = (X, Y, w) => {
        const x0 = Math.round(X) - (w >> 1);
        for (let k = 0; k < w; k++) this.px(x0 + k, Math.round(Y), k === 0 && w > 1 ? hi : base);
      };
      let prev = null;
      for (const p of sim.stream.parcels) {
        const [X, Y] = this._table(F, p.x, p.y);
        if (p.drip || p.dist > p.Lb) {
          this.px(Math.round(X), Math.round(Y), base);
          if (p.V > 3e-8) this.px(Math.round(X), Math.round(Y) - 1, hi);
          prev = null;
          continue;
        }
        const v = Math.hypot(p.vx, p.vy);
        const w = Math.max(1, Math.round(p.d * Math.sqrt(p.v0 / Math.max(v, p.v0)) * PX));
        if (prev && Math.abs(prev.age - p.age) < 0.03) {
          const n = Math.max(1, Math.ceil(Math.hypot(X - prev.X, Y - prev.Y)));
          for (let i = 1; i <= n; i++) span(prev.X + (X - prev.X) * i / n, prev.Y + (Y - prev.Y) * i / n, Math.round(prev.w + (w - prev.w) * i / n));
        } else span(X, Y, w);
        prev = { X, Y, w, age: p.age };
      }
      if (!j || !(P0.Qin > 0)) return;
      const [lx, ly] = this._world(F, P0.land.x, P0.land.y);
      const splash = [Math.round(lx), Math.round(ly)];
      // Splash droplets, scaled by how much air the jet is entraining. Splash
      // drops leave at a fraction of the impact speed (≈0.2–0.7 m/s here, i.e.
      // they rise a few mm to ~2 cm) and are caught by the glass and the liquid.
      const n = Math.min(4, j.ratio * 6 + (P0.hitIce ? 1 : 0));
      for (let k = 0; k < n; k++) {
        if (Math.random() > 0.6) continue;
        const speed = (0.2 + 0.5 * Math.random()) * Math.min(1, j.vEff / 2) * PX;   // px/s
        const ang = (Math.random() - 0.5) * 1.2;                                   // within ±35° of vertical
        this.fx.push({ x: splash[0] + (Math.random() - 0.5) * 4, y: splash[1] - 1,
                       vx: speed * Math.sin(ang), vy: -speed * Math.cos(ang), life: 1.5, inCup: true,
                       c: Math.random() < 0.5 ? hi : P.foamDry });
      }
    }

    /**
     * The bottle at true scale and its physical angle φ, pivoting on its lip.
     * Its outline comes from the same body / shoulder / neck profile the flow
     * model integrates, and the soda inside fills up to the horizontal surface
     * the physics solved for.
     */
    _drawBottle(sim, F) {
      const B = sim.bottle, P0 = sim.pour, T = B.type;
      const [tipX, tipY] = this._world(F, P0.mouth.x, P0.mouth.y);
      const phi = B.phi * Math.PI / 180;
      const dx = -Math.sin(phi), dy = Math.cos(phi);        // screen direction lip → base
      const label = this.colorOf(sim.bev.label).p, stripe = this.colorOf(sim.bev.stripe).p;
      const liquid = this.colorOf(sim.bev.liquid).p, liqHi = this.colorOf(sim.bev.liquidHi).p;
      const glassBottle = T.id.startsWith('glass');
      const edge = glassBottle ? P.teal : P.silver, air = glassBottle ? pack([52, 92, 88]) : P.slate;   // the headspace air
      const lipH = B.L * Math.cos(phi);                      // lip-centre height in the bottle frame
      const lenPx = B.L * PX, reach = lenPx + T.R * PX + 2;
      this._bottleGeom = { tipX, tipY, dx, dy, lenPx, halfPx: T.R * PX, neckPx: T.r * PX, cp: F.cp, capPx: B.sealed ? 0.012 * PX : 0 };
      const labelS0 = 0.35 * T.Lb, labelS1 = 0.8 * T.Lb, stripeS = 0.575 * T.Lb;
      // the cap (sealed bottle): a ribbed screw cap ~12 mm over the neck
      const capOn = B.sealed, capPx = 0.012 * PX, capC = stripe, capEdge = pack(mix(unpackRGB(stripe), [0, 0, 0], 0.35));
      // the drink in the bottle, drawn from exactly the geometry the physics uses
      // (bottle.js): its surface is the plane that holds its volume with the
      // bottle tipped by ψ = φ + slosh against it; the foam sits on it up to its
      // own level; a slam's run-up sheet climbs the wall it was thrown at (or a jet
      // up the middle, for a jolt along the axis), with spray at its tip
      const psi = B.psi != null ? B.psi : phi, cPsi = Math.cos(psi), sPsi = Math.sin(psi);
      const hE = B.hEff != null ? B.hEff : B.surface;
      const bub = Math.min(0.15, (B.gasFraction || 0) * 0.6), frame = Math.floor(sim.time * 12);
      const foamOn = B.foamG + B.foamL > 1e-10, fTop = B.foamTop || hE;
      const run = B.V > 1e-9 ? (B.runUp || 0) : 0, axial = (B.runAxial || 0) > 0.5, side = B.runSide || 1;
      const bpal = this.bevPalette(sim.bev), foamC = pack(bpal.foamMid), foamE = pack(bpal.foamEdge);
      const ringS = B.L - 0.012;                             // neck support ring
      const x0 = Math.floor(tipX - reach), x1 = Math.ceil(tipX + reach);
      const y0 = Math.floor(tipY - reach * F.cp), y1 = Math.ceil(tipY + reach * F.cp);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const rx = x + 0.5 - tipX, ry = (y + 0.5 - tipY) / F.cp;
          const u = rx * dx + ry * dy, v = -rx * dy + ry * dx;
          if (u < 0 || u > lenPx) continue;
          const s = B.L - u / PX;                            // distance from the base [m]
          let r = B.radiusAt(s);
          if (s < 0.006) r *= 0.85 + 0.15 * s / 0.006;      // rounded base
          if (Math.abs(s - ringS) < 0.0015) r += 0.003;      // neck ring
          const half = r * PX + 1, av = Math.abs(v);
          if (av > half) continue;
          let c;
          if (capOn && u < capPx && av <= half + 1) c = av > half - 0.5 || u < 1 ? capEdge : capC;   // the cap
          else if (u < 1.5 || av > half - 1) c = edge;       // lip and wall
          else {
            const onLabel = s > labelS0 && s < labelS1;
            // height of this point against the drink's own surface (bottle frame: s along
            // the axis from the base, w across it, + toward the side that goes down as it tips)
            const w = -v / PX, yE = s * cPsi - w * sPsi;
            const full = B.V > 0 && yE < hE;
            c = air;
            if (full) {
              c = av < Math.max(1, half * 0.25) && s < T.Lb ? liqHi : liquid;
              if (bub > 0 && U.hash2(x * 5 + frame, y * 3 - frame) < bub) c = foamC;    // fine bubbles all through it
            } else if (run > 1e-3 && yE < hE + run) {
              // the run-up: a sheet thinning as it climbs the wall, or a jet up the middle
              const f = (yE - hE) / run, rr = r;
              const sheet = axial ? Math.abs(w) < (0.0015 + 0.004 * (1 - f)) : side * w > rr - (0.0015 + 0.005 * (1 - f));
              if (sheet) c = U.hash2(x, y + frame) < 0.15 ? liqHi : liquid;
              else if (U.hash2(x * 7 + frame, y * 5) < 0.06 * (1 - f) + (f > 0.7 ? 0.04 : 0)) c = liqHi;   // spray off its tip
            }
            if (!full && c === air && foamOn && B.V > 0 && yE < fTop) c = U.hash2(x, y) < 0.2 ? foamE : foamC;
            if (full && yE > hE - 1.2 / PX) c = liqHi;                  // the surface line: the slosh reads at a glance
            // a thin printed label: the drink shows through it, so you can see where it is
            if (onLabel) {
              const lab = Math.abs(s - stripeS) < 0.006 ? stripe : label;
              c = pack(mix(unpackRGB(lab), unpackRGB(c), c === air ? 0.15 : 0.45));
            }
          }
          this.px(x, y, c);
        }
      }
      const since = sim.time - (sim.stats.openedAt ?? -1e9);
      if (since >= 0 && since < 0.6 && B.hiss > 0) {
        const r0 = (2 + since * 30) * Math.min(1.5, 0.5 + B.hiss / 3e5), k = 1 - since / 0.6;
        const ux = Math.sin(phi), uy = -Math.cos(phi) * F.cp;            // out along the axis (screen)
        for (let i = 0; i < 40; i++) {
          const a = U.hash2(i, 7) * 2 * Math.PI, rr = r0 * Math.sqrt(U.hash2(i, 11));
          const X = Math.round(tipX + ux * r0 * 0.8 + Math.cos(a) * rr), Y = Math.round(tipY + uy * r0 * 0.8 + Math.sin(a) * rr * 0.7);
          if (U.hash2(i, Math.floor(since * 30)) < k) this.blend(X, Y, RGB.white, 0.5 * k);
        }
      }
    }

    /** The popped cap, flying or lying on the table: a small ribbed disc seen edge-on, spinning. */
    _drawCapFly(sim, F) {
      const c = sim.capFly;
      if (!c) return;
      const [X, Y] = this._world(F, c.x, c.y);
      const col = this.colorOf(sim.bev.stripe).p, dark = pack(mix(unpackRGB(col), [0, 0, 0], 0.35));
      const w = Math.max(2, 0.016 * PX), h = Math.max(1.5, 0.012 * PX);
      const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
      for (let a = -w / 2; a <= w / 2; a += 0.5) for (let b = -h / 2; b <= h / 2; b += 0.5) {
        const x = Math.round(X + a * ca + b * sa), y = Math.round(Y - (-a * sa + b * ca) * F.cp);
        this.px(x, y, Math.abs(b) > h / 2 - 0.6 || Math.abs(a) > w / 2 - 0.6 ? dark : col);
      }
    }

    /**
     * Overflow runs come from the physics (sim.runs): each is a lobe of foam or
     * a film of liquid sliding down the OUTSIDE of the glass from the rim it went
     * over, at the speed capillary.js gives it — foam creeps, liquid streams.
     */
    _drawRuns(sim, F) {
      const pal = this.bevPalette(sim.bev);
      const foamC = pack(pal.foamMid), foamE = pack(pal.foamEdge), liq = pack(pal.base), liqHi = pack(pal.hi);
      for (const r of sim.runs) {
        const thick = Math.max(1, Math.round(r.delta * PX));
        const len = r.s * PX;
        const u0 = r.side * (F.hwO + 0.5);
        for (let d = 0; d <= len; d += 0.5) {
          // a foam lobe is fattest at its leading edge; a liquid film is uniform
          const w = r.kind === 'foam' ? Math.max(1, Math.round(thick * (0.5 + 0.5 * d / Math.max(len, 1)))) : Math.max(1, Math.min(2, thick));
          for (let k = 0; k < w; k++) {
            const [x, y] = F.toScreen(u0 + r.side * k, F.Hp - d);
            const X = Math.round(x), Y = Math.round(y);
            if (Y >= TABLE_Y) continue;
            const c = r.kind === 'foam' ? (k === w - 1 || U.hash2(X, Y) < 0.2 ? foamE : foamC) : (k === 0 ? liqHi : liq);
            this.px(X, Y, c);
          }
        }
      }
    }

    /**
     * Surface tension at the rim: the liquid bulging above it (pinned at the
     * edge, rising over ~l_c) and the foam dome standing on top (paraboloid,
     * held up by its yield stress). Drawn for an upright glass.
     */
    _drawCrown(sim, F) {
      const cr = sim.crown;
      if (!cr || (cr.liquid <= 0 && cr.foam <= 0) || Math.abs(F.s) > 0.05 || F.sloshing && Math.abs(F.sd) > 0.02) return;
      const fl = sim.fluid, lc = Fizz.Capillary.capillaryLength(fl), hw = sim.D / 2;
      const liqPeak = cr.liquid / Math.max(0.5, 1 - (2 - Math.SQRT2) * lc * 4 / sim.D);
      const foamPeak = 2 * cr.foam;
      const pal = this.bevPalette(sim.bev);
      const pBase = pack(pal.base), pHi = pack(pal.hi), fC = pack(pal.foamDry), fE = pack(pal.foamEdge);
      const rimY = F.Oy - F.Hp;
      for (let X = Math.ceil(F.Ox - hw * PX); X < F.Ox + hw * PX; X++) {
        const u = (X + 0.5 - F.Ox) / PX;
        const edge = Math.max(0, hw - Math.abs(u));
        const yl = liqPeak * (1 - Math.exp(-edge / lc));                  // pinned at the edge, flat within
        const yf = yl + foamPeak * Math.max(0, 1 - (u / hw) ** 2);
        const top = Math.round(rimY - yf * PX);
        for (let Y = Math.round(rimY) - 1; Y >= top; Y--) {
          const h = (rimY - Y - 0.5) / PX;
          if (h < yl) this.px(X, Y, h > yl - 1 / PX ? pHi : pBase);
          else this.px(X, Y, Y === top || U.hash2(X, Y) < 0.15 ? fE : fC);
        }
      }
    }

    _drawFx(sim, F, realDt) {
      const dt = Math.min(0.05, realDt || 0.016);
      const g = 9.81 * PX * F.cp;                                   // real gravity, in px/s² (foreshortened)
      const surface = Math.max(F.g.level, F.g.foamTop);
      this.fx = this.fx.filter(p => {
        p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        const X = Math.round(p.x), Y = Math.round(p.y);
        if (p.inCup) {
          const [u] = F.toLocal(p.x, p.y);
          if (Math.abs(u) >= F.hw) return false;                   // caught by the inside of the glass
          if (p.vy > 0 && F.zAt(Y, X) <= surface) return false;     // fell back into the drink / foam
        }
        if (Y >= TABLE_Y) return false;
        this.px(X, Y, p.c);
        return p.life > 0;
      });
      if (this.fx.length > 400) this.fx.splice(0, this.fx.length - 400);
    }

    /** Canvas pixels → which screen object is there (used for drag-to-tilt). */
    hitCup(x, y) {
      const b = this.cupBox;
      return !!b && x >= b.x0 - 6 && x <= b.x1 + 6 && y >= b.y0 - 10 && y <= b.y1 + 2;
    }
  }

  Renderer.SIZE = { W, H };
  Renderer.internals = { PX: () => PX, pack, hex, mix, bayer, P, RGB, PAL, W, H, TABLE_Y, CUP_X };
  Fizz.Renderer = Renderer;
})(window.Fizz = window.Fizz || {});
