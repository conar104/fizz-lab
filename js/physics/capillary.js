/* Fizz Lab — surface tension at the glass: menisci, rim pinning, foam yield.
 *
 * Over millimetres surface tension beats gravity, and that is exactly the
 * scale of the rim. The length that separates the two regimes is the
 * capillary length  l_c = √(σ / ρg)  (≈ 2.7 mm for water).
 *
 *   wall meniscus  liquid climbs a wettable wall (glass) and dips at a
 *                  water-repellent one (paper, foam cups). Laplace–Young for a
 *                  vertical wall:  h = l_c·√(2(1 − sin θ)),  rising if θ < 90°.
 *   rim pinning    at a sharp rim the contact line pins: the surface may turn
 *                  through the rim's edge angle before the liquid advances over
 *                  it (Gibbs' inequality; Oliver, Huh & Mason 1977). So a glass
 *                  can be filled ABOVE its rim, by up to the height of a 2-D
 *                  meniscus whose slope reaches α at the edge:
 *                      h = 2·l_c·sin(α/2),  α = min(90°, θ + (180° − φ_edge))
 *                  ≈ √2·l_c ≈ 3.8 mm for water on a square-edged glass.
 *   foam yield     a foam is a soft solid: it only flows once stressed past
 *                  its yield stress (Mason, Bibette & Weitz 1996; Saint-Jalmes
 *                  & Durian 1999):
 *                      τ_y = 0.51·(σ/R)·(φ_g − 0.635)²,  φ_g = gas fraction
 *                  so a head can stand as a dome above the rim, up to the height
 *                  at which its own weight shears it:  h = τ_y / (ρ_foam·g).
 *                  Past that it creeps over the rim and slides down the outside.
 */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  const RIM_EDGE_ANGLE = 90;      // a square-cut rim [deg]
  const PHI_RCP = 0.635;          // random close packing of bubbles (gas fraction where yield vanishes)
  const FOAM_MU = 0.3;            // effective viscosity of soda foam flowing [Pa·s] (foam rheology: 0.1–1; estimate)

  function capillaryLength(fl) { return Math.sqrt(fl.sigma / (fl.rho * C.G)); }

  /** Height the liquid climbs (+) or dips (−) at a vertical wall of contact angle θ [deg]. */
  function wallMeniscus(fl, thetaDeg) {
    const th = thetaDeg * Math.PI / 180;
    const h = capillaryLength(fl) * Math.sqrt(2 * (1 - Math.sin(th)));
    return thetaDeg < 90 ? h : -h;
  }

  /** How far above the rim the liquid can stand before it spills [m]. */
  function rimOverfill(fl, thetaDeg, edgeDeg = RIM_EDGE_ANGLE) {
    const alpha = Math.min(90, thetaDeg + (180 - edgeDeg)) * Math.PI / 180;
    return 2 * capillaryLength(fl) * Math.sin(alpha / 2);
  }

  /** Foam yield stress [Pa] for bubble radius R and liquid fraction φ. */
  function foamYieldStress(sigma, R, phiLiquid) {
    const phiGas = 1 - phiLiquid;
    if (phiGas <= PHI_RCP || R <= 0) return 0;
    return 0.51 * (sigma / R) * (phiGas - PHI_RCP) ** 2;
  }

  /** Height a foam can stand unsupported (a dome above the rim) [m]. */
  function foamStandHeight(sigma, R, phiLiquid, rhoL) {
    const tau = foamYieldStress(sigma, R, phiLiquid);
    const rhoFoam = Math.max(phiLiquid, 0.01) * rhoL;
    return tau / (rhoFoam * C.G);
  }

  /**
   * Speed of foam sliding down the outside of the glass: a Bingham film of
   * thickness δ slides only where its weight exceeds the yield stress,
   *     u = (ρ_f g δ − τ_y)·δ / (3 μ_f)
   * with an effective foam viscosity μ_f ~ 0.1–1 Pa·s (foam rheology
   * literature; 0.3 Pa·s used here — an estimate). Liquid films (no yield)
   * run off at the Nusselt speed ρgδ²/(3μ).
   */
  function overflowSpeed(fl, foam, delta) {
    if (!foam) return fl.rho * C.G * delta * delta / (3 * fl.mu);
    const rhoF = Math.max(foam.phi, 0.01) * fl.rho;
    const tau = foamYieldStress(fl.sigma, foam.R, foam.phi);
    return Math.max(0, (rhoF * C.G * delta - tau) * delta / (3 * FOAM_MU));
  }

  /**
   * How fast a head can flow over the rim [m³/s]. The part of the head above
   * the dome its yield stress can hold up, δ = height above that dome, flows
   * outward over the edge like a viscous layer of that thickness (a viscous
   * weir; Bingham above yield):
   *     Q = P · ρ_f g δ³ / (3 μ_f)          P = the length of rim it goes over
   * Steep in δ: 2 mm → a few ml/s, 1 cm → ~0.5 L/s round a 7.5 cm rim. So a
   * surging head piles up above the rim until its outflow matches what the
   * bubbles produce, and settles back to about the rim when they slow. Wet
   * froth (gas fraction below 0.635: a bubbly liquid, no yield stress) runs over
   * with the drink's own viscosity, i.e. almost at once.
   */
  function foamOverflowRate(fl, foam, delta, perimeter) {
    if (delta <= 0) return 0;
    const wet = 1 - foam.phi <= PHI_RCP;
    const rhoF = Math.max(foam.phi, 0.01) * fl.rho;
    return perimeter * rhoF * C.G * delta * delta * delta / (3 * (wet ? fl.mu : FOAM_MU));
  }

  Fizz.Capillary = { capillaryLength, wallMeniscus, rimOverfill, foamYieldStress, foamStandHeight, overflowSpeed, foamOverflowRate, PHI_RCP, FOAM_MU };
})(window.Fizz = window.Fizz || {});
