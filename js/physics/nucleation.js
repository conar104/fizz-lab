/* Fizz Lab — bubble nucleation.
 *
 * Soda is supersaturated: it holds several times more CO2 than Henry's law
 * allows at 1 atm. Yet a clean, smooth container barely fizzes, because
 * creating a brand-new bubble from nothing (classical *homogeneous*
 * nucleation) has an astronomically high energy barrier. Practically every
 * bubble you see is born from a pre-existing gas pocket trapped in a cavity,
 * crack or fibre on some surface ("type IV" non-classical nucleation, Jones et
 * al. 1999; Liger-Belair 2005 for champagne).
 *
 * The chain modelled here, for each surface patch:
 *
 *   supersaturation → critical radius R* → which cavities are active
 *                   → how big a bubble grows before it detaches (R_d)
 *                   → how long that takes (site period) → bubbles per second
 */
(function (Fizz) {
  'use strict';
  const { C } = Fizz;

  const R_REF = 1e-6;          // reference cavity radius for the site density
  const R_MIN = 0.08e-6;       // smallest cavity able to hold a gas pocket
  const SIZE_EXPONENT = 2;     // cavity population N(>r) ∝ r^-m   (boiling literature: m ≈ 2–4)
  const PINCH_RATIO = 5;       // gas pocket necks off at ~5 × its mouth radius
  const WAIT_TIME = 1e-3;      // re-establishment time after each detachment [s]
  const J0 = 1e33;             // homogeneous-nucleation kinetic prefactor [1/(m³·s)]
  const SITE_FLOW_LENGTH = 5e-3; // boundary-layer length scale over a site [m]

  /** S = c / c_eq − 1. Zero means saturated; cola straight from the fridge is ~1.5, warm ≈ 3–4. */
  function supersaturation(c, kH, P) { return c / (kH * P) - 1; }

  /**
   * Critical radius: a gas pocket grows only if its curvature pressure is
   * less than the "dissolved-gas pressure" excess:
   *     c = kH·(P_L + 2σ/R*)   ⇒   R* = 2σ / (c/kH − P_L)
   * P_L = P_atm + ρ g z, so deeper water (more hydrostatic pressure) is harder to nucleate in.
   */
  function criticalRadius(c, kH, PL, sigma) {
    const dP = c / kH - PL;
    return dP > 0 ? 2 * sigma / dP : Infinity;
  }

  /**
   * Bankoff's criterion: a conical cavity of half-angle β traps gas on wetting
   * when the contact angle θ > 2β. With β uniformly distributed on [0°, 90°)
   * the trapping fraction is simply θ / 180°.
   */
  function trappingFraction(thetaDeg) { return Math.min(1, thetaDeg / 180); }

  /** Active sites per m²: cavities larger than R* that hold gas. */
  function activeSiteDensity(surf, Rstar) {
    if (!isFinite(Rstar)) return 0;
    const sizeFactor = Math.pow(R_REF / Math.max(Rstar, R_MIN), SIZE_EXPONENT);
    return surf.sitesPerM2 * trappingFraction(surf.contactAngle) * sizeFactor;
  }

  /**
   * Bubble radius at detachment = the smallest of three release mechanisms:
   *   pinch-off of the pocket neck      R ≈ 5 r_c
   *   buoyancy beats contact-line pin   (4/3)πR³ρg = 2π r_c σ sinθ
   *   flow drag beats contact-line pin  6πμRu      = 2π r_c σ sinθ
   * Flow (pouring, stirring) sheds smaller bubbles more often.
   */
  function detachmentRadius(surf, fl, u, Rstar) {
    const sigma = fl.sigma * surf.sigmaFactor;
    const pin = surf.cavityRadius * sigma * Math.sin(surf.contactAngle * Math.PI / 180);
    const rBuoy = Math.cbrt(1.5 * pin / (fl.rho * C.G));
    const rDrag = u > 1e-6 ? pin / (3 * fl.mu * u) : Infinity;
    const rPinch = PINCH_RATIO * surf.cavityRadius;
    return Math.max(1.5 * Rstar, Math.min(rBuoy, rDrag, rPinch));
  }

  /**
   * Convective mass-transfer coefficient over a site in a flow of speed u
   * (laminar flat plate, Levich):  k = 0.664 (D/L) Re_L^½ Sc^⅓.
   */
  function siteConvectiveK(fl, u) {
    if (u <= 0) return 0;
    const ReL = u * SITE_FLOW_LENGTH / fl.nu;
    return 0.664 * (fl.D / SITE_FLOW_LENGTH) * Math.sqrt(ReL) * Math.cbrt(fl.Sc);
  }

  /**
   * Time for a pocket to grow to R_d. Gas balance on the bubble:
   *     dn/dt = 4πR² k Δc,   n = P·(4/3)πR³ / RT   ⇒   dR/dt = k · a,   a = RTΔc/P
   * with k = D/R (pure diffusion) + k_conv (flow). Integrating exactly:
   *     t = (1/a) · [ R_d/k_c − (D/k_c²)·ln(1 + k_c R_d / D) ]
   * which tends to R_d² / (2 D a) as k_c → 0 (Scriven's diffusive growth).
   */
  function growthTime(Rd, dc, fl, P, kConv) {
    const a = C.R * fl.T * dc / P;
    if (a <= 0) return Infinity;
    const D = fl.D;
    const x = kConv * Rd / D;
    if (x < 1e-4) return Rd * Rd / (2 * D * a);
    return (Rd / kConv - (D / (kConv * kConv)) * Math.log1p(x)) / a;
  }

  /**
   * Classical homogeneous nucleation, reported only to show why it is irrelevant:
   *     J = J0 · exp( −16πσ³ / (3 k_B T ΔP²) )
   * returns log10 J (ΔP ≈ 3 atm gives about 10^(−4,000,000) per m³ per s).
   */
  function homogeneousLog10Rate(sigma, dP, T) {
    if (dP <= 0) return -Infinity;
    const barrier = 16 * Math.PI * sigma ** 3 / (3 * dP * dP);
    return Math.log10(J0) - barrier / (C.KB * T * Math.LN10);
  }

  /**
   * Evaluate a whole surface patch.
   * st = { c, kH, PL, fl, u }   →   per-m² emission and its ingredients.
   */
  function evaluate(surf, st) {
    const { c, kH, PL, fl, u } = st;
    const sigma = fl.sigma * surf.sigmaFactor;
    const Rstar = criticalRadius(c, kH, PL, sigma);
    const density = activeSiteDensity(surf, Rstar);
    if (density <= 0) return { Rstar, density: 0, Rd: 0, freq: 0, rate: 0 };
    const Rd = detachmentRadius(surf, fl, u, Rstar);
    const dc = c - kH * (PL + 2 * sigma / Rd);           // drive felt by the detaching bubble
    const t = growthTime(Rd, dc, fl, PL, siteConvectiveK(fl, u));
    const freq = isFinite(t) ? 1 / (t + WAIT_TIME) : 0;
    return { Rstar, density, Rd, freq, rate: density * freq };
  }

  Fizz.Nucleation = {
    supersaturation, criticalRadius, trappingFraction, activeSiteDensity,
    detachmentRadius, siteConvectiveK, growthTime, homogeneousLog10Rate, evaluate,
    PINCH_RATIO,
  };
})(window.Fizz = window.Fizz || {});
