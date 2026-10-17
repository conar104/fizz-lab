# Fizz Lab

An 8-bit simulator of pouring a carbonated drink into a cup, where the graphics are simple and the foam physics is not.

**Run it:** open `index.html` in a browser. If your browser blocks scripts on `file://` pages, run `node tools/serve.js` and visit <http://localhost:5173>.

**Play:** hold **SPACE** (or HOLD) to tip the bottle; let go and it rights itself. Drag the glass sideways (or use **← →**) to tilt it. **AUTO** and **STIR** are toggles: click once to start, again to stop. Keys: **A** auto-pour, **I** drop an ice cube in, **M** Mentos, **S** stir, **R** reset, **P** pause, **H** show/hide the HUD. The **LAB** tab has one-click experiments, **GAME** has the five-round *Perfect Pour* challenge and achievements, and **MODEL** lists every equation. Hover any control or readout to see the formula behind it.

## Drinks and their carbonation

Picking a drink loads its typical fill carbonation; the slider can override it. Each drink's bulk physics comes from its sugar content (°Brix): viscosity, density, heat capacity and how much the sugar lowers CO₂ solubility. Its foam behaviour comes from what it contains that coats the bubbles.

| Drink | Example | CO₂ (vol) | °Brix | Foam chemistry | Source for CO₂ |
|---|---|---|---|---|---|
| Cola | Coca-Cola | 3.8 | 10.4 | caramel colour | measured, Ali et al. 2022 |
| Sweet cola | Pepsi | 3.6 | 11.4 | caramel colour | measured, Ali et al. 2022 |
| Diet cola | Diet Coke | 3.7 | ~0 | aspartame + benzoate | estimate: assumed same as sugared colas (3.5–4.0 standard) |
| Pepper soda | Dr Pepper | 3.5 | ~11 | caramel colour | industry guide range 3.4–3.6 |
| Lemon-lime | Sprite / 7-Up | 3.8 | 10.0 | little surfactant | measured, Ali et al. 2022 (7-Up 3.7) |
| Citrus soda | Mountain Dew | 3.2 | 11.9 | flavour-oil emulsion | measured, Ali et al. 2022 |
| Orange soda | Fanta | 1.8 | 13.0 | little surfactant | measured, Ali et al. 2022 (Mirinda also 1.8) |
| Root beer | A&W | 3.7 | ~11.5 | saponin foaming agent | industry range 3.5–4.0 |
| Ginger ale | Canada Dry | 3.3 | ~9 | little surfactant | industry range 3.2–3.5 |
| Tonic water | Schweppes | 3.2 | ~8.5 | quinine | UF/IFAS standard 3.0–3.5 |
| Club soda | soda water | 3.0 | 0 | none | UF/IFAS standard 2.5–3.5 |

Brix values marked "~" are typical label sugar contents rather than measurements. The measured Ali et al. values come from bottles bought in Pakistan, and regional formulations differ: Fanta's 1.8 vol in particular is lower than many markets.

## Variables you can change

| Group | Variable | What it changes in the physics |
|---|---|---|
| Beverage | drink type | viscosity, surface tension, sugar salting-out of CO₂, foam stability (critical liquid fraction φc, film thickness, interface mobility) |
| | carbonation (volumes) | dissolved CO₂, so supersaturation, critical radius, active sites, growth rates |
| | soda temperature | Henry constant (Weiss 1974), viscosity, diffusivity, surface tension |
| Cup | material | nucleation-site density, contact angle, air trapped on wetting, conductivity, heat capacity, wall thickness |
| | diameter / height | wetted area, free-surface area (foam height = volume / area), hydrostatic depth, headroom |
| | cup temperature | heat flow into or out of the soda through the wall |
| | rinsed | floods cavities (fewer sites) and stops air being trapped at the wetting front |
| Ice | count / edge / temperature | nucleation area, frost air, chilling, melting and dilution, displacement, buoyancy, a splashing stream |
| Pour | amount, rate, height, tilt | jet speed and diameter, air entrainment, plume turbulence, bubble size, foam erosion |
| Room | temperature, pressure (altitude) | heat loss and gain; the equilibrium CO₂ level |
| Actions | drop ice, Mentos, salt, stir | live additions: extra surfaces, trapped air, turbulence |

## The model

Everything is in SI units. Each sub-model lives in its own file under `js/physics/`.

### Gas chemistry (`properties.js`, `nucleation.js`)
- **Henry's law:** `c_eq = K₀(T)·P` with the Weiss (1974) solubility fit, within 1.3% of the CRC table from 0–40 °C. Sugar is assumed to lower solubility by about 7% at 11 °Bx (Sechenov salting-out); this coefficient is an estimate, as no measured value for CO₂ in sucrose was found.
- **Water properties:** CRC viscosity fits (Bingham below 20 °C, Kestin above), Thiesen density and IAPWS surface tension, all within 0.3% of IAPWS. CO₂ diffusivity follows Versteeg & van Swaaij (1988), with `D·μ^0.8 = const` for sugar solutions.
- **Sugar solutions:** viscosity and density fitted to the CRC sucrose tables (within 1.5%).
- **Supersaturation:** `S = c/c_eq − 1`.
- **Critical radius:** `R* = 2σ / (c/k_H − P_atm − ρgz)`. A gas pocket grows only if it is wider than R*.
- **Homogeneous nucleation:** `J = J₀·exp(−16πσ³ / 3k_BTΔP²)`. The readout shows this is around 10^(−10⁸), which is why every bubble starts on a surface.

