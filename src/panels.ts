// Small render functions for the dashboard cards. Plain DOM, no framework.
import type { ElementInfo, ModelSummary } from "./model-data";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderCategories(el: HTMLElement, categories: ModelSummary["categories"]) {
  el.innerHTML = categories
    .slice(0, 8)
    .map((c) => `<li><span>${esc(c.name)}</span><span>${c.count}</span></li>`)
    .join("");
}

export function renderProperties(el: HTMLElement, info: ElementInfo | null) {
  if (!info) {
    el.innerHTML = `<p class="hint">Click an element in the model to see its IFC data.</p>`;
    return;
  }
  const materials = info.materials.length
    ? `<dl>${info.materials
        .map((m) => `<dt>${m.thickness ? `${Math.round(m.thickness * 1000)} mm` : "–"}</dt><dd>${esc(m.name)}</dd>`)
        .join("")}</dl>`
    : `<span class="tag-missing">No material assigned</span>`;

  el.innerHTML = `
    <div class="title">${esc(info.name)}</div>
    <div class="sub">${esc(info.category)} · ${esc(info.guid)}</div>
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
