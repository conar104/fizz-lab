/* Fizz Lab — physical constants. SI units throughout (m, kg, s, K, Pa, mol). */
(function (Fizz) {
  'use strict';

  const R = 8.314462618;                 // universal gas constant          [J/(mol·K)]
  const T0 = 273.15;                     // 0 °C                            [K]
  const P_ATM = 101325;                  // standard atmosphere             [Pa]

  Fizz.C = Object.freeze({
    R,
    T0,
    P_ATM,
    G: 9.80665,                          // gravitational acceleration      [m/s²]
    KB: 1.380649e-23,                    // Boltzmann constant              [J/K]

    // ---- carbon dioxide -------------------------------------------------
    M_CO2: 0.04401,                      // molar mass                      [kg/mol]
    // "Volumes of CO2": the beverage industry's unit. One volume = one litre of
    // gas at 0 °C / 1 atm dissolved per litre of liquid  →  P/(R·T0) mol per m³.
    MOL_PER_VOLUME: P_ATM / (R * T0),    // ≈ 44.6 mol/m³  (≈ 1.96 g/L)
    // Henry solubility, its temperature dependence and CO2 diffusivity are
    // temperature-dependent fits: see properties.js (Weiss 1974; Versteeg 1988).
    X_CO2_AIR: 4.2e-4,                   // CO2 mole fraction of room air (NOAA 2024 ≈ 422 ppm)

    // ---- water & ice ------------------------------------------------------
    CP_WATER: 4184,                      // specific heat                   [J/(kg·K)]
    RHO_ICE: 917,                        //                                 [kg/m³]
    CP_ICE: 2108,                        //                                 [J/(kg·K)]
    L_FUSION: 333.55e3,                  // latent heat of melting          [J/kg]

    // ---- foam ---------------------------------------------------------------
    PHI_JAM: 0.36,                       // random-close-packing liquid fraction: above
                                         // this a "foam" is just bubbly liquid
  });
})(window.Fizz = window.Fizz || {});
