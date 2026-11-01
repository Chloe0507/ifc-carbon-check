// App entry: loads a model, runs the readiness check and wires everything
// to the dashboard cards.
import "./style.css";
import { Viewer } from "./viewer";
import { summarise, describeElement } from "./model-data";
import {
  binOf, carbonBins, carbonDetail, carbonLegend, CARBON_RAMP,
  renderCarbon, renderCategories, renderCoverage, renderProperties, renderRules, renderTicker,
} from "./panels";
import { calculate, type CarbonReport } from "./carbon";
import { renderLifecycleChart } from "./charts";
import { loadSettings, renderSettings } from "./settings";
import { mappingState } from "./lca-data";
import { readModel, type ModelData } from "./ifc-data";
import { runChecks, type CheckReport } from "./checks";
import { measureCoverage, type Coverage } from "./coverage";
import { buildBcf, type BcfTopic } from "./bcf";
import { DEFAULT_BOUNDARY, loadEdits, loadLca, saveEdits, type Dataset, type Mapping } from "./lca-data";
import { materialUses, renderLibrary } from "./library";

const DEFAULT_MODEL = { url: "models/duplex.ifc", name: "Duplex Apartment" };
// Material mappings reviewed for the bundled models, by IFC file name.
const MAPPINGS: Record<string, string> = { "duplex.ifc": "data/mappings/duplex.json" };
// Issues about this many elements or fewer open with only those elements shown.
const ISOLATE_BELOW = 20;
const COLORS = { fail: "#d64545", some: "#f0b429", pass: "#7ccfb5" };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewer = new Viewer($("viewport"));

const state = {
  data: null as ModelData | null,
  report: null as CheckReport | null,
  coverage: null as Coverage | null,
  fileName: "",
  mode: "normal" as "normal" | "readiness" | "carbon",
  volumes: new Map<number, number>(),
  carbon: null as CarbonReport | null,
  includeProvisional: true,
  rule: null as string | null, // the rule picked in the readiness card, if any
  view: "overview" as "overview" | "readiness" | "carbon" | "library" | "settings",
  datasets: [] as Dataset[],
  byUuid: new Map<string, Dataset>(),
  mappings: new Map<string, Mapping>(),
  boundary: DEFAULT_BOUNDARY,
  area: null as number | null, // manual reference area, m²
  reviewNote: "",
};

async function show(bytes: Uint8Array, name: string, fileName: string) {
  $("loading").classList.remove("hidden");
  $("loading").textContent = `Loading ${name}…`;
  renderProperties($("props"), null);

  // web-ifc may take ownership of the buffer, so give each reader its own copy.
  state.data = await readModel(bytes.slice());
  const model = await viewer.loadIfc(bytes, name);
  const summary = await summarise(model, state.data.schema);

  $("meta-model").textContent = name;
  $("meta-schema").textContent = summary.schema;
  $("kpi-elements").textContent = summary.elementCount.toLocaleString("en");
  $("kpi-elements-note").textContent = `building elements · ${summary.furnitureCount} furniture items excluded`;
  renderCategories($("cat-list"), summary.categories);

  $("loading").textContent = "Running readiness check…";
  const boxes = await viewer.boxKeys([...state.data.elements.keys()]);
  state.report = runChecks(state.data, boxes);
  state.rule = null;
  state.fileName = fileName;
  renderReadiness();

  $("loading").textContent = "Measuring data coverage…";
  const volumes = await viewer.volumes(state.report.assessed.map((e) => e.id));
  state.volumes = volumes;
  state.coverage = measureCoverage(state.report.assessed, volumes);
  $("kpi-calc").textContent = Math.round((state.coverage.calculable / state.coverage.total) * 100).toString();
  renderCoverage($("coverage"), state.coverage);

  $("loading").textContent = "Loading Ökobaudat datasets…";
  await loadMappings(fileName);
  await applyMode();
  $("loading").classList.add("hidden");
}

