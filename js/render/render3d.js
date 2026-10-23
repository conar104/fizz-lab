/* Fizz Lab — the 3-D view.
 *
 * The camera looks down on the table from `pitch` above, orthographically (no
 * perspective distortion, so sizes stay true). World axes: x right, y up, z
 * toward the viewer. A point projects to
 *     X = Ox + x·PX,     Y = Oy − (y·cos φ − z·sin φ)·PX
 * so horizontal circles (rims, the liquid surface) appear as ellipses.
 *
 * The glass and everything in it is RAY-CAST: each screen pixel is a ray going
 * into the scene along (0, −sin φ, −cos φ). In the cup's own frame (u across,
 * v up its axis, w toward the viewer; tilted by θ about the depth axis) the
 * ray meets
 *     the cylinder walls      u² + w² = R²   (quadratic in t)
 *     the floor / rim planes  v = const
 *     every ice cube          an axis-aligned box (slab test)
 *     the liquid and foam     world heights y < h_liquid, y < h_foam
 * The liquid's surface is a plane tilted by the slosh angle δ (it need not be
 * level in the cup), so its height at the ray's world x is (h + x·sin δ)/cos δ.
 * and the nearest thing along it decides the colour. Liquid is drawn as an
 * absorbing medium (Beer–Lambert, e^(−k·path)): cubes and bubbles near the
 * front show through cola; the deep ones fade. Physics is unchanged — the
 * simulation's cross-section is axisymmetric; depth comes from the ice lanes
 * and a stable random depth per bubble.
 */
