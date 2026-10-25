# IFC Carbon Check

A web app that checks whether a BIM model is **ready for a life cycle assessment**, then shows its **embodied carbon in 3D**.

Most BIM-to-LCA tools are closed plugins: you can't see which model data was missing, how materials were matched to EPDs, or how much of the result was estimated. This project opens that workflow up:

1. **Readiness check.** The model is checked against information requirements written as an [IDS](https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/) file. Elements with missing data turn red, and the issues can be exported as BCF for the modeller.
2. **Material matching.** IFC material names are matched to [Ökobaudat](https://www.oekobaudat.de/) datasets. AI suggests a match and a person reviews it; the approved mapping table ships with the site.
3. **Carbon in 3D.** Embodied carbon (EN 15978, A1–A3 and C3–C4) per element, as a heatmap on the model, with honest coverage: anything estimated is labelled.
4. **What-if.** Swap a material group for an alternative and watch the totals change.

> Status: day 1 of a 10-day build. The viewer loads IFC models and shows each element's data and material layers. The readiness check and the carbon calculation come next.

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
| `src/ifc-data.ts` | Reads material layers and thicknesses straight from the IFC with web-ifc |
| `src/model-data.ts` | Summarises a model (element counts) and describes one element (attributes, property sets) |
| `src/panels.ts` | Renders the cards in the side panels |
| `src/style.css` | The light dashboard theme and layout |

## Credits

- Sample model: BSI (2020) "Duplex Apartment Test Files," buildingSMART International, <https://github.com/buildingSMART/Sample-Test-Files>, CC BY 4.0. Unchanged.
- 3D engine: [That Open Engine](https://github.com/ThatOpen/engine_components) and [web-ifc](https://github.com/ThatOpen/engine_web-ifc).