function renderReadiness() {
  const report = state.report!;
  const failsGroup = (id: number, group: string) =>
    (report.failures.get(id) ?? []).some((f) => f.rule.group === group);
  const share = (group: string) => {
    const modelFail = report.results.some((r) => r.rule.group === group && r.modelProblems.length);
    if (modelFail || !report.assessed.length) return 0;
    return report.assessed.filter((e) => !failsGroup(e.id, group)).length / report.assessed.length;
  };
  $("kpi-bim").textContent = Math.round(share("BIM-ready") * 100).toString();
  $("kpi-lca").textContent = Math.round(share("LCA-ready") * 100).toString();
  $("kpi-ready-note").textContent = `Share of ${report.assessed.length} building elements passing every check in the group.`;
  renderRules($("rule-list"), report, state.rule, async (ruleId) => {
    state.rule = ruleId;
    state.mode = "readiness";
    renderReadiness();
    await applyMode();
  });
  renderTicker($("ticker"), report);
}

function applySettings() {
  const settings = loadSettings();
  state.boundary = settings.boundary;
  state.area = settings.area;
}
applySettings();

function renderSettingsView() {
  renderSettings($("settings"), { boundary: state.boundary, area: state.area }, state.data?.floorArea ?? null, async () => {
    applySettings();
    renderSettingsView();
    renderLibraryView();
    recalculate();
    if (state.mode === "carbon") await applyMode();
  });
}

async function loadMappings(fileName: string) {
  const lca = await loadLca(MAPPINGS[fileName] ?? "");
  state.datasets = lca.data.datasets;
  state.byUuid = lca.byUuid;
  // The published mapping, with this browser's review edits on top.
  state.mappings = new Map((lca.mapping?.mappings ?? []).map((m) => [m.material, m]));
  state.reviewNote = lca.mapping?.reviewedBy ? `Published mapping reviewed by ${lca.mapping.reviewedBy} on ${lca.mapping.reviewed}.` : "";
  for (const [name, m] of Object.entries(loadEdits(fileName))) state.mappings.set(name, m);
  renderLibraryView();
  renderSettingsView();
  recalculate();
}

/** Runs the carbon calculation with the current mappings and refreshes the carbon card. */
function recalculate() {
  if (!state.report || !state.data) return;
  state.carbon = calculate(
    state.report.assessed, state.volumes, state.mappings, state.byUuid, state.boundary, state.includeProvisional, state.data.elements,
  );
  renderLifecycleChart($("lifecycle"), state.carbon, state.boundary.modules);
  const unreviewed = [...state.mappings.values()].filter((m) => {
    const ds = m.uuid ? state.byUuid.get(m.uuid) : undefined;
    return mappingState(m, ds, state.boundary) === "to-review";
  }).length;
  renderCarbon($("carbon"), state.carbon, {
    floorArea: state.area ? { value: state.area, rooms: 0 } : state.data.floorArea,
    includeProvisional: state.includeProvisional,
    unreviewed,
    assessed: state.report.assessed.length,
  });
  document.getElementById("carbon-provisional")?.addEventListener("change", async (e) => {
    state.includeProvisional = (e.target as HTMLInputElement).checked;
    recalculate();
    if (state.mode === "carbon") await applyMode();
  });
}

