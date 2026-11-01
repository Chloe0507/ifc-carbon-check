// The material library view: one row per IFC material, the Ökobaudat dataset
// it is matched to, whether that dataset fits the system boundary, and the
// reviewer's approval. Approving, changing or excluding a match happens here.
import type { ElementRecord } from "./ifc-data";
import {
  STATE_LABEL,
  mappingState,
  scopeIssues,
  type Dataset,
  type Mapping,
  type MappingState,
  type SystemBoundary,
} from "./lca-data";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface MaterialUse {
  name: string;
  elements: number[];
  classes: Set<string>;
  thicknesses: Set<number>; // mm
}

/** Which IFC materials the model uses, and where. */
export function materialUses(elements: ElementRecord[]): MaterialUse[] {
  const uses = new Map<string, MaterialUse>();
  for (const el of elements) {
    for (const layer of el.materials) {
      const u = uses.get(layer.name) ?? { name: layer.name, elements: [], classes: new Set(), thicknesses: new Set() };
      if (!u.elements.includes(el.id)) u.elements.push(el.id);
      u.classes.add(pretty(el.ifcClass));
      if (layer.thickness) u.thicknesses.add(Math.round(layer.thickness * 1000));
      uses.set(layer.name, u);
    }
  }
  return [...uses.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const pretty = (cls: string) =>
  cls.replace(/^IFC/, "").replace("STANDARDCASE", "").replace("BUILDINGELEMENTPROXY", "Proxy").toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

export interface LibraryContext {
  uses: MaterialUse[];
  mappings: Map<string, Mapping>;
  byUuid: Map<string, Dataset>;
  all: Dataset[];
  boundary: SystemBoundary;
  onChange: (m: Mapping) => void;
  onShow: (ids: number[]) => void;
}

const fmt = (n: number | undefined) =>
  n === undefined ? "–" : Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(1) : n.toPrecision(2);

export const unitLabel = (d: Dataset) => d.unit.replace("3", "³").replace("2", "²");

// "'Mineral building products' / 'Mortar and Concrete' / 'Ready mixed concrete'" -> last part.
const shortCategory = (c: string) => c.split("/").pop()!.replace(/'/g, "").trim();

// Generic (German national average) data first, then industry averages, then single-producer EPDs.
const TYPE_ORDER: Record<string, number> = { generic: 0, average: 1, representative: 2, template: 3, specific: 4 };

export function datasetLine(d: Dataset, boundary: SystemBoundary) {
  // Only the modules the dataset declares: a recycled product has C3 but no C4.
  const gwp = boundary.modules.filter((m) => d.gwp[m] !== undefined).map((m) => `${m} ${fmt(d.gwp[m])}`).join(" · ");
  return `kg CO₂e per ${unitLabel(d)}: ${gwp}`;
}

export function renderLibrary(el: HTMLElement, ctx: LibraryContext) {
  const counts: Record<MappingState, number> = { counts: 0, excluded: 0, "to-review": 0, scope: 0, unmatched: 0 };
  const rows = ctx.uses.map((u) => {
    const m = ctx.mappings.get(u.name);
    const ds = m?.uuid ? ctx.byUuid.get(m.uuid) : undefined;
    const state = mappingState(m, ds, ctx.boundary);
    counts[state]++;
    const issues = ds ? scopeIssues(ds, ctx.boundary) : [];
    const thick = [...u.thicknesses].sort((a, b) => a - b).map((t) => `${t}`).join(", ");
    return `<tr data-material="${esc(u.name)}">
      <td>
        <div class="lib-mat">${esc(u.name)}</div>
        <div class="lib-sub"><a href="#" class="lib-show">${u.elements.length} elements</a> · ${esc([...u.classes].join(", "))}${thick ? ` · ${thick} mm` : ""}</div>
      </td>
      <td>${
        m?.status === "excluded"
          ? `<div class="lib-sub">Not counted</div>`
          : ds
            ? `<div class="lib-ds">${esc(ds.name)}</div>
               <div class="lib-sub">${esc(ds.type)} · ${ds.standard}${m && m.share !== 1 ? ` · ${+(m.share * 100).toFixed(1)}% of layer volume` : ""}</div>
               <div class="lib-sub mono">${datasetLine(ds, ctx.boundary)}</div>`
            : `<span class="tag-missing">No dataset</span>`
      }
        ${m?.reason ? `<div class="lib-reason">${esc(m.reason)}</div>` : ""}
        ${issues.length ? `<div class="lib-scope">⚠ Scope: ${esc(issues.join("; "))}${m?.scopeApproval ? ` · accepted: “${esc(m.scopeApproval.reason)}”` : ""}</div>` : ""}
      </td>
      <td><span class="state state-${state}">${STATE_LABEL[state]}</span></td>
      <td class="lib-actions">
        ${state === "to-review" ? `<button class="btn btn-sm" data-act="approve">Approve</button>` : ""}
        ${state === "scope" ? `<button class="btn btn-sm btn-warn" data-act="scope">Accept scope…</button>` : ""}
        <button class="btn btn-sm btn-ghost" data-act="change">Change</button>
      </td>
    </tr>`;
  });

  el.innerHTML = `
    <div class="lib-head">
      <div>
        <h2>Material library</h2>
        <p class="hint">Each IFC material is matched to an Ökobaudat 2024-II dataset. The matches were suggested by AI from the material name, the element types and the layer thicknesses. A match only counts once it is approved and its dataset fits the system boundary.</p>
      </div>
      <div class="lib-boundary">
        <span class="meta-label">System boundary</span>
        <span class="meta-value">${ctx.boundary.modules.join(", ")} · ${ctx.boundary.standard}</span>
      </div>
    </div>
    <div class="lib-summary">
      ${(Object.keys(counts) as MappingState[])
        .filter((s) => counts[s])
        .map((s) => `<span class="state state-${s}">${STATE_LABEL[s]} ${counts[s]}</span>`)
        .join("")}
      <span class="lib-spacer"></span>
      <button class="btn btn-sm btn-ghost" id="lib-export">Download mapping (JSON)</button>
    </div>
    <table class="lib-table">
      <thead><tr><th>IFC material</th><th>Ökobaudat dataset</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
    <div class="lib-picker hidden" id="lib-picker"></div>`;

  el.querySelectorAll<HTMLTableRowElement>("tr[data-material]").forEach((tr) => {
    const name = tr.dataset.material!;
    const use = ctx.uses.find((u) => u.name === name)!;
    const current = (): Mapping =>
      ctx.mappings.get(name) ?? { material: name, uuid: null, reason: "", alternatives: [], share: 1, status: "suggested" };
    tr.querySelector(".lib-show")!.addEventListener("click", (e) => {
      e.preventDefault();
      ctx.onShow(use.elements);
    });
    tr.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) =>
      b.addEventListener("click", () => {
        const m = current();
        if (b.dataset.act === "approve") ctx.onChange({ ...m, status: "approved" });
        if (b.dataset.act === "scope") {
          const ds = ctx.byUuid.get(m.uuid!)!;
          openScopeDialog(el, name, scopeIssues(ds, ctx.boundary), (reason) =>
            ctx.onChange({ ...m, scopeApproval: { reason, date: new Date().toISOString().slice(0, 10) } }),
          );
        }
        if (b.dataset.act === "change") openPicker(el, use, m, ctx);
      }),
    );
  });
}

function openScopeDialog(root: HTMLElement, material: string, issues: string[], onAccept: (reason: string) => void) {
  const box = root.querySelector<HTMLElement>("#lib-picker")!;
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="picker-card">
      <h3>Accept a scope mismatch for “${esc(material)}”</h3>
      <p class="hint">This dataset ${esc(issues.join("; "))}. Its results will be shown with a warning. Write down why it is acceptable, for example “no +A2 dataset for this product; difference in GWP method is small for mineral products”.</p>
      <textarea id="scope-reason" rows="3" placeholder="Reason (required)"></textarea>
      <div class="card-actions">
        <button class="btn" id="scope-ok" disabled>Accept with this reason</button>
        <button class="btn btn-ghost" id="scope-cancel">Cancel</button>
      </div>
    </div>`;
  const text = box.querySelector<HTMLTextAreaElement>("#scope-reason")!;
  const ok = box.querySelector<HTMLButtonElement>("#scope-ok")!;
  text.addEventListener("input", () => (ok.disabled = text.value.trim().length < 10));
  ok.addEventListener("click", () => onAccept(text.value.trim()));
  box.querySelector("#scope-cancel")!.addEventListener("click", () => box.classList.add("hidden"));
  box.onclick = (e) => e.target === box && box.classList.add("hidden");
  text.focus();
}

/** Pick another dataset: the AI shortlist first, then search over the whole database. */
function openPicker(root: HTMLElement, use: MaterialUse, m: Mapping, ctx: LibraryContext) {
  const box = root.querySelector<HTMLElement>("#lib-picker")!;
  box.classList.remove("hidden");
  const shortlist = [m.uuid, ...m.alternatives].filter(Boolean).map((u) => ctx.byUuid.get(u!)).filter(Boolean) as Dataset[];
  const item = (d: Dataset) => {
    const issues = scopeIssues(d, ctx.boundary);
    return `<li data-uuid="${d.uuid}" class="${d.uuid === m.uuid ? "current" : ""}">
      <div class="lib-ds">${esc(d.name)}</div>
      <div class="lib-sub">${esc(shortCategory(d.category))} · ${esc(d.type)} · ${d.standard}</div>
      <div class="lib-sub mono">${datasetLine(d, ctx.boundary)}</div>
      ${issues.length ? `<div class="lib-scope">⚠ ${esc(issues.join("; "))}</div>` : ""}
    </li>`;
  };
  box.innerHTML = `
    <div class="picker-card">
      <h3>Dataset for “${esc(use.name)}”</h3>
      <h4>AI shortlist</h4>
      <ul class="picker-list" id="pick-short">${shortlist.map(item).join("") || `<li class="hint">No suggestions.</li>`}</ul>
      <h4>Search all ${ctx.all.length.toLocaleString("en")} Ökobaudat datasets</h4>
      <input id="pick-q" type="search" placeholder="e.g. concrete C25/30, gypsum board, mineral wool" />
      <ul class="picker-list" id="pick-results"></ul>
      <label class="picker-share">Share of layer volume <input id="pick-share" type="number" min="0.01" max="1" step="0.01" value="${m.share}" /></label>
      <div class="card-actions">
        <button class="btn btn-ghost" id="pick-exclude">Exclude from LCA</button>
        <button class="btn btn-ghost" id="pick-cancel">Cancel</button>
      </div>
    </div>`;

  const share = () => Math.min(1, Math.max(0.01, Number(box.querySelector<HTMLInputElement>("#pick-share")!.value) || 1));
  const choose = (uuid: string) => {
    const keep = uuid === m.uuid ? m : { ...m, scopeApproval: undefined };
    ctx.onChange({
      ...keep,
      uuid,
      share: share(),
      status: "approved",
      reason: uuid === m.uuid ? m.reason : "Chosen by the reviewer.",
      alternatives: m.uuid && uuid !== m.uuid ? [m.uuid, ...m.alternatives.filter((a) => a !== uuid)] : m.alternatives,
    });
  };
  const bind = (list: HTMLElement) =>
    list.querySelectorAll<HTMLElement>("li[data-uuid]").forEach((li) => li.addEventListener("click", () => choose(li.dataset.uuid!)));
  bind(box.querySelector("#pick-short")!);

  const q = box.querySelector<HTMLInputElement>("#pick-q")!;
  const results = box.querySelector<HTMLElement>("#pick-results")!;
  q.addEventListener("input", () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return void (results.innerHTML = "");
    const hits = ctx.all
      .filter((d) => {
        const text = `${d.name} ${d.nameDe} ${d.category}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => (TYPE_ORDER[a.type] ?? 5) - (TYPE_ORDER[b.type] ?? 5))
      .slice(0, 40);
    results.innerHTML = hits.map(item).join("") || `<li class="hint">No datasets match.</li>`;
    bind(results);
  });
  box.querySelector("#pick-exclude")!.addEventListener("click", () => {
    ctx.onChange({ ...m, uuid: null, status: "excluded", reason: m.status === "excluded" ? m.reason : "Excluded by the reviewer." });
  });
  box.querySelector("#pick-cancel")!.addEventListener("click", () => box.classList.add("hidden"));
  box.onclick = (e) => e.target === box && box.classList.add("hidden");
  box.onkeydown = (e) => e.key === "Escape" && box.classList.add("hidden");
  q.focus();
}
