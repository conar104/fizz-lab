/* Fizz Lab — the pour: a plunging liquid jet.
 *
 * The stream leaving the bottle accelerates under gravity, thins out, and
 * punches into the liquid already in the cup. If it arrives fast enough it
 * drags a sheath of air under the surface. Those air bubbles contain no CO2
 * at all, so they strip dissolved gas ferociously as they rise — this is the
 * main reason a fast, high pour makes a huge head.
 */
(function (Fizz) {
  'use strict';
  const { C, U } = Fizz;

  const V_ONSET = 0.9;       // entrainment inception velocity for a smooth jet [m/s]
  const PLUME_SPREAD = 0.2;  // tan(half-angle) of the submerged bubble cone
  // Bin (1993) prefactor is 0.04 for his (mostly large, fast) jets; CAL scales it
  // for thin bottle pours — see the calibration note in the README / tests.
  //   cal = 0.35 is a least-squares fit to the six measured pour losses of
  //   Liger-Belair et al. (2010, Table 1); bottle streams are thin and slow next
  //   to Bin's jets, and entrain about a third as much air.
  const tuning = { binK: 0.04, cal: 0.35 };

  /**
   * p = { Q [m³/s], d0 [m] nozzle, fall [m], tilt [rad], fl, splash multiplier }
   */
  function plungingJet(p) {
    const { Q, d0, fall, tilt, fl, splash } = p;
    const v0 = Q / (Math.PI * d0 * d0 / 4);
    const v = Math.sqrt(v0 * v0 + 2 * C.G * Math.max(fall, 0));   // free fall
    const dj = d0 * Math.sqrt(v0 / v);                             // continuity: Q = v·πd²/4
    // Pouring down a tilted cup's wall: only the wall-normal velocity plunges.
    const vEff = v * Math.cos(tilt);
    const Fr = vEff * vEff / (C.G * dj);                           // jet Froude number
    const onset = Math.max(0, 1 - (V_ONSET / Math.max(vEff, 1e-6)) ** 2);
    // Bin's correlation for plunging-jet air entrainment:
    //   Q_air / Q = 0.04 · Fr^0.28 · (h / d0)^0.4
    const ratio = tuning.binK * tuning.cal * Math.pow(Fr, 0.28) * Math.pow(Math.max(fall, dj) / d0, 0.4) * onset * splash;
    return {
      v0, v, vEff, dj, Fr,
      Re: vEff * dj / fl.nu,
      We: fl.rho * vEff * vEff * dj / fl.sigma,
      ratio,
      Qair: Q * ratio,
      power: 0.5 * fl.rho * Q * vEff * vEff,   // kinetic energy flux delivered [W]
    };
  }

  /**
   * Mean turbulent dissipation ε [W/kg] in the submerged cone the jet stirs up:
   * jet power spread over a cone of length min(depth, 25 d_j). A shallow pool
   * does not concentrate the power into a thin layer — the excess goes into
   * splashing off the floor — so the cone is never shorter than 10 d_j.
   */
  function plumeDissipation(power, dj, depth, rho) {
    const L = U.clamp(depth, 10 * dj, 25 * dj);
    const r0 = dj / 2, r1 = r0 + PLUME_SPREAD * L;
    const vol = Math.PI / (3 * PLUME_SPREAD) * (r1 ** 3 - r0 ** 3);
    return power / (rho * vol);
  }

  /**
   * Hinze (1955): the largest bubble surviving turbulent break-up,
   *     d_max = 0.725 · (σ/ρ)^0.6 · ε^−0.4
   */
  function hinzeMaxRadius(eps, fl) {
    const d = 0.725 * Math.pow(fl.sigma / fl.rho, 0.6) * Math.pow(Math.max(eps, 1e-3), -0.4);
    return U.clamp(d / 2, 1e-4, 3e-3);
  }

  Fizz.Jet = { plungingJet, plumeDissipation, hinzeMaxRadius, V_ONSET, tuning };
})(window.Fizz = window.Fizz || {});
