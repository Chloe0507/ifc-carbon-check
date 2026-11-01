// What-if material swaps. A swap replaces the dataset of one IFC material in a
// scenario only: the reviewed mapping stays as it is, and the baseline is kept
// for comparison.
import { scopeIssues, type Dataset, type Mapping, type SystemBoundary } from "./lca-data";
import { datasetLine } from "./library";

export interface Swap {
  material: string;
  uuid: string;
  reason: string;
}

export interface SwapFile {
  suggestedBy: string;
  note: string;
  swaps: Record<string, { uuid: string; reason: string }[]>;
}

export async function loadSwaps(url: string | undefined): Promise<SwapFile | null> {
  if (!url) return null;
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}

/** The mapping with the swaps applied: swapped materials use the new dataset, approved for the scenario. */
export function scenarioMappings(mappings: Map<string, Mapping>, swaps: Swap[]) {
  const out = new Map(mappings);
  for (const s of swaps) {
    const m = mappings.get(s.material);
    if (!m) continue;
    out.set(s.material, { ...m, uuid: s.uuid, status: "approved", scopeApproval: undefined, reason: `What-if: ${s.reason}` });
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const TYPE_ORDER: Record<string, number> = { generic: 0, average: 1, representative: 2, template: 3, specific: 4 };

/** The picker: AI shortlist first, then a search over the whole database. Datasets outside the boundary can't be picked. */
export function openSwapPicker(opts: {
  host: HTMLElement;
  material: string;
  current: Dataset | undefined;
  shortlist: { uuid: string; reason: string }[];
  all: Dataset[];
  byUuid: Map<string, Dataset>;
  boundary: SystemBoundary;
  onPick: (s: Swap) => void;
}) {
  const { host, boundary } = opts;
  host.classList.remove("hidden");
  const item = (d: Dataset, reason?: string) => {
    const issues = scopeIssues(d, boundary);
    return `<li ${issues.length ? 'class="disabled"' : `data-uuid="${d.uuid}"`} data-reason="${esc(reason ?? "chosen from the database")}">
      <div class="lib-ds">${esc(d.name)}</div>
      <div class="lib-sub">${esc(d.type)} · ${d.standard}</div>
      <div class="lib-sub mono">${datasetLine(d, boundary)}</div>
      ${reason ? `<div class="lib-reason">${esc(reason)}</div>` : ""}
      ${issues.length ? `<div class="lib-scope">Outside the system boundary: ${esc(issues.join("; "))}</div>` : ""}
    </li>`;
  };
  const short = opts.shortlist.map((s) => [opts.byUuid.get(s.uuid), s.reason] as const).filter(([d]) => d);
  host.innerHTML = `
    <div class="picker-card">
      <h3>What if “${esc(opts.material)}” were something else?</h3>
      ${opts.current ? `<p class="hint">Now: <b>${esc(opts.current.name)}</b> · ${datasetLine(opts.current, boundary)}</p>` : ""}
      <p class="hint">The swap keeps the layer thickness. Check structure, fire and U-value separately.</p>
      <h4>AI shortlist</h4>
      <ul class="picker-list" id="sw-short">${short.map(([d, r]) => item(d!, r)).join("") || `<li class="hint">No suggestions for this material. Search below.</li>`}</ul>
      <h4>Search all ${opts.all.length.toLocaleString("en")} Ökobaudat datasets</h4>
      <input id="sw-q" type="search" placeholder="e.g. wood fibre, sand-lime, recycled concrete" />
      <ul class="picker-list" id="sw-results"></ul>
      <div class="card-actions"><button class="btn btn-ghost" id="sw-cancel">Cancel</button></div>
    </div>`;
  const close = () => host.classList.add("hidden");
  const bind = (list: HTMLElement) =>
    list.querySelectorAll<HTMLElement>("li[data-uuid]").forEach((li) =>
      li.addEventListener("click", () => {
        close();
        opts.onPick({ material: opts.material, uuid: li.dataset.uuid!, reason: li.dataset.reason! });
      }),
    );
  bind(host.querySelector("#sw-short")!);
  const q = host.querySelector<HTMLInputElement>("#sw-q")!;
  const results = host.querySelector<HTMLElement>("#sw-results")!;
  q.addEventListener("input", () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return void (results.innerHTML = "");
    const hits = opts.all
      .filter((d) => words.every((w) => `${d.name} ${d.nameDe} ${d.category}`.toLowerCase().includes(w)))
      .sort((a, b) => (TYPE_ORDER[a.type] ?? 5) - (TYPE_ORDER[b.type] ?? 5))
      .slice(0, 40);
    results.innerHTML = hits.map((d) => item(d)).join("") || `<li class="hint">No datasets match.</li>`;
    bind(results);
  });
  host.querySelector("#sw-cancel")!.addEventListener("click", close);
  host.onclick = (e) => e.target === host && close();
  host.onkeydown = (e) => e.key === "Escape" && close();
  q.focus();
}