function renderLibraryView() {
  if (!state.report) return;
  renderLibrary($("library"), {
    uses: materialUses(state.report.assessed),
    mappings: state.mappings,
    byUuid: state.byUuid,
    all: state.datasets,
    boundary: state.boundary,
    reviewNote: state.reviewNote,
    onChange: (m) => {
      state.mappings.set(m.material, m);
      const edits = loadEdits(state.fileName);
      edits[m.material] = m;
      saveEdits(state.fileName, edits);
      renderLibraryView();
      recalculate();
    },
    onShow: async (ids) => {
      setView("overview");
      state.mode = "normal";
      await applyMode();
      await viewer.paint([{ ids, color: COLORS.some }]);
      $("legend").classList.remove("hidden");
      $("legend").innerHTML = legend([[COLORS.some, `${ids.length} elements with this material`]]);
    },
  });
  $("lib-export").addEventListener("click", () => {
    const file = {
      model: state.fileName,
      dataset: "ÖKOBAUDAT 2024-II",
      suggestedBy: "Claude (AI), reviewed in IFC Carbon Check",
      mappings: [...state.mappings.values()].sort((a, b) => a.material.localeCompare(b.material)),
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    a.download = state.fileName.replace(/\.ifc$/i, "") + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

const viewFor = (mode: typeof state.mode) => (mode === "normal" ? "overview" : mode);

function setView(view: typeof state.view) {
  state.view = view;
  $("library").classList.toggle("hidden", view !== "library");
  $("settings").classList.toggle("hidden", view !== "settings");
  document.querySelector(".layout")!.classList.toggle("lib-open", view === "library" || view === "settings");
  $("lifecycle-card").classList.toggle("hidden", view !== "carbon");
  $("coverage-card").classList.toggle("hidden", view === "carbon");
  $("carbon-card").classList.toggle("hidden", view !== "carbon");
  $("readiness-card").classList.toggle("hidden", view === "carbon");
  document.querySelectorAll<HTMLElement>(".rail-item").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
}

/** Colours the model for the current mode (and the picked rule, if any). */
async function applyMode() {
  document.querySelectorAll<HTMLElement>(".mode[data-mode]").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === state.mode),
  );
  if (state.view !== "library" && state.view !== "settings") setView(viewFor(state.mode));
  const report = state.report;
  $("legend").classList.toggle("hidden", state.mode === "normal");
  if (state.mode === "normal" || !report) return viewer.paint([]);

  const ids = report.assessed.map((e) => e.id);
  if (state.mode === "carbon") {
    const c = state.carbon;
    if (!c || !c.elements.size) {
      $("legend").innerHTML = `<span>Nothing calculated: check the material library and project settings.</span>`;
      return viewer.paint([]);
    }
    const values = [...c.elements.values()].map((e) => e.total);
    const breaks = carbonBins(values);
    const groups = CARBON_RAMP.map((color) => ({ color, ids: [] as number[] }));
    for (const e of c.elements.values()) groups[binOf(e.total, breaks)].ids.push(e.id);
    $("legend").innerHTML = carbonLegend(breaks, state.includeProvisional && c.provisionalTotal !== 0);
    return viewer.paint(groups);
  }
  if (state.rule) {
    // One rule picked: red where it fails, green where it passes.
    const failSet = new Set(report.results.find((r) => r.rule.id === state.rule)!.failed);
    $("legend").innerHTML = legend([[COLORS.fail, `Fails ${state.rule}`], [COLORS.pass, "Passes"]]);
    return viewer.paint([
      { ids: ids.filter((id) => failSet.has(id)), color: COLORS.fail },
      { ids: ids.filter((id) => !failSet.has(id)), color: COLORS.pass },
    ]);
  }
  // Overview: shade by how many checks each element fails.
  const fails = (id: number) => report.failures.get(id)?.length ?? 0;
  $("legend").innerHTML = legend([
    [COLORS.fail, "3 or more checks fail"],
    [COLORS.some, "1–2 checks fail"],
    [COLORS.pass, "All checks pass"],
  ]);
  await viewer.paint([
    { ids: ids.filter((id) => fails(id) >= 3), color: COLORS.fail },
    { ids: ids.filter((id) => fails(id) > 0 && fails(id) < 3), color: COLORS.some },
    { ids: ids.filter((id) => fails(id) === 0), color: COLORS.pass },
  ]);
}

const legend = (rows: [string, string][]) =>
  rows.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("");

viewer.onPick(async (localId) => {
  if (localId === null || !viewer.model || !state.data) return renderProperties($("props"), null);
  const info = await describeElement(viewer.model, localId, state.data);
  const assessed = !!state.report?.assessed.some((e) => e.id === localId);
  const carbon = assessed ? carbonDetail(state.carbon?.elements.get(localId), state.carbon?.missing.get(localId)) : "";
  renderProperties($("props"), info, state.report?.failures.get(localId) ?? [], assessed, carbon);
});

document.querySelectorAll<HTMLElement>(".mode[data-mode]").forEach((b) =>
  b.addEventListener("click", async () => {
    state.mode = b.dataset.mode as typeof state.mode;
    setView(viewFor(state.mode));
    if (state.mode === "normal") state.rule = null;
    if (state.report) renderReadiness();
    await applyMode();
  }),
);

document.querySelectorAll<HTMLElement>(".rail-item[data-view]").forEach((a) =>
  a.addEventListener("click", async () => {
    const view = a.dataset.view;
    if (view === "library") return setView("library");
    if (view === "settings") return setView("settings");
    if (view === "overview") state.mode = "normal";
    else if (view === "readiness") state.mode = "readiness";
    else if (view === "carbon") state.mode = "carbon";
    else return;
    setView(view);
    await applyMode();
  }),
);

$("btn-fit").addEventListener("click", () => viewer.fitView());

// One BCF topic per failing rule, each with a viewpoint and snapshot of its elements.
$("btn-bcf").addEventListener("click", async () => {
  const { report, data } = state;
  if (!report || !data) return;
  const button = $<HTMLButtonElement>("btn-bcf");
  button.disabled = true;
  const restoreView = viewer.saveView();
  const failing = report.results.filter((r) => r.failed.length || r.modelProblems.length);
  const topics: BcfTopic[] = [];

  try {
    for (const [i, r] of failing.entries()) {
      $("loading").classList.remove("hidden");
      $("loading").textContent = `Preparing BCF issue ${i + 1} of ${failing.length}…`;
      // Paint the rule's failures so the snapshot shows them.
      state.mode = "readiness";
      state.rule = r.failed.length ? r.rule.id : null;
      await applyMode();
      const isolate = r.failed.length > 0 && r.failed.length <= ISOLATE_BELOW;
      const view = await viewer.viewpoint(r.failed, isolate);

      const reasons = new Map<string, number>();
      for (const id of r.failed) {
        const reason = report.failures.get(id)!.find((f) => f.rule.id === r.rule.id)!.reason;
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      const details = r.modelProblems.length
        ? r.modelProblems
        : [...reasons].map(([reason, n]) => `${reason} (${n})`);

      topics.push({
        title: r.failed.length
          ? `${r.rule.id} ${r.rule.title}: ${r.failed.length} of ${r.checked} elements fail`
          : `${r.rule.id} ${r.rule.title}: fails`,
        description:
          `${r.rule.group} requirement ${r.rule.id}: ${r.rule.title}.\n` +
          `Found: ${details.join("; ")}.\n` +
          `Checked with IFC Carbon Check against the LCA-ready requirements (lca-ready.ids v0.1).`,
        priority: r.rule.group === "BIM-ready" ? "High" : "Normal",
        labels: [r.rule.group, r.rule.id],
        guids: r.failed.map((id) => data.elements.get(id)!.guid),
        isolate,
        camera: view.camera,
        snapshot: view.snapshot,
      });
    }

    const blob = await buildBcf({
      projectGuid: data.projectGuid,
      ifcFilename: state.fileName,
      author: "IFC Carbon Check",
      topics,
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.fileName.replace(/\.ifc$/i, "")}-readiness-issues.bcf`;
    a.click();
    URL.revokeObjectURL(a.href);
  } finally {
    state.rule = null;
    await restoreView();
    await applyMode();
    renderReadiness();
    $("loading").classList.add("hidden");
    button.disabled = false;
  }
});

$<HTMLInputElement>("file-input").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await show(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.ifc$/i, ""), file.name);
});

const res = await fetch(DEFAULT_MODEL.url);
await show(new Uint8Array(await res.arrayBuffer()), DEFAULT_MODEL.name, DEFAULT_MODEL.url.split("/").pop()!);

// Handy in the browser console while developing (and for the automated checks).
if (import.meta.env.DEV) Object.assign(window, { __state: state, __viewer: viewer });
