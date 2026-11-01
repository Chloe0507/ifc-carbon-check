// Small render functions for the dashboard cards. Plain DOM, no framework.
import type { ElementInfo, ModelSummary } from "./model-data";
import type { CheckReport, Rule } from "./checks";
import type { Coverage } from "./coverage";

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
