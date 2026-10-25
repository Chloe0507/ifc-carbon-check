// App entry: wires the viewer to the dashboard cards.
import "./style.css";
import { Viewer } from "./viewer";
import { summarise, describeElement, readSchema } from "./model-data";
import { renderCategories, renderProperties } from "./panels";
import { readMaterials, type MaterialIndex } from "./ifc-data";

const DEFAULT_MODEL = { url: "models/duplex.ifc", name: "Duplex Apartment" };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewer = new Viewer($("viewport"));
let materials: MaterialIndex = new Map();

async function show(bytes: Uint8Array, name: string) {
  $("loading").classList.remove("hidden");
  $("loading").textContent = `Loading ${name}…`;
  renderProperties($("props"), null);

  // web-ifc may take ownership of the buffer, so give each reader its own copy.
  materials = await readMaterials(bytes.slice());
  const model = await viewer.loadIfc(bytes, name);
  const summary = await summarise(model, readSchema(bytes));

  $("meta-model").textContent = name;
  $("meta-schema").textContent = summary.schema;
  $("kpi-elements").textContent = summary.elementCount.toLocaleString("en");
  $("kpi-elements-note").textContent = `building elements · ${summary.furnitureCount} furniture items excluded`;
  renderCategories($("cat-list"), summary.categories);
  $("loading").classList.add("hidden");
}

viewer.onPick(async (localId) => {
  const info = localId === null || !viewer.model ? null : await describeElement(viewer.model, localId, materials);
  renderProperties($("props"), info);
});

$("btn-fit").addEventListener("click", () => viewer.fitView());

$<HTMLInputElement>("file-input").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await show(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.ifc$/i, ""));
});

const res = await fetch(DEFAULT_MODEL.url);
await show(new Uint8Array(await res.arrayBuffer()), DEFAULT_MODEL.name);
