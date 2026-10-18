# Fizz Lab: evidence audit

This document classifies every formula and constant in the physics code by the evidence behind it. Run `node tests/run-all.js` to reproduce every number quoted here: 110 checks across five suites, all passing.

| Class | Meaning | How it is checked |
|---|---|---|
| **A. Law** | An exact physical relation with no adjustable constants | Implemented as written; conservation tests |
| **B. Published correlation** | An empirical fit from the literature, used inside its stated range | Compared with *independent* reference data in `tests/reference.test.js` |
| **C. Calibrated** | One constant fitted to a measured experiment | Fit and out-of-sample residuals in `tests/validation.test.js` |
| **D. Estimate** | No direct measurement was found; chosen within a plausible physical range | Only the *direction* of its effect is tested (`tests/trends.test.js`) |

---

## A. Laws (no adjustable constants)

| Where | What |
|---|---|
| `bubbles.js` | Ideal gas plus Laplace pressure inside a bubble: `(P_L + 2σ/R)·⁴⁄₃πR³ = nRT` (Newton solve) |
| `bubbles.js`, `nucleation.js` | Hydrostatic pressure `P_L = P_atm + ρgz` |
| `nucleation.js` | Critical radius `R* = 2σ/(c/k_H − P_L)` (Laplace + Henry). Reproduces Liger-Belair's 0.2 µm for champagne to within 3% |
| `nucleation.js` | Diffusive bubble growth `dn/dt = 4πR²k(c − k_H p)` and its closed-form integral for the site period |
| `ice.js` | Every cube a rigid body: gravity, Archimedes buoyancy and quadratic drag; stacking contacts; a heap above the rim tips over once its centre of mass passes the rim edge |
| `ice.js` | Depth lanes and capacity: a cube fits a lane only if the circle's chord at that depth allows it |
| `simulation.js` | Stefan condition: heat reaching a cube first warms it to 0 °C, then melts it (m = q/L_f), with energy conserved (test: drift 0.15 % of the heat moved) |
| `simulation.js` | Refreezing: soda chilled past its freezing point freezes onto the ice, its latent heat holding the soda at the freezing point |
| `simulation.js` | Dilution: meltwater carries no CO₂ and no sugar; the drink's properties are recomputed at the diluted strength |
| `ice.js` | Freezing point by colligative depression, ΔT = i·1.86 K·kg/mol × molality (cola −0.63 °C; champagne −4.4 °C with ethanol; NaCl i = 1.87, so 0.1 mol/kg gives −0.348 °C as measured) |
| `simulation.js` | Ice in a solution melts at the solution's freezing point; a cube warmer than that melts from its own sensible heat (energy conserved, tested) |
| `simulation.js` | Lumped energy balances: wall, soda, ice; latent heat 333.55 kJ/kg; ice c_p 2108 J/kg·K |
| `jet.js`, `simulation.js` | Free fall `v = √(v₀² + 2gh)`, continuity `d = d₀√(v₀/v)`, ballistic arc of the stream |
| `tilt.js` | Geometry of a tilted cup (exact for the 2-D cross-section) |
| `foam.js` | Plateau-border capillary pressure `Pc = σ/r_pb` (shown as a diagnostic) |
| `capillary.js` | Capillary length `√(σ/ρg)`; Laplace–Young wall meniscus `h = l_c√(2(1 − sin θ))` (climbs glass, dips at water-repellent cups) |
| `capillary.js` | Rim pinning (Gibbs' inequality; Oliver, Huh & Mason 1977): liquid stands above a square rim by up to `2 l_c sin(α/2)` ≈ 3.85 mm before spilling |
| `constants.js` | `1 volume CO₂ = P/(R·T₀) = 44.6 mol/m³ = 1.964 g/L` (industry definition 1.96 g/L) |
| tests | Liquid conservation: poured + melted = cup + foam + spilled, to within 1% (all scenarios) |

## B. Published correlations, checked against independent data

| Where | Correlation | Source | Independent check | Error |
|---|---|---|---|---|
| `properties.js` | Water viscosity: Bingham (0–20 °C) / Kestin (20–100 °C) | CRC Handbook | IAPWS 2008, 0–40 °C | ≤ 0.2 % |
| `properties.js` | Water density | Thiesen–Scheel–Diesselhorst | CRC / Kell, 0–40 °C | ≤ 0.01 % |
| `properties.js` | Water surface tension | IAPWS 2014 | IAPWS table | ≤ 0.01 % |
| `properties.js` | CO₂ solubility `ln K₀ = −58.0931 + 90.5069(100/T) + 22.2940 ln(T/100)` | Weiss 1974 | CRC solubility table, 0–40 °C | ≤ 1.3 % |
| `properties.js` | Heat of desorption `ΔH = R(100A₂ − A₃T)` | derived from Weiss | Carroll, Slupsky & Mather 1991 | 0.4 % |
| `properties.js` | CO₂ diffusivity `D = 2.35·10⁻⁶ e^(−2119/T)`, `D·μ^0.8 = const` | Versteeg & van Swaaij 1988 | Jähne et al. 1987, 10–35 °C | ≤ 4.6 % |
| `properties.js` | Sucrose-solution viscosity and density vs °Brix | fitted to the CRC sucrose table | CRC table, 5–15 wt% | ≤ 1.5 % |
| `bubbles.js` | Drag: Stokes / Hadamard–Rybczynski / Schiller–Naumann; Tomiyama deformation cap | Clift et al. 1978; Tomiyama 1998 | Stokes' law (exact limit); Clift data | ≤ 1.6 %; 1 mm and 3 mm bubbles within the published bands |
| `bubbles.js` | Mass transfer: Frössling (rigid), Higbie (mobile), Lamont & Scott (turbulent) | textbook correlations | formula-level | – |
| `nucleation.js` | Levich laminar boundary-layer transfer over a site | Levich 1962 | formula-level | – |
| `nucleation.js` | Gas trapping by contact angle (θ > 2β) | Bankoff 1958 | formula-level | – |
| `nucleation.js` | Classical homogeneous nucleation rate (shown only to prove it is negligible) | Wilt 1986 | log₁₀ J ≈ −7×10⁶ | – |
| `jet.js` | Air entrainment `Q_a/Q = 0.04·Fr^0.28·(h/d₀)^0.4` | Bin 1993 | implemented exactly (then scaled; see C) | 0 % |
| `jet.js` | Largest stable bubble `d_max = 0.725(σ/ρ)^0.6 ε^−0.4` | Hinze 1955 | formula-level | – |
| `simulation.js` | Round-jet plume `u_c = 5.8·u₀d/z`, half-width 0.094 z | Pope 2000 | formula-level | – |
| `simulation.js` | Loss through stream and film surfaces `(A/V)·4√(Dt/π)`; Nusselt film | Higbie 1935; Nusselt 1916 | part of the validation in C | – |
| `foam.js` | Foam permeability: `8.0·10⁻⁴D²φ²` (rigid) and `6.7·10⁻⁴D²φ^{3/2}` (mobile) | Weaire et al.; Koehler et al. 2000 | formula-level (valid φ ≲ 0.07–0.2) | – |
| `foam.js` | Coarsening slowed in wet foam `(1 − √(φ/φ*))²` | Hilgenfeldt, Koehler & Stone 2001 | formula-level | – |
| `foam.js` | Collapse below a critical liquid fraction φc | Carrier & Colin 2003 | concept only; φc values are class D | – |
| `capillary.js` | Foam yield stress `0.51(σ/R)(φ_g − 0.635)²`; a head stands above the rim up to `τ_y/(ρ_f g)` | Mason, Bibette & Weitz 1996; Saint-Jalmes & Durian 1999 | formula-level; gives 2–10 mm domes, as seen on beer and soda | – |
| `ice.js` | Melting: Churchill (1983) sphere natural convection, with the boundary layer's averaged density difference (water densest at 4 °C), blended with Ranz–Marshall forced convection | Churchill 1983; Ranz & Marshall 1952 | flow reversal near 5–6 °C vs Carey & Gebhart's measured 4.7–5.0 °C; melting spheres follow the standard sphere correlations in flowing water | – |
| `ice.js` | Cube drag coefficient 1.05 | Hoerner 1965 | – | – |
| `slosh.js` | First sloshing mode `ω² = (gξ₁/R)tanh(ξ₁h/R)`, planar-surface analogue driven by `tan δ = −a_x/(g + a_y)` | Lamb 1932; Abramson 1966 (NASA SP-106) | simulated ringing period vs theory: 3.49 Hz | 0.0 % |
| `slosh.js` | Viscous damping `0.79√(ν/√(gR³))·[…]` | Mikishev & Dorozhkin 1961 (Ibrahim 2005, eq. 3.12) | formula-level | – |
| `table.js` | Viscous gravity current `r = 0.894(ρgV³/3μ)^{1/8}t^{1/8}` | Huppert 1982, J. Fluid Mech. 121:43 | ODE vs similarity solution; Huppert's silicone-oil experiments | 0.0 % |
| `table.js` | Puddle height `2·l_c·sin(θ/2)`; sessile cap for small spills | de Gennes, Brochard-Wyart & Quéré 2004 | 3.1 mm for water at θ = 70° | – |
| `stream.js` | Jet break-up length `L/d = 19.5[√We(1+3Oh)]^0.85` | Grant & Middleman 1966 | formula-level | – |
| `table.js` | Foam heap on a table: perfectly plastic profile `h² = 2τ_y(r₀ − r)/ρ_f g`, `V = (8π/15)h₀r₀²` | Nye 1951; Coussot 2005 | heap height vs formula; 0.0 % | – |
| `table.js` | A puddle passes a square edge only above `2·l_c·sin(α/2)` | Gibbs; Oliver, Huh & Mason 1977 | pins at 3.1 mm, runs over when dumped at the edge | – |
| `table.js` | Drop drag: Schiller–Naumann `C_d = 24/Re·(1 + 0.15Re^0.687)` | Schiller & Naumann 1933 | formula-level | – |
| `simulation.js` | Overflowing foam as a Bingham film on the outside, at most ~2τ_y/ρ_f g thick; the excess breaks off | Bingham film (capillary.js) | formula-level | – |
| `simulation.js` | Salt dissolution `k·A·ρ_w·(m_sat − m)`, `Sh = 2 + 0.6Re^½Sc^⅓`; NaCl diffusivity 1.61·10⁻⁹ m²/s; solubility 6.10 mol/kg at 0 °C + 0.0028 /K | Ranz & Marshall 1952; CRC Handbook | pinch: ~100 s still, ~4 s stirred; saturates at 6.15 mol/kg (0.0 %) | – |
| `simulation.js` | Salt on ice: brine at the molality whose freezing point is the ice's temperature; latent + dissolution heat from the ice | colligative freezing point (CRC); first law | ice cools −4 → −10 °C | – |
| `ice.js`, `simulation.js` | Bodies in a swinging cup: −(α×r − ω²r) − 2Ω×w | rigid-body mechanics in a rotating frame | slow tip keeps ice; flick throws it | – |
| `capillary.js` | Foam over the rim as a viscous weir `Q = P·ρ_f g δ³/3μ_f` (Bingham above yield) | thin-film/weir flow of a viscous layer | head surges ≤ 1.6 cm above the rim and settles back | – |
| `slosh.js` | Exact solution of the damped oscillator per step (energy non-increasing) | analytic | slosh energy never rises with the glass still | – |
| `stream.js` | Drip size, Tate's law with the Harkins–Brown 0.6 | Tate 1864; Harkins & Brown 1919 | ≈0.07 ml drops | – |
| `simulation.js` | Layer erosion `u_e = E·u`, `E ≈ 0.1/Ri`, E(0) = 0.2 | Turner 1973; Fernando 1991 | formula-level | – |
| `simulation.js` | NaCl dissolution +3.88 kJ/mol; brine density and heat capacity vs salinity | CRC Handbook; Sharqawy et al. 2010 | 6 g in 300 ml: −0.32 °C; 35 g/kg: +26.6 kg/m³, c_p 3993 J/kg·K | ≤ 0.6 % |
| `simulation.js` | Density added by dissolved CO₂, partial molar volume 37 cm³/mol | Garcia 2001 | ≈1 kg/m³ at 3.7 volumes | – |
| `ice.js` | Water conductivity, linear in T | IAPWS 2011 | ±1 % over 0–40 °C | – |
| `bottle.js` | Glug ceiling `(πd²/4)·0.35√(gd)` (Davies–Taylor bubble speed) | Davies & Taylor 1950 | Clanet & Searby's `(π/12)√g·d^{5/2}` | 5 % |
| `bottle.js` | Upturned 500 ml drain time | – | Clanet & Searby's ideal-cylinder scaling | +23 % (a real bottle has a neck and must be tipped) |
| `bottle.js` | Discharge coefficient 0.62 for weir and orifice flow | standard hydraulics | – | – |

## C. Calibrated against measurement

| Constant | Value | Fitted to | Result |
|---|---|---|---|
| `Jet.tuning.cal`, the scale on Bin's coefficient | **0.35** | the 3 vertical pours of Liger-Belair et al. 2010, Table 1 (champagne, 4/12/18 °C) | vertical pours −6.4 %, +2.9 %, −4.2 %; the 3 tilted pours (out of sample) about +30 %, +30 % and −6 %; **18 % RMS** over all six |

The calibration is plausible. Bin's correlation comes from large, fast industrial jets, and bottle streams are thin and slow, so they are expected to entrain less air.

The stream now flies as real parcels and must pass through the mouth. Before, it could land anywhere, even through the rim. In the narrow 5 cm flute this moved two things:
- **Vertical pours:** the pourer keeps the lip over the glass, so the jet lands further in. The plume model is a free round jet, so its axis is kept 0.28·D clear of the wall, where a real jet would attach to the wall instead.
- **Tilted pours:** as the flute is straightened, no arc reaches the low wall below about 15°, and the rest is poured straight in from 1 cm above the rim. That plunge costs CO₂ (+32 % at 4 and 12 °C). Keeping the stream on a wall to the end instead gives about −27 %. The measurement lies between the two, and the paper does not say how the flute was brought upright.

The 18 °C tilted miss shrank from −45 % to −6.5 %.

| `simulation.js` | CO₂ salting-out by NaCl, Sechenov `log₁₀(c₀/c) = K_s·[NaCl]`, K_s ≈ 0.11 L/mol from Weisenberger & Schumpe (1996) ion parameters |

## D. Estimates (no direct data found; only directions are tested)

These are honest guesses within physically sensible ranges. The game's *trends* do not hinge on their exact values, which `tests/trends.test.js` confirms. Precise *magnitudes* involving them should not be trusted to better than a factor of ~2.

| Where | Constant(s) | Basis |
|---|---|---|
| `properties.js` | Sucrose salting-out coefficient k_s = 0.095 L/mol | typical non-electrolyte value; no measured value for CO₂/sucrose was found |
| `properties.js` | Diet-cola surface tension 0.92 × water | Coffey 2008 shows qualitatively that aspartame and benzoate lower σ; the paper's numbers were not accessible |
| `properties.js` | Foam classes: mobility, film thickness, φc, burst and coalescence rates | ordered by known surfactant content (saponins > proteins > caramel > none); magnitudes chosen so heads last tens of seconds (root beer ~100 s, club soda ~0) |
| `properties.js` | Champagne Henry factor 0.72, viscosity 1.6× water, σ 50 mN/m | σ and μ(T) from Liger-Belair 2010; the 0.72 is Agabaliantz's value as quoted in that literature |
| `properties.js` | Cup site densities, cavity radii, air-entrapment depths per material | ordered by hydrophobicity and roughness (Bankoff); magnitudes estimated |
| `properties.js` | Ice: 400 sites/cm², 15 µm cavities, 40 µm frost | estimate |
| `properties.js` | Mentos: 2·10⁵ sites/cm², σ × 0.7 | Coffey 2008 (rough surface, gum arabic), magnitude estimated |
| `nucleation.js` | Cavity size spectrum `N ∝ (1µm/R*)²`; pinch-off at 5·r_c | boiling-literature form; exponent and ratio estimated |
| `foam.js` | Injection liquid fraction 0.20; rupture steepness β = 3; wet drainage time 0.08 s | estimates |
| `foam.js` | Top-film thickness 250 × interior film | order of magnitude from CO₂ (beer) heads collapsing at ≲0.1 mm/s; ×25 made foam vanish in wide vessels |
| `simulation.js` | Ice cascade splash `2 + 1.5·steps`, keeps 60 % of speed | calibrated so more ice gives more foam, the universally observed direction; magnitude estimated |
| `capillary.js` | Effective foam viscosity 0.3 Pa·s for spilled foam creeping down the outside | foam rheology literature gives 0.1–1 Pa·s |
| `ice.js` | Cubes heaped above the rim slump outward at 0.35 g | sets how quickly an over-full heap sheds cubes; estimate |
| `simulation.js` | Ice holds 2.5 % air | upper bound: water holds ~29 ml/L of dissolved air at 0 °C, which freezing expels |
| `simulation.js` | Heat-transfer coefficients: soda–wall 300, soda–ice 450, air 10 W/m²K | typical natural-convection textbook ranges |
| `simulation.js` | Free-surface k_L = 2·10⁻⁵ m/s | typical quiescent water-surface value (1–4·10⁻⁵) |
| `simulation.js` | Stirring ε = 5 W/kg, spoon 0.3 m/s, stroke cavity 1 mm | estimates |
| `slosh.js` | Hand ω = 14 rad/s, ≤ 12 rad/s; contact-line damping ζ = 0.01; foam damping ζ = 0.03 per cm | arm-movement times of 0.2–0.4 s; Keulegan 1959 (small vessels damp more); Sauret et al. 2015 (foam damps strongly) |
| `stream.js`, `simulation.js` | Teapot effect: clinging share `1/(1 + (u/u_c)⁴)`, `u_c = k√(σ(1+cos θ)/ρr)`, r = 1.5 mm; k = 1 at a glass rim, 0.3 under a bottle lip | form after Duez et al. 2010; k = 0.3 chosen so a steady pour leaves the lip cleanly, as seen |
| `simulation.js` | Foam flung off at the rim: `ρ_f u²/(ρ_f u² + τ_y + ρ_f u_c²)`; clumps leave at ~u along the axis, spreading at 0.5·u·r/R | dynamic pressure vs yield stress and adhesion; spread estimated |
| `table.js` | Drop radius 1.5 mm, foam clump 4 mm (for air drag); contact angle on the table 70°; foam on the table collapses in ~20 s | estimates (varnished wood 60–80°) |
| `simulation.js` (table fizz) | Puddle surface mass transfer k_L ≈ 2·10⁻⁵ m/s (doubled by bubbling); varnished wood ≈ 6 sites/cm²; splash loss 15 %; runs keep 80 % of their CO₂; Mentos reach ~2 cm of puddle; puddle warming τ ≈ 5 min | estimates (k_L typical of still water surfaces, 10⁻⁵–10⁻⁴ m/s) |
| `bottle.js` (slosh/shake) | First slosh mode ω₀² = g·k·tanh(kh), k = 1.841/R | Ibrahim 2005, *Liquid Sloshing Dynamics*, ch. 2 (exact for a circular tank) |
| `bottle.js` (slosh/shake) | Damping ζ ≈ 0.03; breaking past 25° faster than 0.15 m/s; trapped air ∝ breaking speed (coefficient 0.02); trapped bubbles 50 µm | estimates |
| `bottle.js` (slosh/shake) | Bubble growth dV/dt = 4πR·D·Δc·RT/P (Sh = 2), with Δc against the gas's CO₂ pressure plus the Laplace pressure 2σ/R; Stokes rise 2ρgR²/9μ | Epstein & Plesset 1950; Stokes |
| `table.js` (wet ground) | Film left on wetted varnish 50 µm; drop splash ~3× drop size; foam heaps burst at 0.3× a head's rate | estimates |
| `table.js` (wet ground) | Evaporation 3·10⁻⁸ m/s at 20 °C, ×e^{0.06(T−20)} | ~1 mm/day in still room air; consistent with diffusion-limited drop evaporation (Hu & Larson 2002) |
| `table.js` (wet ground) | Dried sugar stain darkest at the rim | Deegan et al. 1997, Nature 389:827 (coffee-ring effect) |
| `bottle.js` (shaking out) | Outflow against the effective gravity g − a (tilt φ + slosh, rates × √(g_eff/g)); breaking waves damp (no surface jump), surface tilt ≤ 70°; run-up h = 2·w²/2g (wall run-up of a wave: 2–3), side slams 60 % into the neck, drink velocity lag τ = 0.08 s, exit at √(2g(h − d)) through half the mouth | energy balance (exact); coefficients are estimates |
| `bottle.js` (cap) | Sealed headspace: ideal gas P = nRT/V over headspace + bubbles + foam gas; Henry equilibrium c = k_H·P_CO₂; Boyle expansion of bubbles on opening | ideal-gas law, Henry's law, Boyle's law (exact) |
| `bottle.js` (cap) | Surface transfer k_L ≈ 2·10⁻⁵ m/s (×(1 + 100·slosh speed)); trapped-bubble radius 20 µm; air-limited dissolving τ = 30 s·(R/20 µm)²; foam leaving the mouth at max(0.25 m/s, volume rate / mouth area) | estimates |
| `simulation.js` (rim) | Rim pinning reduced by g/(g + a_swing) while the cup swings | estimate (the meniscus holds against the effective gravity) |
| `properties.js` | Foam burst rates set so a soda head erodes from the top at once and is gone in ~15–20 s (cola 15 /s, tonic and lemon-lime 15, diet 12, citrus 10, champagne 5; root beer 0.8 keeps its head for minutes) | estimates tuned to everyday observation; the champagne validation still passes |
| `simulation.js` | Eddy size ℓ = 5 mm for the layer's Richardson number | bubble wakes and plume edges; estimate |
| `simulation.js` | Spray: jet-drop radius 0.1·R, speed 2.6·(R/1 mm)^−0.6 m/s, one per bare burst; film drops 20 µm at 1 m/s, 0.5 per burst | Blanchard 1963; Spiel 1997; Ghabache & Séon 2016; Lhuissier & Villermaux 2012 (orders of magnitude) |
| `table.js` | Table back edge 12 cm behind the glass; run-off time 0.2 s; drained heaps' top ≈ half their footprint | scene choices; estimates |
| `simulation.js` | Mentos release (random over 70 % of the mouth, ±5 cm/s push); salt scatter σ = 5 mm; drag times 0.3 s / 0.05 s in the drink | estimates |
| `slosh.js` | Flick hand ω = 25 rad/s, ≤ 20 rad/s when the target moves > 3 rad/s; wave breaking above η = min(0.5·h, 0.2·λ) with ζ_b = 1.5(η − η_b)/η_b (≤ 3) | wrist flicks 20–40 rad/s; bores and Stokes' breaking limit (orders of magnitude) |
| `simulation.js` | Mentos density 1.25 g/cm³, disc C_d 1.1, friction 0.35; salt friction 0.5; ice on wet wood μ = 0.3; salt on ice dissolves over ~15 s; restitution 0.4 | estimates |
| `ice.js` | Added mass C_A = 0.8; heave damping ζ = 0.2 (radiation + boundary layers); sway τ = 0.8 s; wet ice on glass μ = 0.1 | box heave-decay tests 0.1–0.3; wet ice 0.02–0.1 (estimates) |
| `foam.js` | Foam fragility × 1/(0.1 + 0.9·s) with the share s of real drink in its liquid | direction certain (films need surfactants); strength estimated |
| `simulation.js` | A pinch of salt = 0.4 g in 24 grains, dissolving with τ = 6 s | typical pinch (1/16 tsp); fine grains dissolve in seconds |
| `render3d.js` | Light absorption in the drink (cola 70 /m), bubble depths | rendering only; no effect on the physics |
| `bubbles.js` | Bubble-swarm drift `0.35·√(gαH)` | dimensional (buoyant-plume) scaling; coefficient estimated |
| `bottle.js` | Glug pulsation shape and period; hand return speed; AUTO controller | estimates; the *mean* glug rate is class B |
| `bottle.js` | 355 ml glass bottle bore 17 mm | derived from the 26.5 mm crown finish; not measured |
| `simulation.js` | "Taste-flat" < 1.5 vol; "bubbling stops" at S < 0.15 | conventions, not physics |

## Known limits

- **Well-mixed liquid:** one CO₂ concentration and one temperature for the bulk soda; no concentration boundary layers around bubbles.
- **Tilt mapping:** 2-D area equivalence stands in for the 3-D cylinder. Ice cubes do slide and can tumble out, but cubes keep their orientation (no rotation).
- **Melting in a still glass:** about 1.9× slower than a measured cube melting in 15 °C water (Wolfram Demonstrations: 7.5 min; model 14 min). The model treats the liquid as well mixed, but in reality cold meltwater sinks and the floating cube keeps sitting in warmer top water. The heat-transfer correlation itself is the standard one.
- **Ice and foam chemistry:** dilution by meltwater changes sugar-derived properties and, through the fragility factor, foam stability (class D strength).
- **Floating ice in salt water:** classroom experiments find a floating cube melts clearly slower in salt water than in fresh: its cold, fresh meltwater cannot sink and stays around it (SERC/Carleton "Melting ice cubes"; MIT BLOSSOMS; Glessmer 2018). The model has the floating fresh layer, but it covers the whole surface evenly, only millimetres deep against a 2.3 cm draft. It also warms from the drink and the glass, so it insulates little: salt's lower melting point and the layer roughly cancel (5.1 vs 5.3 min). An earlier "solutal convection speeds melting" term was removed because it contradicts these observations.
- **Sloshing:** one planar mode, no breaking or swirl; amplitude capped at ~63°.
- **Bubble merging:** bubbles do not coalesce in the liquid, only in the foam.
- **Tilted pours:** they depend on how the glass is brought upright (see C).
- **Bubble rise:** Tomiyama's contaminated-water drag sits at the upper end of the measured band for 3 mm bubbles.
- **Foam magnitudes:** head heights and lifetimes rest on class D foam constants. Their ordering by drink is evidence-based; their seconds and millimetres are not.

## Sources for the measured data used in tests

- Huber et al. 2009 (IAPWS 2008 viscosity); IAPWS 2014 surface tension; CRC Handbook of Chemistry and Physics (water, sucrose and CO₂ solubility tables)
- Weiss 1974, Mar. Chem. 2:203; Carroll, Slupsky & Mather 1991, J. Phys. Chem. Ref. Data 20:1201
- Jähne, Heinz & Dietrich 1987, J. Geophys. Res. 92:10767; Versteeg & van Swaaij 1988, J. Chem. Eng. Data 33:29
- Clift, Grace & Weber 1978, *Bubbles, Drops and Particles*; Tomiyama et al. 1998
- Clanet & Searby 2004, J. Fluid Mech. 510:145; Davies & Taylor 1950, Proc. R. Soc. A 200:375
- Liger-Belair 2005, J. Agric. Food Chem. 53:2788; Liger-Belair et al. 2010, J. Agric. Food Chem. 58:8768 (Table 1)
- Ali et al. 2022, Sci. Inquiry Rev. 6(3) (carbonation levels); UF/IFAS EDIS FS379
- Coffey 2008, Am. J. Phys. 76:551; Kuntzleman et al. 2017, J. Chem. Educ. 94:569
- Churchill 1983 (natural convection, spheres); Ranz & Marshall 1952; Carey & Gebhart 1981, J. Fluid Mech. 107:37; Bendell & Gebhart 1976, Int. J. Heat Mass Transfer 19:1081
- Wolfram Demonstrations, "Ice Cube Melting in Water" (19.5 g cube, 175 mL at 15 °C, 7.5 min)
- de Gennes, Brochard-Wyart & Quéré 2004, *Capillarity and Wetting Phenomena*; Oliver, Huh & Mason 1977, J. Colloid Interface Sci. 59:568
- Mason, Bibette & Weitz 1996, Phys. Rev. Lett. 75:2051; Saint-Jalmes & Durian 1999, J. Rheol. 43:1411
