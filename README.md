# Butterfly PEMF coil optimizer

An interactive, single-page design tool for a bent butterfly (figure-8) air-core PEMF coil. It solves flux against amps, volts and heat as a constrained optimization (peak current is a first-class budget and a selectable objective) with an augmented Lagrangian, and shows every governing equation, constraint price (multiplier), field map, trade-off sweep and a build sheet, all linked to one set of inputs.

**Live page:** https://combsbw.github.io/pemf/

## What it models

- Exact Biot–Savart field of the wound coil, induced E-field from the vector potential, Neumann inductance
- Wire gauge, winding packing, resistance with temperature
- Lumped thermal node with a closed-form temperature and skin temperature through the cover
- Drive limits (source voltage and sag, current, power, battery energy)
- Seven design variables, 22 constraints, KKT diagnostics and shadow prices

It is a lumped design model, not medical advice and not a substitute for measurement. Verify coil temperature, current and flux on the real hardware, and choose your own field and temperature limits.

## Layout

- `index.html` is the built, self-contained page (what GitHub Pages serves)
- `src/core.js` physics and solver (no dependencies, runs in Node or the browser)
- `src/part1.js` to `src/part5.js` interface: helpers and charts, field maps, state and controls, tabs, trade-offs/equations/build sheet
- `src/style.css` styles
- `build.py` regenerates `index.html` from `src/`

## Develop

```
python3 build.py        # writes index.html
python3 -m http.server  # open http://localhost:8000
```

Fonts load from Google Fonts with system fallbacks. The solver runs in a Web Worker created from the inlined `core.js`.
