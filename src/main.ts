// App entry: loads a model, runs the readiness check and wires everything
// to the dashboard cards.
import "./style.css";
import { Viewer } from "./viewer";
import { summarise, describeElement } from "./model-data";
import { renderCategories, renderCoverage, renderProperties, renderRules, renderTicker } from "./panels";
import { readModel, type ModelData } from "./ifc-data";
import { runChecks, type CheckReport } from "./checks";
import { measureCoverage, type Coverage } from "./coverage";
import { buildBcf, type BcfTopic } from "./bcf";

const DEFAULT_MODEL = { url: "models/duplex.ifc", name: "Duplex Apartment" };
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
  mode: "normal" as "normal" | "readiness",
  rule: null as string | null, // the rule picked in the readiness card, if any
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
  state.coverage = measureCoverage(state.report.assessed, volumes);
  $("kpi-calc").textContent = Math.round((state.coverage.calculable / state.coverage.total) * 100).toString();
  renderCoverage($("coverage"), state.coverage);
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

/** Colours the model for the current mode (and the picked rule, if any). */
async function applyMode() {
  document.querySelectorAll<HTMLElement>(".mode[data-mode]").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === state.mode),
  );
  document.querySelectorAll<HTMLElement>(".rail-item").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === (state.mode === "readiness" ? "readiness" : "overview")),
  );
  const report = state.report;
  $("legend").classList.toggle("hidden", state.mode === "normal");
  if (state.mode === "normal" || !report) return viewer.paint([]);

  const ids = report.assessed.map((e) => e.id);
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
  renderProperties($("props"), info, state.report?.failures.get(localId) ?? [], assessed);
});

document.querySelectorAll<HTMLElement>(".mode[data-mode]").forEach((b) =>
  b.addEventListener("click", async () => {
    state.mode = b.dataset.mode as typeof state.mode;
    if (state.mode === "normal") state.rule = null;
    if (state.report) renderReadiness();
    await applyMode();
  }),
);

document.querySelectorAll<HTMLElement>(".rail-item[data-view]").forEach((a) =>
  a.addEventListener("click", async () => {
    if (a.dataset.view === "overview") state.mode = "normal";
    else if (a.dataset.view === "readiness") state.mode = "readiness";
    else return;
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