(function (Fizz) {
  'use strict';
  const { U } = Fizz;
  const Rp = Fizz.Renderer.prototype;
  const K = Fizz.Renderer.internals;
  const { pack, hex, mix, P, RGB, PAL, W, TABLE_Y, CUP_X } = K;

  const TABLE_DEPTH = -Fizz.Table.EDGE.back;  // the table's back edge, as in the physics [m]

  /** Interval [t1, t2] where a ray is inside a circle of radius r in the (u, w) plane. */
  function cylinder(u0, w0, du, dw, r) {
    const a = du * du + dw * dw, b = 2 * (u0 * du + w0 * dw), c = u0 * u0 + w0 * w0 - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const q = Math.sqrt(disc);
    return [(-b - q) / (2 * a), (-b + q) / (2 * a)];
  }
  /** Interval where v0 + t·dv lies in [lo, hi]. */
  function slab(v0, dv, lo, hi) {
    if (Math.abs(dv) < 1e-12) return v0 >= lo && v0 <= hi ? [-Infinity, Infinity] : null;
    let t1 = (lo - v0) / dv, t2 = (hi - v0) / dv;
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; }
    return [t1, t2];
  }
  function meet(a, b) {
    if (!a || !b) return null;
    const t1 = Math.max(a[0], b[0]), t2 = Math.min(a[1], b[1]);
    return t1 < t2 ? [t1, t2] : null;
  }

  // ---------------------------------------------------------------------------
  Rp._draw3d = function (sim, F, t, overlay) {
    const PX = K.PX();
    this._drawTable3d(sim, F, PX);
    this._drawPuddle3d(sim, F, PX);
    this._drawPiles3d(sim, F, PX, false, t);                     // foam heaped behind the glass first
    // The stream lives in the glass's middle plane, so it is depth-sorted against
    // the glass: drawn to its own layer, then composited after the far half of the
    // rim and before the near half — in front of the back of the rim, behind the
    // front; seen through the front wall's glass inside it; lost in the drink below
    // the surface.
    const layer = this._streamLayer(sim, F, t);
    this._drawCup3d(sim, F, PX, t);
    this._drawBubbles3d(sim, F, PX);
    this._drawAdditives3d(sim, F, PX, t);
    this._drawLooseIce3d(sim, F, PX);
    this._drawRim3d(sim, F, PX, 'back');
    this._compositeStream(layer);
    this._drawRim3d(sim, F, PX, 'front');
    this._drawSpoon3d(sim, F, PX);
    this._drawPiles3d(sim, F, PX, true, t);                      // and in front of it last
    this._drawRuns(sim, F);
    this._drawRuler(sim, F);
  };

  /** The table top, seen from above: wood planks receding to the back wall. */
  Rp._drawTable3d = function (sim, F, PX) {
    const yBack = Math.max(0, Math.round(TABLE_Y - TABLE_DEPTH * F.sp * PX));
    for (let Y = yBack; Y < K.H; Y++) {
      const depth = (TABLE_Y - Y) / Math.max(1, TABLE_Y - yBack);          // 1 at the back, <0 in front
      for (let X = 0; X < W; X++) {
        let c = P.wood;
        if (Y === yBack) c = P.woodHi;
        else if ((Y - yBack) % 7 === 3 || U.hash2(X >> 4, Y) < 0.08) c = P.woodDark;
        this.buf[Y * W + X] = depth > 0.6 ? pack(mix(hex(PAL.wood), hex(PAL.woodDark), 0.35)) : c;
      }
    }
    // The cup's shadow, light from overhead: its outline dropped straight down
    // onto the table. A tilted cylinder casts the two end circles (as ellipses
    // squashed by cos θ along x) joined by a band; darkest where the cup touches
    // the table, fading toward the end held up in the air.
    const T = sim.cupTilt(), Ro = sim.D / 2 + Math.max(sim.mat.wall, 1.5e-3);
    const pl = sim.pivotLocal();
    const base = sim.worldToTable(...T.rot(0, pl[1])), top = sim.worldToTable(...T.rot(0, sim.H));
    const ax = Math.max(Ro * Math.abs(T.cos), 1e-3);
    const x0 = Math.min(base[0], top[0]) - Ro, x1 = Math.max(base[0], top[0]) + Ro;
    const toZ = (Y) => (Y + 0.5 - TABLE_Y) / (F.sp * PX);
    for (let Y = Math.floor(TABLE_Y - Ro * F.sp * PX - 2); Y <= TABLE_Y + Ro * F.sp * PX + 2; Y++) {
      const z = toZ(Y);
      if (Math.abs(z) > Ro * 1.08 || z < Fizz.Table.EDGE.back) continue;
      for (let X = Math.floor(CUP_X + x0 * PX) - 2; X <= CUP_X + x1 * PX + 2; X++) {
        const x = (X + 0.5 - CUP_X) / PX;
        const inEnd = (cx, s) => ((x - cx) / (ax * s)) ** 2 + (z / (Ro * s)) ** 2 < 1;
        const between = (x - base[0]) * (x - top[0]) <= 0 && Math.abs(z) < Ro;
        const soft = inEnd(base[0], 1.08) || inEnd(top[0], 1.08) || (between && Math.abs(z) < Ro * 1.08);
        if (!soft) continue;
        const core = inEnd(base[0], 1) || inEnd(top[0], 1) || between;
        // how high the cup is above this bit of shadow: 0 at the base, H·sinθ at the far end
        const along = Math.abs(top[0] - base[0]) > 1e-4 ? U.clamp((x - base[0]) / (top[0] - base[0]), 0, 1) : 0;
        const a = (core ? 0.38 : 0.16) * (1 - 0.55 * along);
        this.blend(X, Y, [20, 12, 8], a);
      }
    }
  };

  /**
   * Puddles from the physics (table.js): discs on the table seen from above as
   * ellipses, wet-dark at the rim, glossy in the middle, with any foam still on them.
   */
  Rp._drawPuddle3d = function (sim, F, PX) {
    // Each puddle is a slab as thick as the physics says (≈3 mm spread out, a
    // domed cap when small): its top surface is lifted by h, and the front shows
    // its side. The table ends at its back edge: a puddle pinned there is cut
    // off by it, with a bright meniscus along the edge (and a dark wet edge if
    // it is running over).
    const zBackPx = (z) => TABLE_Y + z * F.sp * PX;               // screen row of table-plane depth z
    const yEdge = zBackPx(Fizz.Table.EDGE.back);
    // wet ground first: damp wood (darker, tinted by the drink, a faint sheen)
    // that dries to a sticky stain, darkest at its rim (coffee-ring effect)
    const W = K.W, Hs = K.H;
    for (const m of sim.table.marks || []) {
      const wet = m.V / Math.max(m.Vmax, 1e-15), stain = m.stain || 0;
      if (wet < 0.02 && stain < 0.02) continue;
      const [cx, cy] = this._table(F, m.x, 0, m.z);
      const rx = Math.max(1, m.r * PX), ry = Math.max(0.6, m.r * F.sp * PX);
      const tint = this._wetColor(sim, m.s, m.bev);
      for (let Y = Math.max(Math.ceil(yEdge), Math.floor(cy - ry)); Y <= Math.min(Hs - 1, cy + ry); Y++) {
        for (let X = Math.max(0, Math.floor(cx - rx)); X <= Math.min(W - 1, cx + rx); X++) {
          const ex = (X + 0.5 - cx) / rx, ey = (Y + 0.5 - cy) / ry, d2 = ex * ex + ey * ey;
          if (d2 > 1) continue;
          const i = Y * W + X;
          let c = unpack(this.buf[i]);
          // a damp film darkens the wood and takes on the drink's colour; the edge is soft
          const soft = Math.min(1, (1 - d2) * 6);
          c = mix(c, mix([0, 0, 0], tint, 0.35), 0.38 * wet * soft);
          if (wet > 0.3 && U.hash2(X * 3, Y * 5) < 0.025 * wet) c = mix(c, RGB.white, 0.25);   // a glint off the film
          // the dried stain: faint inside, a darker ring at the rim
          if (stain > 0) c = mix(c, mix([0, 0, 0], tint, 0.5), stain * (d2 > 0.78 ? 0.22 : 0.07));
          this.buf[i] = pack(c);
        }
      }
    }
    for (const q of sim.table.puddles) {
      const [cx, cy] = this._table(F, q.x, 0, q.z);
      const rx = Math.max(1, q.r * PX), ry = Math.max(1, q.r * F.sp * PX);
      const h = q.h || q.V / (Math.PI * q.r * q.r);
      const lift = h * F.cp * PX;
      const wet = this._wetColor(sim, q.s, q.bev);
      const top = pack(wet), side = pack(mix(wet, [0, 0, 0], 0.35)), rim = pack(mix(wet, hex(PAL.woodDark), 0.4));
      const gloss = pack(mix(wet, RGB.white, 0.4)), bead = pack(mix(wet, RGB.white, 0.55));
      // a small glint of the window light, the same size whatever the puddle
      const gX = cx - 0.35 * rx, gY = cy - lift - 0.3 * ry, gW = Math.max(0.6, Math.min(0.12 * rx, 6)), gH = Math.max(0.5, Math.min(0.1 * ry, 1.6));
      for (let Y = Math.floor(cy - ry - lift - 1); Y <= cy + ry; Y++) {
        for (let X = Math.floor(cx - rx); X <= cx + rx; X++) {
          const ex = (X + 0.5 - cx) / rx;
          const eyT = (Y + 0.5 + lift - cy) / ry, eyB = (Y + 0.5 - cy) / ry;
          const dT = ex * ex + eyT * eyT, dB = ex * ex + eyB * eyB;
          let col = null;
          if (dT < 1 && Y + lift >= yEdge) {
            // the top surface (its own footprint row decides whether it is on the table)
            const gx = (X + 0.5 - gX) / gW, gy = (Y + 0.5 - gY) / gH;
            col = dT > 0.86 ? rim : gx * gx + gy * gy < 1 ? gloss : top;
            if (q.atEdge && Math.abs(Y + lift - yEdge) < 1) col = q.runoff > 1e-8 ? side : bead;
          } else if (dB < 1 && Y >= yEdge && eyB > 0) col = side;  // its front side
          if (col != null) this.px(X, Y, col);
        }
      }
      // fizz: bubbles from the wood grain (and air trapped as it first wetted the
      // table) wink at the surface; each one lives ~0.1 s, so they twinkle
      const fz = Math.min(0.05, (q.fizz || 0) / 1e4 * 0.004 + (q.entrap || 0) * 2e-6);
      if (fz > 0.003) {
        const frame = Math.floor(sim.time * 10);
        for (let Y = Math.floor(cy - ry - lift); Y <= cy + ry - lift; Y++) {
          for (let X = Math.floor(cx - rx); X <= cx + rx; X++) {
            const ex = (X + 0.5 - cx) / rx, ey = (Y + 0.5 + lift - cy) / ry;
            if (ex * ex + ey * ey > 0.8 || Y + lift < yEdge) continue;
            if (U.hash2(X * 7 + frame, Y * 13 - frame * 3) < fz) this.px(X, Y, bead);
          }
        }
      }
    }
  };

  /**
   * The ray-cast glass: walls, floor, liquid, foam and the cubes inside it.
   */
  Rp._drawCup3d = function (sim, F, PX, t) {
    const g = F.g, tilt = g.tilt, I = sim.ice;
    const c = F.c, s = F.s, cp = F.cp, sp = F.sp;
    const R = sim.D / 2, wall = Math.max(sim.mat.wall, 1.2e-3), Ro = R + wall;
    const base = Math.max(2, F.baseRows) / PX, H = sim.H;
    const glass = F.id === 'glass';
    const pal = this.bevPalette(sim.bev);
    const opacity = sim.bev.clear;
    // Beer–Lambert absorption for drawing [1/m] (a rendering choice): cola hides what is deep
    // inside within ~1.5 cm; a clear drink is tinted in proportion to its colour opacity
    const kAbs = opacity ? 4 + 60 * opacity : 70;
    const liq = pal.base, liqHi = pal.hi;
    const matRGB = hex({ glass: PAL.cyan, plastic: PAL.red, paper: PAL.white, styrofoam: PAL.white, ceramic: PAL.orange, steel: PAL.silver }[F.id]);
    // surface heights in the liquid's frame; per pixel they become world heights
    const hS = tilt.levelToWorld(g.level);
    const hasFoam = g.foamTop > g.level + 1e-4;
    const hF = hasFoam ? tilt.levelToWorld(g.foamTop) : hS;
    const hasWater = sim.water && sim.water.V > 0 && g.waterZ < g.level - 1e-5;
    const hW = hasWater ? tilt.levelToWorld(g.waterZ) : hS;
    const cd = F.cd, sd = F.sd;
    const waterC = pal.water;
    const crown = sim.crown || { foam: 0, liquid: 0 };
    const upright = Math.abs(s) < 0.05;
    const domePeak = upright ? 2 * crown.foam : 0;
    const geo = sim.foam.geometry;
    const cubes = I.cubes.filter(q => q.where === 'cup');
    const lanes = I.laneDefs.length ? I.laneDefs : [{ z: 0 }];
    let iceTop = 0;
    for (const q of cubes) iceTop = Math.max(iceTop, q.v + q.a);
    const Htop = Math.max(H, iceTop, H + domePeak + crown.liquid) + 1e-3;
    const tick = Math.floor(t * 3);

    // foam colour at a world height (layer lookup through the equivalent level)
    const foamCol = (y, X, Y, top, xw) => {
      const z = tilt.worldToLevel(Math.min(y * cd - xw * sd, hF - 1e-6));
      let k = 0;
      while (k < geo.length - 1 && geo[k].z1 < z) k++;
      const G = geo[k] || { phi: 0.2, R: 3e-4 };
      const wet = U.clamp(G.phi / 0.3, 0, 1);
      const col = wet > 0.5 ? mix(pal.foamMid, pal.foamWet, (wet - 0.5) * 2) : mix(pal.foamDry, pal.foamMid, wet * 2);
      const cell = U.clamp(Math.round(G.R * PX * 9), 2, 10);
      const edge = ((X + (top ? 0 : k * 7)) % cell === 0) || ((Y + (top ? tick : 0)) % cell === 0);
      return edge ? mix(col, pal.foamEdge, 0.8) : col;
    };

    // screen bounds of the cup (8 corners of its local bounding box)
    const pts = [];
    for (const u of [-Ro, Ro]) for (const v of [-base, Htop]) for (const w of [-Ro, Ro]) pts.push(F.proj(u * PX, v * PX, w * PX));
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0]))) - 1);
    const x1 = Math.min(W - 1, Math.ceil(Math.max(...pts.map(p => p[0]))) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1]))) - 1);
    const y1 = Math.min(K.H - 1, Math.ceil(Math.max(...pts.map(p => p[1]))) + 1);
    this.cupBox = { x0, x1, y0, y1 };

    // the ray direction in the cup's frame is the same for every pixel
    const du = -sp * s, dv = -sp * c, dw = -cp;
    const zStart = Ro + 0.05;
    // per pixel: where along the view ray the front wall is, and the first thing
    // you cannot see through (or the drink), so the stream can be depth-sorted
    const N = W * K.H;
    if (!this._dWall || this._dWall.length !== N) { this._dWall = new Float32Array(N); this._dSolid = new Float32Array(N); this._dKind = new Uint8Array(N); }
    this._dWall.fill(Infinity); this._dSolid.fill(Infinity); this._dKind.fill(0);
    // every ray starts at depth zStart and loses cp per unit t: it crosses the middle plane at
    this._depth = { t0: zStart / cp, matRGB, glass, liq, kAbs };

    for (let Y = y0; Y <= y1; Y++) {
      for (let X = x0; X <= x1; X++) {
        const x = (X + 0.5 - F.Ox) / PX, q = (F.Oy - (Y + 0.5)) / PX;
        const yStart = (q + zStart * sp) / cp;
        const u0 = x * c + yStart * s, v0 = -x * s + yStart * c, w0 = zStart;
        const yAt = (tt) => yStart - tt * sp;
        // world heights of the surface, the foam top and the meltwater's underside above this x
        const hSx = (hS + x * sd) / cd, hFx = (hF + x * sd) / cd, hWx = (hW + x * sd) / cd;

        const outer = meet(cylinder(u0, w0, du, dw, Ro), slab(v0, dv, -base, H));
        const inner = meet(cylinder(u0, w0, du, dw, R), slab(v0, dv, 0, Htop));
        if (!outer && !inner) continue;
        const i = Y * W + X;

        // --- what lies behind the contents: back wall or floor
        let back;
        if (inner) {
          const vExit = v0 + inner[1] * dv;
          if (vExit <= 1e-5) back = glass ? mix(unpack(this.buf[i]), RGB.silver, 0.18) : mix(matRGB, [0, 0, 0], 0.15);
          else if (vExit <= H) back = glass ? mix(unpack(this.buf[i]), RGB.cyan, 0.08) : mix(matRGB, [0, 0, 0], 0.3);
          else back = unpack(this.buf[i]);                       // looking out over the rim
        }

        let col = null, tS = Infinity, kind = 0;                 // kind 1: drink (partly see-through), 2: solid
        if (inner) {
          const tA = inner[0], tB = inner[1];
          const backIsWall = v0 + tB * dv <= H;
          // nearest ice cube along the ray
          let tc = Infinity, face = 0, cubeSub = false;
          for (const qb of cubes) {
            const lz = lanes[Math.min(qb.lane, lanes.length - 1)].z, h = qb.a / 2;
            const su = slab(u0, du, qb.u - h, qb.u + h), sv = slab(v0, dv, qb.v - h, qb.v + h), sw = slab(w0, dw, lz - h, lz + h);
            const hit = meet(meet(su, sv), sw);
            if (hit && hit[0] < tc && hit[0] >= tA - 1e-9 && hit[0] <= tB) {
              tc = hit[0];
              face = hit[0] === sv[0] ? 1 : hit[0] === sw[0] ? 2 : 3;   // 1 top, 2 front, 3 side
              cubeSub = yAt(tc) < hSx;
            }
          }
          const iceC = (sub) => {
            const base = face === 1 ? RGB.white : face === 2 ? hex(PAL.ice) : hex(PAL.iceShade);
            return sub ? mix(base, hex(PAL.iceSub), 0.35) : base;
          };
          const yA = yAt(tA);
          const r2 = (tt) => { const uu = u0 + tt * du, ww = w0 + tt * dw; return uu * uu + ww * ww; };
          const foamTopAt = (tt) => hFx + (domePeak > 0 ? domePeak * Math.max(0, 1 - r2(tt) / (R * R)) : 0);
          if (yA < hSx && hasWater && yA >= hWx) {
            // through the wall into the floating meltwater: clear, the cubes show through
            const tEnd = Math.min(tc, tB);
            const target = tc < Infinity ? iceC(true) : back;
            col = mix(target, waterC, 0.55 + 0.35 * (1 - Math.exp(-15 * (tEnd - tA))));
            tS = tA; kind = 1;
          } else if (yA < hSx) {
            // entering the liquid through the front wall
            const tEnd = Math.min(tc, tB);
            const target = tc < Infinity ? iceC(true) : back;
            col = mix(target, liq, 1 - Math.exp(-kAbs * (tEnd - tA)));
            tS = tA; kind = 1;
          } else if (hasFoam && yA < foamTopAt(tA)) {
            col = foamCol(yA, X, Y, false, x);                     // the foam's side, through the wall
            tS = tA; kind = 2;
          } else {
            // entering from above: what comes first — ice, foam top, liquid surface, or the far side?
            const tf = hasFoam ? (yStart - hFx) / sp : Infinity;
            const tl = (yStart - hSx) / sp;
            let tFoam = Infinity;
            if (hasFoam && tf < tB) {
              // the dome bulges above hF in the middle: march to the first point under it
              let tt = Math.max(tA, domePeak > 0 ? (yStart - hFx - domePeak) / sp : tf);
              for (let k = 0; k < 24 && tt < tB; k++, tt += Math.max(1e-4, (tf - tA) / 24)) {
                if (yAt(tt) < foamTopAt(tt)) { tFoam = Math.max(tt, tA); break; }
              }
              if (tFoam === Infinity && tf >= tA) tFoam = tf;
            }
            const tLiq = tl >= tA && tl < tB ? tl : Infinity;
            const first = Math.min(tc, tFoam, tLiq);
            if (first === Infinity) { col = back; if (backIsWall) { tS = tB; kind = 2; } }
            else if (first === tc) { col = iceC(cubeSub); tS = tc; kind = 2; }
            else if (first === tFoam) { col = foamCol(yAt(tFoam), Math.round(u0 + tFoam * du * 1e3), Math.round(w0 + tFoam * dw * 1e3), true, x); tS = tFoam; kind = 2; }
            else {
              tS = tLiq; kind = 1;
              // the liquid surface: what lies below shows through, fading with depth
              const tEnd = Math.min(tc > tLiq ? tc : Infinity, tB);
              const target = tc > tLiq && tc < Infinity ? iceC(true) : back;
              col = mix(target, liq, 1 - Math.exp(-kAbs * (tEnd - tLiq)));
              col = mix(col, liqHi, 0.3);
              if (hasWater) col = mix(col, waterC, 0.5);           // looking down through the meltwater lid
              // meniscus: the surface climbs a wettable wall in a bright ring ~l_c wide
              const rr = Math.sqrt(r2(tLiq)), lc = 2.7e-3;
              if (sim.mat.contactAngle < 90 && rr > R - lc) col = mix(col, liqHi, 0.6);
              }
          }
        }

        // --- the front wall over everything inside it
        const throughWall = outer && (!inner || outer[0] < inner[0] - 1e-9);
        if (throughWall) {
          const vIn = v0 + outer[0] * dv;
          const inside = col || unpack(this.buf[i]);
          if (!inner && !col) {
            col = mix(inside, matRGB, glass ? 0.55 : 1);           // the wall seen edge-on (silhouette)
          } else if (vIn < 0) {
            col = mix(inside, glass ? RGB.white : matRGB, glass ? 0.25 : 0.9);    // the base
          } else {
            col = mix(inside, matRGB, glass ? 0.12 : 0.35);        // glass tint; other cups shown x-ray
            const xs = (u0 + outer[0] * du) / Ro;                  // glint down the left of the front face
            if (glass && xs > -0.72 && xs < -0.56) col = mix(col, RGB.white, 0.25);
          }
        }
        if (col) this.buf[i] = pack(col);
        if (throughWall) this._dWall[i] = outer[0];
        if (!inner && outer) { tS = outer[0]; kind = 2; }      // the wall seen edge-on
        this._dSolid[i] = tS; this._dKind[i] = kind;
      }
    }
  };

  function unpack(p) { return [p & 255, (p >> 8) & 255, (p >> 16) & 255]; }

  /** Draw the stream into a layer of its own (0 = nothing there). */
  Rp._streamLayer = function (sim, F, t) {
    const N = W * K.H;
    if (!this._sLayer || this._sLayer.length !== N) this._sLayer = new Uint32Array(N);
    this._sLayer.fill(0);
    const save = this.buf;
    this.buf = this._sLayer;
    this._drawStream(sim, F, t);
    this.buf = save;
    return this._sLayer;
  };

  /**
   * Put the stream over the scene where nothing nearer hides it. It is in the
   * middle plane (ray parameter t0): in front of anything the ray meets later, seen
   * through the front wall's glass if the wall comes first, fading into the drink
   * once it is under the surface, and hidden behind anything solid in front of it.
   */
  Rp._compositeStream = function (layer) {
    const d = this._depth;
    for (let i = 0; i < layer.length; i++) {
      const p = layer[i];
      if (!p) continue;
      if (!d) { this.buf[i] = p; continue; }
      let c = unpack(p);
      const tS = this._dSolid[i], kind = this._dKind[i];
      if (tS < d.t0) {
        if (kind === 2) continue;                                // something solid is in front
        c = mix(c, d.liq, 1 - Math.exp(-d.kAbs * (d.t0 - tS)));  // under the drink
        if (d.kAbs > 40) continue;                               // dark drinks hide it entirely
      }
      if (this._dWall[i] < d.t0) c = mix(c, d.matRGB, d.glass ? 0.14 : 0.6);   // behind the front wall
      this.buf[i] = pack(c);
    }
  };

  /** The rim: a ring between the inner and outer radius at the top of the wall. */
  Rp._drawRim3d = function (sim, F, PX, half) {
    const R = sim.D / 2 * PX, Ro = R + Math.max(sim.mat.wall * PX, 1.5), H = sim.H * PX;
    const glass = F.id === 'glass';
    const rimC = glass ? P.white : this.colorOf({ plastic: PAL.white, paper: PAL.silver, styrofoam: '#c8c8cc', ceramic: PAL.yellow, steel: PAL.white }[F.id]).p;
    const n = Math.ceil(2 * Math.PI * Ro * 2);
    for (let k = 0; k < n; k++) {
      const a = k / n * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      if (half === 'back' && sa >= 0) continue;                 // far half: depth w < 0
      if (half === 'front' && sa < 0) continue;                 // near half: depth w ≥ 0
      for (let r = R; r <= Ro; r += 0.5) {
        const [X, Y] = F.proj(r * ca, H, r * sa);
        this.px(Math.round(X), Math.round(Y), rimC);
      }
    }
    // the ceramic mug's handle, on the right in the middle plane
    if (F.handle && half !== 'back') {
      const style = hex(PAL.orange);
      const top = H - 8, bot = Math.max(8, H - 42);
      for (let v = bot; v <= top; v += 0.5) for (let u = Ro; u < Ro + 10; u += 0.5) {
        const ring = v > top - 3 || v < bot + 3 || u < Ro + 3 || u > Ro + 7;
        if (!ring) continue;
        const [X, Y] = F.proj(u, v, 0);
        this.px(Math.round(X), Math.round(Y), pack(style));
      }
    }
  };

  /** Bubbles at their (stable, random) depth, fading behind the drink in front of them. */
  Rp._drawBubbles3d = function (sim, F, PX) {
    const b = sim.bubbles, R = sim.D / 2;
    const pal = this.bevPalette(sim.bev);
    const kAbs = sim.bev.clear ? 4 + 60 * sim.bev.clear : 70;
    const cMid = unpack(pal.bubble), cDim = unpack(pal.bubbleDim);
    for (let i = 0; i < b.count; i++) {
      // liquid frame → world → the cup's own frame
      const [wx, wy] = F.mapWorld(b.x[i], b.y[i]);
      const u = wx * F.c + wy * F.s, v = -wx * F.s + wy * F.c;
      const chord = Math.sqrt(Math.max(0, R * R - u * u));
      const w = b.zd[i] * chord;
      const alpha = Math.exp(-kAbs * (chord - w) / F.cp);          // drink between it and the front wall
      if (alpha < 0.08) continue;
      const [X, Y] = F.proj(u * PX, v * PX, w * PX);
      const big = b.R[i] > 1.2e-3;
      const col = big ? RGB.white : b.R[i] > 0.25e-3 ? cMid : cDim;
      this.blend(Math.round(X), Math.round(Y), col, alpha);
      if (big) this.blend(Math.round(X) + 1, Math.round(Y), col, alpha);
    }
  };

  /** Cubes that tumbled out (falling or on the table), as little 3-D boxes. */
  Rp._drawLooseIce3d = function (sim, F, PX) {
    const lanes = sim.ice.laneDefs.length ? sim.ice.laneDefs : [{ z: 0 }];
    const loose = sim.ice.cubes.filter(c => c.where !== 'cup')
      .map(c => ({ c, z: lanes[Math.min(c.lane, lanes.length - 1)].z }))
      .sort((p, q) => p.z - q.z);
    for (const { c, z } of loose) {
      const h = c.a / 2;
      // front face: x ± h, y ± h at depth z + h;  top face: y + h, depth z ± h
      const [xl, yTopF] = this._table(F, c.x - h, c.y + h, z + h), [xr, yBotF] = this._table(F, c.x + h, c.y - h, z + h);
      const [, yTopB] = this._table(F, c.x, c.y + h, z - h);
      for (let Y = Math.round(yTopB); Y < Math.round(yTopF); Y++) for (let X = Math.round(xl); X <= Math.round(xr); X++) this.px(X, Y, P.white);
      for (let Y = Math.round(yTopF); Y <= Math.round(yBotF); Y++) for (let X = Math.round(xl); X <= Math.round(xr); X++) {
        this.px(X, Y, X === Math.round(xl) || Y === Math.round(yTopF) ? P.iceEdge : X === Math.round(xr) || Y === Math.round(yBotF) ? P.iceShade : P.ice);
      }
    }
  };

  /**
   * Foam heaps on the table, as the physics shapes them (table.js): the plastic
   * profile h = h₀·√(1 − ρ/r₀) of a yield-stress pile. Painted back to front as
   * columns, lit from the upper left, with bubble speckle and the odd pop.
   */
  Rp._drawPiles3d = function (sim, F, PX, front, t) {
    const pal = this.bevPalette(sim.bev);
    const dry = pal.foamDry, mid = pal.foamMid, edge = pal.foamEdge;
    const tick = Math.floor(t * 8);
    // foam cannot be inside the glass: a column is left out only where its top is
    // inside the glass as it stands now (tilted or not), so a glass swung over a
    // heap no longer cuts a hole where its foot used to be
    const Ro = sim.D / 2 + Math.max(sim.mat.wall, 1.5e-3), Hc = sim.H;
    const insideGlass = (x, y, z) => { const [u, v] = sim.tableToCup(x, y); return v > -2e-3 && v < Hc && Math.hypot(u, z) < Ro; };
    for (const p of sim.table.piles) {
      if (!(p.r > 0) || !(p.h > 0)) continue;
      const stepX = 0.7 / PX, stepZ = 0.7 / (PX * Math.max(F.sp, 0.2));
      for (let b = -p.r; b <= p.r; b += stepZ) {                       // back to front
        const zz = p.z + b;
        if (zz < Fizz.Table.EDGE.back || (zz >= 0) !== front) continue;
        for (let a = -p.r; a <= p.r; a += stepX) {
          const rho = Math.hypot(a, b);
          if (rho >= p.r) continue;
          const hh = p.h * Math.sqrt(1 - rho / p.r);
          if (insideGlass(p.x + a, hh, zz)) continue;
          const [X, Yb] = this._table(F, p.x + a, 0, p.z + b);
          const Yt = Yb - hh * F.cp * PX;
          const light = U.clamp(0.85 - 0.35 * (a / p.r) - 0.25 * (b / p.r) - 0.2 * rho / p.r, 0, 1);
          let col = mix(mid, dry, light);
          const xi = Math.round(X), yt = Math.round(Yt);
          if (U.hash2(xi * 3 + yt, tick) < 0.04) col = RGB.white;       // a bubble popping
          else if (U.hash2(xi, yt) < 0.15) col = mix(col, edge, 0.6);   // cell walls
          this.px(xi, yt, pack(col));
          const sideC = pack(mix(col, edge, 0.5));
          for (let Y = yt + 1; Y <= Math.round(Yb); Y++) this.px(xi, Y, sideC);
        }
      }
    }
  };

  /**
   * How much of the drink lies between a point in the glass (cup frame, metres)
   * and the viewer: along the view ray it leaves the liquid through the front
   * wall or up through the surface, whichever comes first. Returns the fraction
   * of light that gets through (Beer–Lambert, as in the ray-cast).
   */
  Rp._seeThrough = function (sim, F, u, v, w) {
    const g = F.g, R = sim.D / 2;
    const level = g.level;
    if (v >= level || sim.cupVolume < 1e-8) return 1;
    const kAbs = sim.bev.clear ? 4 + 60 * sim.bev.clear : 70;
    const toWall = Math.max(0, Math.sqrt(Math.max(0, R * R - u * u)) - w) / Math.max(F.cp, 0.2);
    const toTop = (level - v) / Math.max(F.sp, 0.05);
    return Math.exp(-kAbs * Math.min(toWall, toTop));
  };

  /**
   * Mentos and salt grains where the physics put them: x across, z in depth,
   * y up. A Mentos is a white candy lens (Ø 19 mm, 6 mm thick) that tumbles as
   * it falls and lies flat once down; salt grains are single sparkling pixels.
   * Both fade behind the drink in front of them.
   */
  Rp._drawAdditives3d = function (sim, F, PX, t) {
    const A = sim.additives;
    const draw = (u, v, w, col, a) => {
      const [X, Y] = F.proj(u * PX, v * PX, w * PX);
      if (a >= 0.98) this.px(Math.round(X), Math.round(Y), pack(col)); else this.blend(Math.round(X), Math.round(Y), col, a);
    };
    // out of the glass (flying or on the table): drawn in the table frame
    const tableDraw = (x, y, z, col) => { const [X, Y] = this._table(F, x, y, z); this.px(Math.round(X), Math.round(Y), pack(col)); };
    for (const m of A.mentos) {
      if (m.where === 'cup') continue;
      const r = 0.0095, step = 0.6 / PX;
      for (let b = -r; b <= r; b += step) for (let a = -r; a <= r; a += step) {
        const q = (a * a + b * b) / (r * r);
        if (q >= 1) continue;
        tableDraw(m.tx + a, m.ty + 0.003 * Math.sqrt(1 - q), m.tz + b, mix([150, 150, 160], RGB.white, U.clamp(0.95 - 0.25 * (a / r) - 0.15 * q, 0.5, 1)));
      }
    }
    for (const sg of A.salt) if (sg.where !== 'cup') tableDraw(sg.tx, sg.ty, sg.tz, [225, 228, 235]);
    const mentos = A.mentos.filter(m => m.where === 'cup').sort((p, q) => (p.z || 0) - (q.z || 0));
    for (const m of mentos) {
      const r = 0.0095, half = 0.003, z0 = m.z || 0;
      const resting = m.y <= 0.0046;
      const tilt = resting ? 0 : (m.tilt || 0) + 0.8 * Math.sin(m.age * 9 + (m.spin || 0));   // tumbling on the way down
      const step = 0.6 / PX;
      for (let b = -r; b <= r; b += step) {
        for (let a = -r; a <= r; a += step) {
          const q = (a * a + b * b) / (r * r);
          if (q >= 1) continue;
          const th = half * Math.sqrt(1 - q);                    // lens: thickest in the middle
          const u = m.x + a, w = z0 + b, vc = m.y + b * Math.sin(tilt);
          const see = this._seeThrough(sim, F, u, vc, w);
          if (see < 0.08) continue;
          const shade = U.clamp(0.95 - 0.25 * (a / r) - 0.15 * q, 0.5, 1);
          draw(u, vc + th, w, mix([150, 150, 160], RGB.white, shade), see);
          if (b > r * 0.55) draw(u, vc - th * 0.6, w, RGB.silver, see);   // the rounded front edge
        }
      }
    }
    for (const s of A.salt) {
      if (s.where && s.where !== 'cup') continue;
      const see = this._seeThrough(sim, F, s.x, s.y, s.z || 0);
      if (see < 0.1) continue;
      const glint = U.hash2(Math.round(s.x * 1e4), Math.floor(t * 6)) < 0.3;
      draw(s.x, s.y, s.z || 0, glint ? RGB.white : [220, 225, 232], see);
    }
  };

  /**
   * The spoon going round its circle (clockwise from above): a steel rod from
   * above the rim to just off the floor, with its bowl at the bottom; the part
   * under the drink fades with the drink in front of it.
   */
  Rp._drawSpoon3d = function (sim, F, PX) {
    if (!sim.additives.stirring) return;
    const sx = sim.spoonX(), sz = sim.spoonZ ? sim.spoonZ() : 0;
    const top = sim.H + 0.05, bot = 0.006;
    for (let v = bot; v <= top; v += 0.5 / PX) {
      const see = v < sim.geom.level ? this._seeThrough(sim, F, sx, v, sz) : 1;
      if (see < 0.06) continue;
      const [X, Y] = F.proj(sx * PX, v * PX, sz * PX);
      const xi = Math.round(X), yi = Math.round(Y);
      const lite = v > sim.H ? RGB.white : RGB.silver, dark = hex(PAL.slate);
      if (see >= 0.98) { this.px(xi, yi, pack(lite)); this.px(xi + 1, yi, pack(dark)); }
      else { this.blend(xi, yi, lite, see); this.blend(xi + 1, yi, dark, see); }
    }
    // the bowl, lying in the horizontal plane at the bottom of the rod
    const rb = 0.007;
    for (let b = -rb * 0.6; b <= rb * 0.6; b += 0.6 / PX) for (let a = -rb; a <= rb; a += 0.6 / PX) {
      if ((a / rb) ** 2 + (b / (0.6 * rb)) ** 2 >= 1) continue;
      const see = this._seeThrough(sim, F, sx + a, bot, sz + b);
      if (see < 0.06) continue;
      const [X, Y] = F.proj((sx + a) * PX, bot * PX, (sz + b) * PX);
      this.blend(Math.round(X), Math.round(Y), RGB.silver, see);
    }
  };

  /**
   * A small top-down map in the corner: the glass from above, with the ice in
   * its depth lanes, the head of foam, where the stream lands and the spoon.
   */
  Rp._drawTopView = function (sim, F) {
    const size = 66, cx = W - size / 2 - 6, cy = size / 2 + 6;
    const R = sim.D / 2, Ro = R + Math.max(sim.mat.wall, 1.5e-3), k = (size / 2 - 3) / Ro;
    const pal = this.bevPalette(sim.bev);
    const g = sim.geom;
    // panel
    for (let Y = cy - size / 2; Y < cy + size / 2; Y++) for (let X = cx - size / 2; X < cx + size / 2; X++) this.blend(X | 0, Y | 0, RGB.night, 0.85);
    const lanes = sim.ice.laneDefs.length ? sim.ice.laneDefs : [{ z: 0 }];
    const foamH = g.foamHeight, hasLiquid = sim.cupVolume > 1e-7;
    for (let Y = Math.floor(cy - size / 2 + 2); Y < cy + size / 2 - 2; Y++) {
      for (let X = Math.floor(cx - size / 2 + 2); X < cx + size / 2 - 2; X++) {
        const u = (X + 0.5 - cx) / k, w = (Y + 0.5 - cy) / k;      // screen down = toward the viewer
        const r = Math.hypot(u, w);
        if (r > Ro) continue;
        let col;
        if (r > R) col = F.id === 'glass' ? RGB.cyan : hex({ plastic: PAL.red, paper: PAL.white, styrofoam: PAL.white, ceramic: PAL.orange, steel: PAL.silver }[F.id]);
        else if (foamH > 0.002) col = U.hash2(X, Y) < Math.min(0.5, foamH * 20) ? pal.foamEdge : pal.foamDry;
        else if (hasLiquid && sim.water.V > 2e-6) col = U.hash2(X, Y) < 0.08 ? pal.hi : mix(pal.base, pal.water, 0.6);
        else if (hasLiquid) col = U.hash2(X, Y) < 0.06 ? pal.hi : pal.base;
        else col = mix(RGB.night, RGB.silver, 0.2);
        this.buf[Y * W + X] = pack(col);
      }
    }
    // ice cubes in their lanes (w = lane depth), topmost drawn last
    const cubes = sim.ice.cubes.filter(c => c.where === 'cup').sort((p, q) => p.v - q.v);
    for (const c of cubes) {
      const lz = lanes[Math.min(c.lane, lanes.length - 1)].z, h = c.a / 2;
      const under = c.sub >= 1;
      for (let Y = Math.round(cy + (lz - h) * k); Y < cy + (lz + h) * k; Y++) {
        for (let X = Math.round(cx + (c.u - h) * k); X < cx + (c.u + h) * k; X++) {
          const edge = Y === Math.round(cy + (lz - h) * k) || X === Math.round(cx + (c.u - h) * k);
          if (Math.hypot(X + 0.5 - cx, Y + 0.5 - cy) > R * k) continue;     // cubes stop at the wall
          this.px(X, Y, edge ? P.iceEdge : under ? P.iceSub : P.ice);
        }
      }
    }
    // where the stream lands, and the spoon
    if (sim.pour.jet) { const X = Math.round(cx + sim.pour.land.x * k); for (let d = -1; d <= 1; d++) { this.px(X + d, Math.round(cy), P.orange); this.px(X, Math.round(cy) + d, P.orange); } }
    // Mentos and salt where they are; the spoon on its clockwise circle
    for (const m of sim.additives.mentos) {
      if (m.where !== 'cup') continue;
      const mx = cx + m.x * k, my = cy + (m.z || 0) * k, rr = 0.0095 * k;
      for (let Y = Math.floor(my - rr); Y <= my + rr; Y++) for (let X = Math.floor(mx - rr); X <= mx + rr; X++) {
        if (Math.hypot(X + 0.5 - mx, Y + 0.5 - my) < rr) this.px(X, Y, P.white);
      }
    }
    for (const s of sim.additives.salt) if (s.where === 'cup') this.px(Math.round(cx + s.x * k), Math.round(cy + (s.z || 0) * k), P.white);
    if (sim.additives.stirring) {
      const X = Math.round(cx + sim.spoonX() * k), Y = Math.round(cy + (sim.spoonZ ? sim.spoonZ() : 0) * k);
      for (let d = -1; d <= 1; d++) { this.px(X + d, Y, P.silver); this.px(X, Y + d, P.silver); }
    }
  };
})(window.Fizz = window.Fizz || {});
