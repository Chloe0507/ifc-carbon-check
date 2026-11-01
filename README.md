# IFC Carbon Check

A web app that checks whether a BIM model is **ready for a life cycle assessment**, then shows its **embodied carbon in 3D**.

Most BIM-to-LCA tools are closed plugins: you can't see which model data was missing, how materials were matched to EPDs, or how much of the result was estimated. This project opens that workflow up:

1. **Readiness check.** The model is checked against information requirements written as an [IDS](https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/) file. Elements with missing data turn red, and the issues can be exported as BCF for the modeller.
2. **Material matching.** IFC material names are matched to [Ökobaudat](https://www.oekobaudat.de/) datasets. AI suggests a match and a person reviews it; the approved mapping table ships with the site.
3. **Carbon in 3D.** Embodied carbon (EN 15978, A1–A3 and C3–C4) per element, as a heatmap on the model, with honest coverage: anything estimated is labelled.
4. **What-if.** Swap a material group for an alternative and watch the totals change.

> Status: day 6 of a 10-day build. The app runs the readiness check, shows data coverage, exports issues as BCF, matches materials to Ökobaudat with a review step, calculates embodied carbon per element with a heatmap and a life-cycle chart, and has project settings for the system boundary. The material swap comes next.

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

## Embodied carbon

For each element the app takes its volume (from IFC quantities, or from the 3D geometry when the file has none) and splits it over the material layers by thickness. Each layer's quantity is converted to the dataset's declared unit: m³ directly, kg with the dataset's density, m² as the wall or slab face area (volume ÷ total thickness). The quantity is multiplied by the dataset's GWP for each module inside the system boundary. [`src/carbon.ts`](src/carbon.ts) does this, and the selected-element card shows every step.

**Duplex result:** 62 t CO₂e for A1–A3 + C3 + C4, or 147 kg CO₂e per m² of room area (422 m² over 21 rooms, read from the IfcSpace areas). A1–A3 is 39 t and C3 is 22 t. C3 is large because timber and plastics are incinerated at end of life, which releases the carbon the timber stored and A1–A3 credited. 96 of 154 elements are calculated. The other 58 are 55 elements with no material (doors, windows, stairs, railings, footings) and 3 with no geometry. All 17 matches were reviewed and approved by Chloe on 1 November 2026. She changed one: the 127 mm slab concrete now uses recycled-aggregate C25/30. If a match is changed later and not yet approved, the app labels its share of the result provisional, and a switch in the carbon card leaves it out.

**Heatmap:** elements are coloured by kg CO₂e in five quintile bins, so each colour holds about a fifth of the calculated elements. The orange ramp was checked with a palette validator (one hue, steps that get darker in order, and a lightest step that still shows against the background).

Checked by hand: the exterior brick-on-block wall (20.74 m³, 417 mm) gives 49.7 m² of face area and 2.6 t from 4.57 m³ of facing brick. A W310×60 beam (0.057 m³ = 451 kg) gives 253 kg.

## Life-cycle chart and project settings

**Chart.** In the Carbon view, a stacked bar per element group (walls, floors and slabs, roof, beams and columns, coverings) shows how its carbon splits over the life-cycle modules. Negative values (carbon stored in timber at A1–A3, benefits in D) extend left of a zero line. Hovering a segment shows its value, and the same numbers are available as a table. On the Duplex the walls carry 44 t of the 62 t, almost all of it A1–A3 from brick and concrete block. The floors and roof show the timber story: A1–A3 is slightly negative because of the stored carbon, and C3 releases it at end of life.

**Project settings** set the system boundary used everywhere else. The settings are:
- **Modules:** C3, C4 and D can each be switched on or off. A1–A3 is always included. Module D is shown next to the total and never added to it, as EN 15978 requires. On the Duplex D is −6.1 t.
- **EN 15804 version:** +A2 or +A1. Switching to +A1 flags all 17 Duplex matches as scope mismatches, because every dataset they use is +A2. That's a quick way to see the scope check working.
- **Reference area:** the room area from the model, or an area typed in, such as the gross floor area from the drawings.

The material library, the carbon totals and the heatmap all recalculate as soon as a setting changes. A4–A5 and the B modules are left out on purpose: the model has no site or use-stage data to pick a scenario from.

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
| `src/carbon.ts` | The carbon calculation: layer quantities × GWP per module, per element |
| `src/charts.ts` | The life-cycle chart (stacked bars per element group, with hover values and a table view) |
| `src/settings.ts` | Project settings: system boundary, EN 15804 version, reference area |
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
