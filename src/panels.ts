// Small render functions for the dashboard cards. Plain DOM, no framework.
import type { ElementInfo, ModelSummary } from "./model-data";
import type { CheckReport, Rule } from "./checks";
import type { Coverage } from "./coverage";
import type { CarbonReport, ElementCarbon } from "./carbon";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderCategories(el: HTMLElement, categories: ModelSummary["categories"]) {
  el.innerHTML = categories
    .map((c) => `<li><span>${esc(c.name)}</span><span>${c.count}</span></li>`)
    .join("");
}

/** The rule list in the readiness card. Clicking a rule calls onSelect with its id. */
export function renderRules(
  el: HTMLElement,
  report: CheckReport,
  activeId: string | null,
  onSelect: (ruleId: string | null) => void,
) {
  let group = "";
  el.innerHTML = report.results
    .map(({ rule, checked, failed, modelProblems }) => {
      const head = rule.group !== group ? `<li class="rule-group">${(group = rule.group)}</li>` : "";
      const modelLevel = !!rule.testModel;
      const bad = modelLevel ? modelProblems.length > 0 : failed.length > 0;
      const count = modelLevel ? (bad ? "fails" : "passes") : `${failed.length} / ${checked}`;
      const share = checked ? (failed.length / checked) * 100 : 0;
      return `${head}<li class="rule ${rule.id === activeId ? "active" : ""}" data-rule="${rule.id}">
        <span class="rule-id">${rule.id}</span>
        <span>${esc(rule.title)}</span>
        <span class="rule-count ${bad ? "bad" : "ok"}">${count}</span>
        ${modelLevel ? (bad ? `<span class="rule-note">${modelProblems.map(esc).join("; ")}</span>` : "") : `<span class="rule-bar"><i style="width:${share}%"></i></span>`}
      </li>`;
    })
    .join("");

  el.querySelectorAll<HTMLElement>(".rule").forEach((li) =>
    li.addEventListener("click", () => onSelect(li.dataset.rule === activeId ? null : li.dataset.rule!)),
  );
}

/** The scrolling issue strip at the bottom: one entry per failing rule. */
export function renderTicker(el: HTMLElement, report: CheckReport) {
  const items = report.results.flatMap(({ rule, failed, checked, modelProblems }) => {
    if (modelProblems.length) return modelProblems.map((p) => [rule.id, p]);
    if (failed.length) return [[rule.id, `${rule.title}: ${failed.length} of ${checked} elements fail`]];
    return [];
  });
  if (!items.length) {
    el.innerHTML = `<span class="check-pass">All checks pass.</span>`;
    return;
  }
  // The list is repeated once so the CSS animation can loop without a jump.
  const html = items.map(([id, text]) => `<span class="ticker-item"><b>${id}</b>${esc(text)}</span>`).join("");
  el.innerHTML = `<div class="ticker-track">${html}${html}</div>`;
}

export function renderProperties(
  el: HTMLElement,
  info: ElementInfo | null,
  failures: { rule: Rule; reason: string }[] = [],
  assessed = true,
  carbonHtml = "",
) {
  if (!info) {
    el.innerHTML = `<p class="hint">Click an element in the model to see its IFC data.</p>`;
    return;
  }
  const materials = info.materials.length
    ? `<dl>${info.materials
        .map((m) => `<dt>${m.thickness ? `${Math.round(m.thickness * 1000)} mm` : "–"}</dt><dd>${esc(m.name)}</dd>`)
        .join("")}</dl>`
    : `<span class="tag-missing">No material assigned</span>`;

  const checks = !assessed
    ? `<p class="hint">Outside the LCA scope (not a building element).</p>`
    : failures.length
      ? `<dl>${failures.map((f) => `<dt class="check-fail">${f.rule.id}</dt><dd>${esc(f.reason)}</dd>`).join("")}</dl>`
      : `<p class="check-pass">Passes every check.</p>`;

  el.innerHTML = `
    <div class="title">${esc(info.name)}</div>
    <div class="sub">${esc(info.category)} · ${esc(info.guid)}</div>
    ${carbonHtml}
    <h4>Readiness checks</h4>
    ${checks}
    <h4>Materials</h4>
    <div>${materials}</div>
    ${info.psets
      .map(
        (p) => `<h4>${esc(p.name)}</h4><dl>${p.props
          .map((x) => `<dt>${esc(x.name)}</dt><dd>${esc(x.value)}</dd>`)
          .join("")}</dl>`,
      )
      .join("")}`;
}