### Heterogeneous nucleation (`nucleation.js`)
- **Active sites:** `N_a = N₀ · (θ/180°) · (1 µm/R*)²`. Cavity sizes follow a power law, and the Bankoff criterion sets which cavities trap gas, depending on the contact angle θ.
- **Detachment radius:** the smallest of three limits:
  - pocket pinch-off at about 5·r_c
  - buoyancy beating contact-line pinning: `∛(1.5 r_c σ sinθ/ρg)`
  - flow drag beating pinning: `r_c σ sinθ / 3μu`
- **Site period:** the exact integral of `dR/dt = (D/R + k_c)·RTΔc/P`, where `k_c` is the Levich laminar boundary-layer coefficient.
- **Wetting-front entrapment:** when soda first wets a dry rough surface, it traps `V = A_new · δ` of air as seed bubbles. Frosty ice, styrofoam and Mentos trap a lot; a rinsed cup traps none.

### Bubbles (`bubbles.js`)
- Each Lagrangian particle stands for `w` identical bubbles and tracks moles of CO₂ and of air separately.
- **Radius:** a Newton solve of `(P_L + 2σ/R)·⁴⁄₃πR³ = nRT`, including hydrostatic and Laplace pressure.
- **Drag:** Schiller–Naumann, blended between the rigid (Stokes) and mobile (Hadamard) limits by the drink's surfactant level, with the Tomiyama deformed-bubble cap.
- **Mass transfer:**
  - rigid surface: Frössling, `Sh = 2 + 0.6Re^½Sc^⅓`
  - clean surface: Higbie, `Sh = 2 + 1.13(ReSc)^½`
  - turbulence: Lamont–Scott, `k = 0.4(εν)^¼Sc^−½`
- **Bubble-swarm drift:** `u = 0.35√(gαH)`. Dense bubble clouds drive a buoyant upwelling; this is what turns a Mentos into an eruption.

### The pour (`jet.js`)
- **Free fall and necking:** `v = √(v₀² + 2gh)`, `d = d₀√(v₀/v)`. On a tilted cup only `v·cos θ` plunges.
- **Air entrainment (Bin 1993):** `Q_a/Q = 0.04·Fr^0.28·(h/d₀)^0.4`, with a 0.9 m/s onset speed and splash factors for an empty cup, ice, or a wall film.
- **Plume:** a self-similar round jet, `u_c = 5.8·v·d/z` with half-width 0.094·z (Pope, *Turbulent Flows*), and stagnation at the floor. Turbulent dissipation ε comes from the jet power.
- **Loss in transit:** CO₂ also diffuses out through the surface of the falling stream and of the film running down a tilted glass. This uses Higbie penetration theory, `(area/volume)·4√(D·t/π)`, with a Nusselt film whose turbulence is set by its own dissipation, `ε = g·sinβ·ū`.
- **Calibration:** Bin's entrainment coefficient is scaled by 0.35, a least-squares fit to Liger-Belair et al. (2010). Bottle streams are thin and slow compared with Bin's jets. With that one constant fitted, the model reproduces all six measured pour losses with 21% RMS error.
- **Largest surviving bubble (Hinze):** `d_max = 0.725(σ/ρ)^0.6·ε^−0.4`.

### Foam (`foam.js`)
The head is a stack of layers. Each layer has its own gas, liquid, bubble count and dissolved CO₂, and these processes act on it:
- **Degassing:** liquid in the foam keeps releasing CO₂ into its bubbles, with time scale `τ = r_pb²/4D`.
- **Coarsening (Ostwald ripening):** `d⟨R²⟩/dt = 4σD·He/(P·h)·(1 − √(φ/φ*))²`.
- **Film rupture (Carrier & Colin 2003):** a draining foam collapses once its liquid fraction drops below a critical φc, largely regardless of bubble size. Coalescence and top-layer bursting scale as `exp[3(φc/φ − 1)]`. Fine foams last because they drain slowly (permeability ∝ R²). Capillary pressure `Pc = σ / (R√(φ/0.33))` is shown as a diagnostic.
- **Drainage (Darcy flow through Plateau borders):** `q = k·ρg/μ`, using the measured foam permeabilities `k = 8.0·10⁻⁴D²φ²` for rigid films (Weaire et al.) and `6.7·10⁻⁴D²φ^{3/2}` for mobile films (Koehler et al.), blended by how mobile each drink's films are. Liquid above φ* = 0.36 runs out quickly.
- **Erosion:** the jet breaks films on its way through the head.
- **Overflow:** anything above the rim spills onto the table.

