# IFC Carbon Check

A web app that checks whether a BIM model is **ready for a life cycle assessment**, then shows its **embodied carbon in 3D**.

Most BIM-to-LCA tools are closed plugins: you can't see which model data was missing, how materials were matched to EPDs, or how much of the result was estimated. This project opens that workflow up:

1. **Readiness check.** The model is checked against information requirements written as an [IDS](https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/) file. Elements with missing data turn red, and the issues can be exported as BCF for the modeller.
2. **Material matching.** IFC material names are matched to [Ökobaudat](https://www.oekobaudat.de/) datasets. AI suggests a match and a person reviews it; the approved mapping table ships with the site.
3. **Carbon in 3D.** Embodied carbon (EN 15978, A1–A3 and C3–C4) per element, as a heatmap on the model, with honest coverage: anything estimated is labelled.
4. **What-if.** Swap a material group for an alternative and watch the totals change.

> Status: day 2 of a 10-day build. The viewer loads IFC models, shows each element's data and material layers, and runs the readiness check. The carbon calculation comes next.

## The readiness check

The check runs in two steps. **BIM-ready** asks whether the model is usable at all; **LCA-ready** asks whether it holds what an embodied carbon assessment needs. There's no single industry standard for either: ISO 19650 leaves information requirements to each project. These rules are based on EN 17412-1 (Level of Information Need), the inputs EN 15978 needs, and the Dutch *BIM basis ILS*.

| Rule | Requirement | In IDS |
| --- | --- | --- |
| B1 | File is readable IFC with a known schema | – |
| B2 | Elements use a specific IFC class, not a generic proxy | yes |
| B3 | Every element sits in a building storey | yes |
| B4 | Storeys are named and ordered; length unit is SI | – |
| B5 | No duplicate elements in the same place | – |
| R1 | Every element has a material assigned | yes |
| R2 | Walls, slabs and roofs use a layer set with thicknesses | – |
| R3 | Material names describe the material | – |
| R4 | Element carries base quantities (volume or area) | yes |
| R5 | IsExternal is set | yes |
| R6 | LoadBearing is set on walls, slabs, beams and columns | yes |
| R7 | Element has a classification reference | yes |

The rules that IDS 1.0 can express are published as [`public/requirements/lca-ready.ids`](public/requirements/lca-ready.ids), so a modeller can check their own model with any IDS tool before handing it over. The app runs all twelve in the browser ([`src/checks.ts`](src/checks.ts)).

**Cross-check.** On the Duplex model, the app's results match buildingSMART's [IfcTester](https://github.com/IfcOpenShell/IfcOpenShell/tree/v0.8.0/src/ifctester) run on the IDS file for every shared rule. The one difference is on R1: the app judges a roof by its slabs, and lets a slab inherit the material of the roof it belongs to, so IfcTester counts 3 more failures.

What the Duplex shows: it's 99% BIM-ready (two ceilings sit exactly on top of each other) and 0% LCA-ready. There are no quantity sets or classifications at all, and doors, windows, footings, stairs, railings and members have no material.

## Run it locally

```bash
npm install     # also copies the web-ifc WASM and the fragments worker into public/
npm run dev     # opens on http://localhost:5173
```

## How the code is organised

| File | What it does |
| --- | --- |
| `src/main.ts` | Entry point: loads a model and wires the viewer to the dashboard cards |
| `src/viewer.ts` | The 3D view (That Open Engine): loading IFC, camera, clicking elements |
| `src/ifc-data.ts` | Reads what the checks and the LCA need straight from the IFC with web-ifc: materials and layer thicknesses, property and quantity sets, classifications, storeys |
| `src/checks.ts` | The readiness rules (B1–B5, R1–R7) and the engine that runs them |
| `public/requirements/lca-ready.ids` | The same requirements as an IDS file |
| `src/model-data.ts` | Summarises a model (element counts) and describes one element (attributes, property sets) |
| `src/panels.ts` | Renders the cards in the side panels |
| `src/style.css` | The light dashboard theme and layout |

## Credits

- Sample model: BSI (2020) "Duplex Apartment Test Files," buildingSMART International, <https://github.com/buildingSMART/Sample-Test-Files>, CC BY 4.0. Unchanged.
- 3D engine: [That Open Engine](https://github.com/ThatOpen/engine_components) and [web-ifc](https://github.com/ThatOpen/engine_web-ifc).
