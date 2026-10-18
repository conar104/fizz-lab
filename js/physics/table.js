/* Fizz Lab — everything that leaves the glass: flying drops and foam, and the
 * puddles and foam piles they make on the table.
 *
 * Frame: the TABLE frame — origin at the cup's pivot corner on the table top,
 * x right, y up, z toward the viewer. It does not move when the cup tilts.
 *
 * FLIGHT. Each particle is a parcel of liquid drops or a clump of foam:
 *     m·dv/dt = m·g − ½·ρ_air·C_d·πr²·|v|·v,   C_d = 0.47 (sphere)
 * Liquid flies as ~1.5 mm drops (sheets torn off a rim break up near the
 * Rayleigh–Plateau size); foam as ~4 mm clumps at the foam's own density, so
 * air drag matters more for foam.
 *
 * PUDDLES. A spill spreads as a viscous gravity current. For a fixed volume V
 * on a flat surface the radius grows as (Huppert 1982, J. Fluid Mech. 121:43)
 *     r(t) = 0.894·(ρgV³/3μ)^{1/8}·t^{1/8}
 * written here as dr/dt = K·V³/r⁷ with K = 0.894⁸·ρg/(24μ), so a puddle that
 * keeps being fed keeps spreading. It stops where gravity and surface tension
 * balance — a puddle's maximum thickness (de Gennes, Brochard-Wyart & Quéré,
 * Capillarity and Wetting Phenomena, §2.3):
 *     h_eq = 2·l_c·sin(θ_e/2),   l_c = √(σ/ρg)
 * about 3 mm for water on varnished wood (θ_e ≈ 70°). A small spill stays a
 * spherical cap. Puddles that touch merge.
 *
 * THE TABLE'S EDGE. The table top ends 12 cm behind the glass (its back edge,
 * where the 3-D view shows the wall beyond). A puddle that spreads to a square
 * edge pins there — Gibbs' inequality, as at the rim of the glass: the contact
 * line cannot pass a 90° edge until the liquid's slope there exceeds θ + 90°,
 * i.e. until the puddle stands h_edge = 2·l_c·sin(α/2) ≈ 3.9 mm thick (the
 * same limit as Capillary.rimOverfill). A puddle at rest is only ~3.1 mm, so it
 * stops at the edge and spreads along it; only a spill fed faster than it can
 * spread piles up past h_edge and runs over, dripping to the floor.
 * Anything that flies past the edge falls to the floor too.
 *
 * FOAM PILES. Foam is a soft solid: surface tension in its films gives it a
 * yield stress τ_y = 0.51·(σ/R)·(φ_g − 0.635)² (Mason, Bibette & Weitz 1996),
 * so a heap of it stands up instead of spreading into a film. A yield-stress
 * heap on a flat table stops where its weight no longer beats τ_y at the base:
 * ρ_f·g·h·dh/dr = −τ_y, i.e. the "perfectly plastic" profile (Nye 1951, the same
 * shape as an ice sheet; Coussot 2005, Rheometry of Pastes, §6)
 *     h(r) = √(2τ_y(r₀ − r)/(ρ_f g)),   V = (8π/15)·h(0)·r₀²
 * Soda foam (τ_y ~ 1–3 Pa) makes low mounds: 50 ml stands ~1 cm tall, ~11 cm
 * across. Wetter foam (φ_g < 0.635) has no yield stress and spreads like liquid.
 * A pile then lives like the head it came from (foam.js): its top bursts at
 * one bubble diameter per bubble lifetime, faster as it dries (Carrier & Colin),
 * and its liquid drains out at the bottom (Darcy, foam permeability) into a
 * Its footprint stays pinned as it shrinks; it just gets lower.
 *
 * WHERE IT HAS BEEN STAYS WET. Liquid that lands, a foam heap's footprint and
 * the ground a puddle has covered all keep a thin film of drink (~50 µm: a
 * wetted, rough varnish holds a film of a few tens of µm; estimate) when the
 * liquid itself moves on. Films and puddles evaporate, ~3·10⁻⁸ m/s at 20 °C
 * in still room air (~1 mm a day; rising ~6 %/K), so a damp patch dries in
 * about half an hour; a sugary drink then leaves a sticky stain, darkest at
 * its rim where the drying film carried the sugar (the coffee-ring effect,
 * Deegan et al. 1997, Nature 389:827). Puddles that touch become one puddle
 * on the bigger one's spot, but the ground both covered stays wet.
 *
 * SODA ON THE TABLE IS STILL SODA. Every puddle and pile carries its dissolved
 * CO2 (n, mol), its temperature and how much of it is drink (s); the
 * simulation fizzes them (Simulation._fizzTable): a 3 mm film has ~20× the
 * surface per volume of a glass, so it goes flat in minutes.
 */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  const RHO_AIR = 1.2, CD_SPHERE = 0.47;
  const DROP_R = 1.5e-3, FOAM_R = 4e-3;
  const THETA_TABLE = 70 * Math.PI / 180;      // water on varnished wood (estimate, 60–80° typical)
  const MAX_DROPS = 600, MAX_PUDDLES = 40, MAX_PILES = 30;
  const PHI_RCP = 0.635, PHI_JAM = 0.36, TAU_WET = 0.08, MAX_RATE = 40;
  const EDGE = { back: -0.12 };                 // the table's back edge, table-frame z [m]
  const RUNOFF_TAU = 0.2;                       // how fast an over-thick edge empties over it [s] (estimate)
  const RHO_AIR_MU = 1.8e-5;                    // air viscosity [Pa·s]
  const FILM_H = 50e-6;                         // film of drink left on wetted varnish [m] (estimate)
  const EVAP = 3e-8;                            // evaporation rate of water at 20 °C, still air [m/s] (~1 mm/day)
  const MAX_MARKS = 90;
  const PILE_BURST = 0.3;                       // foam heaps burst slower than a head: they are wetter, fed from below, and unstirred (estimate)

  /** Area of a disc (centre at distance d inside the edge) that lies on the table. */
  function areaOnTable(r, d) {
    if (d >= r) return Math.PI * r * r;
    if (d <= -r) return 0;
    const beyond = r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
    return Math.PI * r * r - beyond;
  }

  /** Huppert's spreading constant K for dr/dt = K V³ / r⁷. */
  function huppertK(rho, mu) { return Math.pow(0.894, 8) * rho * C.G / (24 * mu); }
  /** Maximum puddle thickness [m]. */
  function puddleHeight(sigma, rho, theta = THETA_TABLE) { return 2 * Math.sqrt(sigma / (rho * C.G)) * Math.sin(theta / 2); }
  /** Radius of a sessile spherical cap of volume V and contact angle θ (gravity negligible). */
  function capRadius(V, theta = THETA_TABLE) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return Math.cbrt(3 * V * s * s * s / (Math.PI * (2 - 3 * c + c * c * c)));
  }
  /** Where spreading stops: a cap when small, a pancake of height h_eq when large. */
  function restRadius(V, sigma, rho) {
    return Math.max(capRadius(V), Math.sqrt(V / (Math.PI * puddleHeight(sigma, rho))));
  }
  /** Footprint radius and peak height of a yield-stress heap of volume V (Nye profile). */
  function heapShape(V, tau, rhoF) {
    const k = Math.sqrt(2 * tau / (rhoF * C.G));             // h = k·√(r₀ − r)
    const r0 = Math.pow(15 * V / (8 * Math.PI * k), 0.4);
    return { r: r0, h: k * Math.sqrt(r0) };
  }

  class Table {
    constructor() { this.clear(); }
    clear() { this.drops = []; this.puddles = []; this.piles = []; this.marks = []; this.landedV = 0; this.returnedV = 0; this.floorV = 0; this.mistV = 0; this.evapV = 0; }
    get filmV() { let v = 0; for (const m of this.marks) v += m.V; return v; }

    /**
     * Wet the table over a disc (x, z, r): it keeps a film of drink there.
     * Returns the film volume this newly wetted (the caller takes it from
     * whatever liquid it has; avail caps it).
     */
    /** Add a given volume of film over a disc (joined to the patch it overlaps). */
    addFilm(x, z, r, s, V) {
      if (!(V > 0)) { this.wetMark(x, z, r, s, 0); return; }
      const got = this.wetMark(x, z, r, s, V);
      if (got < V) {                                              // already wet there: thicken that patch instead
        let m = null, best = Infinity;
        for (const q of this.marks) { const d = Math.hypot(q.x - x, q.z - z); if (d < best) { best = d; m = q; } }
        if (m) { m.V += V - got; m.Vmax = Math.max(m.Vmax, m.V); }
      }
    }

    wetMark(x, z, r, s, avail = Infinity) {
      if (!(r > 1e-3)) return 0;
      // the same patch, or one it mostly covers: grow that one
      let m = null;
      for (const q of this.marks) {
        const d = Math.hypot(q.x - x, q.z - z);
        if (d + r <= q.r * 1.05) return 0;                         // already wet there
        if (d < 0.5 * Math.max(q.r, r)) { m = q; break; }
      }
      const A = Math.PI * r * r;
      if (m) {
        const old = Math.PI * m.r * m.r, add = Math.max(0, A - old);
        const dv = Math.min(avail, add * FILM_H);
        if (r > m.r) { m.x = (m.x * old + x * add) / (old + add); m.z = (m.z * old + z * add) / (old + add); m.r = r; }
        m.V += dv; m.Vmax = Math.max(m.Vmax, m.V); m.s = Math.max(m.s, s); m.bev = m.bev || this.bevNow;
        return dv;
      }
      if (this.marks.length >= MAX_MARKS) {                       // fold the smallest into its nearest neighbour
        let k = 0;
        for (let i = 1; i < this.marks.length; i++) if (this.marks[i].r < this.marks[k].r) k = i;
        const a = this.marks.splice(k, 1)[0];
        let b = this.marks[0], bd = Infinity;
        for (const q of this.marks) { const d = Math.hypot(q.x - a.x, q.z - a.z); if (d < bd) { bd = d; b = q; } }
        b.V += a.V; b.Vmax += a.Vmax; b.stain = Math.max(b.stain || 0, a.stain || 0);
      }
      const dv = Math.min(avail, A * FILM_H);
      this.marks.push({ x, z, r, V: dv, Vmax: Math.max(dv, A * FILM_H), s, bev: this.bevNow || null, stain: 0 });
      return dv;
    }

    get flyingV() { let v = 0; for (const d of this.drops) v += d.V; return v; }
    get puddleV() { let v = 0; for (const p of this.puddles) v += p.V; return v; }
    get pileLiquidV() { let v = 0; for (const p of this.piles) v += p.vl; return v; }
    get pileFoamV() { let v = 0; for (const p of this.piles) v += p.vg + p.vl; return v; }

    /**
     * Throw a parcel. kind 'liquid' | 'foam'; V liquid volume [m³]; vg gas (foam);
     * n CO2 [mol]; s soda fraction (1 drink, 0 water); p, v: [x, y, z] position and
     * velocity; R bubble radius of foam.
     */
    launch(kind, V, vg, n, s, p, v, R = 3e-4, opts = null) {
      if (!(V > 0) && !(vg > 0)) return;
      if (this.drops.length >= MAX_DROPS) {                     // merge into a parcel in flight
        if (opts && opts.spray) return;                          // (spray is the first thing to drop)
        const d = this.drops[(Math.random() * this.drops.length) | 0];
        d.V += V; d.vg += vg; d.n += n; return;
      }
      const d = { kind, V, vg, n, s, R, x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2], age: 0 };
      if (opts) Object.assign(d, opts);                          // rd: drop radius; spray: a burst droplet
      this.drops.push(d);
    }

    /** Liquid straight onto the table at (x, z). */
    deposit(x, z, V, s, n = 0, T = null) {
      if (!(V > 0)) return;
      this.landedV += V;
      let p = null, best = Infinity;
      for (const q of this.puddles) {
        const d = Math.hypot(q.x - x, q.z - z);
        if (d < q.r + 2e-3 && d < best) { best = d; p = q; }
      }
      if (!p) {
        if (this.puddles.length >= MAX_PUDDLES) p = this.puddles.reduce((a, b) => (Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z) ? a : b));
        else { p = { x, z, V: 0, s, r: 0, age: 0, n: 0, T: T || this.Troom || 294, bev: this.bevNow || null }; this.puddles.push(p); }
      }
      const tot = p.V + V;
      p.x = (p.x * p.V + x * V) / tot; p.z = (p.z * p.V + z * V) / tot;
      p.s = (p.s * p.V + s * V) / tot;
      p.T = ((p.T || T || 294) * p.V + (T || p.T || 294) * V) / tot;
      if (!p.bev || (this.bevNow && V > p.V)) p.bev = this.bevNow || p.bev;   // it is whichever drink most of it is
      p.n = (p.n || 0) + Math.max(0, n);
      p.V = tot;
      if (p.r <= 0) p.r = capRadius(Math.max(p.V, 1e-9));
    }

    /** Foam onto the table at (x, z): joins the pile it lands on, or starts one. */
    depositFoam(x, z, vg, vl, R, s, n = 0) {
      if (!(vg > 0)) { this.deposit(x, z, vl, s, n); return; }
      let p = null;
      for (const q of this.piles) if (Math.hypot(q.x - x, q.z - z) < q.r) { p = q; break; }
      if (!p) {
        if (this.piles.length >= MAX_PILES) p = this.piles.reduce((a, b) => (Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z) ? a : b));
        else { p = { x, z, vg: 0, vl: 0, R, s, r: 0, h: 0, age: 0, n: 0, bev: this.bevNow || null }; this.piles.push(p); }
      }
      const V0 = p.vg + p.vl, V1 = vg + vl;
      p.x = (p.x * V0 + x * V1) / (V0 + V1); p.z = (p.z * V0 + z * V1) / (V0 + V1);
      p.R = (p.R * p.vg + R * vg) / (p.vg + vg);
      if (p.vl + vl > 0) p.s = (p.s * p.vl + s * vl) / (p.vl + vl);
      p.vg += vg; p.vl += vl; p.n = (p.n || 0) + Math.max(0, n);
    }

    /** Shape of a pile from its volume and yield stress (footprint pinned once spread). */
    _shape(p, fl) {
      const V = p.vg + p.vl, phi = p.vl / Math.max(V, 1e-15);
      const tau = Fizz.Capillary.foamYieldStress(fl.sigma, p.R, phi);
      const rhoF = Math.max(phi, 0.01) * fl.rho;
      let r, h;
      if (tau > 0.02) ({ r, h } = heapShape(V, tau, rhoF));
      else { r = Math.sqrt(V / (Math.PI * puddleHeight(fl.sigma, fl.rho))); h = V / (Math.PI * r * r); }  // wet: flows like liquid
      p.tau = tau;
      p.r = Math.max(p.r, r);
      // pinned at its widest: a shrinking heap just gets lower (V = 8π/15·h·r²)
      p.h = Math.min(h, 15 * V / (8 * Math.PI * p.r * p.r));
    }

    /**
     * ctx = { fl (spreading liquid), bev (foam constants), catchCup(x, y, z) → true if the
     *         point is inside the cup's mouth (the parcel falls back in), hitsCup(x, y, z) →
     *         true if it is inside the cup's body, fragility(s) }
     * Returns parcels that fell back into the cup.
     */
    step(dt, ctx) {
      const back = [];
      const fl = ctx.fl;
      const keep = [];
      for (const d of this.drops) {
        d.age += dt;
        // air drag on a representative drop / clump, C_d from Schiller–Naumann
        // (tiny spray droplets are Stokes-like and stop within centimetres)
        const r = d.rd || (d.kind === 'foam' ? FOAM_R : DROP_R);
        const rho = d.kind === 'foam' ? fl.rho * U.clamp(d.V / Math.max(d.V + d.vg, 1e-15), 0.03, 1) : fl.rho;
        const m = rho * 4 / 3 * Math.PI * r * r * r;
        const sub = d.rd && d.rd < 2e-4 ? 4 : 1;                 // small drops need finer steps
        for (let k = 0; k < sub; k++) {
          const h = dt / sub, sp = Math.hypot(d.vx, d.vy, d.vz);
          const Re = Math.max(RHO_AIR * sp * 2 * r / RHO_AIR_MU, 1e-6);
          const Cd = Re < 1000 ? 24 / Re * (1 + 0.15 * Math.pow(Re, 0.687)) : CD_SPHERE;
          const kd = 0.5 * RHO_AIR * Cd * Math.PI * r * r / m;
          // implicit in the drag so tiny drops stay stable
          d.vx /= 1 + kd * sp * h; d.vz /= 1 + kd * sp * h;
          d.vy = (d.vy - C.G * h) / (1 + kd * sp * h);
          d.x += d.vx * h; d.y += d.vy * h; d.z += d.vz * h;
        }
        if (d.z < EDGE.back && d.y <= 0) { this.floorV += d.V; continue; }   // past the back edge: to the floor
        if (d.vy < 0 && ctx.catchCup(d.x, d.y, d.z)) { back.push(d); this.returnedV += d.V; continue; }
        // splash shaken out that comes back down onto the open mouth falls back in
        // (foam and drink welling over the brim run down the outside instead)
        if (ctx.catchBottle && d.splash && d.age > 0.02 && ctx.catchBottle(d)) { this.intoBottleV = (this.intoBottleV || 0) + d.V; continue; }
        // lands on the table, a foam pile, or the outside of the glass
        const pile = d.vy < 0 ? this.piles.find(q => { const rr = Math.hypot(d.x - q.x, d.z - q.z); return rr < q.r && d.y <= q.h * Math.sqrt(Math.max(0, 1 - rr / q.r)); }) : null;
        if (d.y <= 0 || pile || ctx.hitsCup(d.x, d.y, d.z) || d.age > 10) {
          if (d.spray && !pile && !this.puddles.some(q => Math.hypot(q.x - d.x, q.z - d.z) < q.r)) {
            this.mistV += d.V;                                     // fizz mist beads on the bare table as a fine dew
            continue;
          }
          if (d.kind === 'foam') { this.depositFoam(d.x, d.z, d.vg, d.V, d.R, d.s, d.n); this.landedV += d.V; }
          else if (pile) { pile.vl += d.V; pile.n = (pile.n || 0) + (d.n || 0); this.landedV += d.V; }   // soaks into the heap
          else if (d.y <= 0) {
            // a drop splashes over ~3× its own size (drop impacts spread to a few
            // diameters before receding; estimate) and leaves that patch wet
            const rs = 1.5 * Math.cbrt(6 * d.V / Math.PI), film = this.wetMark(d.x, d.z, rs, d.s, d.V);
            this.landedV += film;
            if (d.V - film > 1e-12) this.deposit(d.x, d.z, d.V - film, d.s, (d.n || 0) * (1 - film / d.V), ctx.Tdrop);
          }
          else this.deposit(d.x, d.z, d.V, d.s, d.n || 0, ctx.Tdrop);
          continue;
        }
        keep.push(d);
      }
      this.drops = keep;

      // spreading (Huppert), capped at the resting radius; the back edge cuts the
      // wetted area, so a puddle against it spreads further along it
      // each puddle spreads as its own liquid (its drink, how watered down, its temperature)
      const own = (q) => (ctx.fluidOf ? ctx.fluidOf(q) : fl);
      const evap = EVAP * Math.exp(0.06 * ((this.Troom || 293) - 293)) * dt;
      for (const p of this.puddles) {
        p.age += dt;
        const pf = own(p);
        const K = huppertK(pf.rho, pf.mu), hEq = puddleHeight(pf.sigma, pf.rho);
        const hEdge = Fizz.Capillary.rimOverfill(pf, THETA_TABLE * 180 / Math.PI);
        // the ground under a puddle is wet; when it moves on, that stays (film from the puddle)
        if (p.r > (p.markR || 0) * 1.08 || Math.hypot(p.x - (p.markX ?? p.x), p.z - (p.markZ ?? p.z)) > 0.3 * p.r) {
          // the film this puddle leaves is set by its own new footprint alone (so what
          // happens elsewhere on the table cannot change it), then joins the wet marks
          const film = Math.min(0.05 * p.V, Math.max(0, Math.PI * (p.r * p.r - (p.markR || 0) ** 2)) * FILM_H);
          p.V -= film; this.addFilm(p.x, p.z, p.r, p.s, film);
          p.markR = p.r; p.markX = p.x; p.markZ = p.z;
        }
        const dvE = Math.min(p.V, evap * (p.wet || Math.PI * p.r * p.r));
        if (dvE > 0) { p.V -= dvE; this.evapV += dvE; this.landedV -= dvE; }
        const d = p.z - EDGE.back;
        let rRest = restRadius(Math.max(p.V, 1e-12), pf.sigma, pf.rho);
        if (d < rRest) {                                        // solve V = h_eq·A_wet(r) for r
          let lo = rRest, hi = Math.max(1, rRest * 4);
          for (let it = 0; it < 30; it++) { const mid = 0.5 * (lo + hi); if (hEq * areaOnTable(mid, d) < p.V) lo = mid; else hi = mid; }
          rRest = hi;
        }
        if (p.r < rRest) {
          // integrate dr/dt = K V³ / r⁷ exactly over dt: r⁸ grows by 8 K V³ dt
          const r8 = Math.pow(Math.max(p.r, 1e-4), 8) + 8 * K * p.V * p.V * p.V * dt;
          p.r = Math.min(rRest, Math.pow(r8, 1 / 8));
        }
        p.wet = areaOnTable(p.r, d);
        p.h = p.V / Math.max(p.wet, 1e-9);
        p.atEdge = d < p.r;
        // pinned at the edge until it stands thicker than h_edge; then it runs over
        if (p.atEdge && p.h > hEdge) {
          const dV = (p.V - hEdge * p.wet) * (1 - Math.exp(-dt / RUNOFF_TAU));
          if (p.n) p.n -= p.n * dV / p.V;
          p.V -= dV; this.floorV += dV; this.landedV -= dV;
          p.runoff = (p.runoff || 0) * Math.exp(-dt / 0.5) + dV / dt * (dt / 0.5);
        } else if (p.runoff) p.runoff *= Math.exp(-dt / 0.5);
      }
      this._merge(this.puddles, (a, b) => {
        const V = a.V + b.V;
        this.wetMark(a.x, a.z, a.r, a.s, 0); this.wetMark(b.x, b.z, b.r, b.s, 0);
        // the joined puddle sits mostly where the bigger one was (it drains the smaller one)
        const wa = a.V >= b.V ? 0.85 : 0.15;
        a.x = a.x * wa + b.x * (1 - wa); a.z = a.z * wa + b.z * (1 - wa);
        a.s = (a.s * a.V + b.s * b.V) / V;
        a.T = ((a.T || 294) * a.V + (b.T || 294) * b.V) / V;
        if (b.V > a.V - b.V && b.bev) a.bev = b.bev;
        a.n = (a.n || 0) + (b.n || 0); a.salt = (a.salt || 0) + (b.salt || 0);
        a.r = Math.sqrt(a.r * a.r + b.r * b.r);                   // keeps the area of both, spreads on from there
        a.V = V;
      });

      // foam piles: burst at the top, drain at the bottom (as the head does, foam.js)
      const bev = ctx.bev;
      for (const p of this.piles) {
        p.age += dt;
        const V = p.vg + p.vl, phi = p.vl / Math.max(V, 1e-15);
        const area = Math.PI * p.r * p.r;
        // (d) bursting: one bubble diameter per bubble lifetime, faster once dried below φc
        const pb = p.bev || bev, pf = ctx.fluidOf ? ctx.fluidOf(p) : fl;
        const severity = Math.exp(Math.min(3 * (pb.criticalPhi / Math.max(phi, 1e-5) - 1), 20));
        const kBurst = Math.min(MAX_RATE, PILE_BURST * pb.burstRate * severity * (ctx.fragility ? ctx.fragility(p.s) : 1));
        if (p.r > (p.markR || 0) * 1.08) {                          // its footprint stays damp (film set by its own footprint)
          const film = Math.min(0.3 * p.vl, Math.max(0, Math.PI * (p.r * p.r - (p.markR || 0) ** 2)) * FILM_H);
          p.vl -= film; this.addFilm(p.x, p.z, p.r, p.s, film); p.markR = p.r;
        }
        p.vg = Math.max(0, p.vg - kBurst * 2 * p.R * area * 0.5 * dt);   // the mound's top ≈ half its footprint
        // (e) drainage: Darcy through the Plateau borders (rigid/mobile blend) plus excess wet liquid
        const pe = Math.min(phi, PHI_JAM), D2 = 4 * p.R * p.R;
        const perm = (1 - pb.mobility) * 8.0e-4 * D2 * pe * pe + pb.mobility * 6.7e-4 * D2 * Math.pow(pe, 1.5);
        let q = perm * pf.rho * C.G / pf.mu * area * dt;
        const vlJam = p.vg * PHI_JAM / (1 - PHI_JAM);
        if (p.vl > vlJam) q += (p.vl - vlJam) * (1 - Math.exp(-dt / TAU_WET));
        q = Math.min(q, 0.9 * p.vl);
        const keep = this.bevNow; this.bevNow = p.bev || keep;
        if (q > 0) { const dn = (p.n || 0) * q / Math.max(p.vl, 1e-15); p.n -= dn; p.vl -= q; this.deposit(p.x, p.z, q, p.s, dn); this.landedV -= q; }
        if (p.vg < 1e-9) { if (p.vl > 0) { this.deposit(p.x, p.z, p.vl, p.s, p.n || 0); this.landedV -= p.vl; } p.vl = 0; p.n = 0; p.dead = true; this.bevNow = keep; continue; }
        this.bevNow = keep;
        this._shape(p, pf);
      }
      this.piles = this.piles.filter(p => !p.dead);
      // films dry; sugar stays behind as a sticky stain (darkest at the rim)
      for (const m of this.marks) {
        if (m.V > 0) {
          const dv = Math.min(m.V, evap * Math.PI * m.r * m.r);
          m.V -= dv; this.evapV += dv; this.landedV -= dv;
          if (m.V <= 0) m.V = 0;
        }
        const brix = m.bev && m.bev.brix != null ? m.bev.brix : 10;
        m.stain = Math.min(1, m.s * brix / 12) * (1 - m.V / Math.max(m.Vmax, 1e-15));
      }
      this._merge(this.piles, (a, b) => {
        const Va = a.vg + a.vl, Vb = b.vg + b.vl;
        a.x = (a.x * Va + b.x * Vb) / (Va + Vb); a.z = (a.z * Va + b.z * Vb) / (Va + Vb);
        a.R = (a.R * a.vg + b.R * b.vg) / Math.max(a.vg + b.vg, 1e-15);
        a.s = (a.s * a.vl + b.s * b.vl) / Math.max(a.vl + b.vl, 1e-15);
        a.vg += b.vg; a.vl += b.vl; a.n = (a.n || 0) + (b.n || 0);
        a.r = Math.max(a.r, b.r);
        this._shape(a, ctx.fluidOf ? ctx.fluidOf(a) : fl);
      });
      return back;
    }

    /** Merge any two items whose footprints overlap. */
    _merge(list, join) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (Math.hypot(a.x - b.x, a.z - b.z) >= a.r + b.r) continue;
          join(a, b);
          list.splice(j--, 1);
        }
      }
    }
  }

  Fizz.Table = { Table, huppertK, puddleHeight, capRadius, restRadius, heapShape, areaOnTable, THETA_TABLE, EDGE };
})(window.Fizz = window.Fizz || {});