### Stirring and live additions (`simulation.js`)
- **Stirring** adds turbulence (ε ≈ 5 W/kg), which speeds CO₂ transfer into bubbles and scrubs bubbles off the walls sooner. It also adds two physical sources of new bubbles:
  - the spoon itself is a steel surface moving at about 0.3 m/s, so its sites shed small bubbles quickly, and its first dip traps air like any dry surface;
  - each stroke opens a small air cavity at the surface that collapses into bubbles: `Q_air ≈ ½ · width · speed · 1 mm`.
  Ten seconds of stirring removes about 17% of the dissolved CO₂ and raises a short froth.
- **Pouring onto ice** is mostly a splashing effect, not a nucleation one. The stream doesn't stop at the top of the pile: it keeps falling through the gaps to the liquid and shatters into sheets at every cube, each one a fresh plunge. So the jet's energy comes from the full drop, and air entrainment is multiplied by `2 + 1.5 × (number of cube-heights it tumbles through)` (a calibrated factor). The tumbling liquid keeps about 60% of its speed and carries its bubbles down the gaps, where they spend longer soaking up CO₂. The pile also squeezes the foam into the space between cubes, so the same foam stands taller.
- **Ice is full of air:** freezing pushes out the ~29 ml/L of air dissolved in water as tiny trapped bubbles (about 2.5% of the ice's volume). Melting releases them as seed bubbles.
- **Cooling still matters, but less:** ice chills the soda by a few °C, raising CO₂ solubility by about 10%. Against the splash, it's a minor brake. Net result: more ice, more foam.
- **Dropping a cube in** adds cold mass, drags an air cavity under (about 0.3 × the cube's volume), and exposes fresh frosty surface that traps air as it wets.

### The bottle (`bottle.js`)
You don't set the flow rate directly. It comes out of the bottle's physics:
- **Geometry:** the bottle is a body, a conical shoulder and a neck. Choose a 500 ml PET bottle, a 2 L PET bottle or a 355 ml glass bottle. For an angle φ (0° upright, 180° upside-down), the liquid surface is the horizontal plane that holds the remaining volume, found by slicing the bottle along its axis. Its height above the lowest point of the lip is the **head**.
- **Smooth regime:** while part of the mouth is above the liquid, soda leaves through the lower part like a weir, `Q = C_d ∫ b(z)√(2g(e − z)) dz`, and air comes in through the upper part as an orifice flow. The trapped air is pulled below atmospheric pressure until the two balance: `Q_liquid(head − ΔP/ρg) = Q_air(ΔP)`.
- **Glug regime:** once the neck floods, air can only get in as bubbles rising up the neck at the Davies–Taylor speed `0.35·√(g·d)`. That caps the flow at `(πd²/4)·0.35·√(g·d)`, about 60 ml/s for a standard 21.7 mm PET neck. This is within 5% of Clanet & Searby's (2004) measured average for upturned bottles, `(π/12)·√g·d^{5/2}`. The air arrives in pulses, so the stream glugs.
- **Your hand:** HOLD tips the bottle at the *tilt speed*, and letting go rights it at 150°/s, so the stream tails off and slightly overshoots. AUTO tips until the flow reaches its target, then holds it there, tipping further as the bottle empties. Tip slowly and the mouth keeps an air path, giving a smooth pour of 20–70 ml/s. Flip the bottle and the neck floods, so it glugs at about 60 ml/s on average. A 500 ml bottle empties in about 13 s upside-down.
- **Drawn to scale:** the bottle is drawn from the same profile the flow model uses, at true size next to the glass (a 500 ml bottle is 20 cm long, a 2 L is 29 cm). The camera zooms out far enough to fit the bottle whether it is lying flat or upside-down, and the soda inside fills to the computed level surface.
- **The stream** leaves the lip along the bottle axis at the exit speed (flow ÷ wetted mouth area) and follows a ballistic arc. The hand slides the bottle so the arc lands on target. Its width follows continuity, so glugging visibly pulses.

### Tilting the glass (`tilt.js`)
- The physics tracks liquid as an *equivalent upright level* z. In a glass tilted by θ the same liquid has a horizontal surface at world height h, found from the cross-section area: `D·z = area of the rotated cup below h`. This is exact in 2-D and a close approximation for the 3-D cylinder.
- **Spilling:** overflow happens at the lower rim, at `rimLevel = A_below(h_lowRim)/D`. A 7.5 × 12 cm glass holds 530 ml upright but only 364 ml at 45°, which is why bartenders straighten the glass as it fills.
- **Surface:** the free surface widens by about 1/cos θ, which speeds CO₂ loss from the surface and heat exchange with the air.
- **The stream** lands on the inner face of the low wall and slides down as a film, so only `v·cos θ` plunges.
- The renderer draws the cup in its own rotated frame and classifies every interior pixel by its world height, so the upright cup is just θ = 0.

### Ice as physical cubes (`ice.js`)
- **Every cube is a rigid body.** Each falls, floats (Archimedes buoyancy), feels drag (C_d = 1.05) and stacks on the others. Cubes are perfect cubes, so their face areas are exact.
- **Tilt and overflow:** tilting the glass slides the pile to the low wall. Cubes heaped above the rim tip over once their centre passes the rim edge and land on the table, where they keep melting into a puddle.
- **Capacity from geometry:** cubes sit in depth lanes, and a lane fits as many cubes as the circle's chord at that depth allows. A 7.5 cm glass takes 4 × 2.5 cm cubes per layer.
- **Heat, cube by cube:** each cube exchanges heat with the soda through its wetted faces and with the room through its dry ones. The heat first warms it to 0 °C and then melts it (`m = q/L_f`); energy is conserved.
- **Melting coefficient:** Churchill's sphere correlation, driven by the boundary layer's averaged density difference. Water is densest at 4 °C, so the flow reverses near 5 °C, as measured by Carey & Gebhart. This is blended with forced convection while pouring or stirring.
- **Refreezing:** freezer-cold cubes can freeze soda onto themselves; the latent heat released holds the drink at its freezing point (−0.63 °C for cola).
- **Dilution:** meltwater dilutes CO₂ and sugar, thinning the syrup.

### Surface tension at the glass (`capillary.js`)
- **Wall meniscus:** soda climbs a glass wall by `l_c√(2(1 − sin θ))`, about 2.9 mm, and dips at water-repellent paper or foam cups.
- **Rim pinning:** a glass can be filled above its rim, up to ≈3.85 mm (`√2·l_c`), before it spills. This is Gibbs' pinning at the edge.
- **Foam dome:** foam is a soft solid with yield stress `0.51(σ/R)(φ_g − 0.635)²` (Mason et al.). A head domes above the rim until its weight beats that, then creeps over the low rim and slides down the outside slowly. Spilled liquid streams down fast.
- **Splash droplets:** they obey real gravity and are caught by the glass and the drink.

### Heat and ice (`simulation.js`)
- **Lumped temperatures** for the soda, the cup wall (with `U = 1/(1/h + t/2k)` on each face) and the ice.
- **Ice melts cube by cube:** each cube takes heat through its wetted faces (Churchill natural convection mixed with Ranz–Marshall forced convection from the pour or the spoon) and its dry faces (room air). The heat first warms it to the melting point, then melts it: `m = q/L_f`, 334 kJ/kg. Meltwater joins the drink at that temperature, dilutes the CO₂, sugar and salt, and releases the air frozen into the ice. Melting is physically slow: six cubes in 4 °C cola melt about 13 g in 5 minutes and 50 g in 30, so use the 64× speed to watch it. The HUD shows the melt rate in g/min.
- **The melting point is the drink's freezing point:** ice touching a solution melts at `T_f = 0 °C − i·K_f·m` (K_f = 1.86 K·kg/mol). Sugar (i = 1), ethanol and dissolved salt (NaCl, i ≈ 1.87, so 0.1 mol/kg freezes at −0.35 °C as measured) all lower it. A colder melting point widens the gap to the drink, so ice melts faster, and a 0 °C cube dropped into salty soda melts using its own sensible heat.
- **Salt:** each pinch is about 0.4 g of 0.5 mm grains (tracked as 24 clusters of ~120). Their faces nucleate bubbles while they last. They dissolve by measured mass transfer, `dN/dt = k·A·ρ_w·(m_sat − m)` with `k = Sh·D/2r` and `Sh = 2 + 0.6Re^½Sc^⅓` (Ranz–Marshall; D = 1.61·10⁻⁹ m²/s, CRC):
  - on the bottom of a still glass a pinch takes about 2 minutes; stirred, about 4 s;
  - dissolving slows to a stop at saturation (NaCl solubility ≈ 6.1 mol/kg, 35.7 g per 100 g water, CRC), leaving the excess as crystals;
  - salt landing in the floating meltwater dissolves into that layer and lowers its freezing point;
  - salt resting on an ice cube above the drink melts it into brine as cold as the cube (the brine's freezing point equals the ice's temperature). The heat comes out of the cube, which gets colder (−4 → −10 °C in 30 s with 2 g), and the brine runs into the drink, as salt melts ice on a road. Dissolved NaCl salts out CO₂ by Sechenov's law, `k_H × 10^(−0.11·[NaCl])` (Weisenberger & Schumpe 1996). One pinch lowers the freezing point by only 0.09 °C; 6 g lowers it by 1.3 °C and speeds melting by about 23%.
- **Salt and heat:** dissolving NaCl is itself endothermic (+3.88 kJ/mol): 6 g chills 300 ml by 0.32 °C before any ice melts. Brine is denser (+0.76 kg/m³ per g/kg) and holds less heat (−1.29 % c_p per %), from seawater data (Sharqawy et al. 2010). Melting ice draws its latent heat from the drink, and with salt the drink can be pulled below 0 °C toward the solution's freezing point.
- **The meltwater layer:** fresh meltwater is lighter than sugary or salty soda (and than water at 4 °C), so it floats on the drink as its own layer (`sim.water`): cold, flat, with no CO₂ and no surfactants. It is a lid on the fizz. The surface no longer degasses, bubbles rising through it give up CO₂, and the wall it touches stays quiet. Ice faces inside it melt at 0 °C with only the layer's small temperature difference to drive them, and foam made from its water collapses faster. Turbulence from the pour, the spoon and rising bubbles erodes the layer back into the drink at `u_e = 0.1·u/Ri` (Turner 1973), with Ri = g′ℓ/u² and ℓ ≈ 5 mm eddies. So a still glass of regular cola grows a few millimetres of water on top; diet cola, at nearly water's density, mixes it straight in, and so does a pour.
- **Dilution and foam:** foam whose liquid is part meltwater is less stable: rupture rates × 1/(0.1 + 0.9·s), where s is the share of real drink. This applies to meltwater stirred into the drink as well as to the floating layer.
- **Fizz cooling:** releasing CO₂ absorbs about 20 kJ/mol.
- **Ice geometry:** the cubes pack in layers. The pack rests on the floor until Archimedes buoyancy exceeds its weight, then floats with draft `m/(ρA)`.

### Play and lab
- **PLAY** (the default) is the game: Perfect Pour, five random drinks, glasses and ice. Fill each to the green line with a 3–15 mm head, then SERVE; there are points for accuracy, speed and the head, and spills cost you. Its compact HUD shows the round and score, a little glass with the liquid and head against the target line, the head against its scoring band, the time, and spill warnings. Challenge messages appear above it. The side panel has the challenge, how to pour, and "Your pour" (AUTO rate, lip height, glass tilt).
- **LAB** is the physics lab: every setup control, the experiments, the model, the charts, the readouts and the detailed HUD. Your choice is remembered.
- **Pour by hand:** grab the bottle by its **neck** to move it, or by its **body** to tip it about the lip. You set the angle; the bottle physics sets the flow, from a trickle to the glug limit, and the stream lands wherever its arc takes it. You can scroll over the bottle to tip it too. Let go and the hand rights it where it is: it stays there (so you can move it, then grab the body to tip it) until HOLD / SPACE or AUTO takes it over, or RESET puts it back. HOLD and AUTO work as before.
- The painted window behind the HUD is hidden while a HUD is showing.

### The controls
- **Buttons:**
  - GLASS group: UPRIGHT, CLEAN TABLE (wipes puddles, foam and spilled ice but leaves the glass), RESET (empty glass, clean table, full bottle), and DEFAULTS (every setting back to the start).
  - Quick bar on the screen: reset, upright, clean, stop, and **?** for the shortcut card.
- **Keys:** U upright, C clean, R reset, Esc stop pouring and stirring, `[` `]` slower/faster, ? for help. Double-click the glass to stand it up.
- **Memory:** your setup is remembered between visits, in this browser only.
- **Shadow:** the glass casts its outline straight down onto the table (both end circles joined by a band), darkest where it touches the table.

### Motion and spills (`slosh.js`, `stream.js`, `table.js`)
- **Mentos and salt are bodies like the ice:** in the glass they feel gravity, the swing of the cup (centrifugal, its starts and stops, Coriolis), buoyancy and drag against the drink (Schiller–Naumann for grains, a disc's C_d ≈ 1.1 for a Mentos), plus the stirred drink's swirl. They bounce off the wall, slide to a stop on the floor, and rest on top of ice cubes. A hard swing throws them out of the glass onto the table, where they slide; salt landing in a puddle dissolves into it.
- **Stirring moves everything:** the spoon is a moving rod that pushes aside any cube in its way. The swirling drink drags submerged cubes, Mentos and salt round with it, including salt caught between the cubes, and the flow speeds up the salt's dissolving.
- **Every motion runs down:** a dropped cube's energy goes into drag, the drink it carries along (added mass, C_A ≈ 0.8) and the surface waves it makes (heave radiation damping, ζ ≈ 0.2), so it settles in about two seconds. Cubes slide with Coulomb friction on the glass (μ ≈ 0.1, wet ice) and table (0.3), and fly with air drag. The slosh is integrated exactly, so with the glass still its energy can only fall. The tests check that everything comes to rest.
- **Throwing ice:** cubes in a swinging glass feel the same forces: centrifugal ω²r, the swing's start and stop α×r, and Coriolis. Tip a glass of ice slowly onto its side and the cubes stay, resting on the low wall. Flick it over and they are thrown out of the mouth, fly, land 10–20 cm away and slide on the table (μ ≈ 0.3). Cubes can also fall back in or bounce off the outside of the glass.
- **The bottle:** between pours the hand parks it 9 cm out from the glass, so it does not block the view, and brings it over the rim when you pour.
- **Mentos, salt and the spoon in 3-D:** a Mentos is released at a random spot over the mouth with a small random push. It tumbles as it falls, bounces off the wall and lies flat where it lands. A pinch of salt is 24 grains scattered round a random spot (σ ≈ 5 mm), each drifting as it sinks. Stirring carries both round. The spoon goes round one steady circle, clockwise seen from above, at its 0.3 m/s stroke speed.
- **The hand:** the tilt you ask for is a target. The cup gets there like a critically damped spring, pivoting on its bottom corner. Gentle changes move at ω = 14 rad/s (at most 12 rad/s). A fast drag, a big jump or a key tap is a flick: ω = 25 rad/s, up to 20 rad/s for half a second (wrist flicks reach 20–40 rad/s). The cup can go to 90°.
- **Sloshing:** the drink's first sloshing mode, `ω² = (gξ₁/R)·tanh(ξ₁h/R)`, ξ₁ = 1.8412 (Lamb), about 3.5 Hz in a 7.5 cm tumbler. The surface is a plane tilted by δ, chasing `tan δ = −a_x/(g + a_y)` as a damped oscillator. It is driven by the acceleration of the cup about its corner, measured where the mode lives (R/ξ₁ below the surface). Large waves break: once the wave at the wall is more than about half the depth (a bore) or steeper than Stokes' limit, extra damping removes most of its energy within a cycle. A violent fling therefore settles in under a second instead of ringing back and forth. Damping comes from Stokes boundary layers (Mikishev & Dorozhkin), contact-line friction and, strongly, a head of foam (Sauret et al. 2015). The liquid's geometry (level, rim, spill side) is computed in the frame tilted by θ − δ.
- **Throwing:** liquid that goes over the rim leaves with the rim's own velocity, plus the slosh wave running up the wall and the weir outflow √(g·h). Slow liquid clings and runs down the outside (the teapot effect, Duez et al. 2010, `u_c ≈ 0.3 m/s`). Fast liquid separates and flies as drops (gravity plus air drag) and lands on the table or back in the glass. Tip a full glass slowly and it pours down its side; swing it fast and the drink is thrown.
- **Fizz spray:** every bubble bursting at the surface flings droplets. From a bare surface it is a jet drop about a tenth of the bubble's radius (Blanchard 1963), at about 2.6·(R/1 mm)^−0.6 m/s (an estimate from Spiel 1997 and Ghabache & Séon 2016). From the top of a head it is slower ~20 µm film drops (Lhuissier & Villermaux 2012). Air drag (Schiller–Naumann) stops them within centimetres: fresh champagne sprays droplets up to ~14 cm. Most fall back in; mist landing on the bare table beads as dew.
- **Foam eruption:** the speed the head leaves the mouth is u = (foam volume rate)/(mouth area): 2–10 cm/s for Mentos in cold diet cola, about 30–60 cm/s in warm soda or a narrow glass. The share flung off is `ρ_f u² / (ρ_f u² + τ_y + ρ_f u_c²)`, the dynamic pressure against the foam's yield stress and its grip on the rim. So cold eruptions ooze, warm ones spray clumps 1–2 cm up that land around the glass.
- **A head flows over the rim at a finite rate:** foam above the dome its yield stress can hold flows outward over the edge like a viscous layer (a viscous weir): `Q = P·ρ_f g δ³ / 3μ_f`, with δ its height above that dome and P the rim it goes over. That is only a few ml/s at 2 mm, but about 0.5 L/s at 1 cm. A surging head therefore piles up above the rim (up to ~1.5 cm in a warm Mentos eruption) until its outflow matches what the bubbles make. Meanwhile it keeps bursting and draining back, and it settles at about the rim when the surge ends. Wet froth (gas fraction below 0.635) has no yield stress and runs straight over.
- **Bubbly overflow:** when the drink itself rises over the rim because it is full of bubbles (gas holdup, huge in an eruption), the mixture goes over together. Only its liquid share is drink lost; the bubbles in it go too.
- **An aggressive head breaks off the rim:** foam that is not flung goes over the rim, but the outside of the glass can only carry it away as a creeping Bingham film, at most about 2τ_y/(ρ_f g) ≈ 2 mm thick. That drains only ~1 ml/s round a 7.5 cm rim. A head rising faster than that breaks off the rim in clumps that fall around the glass, while a slow overflow still runs down the side.
- **Foam on the table has volume and shape:** foam is a soft solid, held up by surface tension in its films (yield stress τ_y = 0.51·(σ/R)·(φ_g − 0.635)², Mason et al. 1996). So it lands as a heap with the "perfectly plastic" profile `h = √(2τ_y(r₀ − r)/ρ_f g)` (Nye 1951; Coussot 2005). 50 ml of cola foam makes a mound ~1.3 cm tall and ~10 cm across; a Mentos eruption leaves a ring of foam about 2 cm high round the glass. Heaps burst and drain like the head they came from (foam.js), keep their footprint while they sink, and leave a puddle of their liquid.
- **The stream:** each step's outflow leaves the lip as a parcel and flies ballistically, so the stream takes its fall time (~0.18 s) to arrive. Glugs travel down it, and if you swing the glass away mid-pour it lands on the table. It stays a jet for `L_b = 19.5·d·[√We(1 + 3Oh)]^0.85` (Grant & Middleman 1966), over a metre for a normal pour and centimetres for a thin trickle, then breaks into drops. Slow flow dribbles down the neck and drips (Tate's law, ~0.07 ml drops). The pourer keeps the lip over the glass and, for a tilted pour, aims down the low wall where an arc can reach it, allowing for the glass still turning. Near upright, the pour finishes straight into the drink.
- **The table's edge:** the table ends 12 cm behind the glass. A puddle that reaches the edge pins there (Gibbs' inequality, as at the rim of the glass): it can only pass a square edge once it stands thicker than 2·l_c·sin(α/2) ≈ 3.9 mm. A puddle at rest is 3.1 mm, so it is held at the edge and spreads along it. Only a big spill dumped right at the edge runs over, onto the floor (as does anything that flies past it).
- **Puddles:** spills spread as viscous gravity currents, `r = 0.894(ρgV³/3μ)^{1/8} t^{1/8}` (Huppert 1982). They stop at the gravity–capillary puddle height `h = 2·l_c·sin(θ/2)` ≈ 3 mm on varnished wood (θ ≈ 70°), so 100 ml covers a disc about 20 cm across. Touching puddles merge. Foam on the table collapses into them, and table ice melts into them.

### The 3-D view (`render3d.js`)
- The camera looks down on the table from 24° above, orthographically, so sizes stay true and rims become ellipses. Press **V** (or the VIEW button) to switch to the flat cut-away **SECTION** view.
- The glass is **ray-cast**: each pixel's ray is intersected with the outer and inner cylinders (a quadratic), the floor and rim planes, the liquid and foam surfaces (world heights from the tilt mapping), and each ice cube as a real box at its lane depth (slab test). The nearest hit decides the colour, and the drink absorbs light along the ray (Beer–Lambert, a rendering choice), so cola hides deep cubes and bubbles while club soda shows them.
- Bubbles carry a stable random depth across the cup and fade with the drink in front of them. Opaque cups (paper, ceramic, steel) are drawn semi-transparent so you can see inside.
- A **top-down inset** (top right) shows the glass from above: the head of foam, the cubes in their lanes, where the stream lands, the spoon and any Mentos.

### Assumptions and limits
- The bulk liquid is well mixed: one concentration and one temperature.
- The liquid physics is axisymmetric (one cross-section), but all areas and volumes are computed in 3D, and ice cubes sit in real depth lanes across the circle.
- Sloshing is one mode with a planar surface: no breaking waves or swirl, and amplitudes are capped at about 63°.
- The meltwater layer covers the whole surface evenly. A real floating cube in salt water sits in a thicker, colder lens of its own meltwater, so the classroom result (it melts clearly slower in salt water) comes out here only as "about the same" (see docs/EVIDENCE.md).
- Bubbles do not merge with each other in the liquid.
- Some constants are calibrated rather than measured: the site densities, φc, the drainage constant, the splash factors, and the film-wetting area. They are named constants at the top of each file.

## Evidence and tests

Every formula and constant is classified in [docs/EVIDENCE.md](docs/EVIDENCE.md) as an exact law, a published correlation (checked against independent data), calibrated to measurements, or an estimate. The test suite checks the model three ways:

```
node tests/run-all.js
```

- **`tests/reference.test.js`:** 43 checks against tabulated data (IAPWS, CRC, Jähne, Stokes, Clift, Clanet & Searby, Davies & Taylor).
- **`tests/validation.test.js`:** replays the champagne pouring experiment of Liger-Belair et al. (2010) and compares CO₂ losses.
- **`tests/trends.test.js`:** 31 one-variable sweeps that check every control pushes the result in the direction real-world evidence says, plus mass-conservation checks.
- **`tests/ice.test.js`:** capacity and overflow, energy conservation through melting and refreezing, a calorimetry balance, a measured melt time, the 4 °C anomaly, freezing points, dilution, and salt (measured NaCl freezing point, faster melting, CO₂ salting-out).
- **`tests/capillary.test.js`:** capillary length, meniscus, rim overfill, foam yield, and behaviour at the rim.
- **`tests/motion.test.js`:** 39 checks covering:
  - the sloshing frequency against Lamb's theory, and foam damping;
  - slow tipping vs. fast swinging;
  - Huppert spreading, puddle height, merging, and pinning at the table's edge;
  - foam heaps (Nye profile) that burst into puddles, and foam breaking off the rim;
  - the fizz spray height;
  - random Mentos landing and the clockwise spoon;
  - stream break-up, arrival delay, dribbling, and a stream that misses;
  - graded foam eruption;
  - the meltwater layer on cola vs. diet and in salt water;
  - foam made of meltwater;
  - salt's dissolving heat and brine properties;
  - conservation through every way liquid can leave the glass.

## Code layout

```
index.html            page shell; scripts load in dependency order
css/style.css         retro UI
js/core/util.js       numeric helpers
js/physics/           constants, properties, nucleation, jet, bubbles, foam, ice, capillary, tilt, bottle, simulation (orchestrator)
js/physics/slosh.js   the hand that moves the cup, and the drink sloshing in it
js/physics/stream.js  the stream as flying parcels; break-up and dribbling
js/physics/table.js   drops and foam in flight, puddles on the table
js/render/            pixel frame-buffer renderer (section view), render3d.js (ray-cast 3-D view and top-down inset), pixel charts
js/ui/controls.js     data-driven control panel, drink picker and readouts
js/ui/hud.js          on-screen HUD (temperatures, CO₂, head, fill, status)
js/game/game.js       experiments, Perfect Pour challenge, achievements
js/main.js            wiring and the fixed-step loop (120 Hz physics, up to 64× speed)
tools/serve.js        optional zero-dependency static server
tests/                reference data, experimental validation and trend tests (node tests/run-all.js)
docs/EVIDENCE.md      evidence audit of every formula and constant
```

## References
- Weiss, R. F. (1974) *Carbon dioxide in water and seawater: the solubility of a non-ideal gas*. Marine Chemistry 2:203–215.
- Versteeg, G. F. & van Swaaij, W. P. M. (1988) *Solubility and diffusivity of acid gases in aqueous alkanolamine solutions*. J. Chem. Eng. Data 33:29–34.
- Jähne, B., Heinz, G. & Dietrich, W. (1987) *Measurement of the diffusion coefficients of sparingly soluble gases in water*. J. Geophys. Res. 92:10767.
- Huber, M. L. et al. (2009) *New international formulation for the viscosity of H₂O* (IAPWS 2008). J. Phys. Chem. Ref. Data 38:101.
- Higbie, R. (1935) *The rate of absorption of a pure gas into a still liquid during short periods of exposure*. Trans. AIChE 31:365.
- Nusselt, W. (1916) *Die Oberflächenkondensation des Wasserdampfes*. Z. VDI 60.
- Koehler, S. A., Hilgenfeldt, S. & Stone, H. A. (2000) *A generalized view of foam drainage*. Langmuir 16:6327.
- Pope, S. B. (2000) *Turbulent Flows*. Cambridge University Press, ch. 5.
- Tomiyama, A. et al. (1998) *Drag coefficients of single bubbles under normal and micro gravity conditions*. JSME Int. J. B 41:472.
- Kuntzleman, T. S. et al. (2017) *New demonstrations and new insights on the mechanism of the candy-cola soda geyser*. J. Chem. Educ. 94:569.
- Ali, A. et al. (2022) *Evaluation of various carbonated soft drinks to assess their effects on human health*. Sci. Inquiry Rev. 6(3):46–60. doi:10.32350/sir.63.03 — measured CO₂ volumes.
- University of Florida IFAS EDIS FS379, *A guide to carbonating beverages at small scale* — standard carbonation ranges.
- Clanet, C. & Searby, G. (2004) *On the glug-glug of ideal bottles*. J. Fluid Mech. 510:145–168.
- Ervine, D. A. (1998) *Air entrainment in hydraulic structures: a review*. Proc. ICE Water, Maritime & Energy — fragmented and "rough" plunging jets entrain several times more air than smooth ones.
- Davies, R. M. & Taylor, G. I. (1950) *The mechanics of large bubbles rising through extended liquids and through liquids in tubes*. Proc. R. Soc. A.
- Carrier, V. & Colin, A. (2003) *Coalescence in draining foams*. Langmuir.
- Liger-Belair, G. (2005) *The physics and chemistry behind the bubbling properties of champagne and sparkling wines*. J. Agric. Food Chem.
- Liger-Belair, G. et al. (2010) *On the losses of dissolved CO₂ during champagne serving*. J. Agric. Food Chem.
- Jones, Evans & Galvin (1999) *Bubble nucleation from gas cavities — a review*. Adv. Colloid Interface Sci.
- Bankoff, S. G. (1958) *Entrapment of gas in the spreading of a liquid over a rough surface*. AIChE J.
- Bin, A. K. (1993) *Gas entrainment by plunging liquid jets*. Chem. Eng. Sci.
- Hinze, J. O. (1955) *Fundamentals of the hydrodynamic mechanism of splitting in dispersion processes*. AIChE J.
- Clift, Grace & Weber (1978) *Bubbles, Drops and Particles*.
- Tomiyama et al. (1998) *Drag coefficients of single bubbles under normal and micro gravity conditions*. JSME Int. J.
- Weaire & Hutzler (1999) *The Physics of Foams*.
- Hilgenfeldt, Koehler & Stone (2001) *Dynamics of coarsening foams*. Phys. Rev. Lett.
- Coffey, T. S. (2008) *Diet Coke and Mentos: what is really behind this physical reaction?* Am. J. Phys.