/** Stacked bars showing where material and quantity data come from. */
export function renderCoverage(el: HTMLElement, c: Coverage) {
  const bar = (title: string, total: number, ok: number, parts: [string, number, string][]) => `
    <div class="cov">
      <div class="cov-title"><span>${title}</span><span>${ok} of ${total}</span></div>
      <div class="cov-bar">${parts.map(([, n, color]) => `<i style="width:${(n / total) * 100}%;background:${color}"></i>`).join("")}</div>
      <div class="cov-legend">${parts
        .filter(([, n]) => n > 0)
        .map(([label, n, color]) => `<span><b style="background:${color}"></b>${label} ${n}</span>`)
        .join("")}</div>
    </div>`;

  el.innerHTML =
    bar("Material", c.total, c.total - c.material.missing, [
      ["on element", c.material.element, "#0f9d7a"],
      ["from type", c.material.type, "#56b89a"],
      ["from parent", c.material.parent, "#9fd8c5"],
      ["missing", c.material.missing, "#d64545"],
    ]) +
    bar("Quantity", c.total, c.total - c.quantity.none, [
      ["from IFC", c.quantity.ifc, "#0f9d7a"],
      ["from 3D geometry", c.quantity.geometry, "#f0b429"],
      ["none", c.quantity.none, "#d64545"],
    ]) +
    (c.layers.of
      ? bar("Layer thicknesses", c.layers.of, c.layers.complete, [
          ["complete", c.layers.complete, "#0f9d7a"],
          ["missing", c.layers.of - c.layers.complete, "#d64545"],
        ])
      : "");
}

// ---- Carbon -------------------------------------------------------------

/** One-hue ramp for the heatmap, light (low) to dark (high). Validated as an ordinal ramp on the light surface. */
export const CARBON_RAMP = ["#f2a072", "#ea7a45", "#d45a24", "#a83f14", "#73270a"];

