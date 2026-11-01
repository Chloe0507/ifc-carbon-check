# IFC Carbon Check

A web app that checks whether a BIM model is **ready for a life cycle assessment**, then shows its **embodied carbon in 3D**.

Most BIM-to-LCA tools are closed plugins: you can't see which model data was missing, how materials were matched to EPDs, or how much of the result was estimated. This project opens that workflow up:

1. **Readiness check.** The model is checked against information requirements written as an [IDS](https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/) file. Elements with missing data turn red, and the issues can be exported as BCF for the modeller.
2. **Material matching.** IFC material names are matched to [Ökobaudat](https://www.oekobaudat.de/) datasets. AI suggests a match and a person reviews it; the approved mapping table ships with the site.
3. **Carbon in 3D.** Embodied carbon (EN 15978, A1–A3 and C3–C4) per element, as a heatmap on the model, with honest coverage: anything estimated is labelled.
4. **What-if.** Swap a material group for an alternative and watch the totals change.

> Status: day 4 of a 10-day build. The viewer runs the readiness check, shows data coverage, exports issues as BCF, and matches materials to Ökobaudat with a review step. The carbon calculation comes next.

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

## Data coverage and BCF issues

**Coverage.** Before any carbon number, the app shows how much of the model it can actually calculate, and where each input comes from. Material can be assigned on the element, on its type or on its parent element (a roof slab takes the roof's material), or be missing. Quantity comes from the IFC's quantity sets or, when those are absent, from the 3D geometry. On the Duplex, 62% of building elements are calculable: 55 have no material, and every volume comes from geometry because the file has no quantity sets.

**BCF export.** "Export issues as BCF" writes a [BCF 2.1](https://github.com/buildingSMART/BCF-XML/tree/release_2_1) file with one issue per failing rule, the way a coordinator would send it, not one ticket per element. Each issue lists the failing elements by GlobalId, colours them red, and carries a camera view and snapshot. Issues with 20 elements or fewer open with only those elements visible, so interior ones aren't hidden behind walls. Open it in BIMcollab Zoom, Solibri, or Revit/Archicad with a BCF plugin, next to the IFC. The files validate against buildingSMART's official BCF 2.1 schemas, and each camera points at its elements to within 5 mm (checked against IfcOpenShell geometry).

## Material matching (Ökobaudat)

Carbon data comes from [ÖKOBAUDAT](https://www.oekobaudat.de) 2024-II, the German federal LCA database: 4,218 datasets with A1–A3 values, all but 8 declared to EN 15804+A2. [`scripts/oekobaudat.py`](scripts/oekobaudat.py) turns the official CSV export into [`public/data/oekobaudat-2024-II.json`](public/data/oekobaudat-2024-II.json): GWP per declared unit for A1–A3, C3, C4 and D, density, and the EN 15804 version. For +A2 datasets GWP means GWP-total, so timber shows negative A1–A3 (stored carbon) and a matching C3 when that carbon is released.

**Matching.** Each IFC material is matched to a dataset in [`public/data/mappings/duplex.json`](public/data/mappings/duplex.json). Claude (AI) suggested the matches from the material name, the element types and the layer thicknesses, with a written reason and a shortlist of alternatives. Generic datasets are preferred because the model has no product information. Two layers are mostly cavity, so only part of their volume counts: the stud layer (0.2% steel) and the joist zone (10% timber). Both shares are marked as assumptions to review.

**Review.** In the Material library view, a reviewer approves each match, picks another one from the shortlist, searches the whole database, or excludes the material (the air gap). Only approved matches count. Edits are kept in the browser and can be downloaded as a new mapping file.

**Scope alignment.** The project sets one system boundary: A1–A3, C3 and C4 under EN 15804+A2. A dataset that is on another EN 15804 version, or has no A1–A3 or end-of-life value, is flagged as a scope mismatch. It only counts once the reviewer accepts it with a written reason, which is saved with the mapping. Ökobaudat datasets follow one end-of-life scenario, so recycled products declare C3 and landfilled ones C4. Either one counts as covering the end of life.

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
| `src/coverage.ts` | Measures where each element's material and quantity come from, and how many elements can be calculated |
| `src/bcf.ts` | Writes readiness issues as a BCF 2.1 zip (markup, viewpoint, snapshot per issue) |
| `src/lca-data.ts` | Dataset and mapping types, the system boundary and the scope-alignment check |
| `src/library.ts` | The material library view: review table, dataset picker and search |
| `scripts/oekobaudat.py` | Converts the Ökobaudat CSV export into the app's dataset file |
| `public/requirements/lca-ready.ids` | The same requirements as an IDS file |
| `src/model-data.ts` | Summarises a model (element counts) and describes one element (attributes, property sets) |
| `src/panels.ts` | Renders the cards in the side panels |
| `src/style.css` | The light dashboard theme and layout |

## Credits

- Sample model: BSI (2020) "Duplex Apartment Test Files," buildingSMART International, <https://github.com/buildingSMART/Sample-Test-Files>, CC BY 4.0. Unchanged.
- 3D engine: [That Open Engine](https://github.com/ThatOpen/engine_components) and [web-ifc](https://github.com/ThatOpen/engine_web-ifc).
- LCA data: ÖKOBAUDAT 2024-II, Federal Ministry for Housing, Urban Development and Building (BMWSB) / BBSR, <https://www.oekobaudat.de>. Converted to JSON with only the fields this app uses; values unchanged apart from being expressed per one declared unit.