const kg = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("en", { maximumFractionDigits: 1 })} t` : `${v.toLocaleString("en", { maximumFractionDigits: v < 10 ? 1 : 0 })} kg`;

/** Quintile breaks over the element totals, so each colour holds about a fifth of the elements. */
export function carbonBins(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return [0.2, 0.4, 0.6, 0.8].map(q);
}

export function binOf(v: number, breaks: number[]) {
  let i = 0;
  while (i < breaks.length && v >= breaks[i]) i++;
  return i;
}

export function carbonLegend(breaks: number[], provisional: boolean) {
  const edges = [null, ...breaks, null];
  const rows = CARBON_RAMP.map((c, i) => {
    const lo = edges[i], hi = edges[i + 1];
    const label = lo === null ? `under ${kg(hi!)}` : hi === null ? `${kg(lo)} and more` : `${kg(lo)} – ${kg(hi)}`;
    return `<span><i style="background:${c}"></i>${label}</span>`;
  }).reverse();
  return `<strong class="legend-title">kg CO₂e per element</strong>${rows.join("")}
    <span><i style="background:#e4e9ed"></i>not calculated</span>
    ${provisional ? `<span class="legend-note">Includes unreviewed AI matches</span>` : ""}`;
}


export function renderCarbon(
  el: HTMLElement,
  r: CarbonReport,
  opts: { floorArea: { value: number; rooms: number } | null; includeProvisional: boolean; unreviewed: number; assessed: number },
) {
  const max = Math.max(...Object.values(r.byModule).map(Math.abs), 1);
  const order = ["A1-A3", "C3", "C4", "D"];
  const byModule = Object.entries(r.byModule).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const modules = byModule
    .map(([m, v]) => `<li><span class="rule-id">${m}</span><span class="bar"><i style="width:${(Math.abs(v) / max) * 100}%"></i></span><span class="num">${kg(v)}</span></li>`)
    .join("");
  const top = r.byMaterial.slice(0, 6);
  const maxMat = Math.max(...top.map((m) => Math.abs(m.total)), 1);
  const materials = top
    .map((m) => `<li class="bar-named"><span class="mat" title="${esc(m.material)}">${esc(m.material)}</span><span class="bar"><i style="width:${(Math.abs(m.total) / maxMat) * 100}%"></i></span><span class="num">${kg(m.total)}</span></li>`)
    .join("");
  const reasons = new Map<string, number>();
  for (const why of r.missing.values()) reasons.set(why, (reasons.get(why) ?? 0) + 1);
  const missing = [...reasons].map(([w, n]) => `${n} ${w}`).join(", ");
  const perM2 = opts.floorArea ? r.total / opts.floorArea.value : null;

  el.innerHTML = `
    <div class="kpi-pair">
      <div><div class="kpi"><span>${(r.total / 1000).toLocaleString("en", { maximumFractionDigits: 1 })}</span><small>t CO₂e</small></div><p class="hint">Total, ${byModule.map(([m]) => m).join(" + ")}</p></div>
      <div><div class="kpi"><span>${perM2 === null ? "–" : Math.round(perM2)}</span><small>kg/m²</small></div><p class="hint">${opts.floorArea ? `per m² of room area (${Math.round(opts.floorArea.value)} m², ${opts.floorArea.rooms} rooms)` : "no rooms in the model"}</p></div>
    </div>
    <p class="hint">${r.elements.size} of ${opts.assessed} elements calculated${missing ? `; not calculated: ${missing}` : ""}.</p>
    <label class="toggle"><input type="checkbox" id="carbon-provisional" ${opts.includeProvisional ? "checked" : ""}/>
      Count unreviewed AI matches${opts.unreviewed ? ` (${opts.unreviewed} of the materials)` : ""}</label>
    ${opts.includeProvisional && r.provisionalTotal ? `<p class="hint prov-note">${kg(r.provisionalTotal)} of the total comes from matches nobody has approved yet.</p>` : ""}
    <h4 class="sub-h">By life-cycle module</h4>
    <ul class="bars">${modules}</ul>
    <h4 class="sub-h">Largest materials</h4>
    <ul class="bars">${materials}</ul>`;
}

/** The carbon section of the selected-element card. */
export function carbonDetail(c: ElementCarbon | undefined, why: string | undefined) {
  if (!c) return `<h4>Embodied carbon</h4><p class="hint">Not calculated${why ? `: ${esc(why)}` : ""}.</p>`;
  const unit = (u?: string) => (u ?? "").replace("3", "³").replace("2", "²");
  const rows = c.layers
    .map((l) =>
      l.skipped
        ? `<dt>${esc(l.material)}</dt><dd class="hint">${esc(l.skipped)}</dd>`
        : `<dt>${esc(l.material)}${l.provisional ? ` <em class="prov">provisional</em>` : ""}</dt><dd>${kg(l.total)} <span class="hint">· ${l.quantity!.toLocaleString("en", { maximumFractionDigits: 2 })} ${unit(l.unit)} of ${esc(l.dataset!.name)}</span></dd>`,
    )
    .join("");
  return `<h4>Embodied carbon · ${kg(c.total)} CO₂e</h4>
    <p class="hint">Volume ${c.volume.toFixed(2)} m³ from ${c.volumeSource === "ifc" ? "IFC quantities" : "3D geometry"}, split over the layers by thickness.</p>
    <dl class="carbon-dl">${rows}</dl>`;
}
