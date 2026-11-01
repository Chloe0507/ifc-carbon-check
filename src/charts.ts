// The life-cycle chart: carbon per element group, one stacked bar per group,
// one segment per module. Negative values (stored biogenic carbon in A1–A3,
// benefits in D) extend left of the zero line.
import type { CarbonReport } from "./carbon";
import type { Module } from "./lca-data";

/** Fixed module colours (validated categorical palette: blue, orange, aqua, violet). */
export const MODULE_COLOR: Record<Module, string> = {
  "A1-A3": "#2a78d6",
  C3: "#eb6834",
  C4: "#1baf7a",
  D: "#6250d6",
};
const MODULE_LABEL: Record<Module, string> = {
  "A1-A3": "A1–A3 Product",
  C3: "C3 Waste processing",
  C4: "C4 Disposal",
  D: "D Beyond the boundary",
};

const t = (kg: number) => `${(kg / 1000).toLocaleString("en", { maximumFractionDigits: 1 })} t`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderLifecycleChart(el: HTMLElement, r: CarbonReport, modules: Module[]) {
  const rows = r.byGroup;
  if (!rows.length) {
    el.innerHTML = `<p class="hint">Nothing calculated yet.</p>`;
    return;
  }
  // Scale: the widest positive and negative stacks set the zero line's position.
  const pos = (m: Partial<Record<Module, number>>) => modules.reduce((s, k) => s + Math.max(0, m[k] ?? 0), 0);
  const neg = (m: Partial<Record<Module, number>>) => modules.reduce((s, k) => s + Math.min(0, m[k] ?? 0), 0);
  const maxPos = Math.max(...rows.map((g) => pos(g.modules)), 1);
  const maxNeg = Math.abs(Math.min(...rows.map((g) => neg(g.modules)), 0));
  const span = maxPos + maxNeg;
  const zero = (maxNeg / span) * 100;
  const pct = (v: number) => (Math.abs(v) / span) * 100;

  const bar = (g: (typeof rows)[number]) => {
    let right = zero;
    let left = zero;
    const segs = modules
      .filter((m) => (g.modules[m] ?? 0) !== 0)
      .map((m) => {
        const v = g.modules[m]!;
        const w = pct(v);
        const x = v >= 0 ? right : left - w;
        if (v >= 0) right += w;
        else left -= w;
        return `<i class="seg" style="left:${x}%;width:${w}%;background:${MODULE_COLOR[m]}" data-tip="${esc(g.group)} · ${MODULE_LABEL[m]}: ${t(v)} CO₂e"></i>`;
      })
      .join("");
    return `<div class="lc-row">
      <div class="lc-label"><span>${esc(g.group)}</span><span class="num">${t(g.total)}</span></div>
      <div class="lc-track">${maxNeg ? `<b class="lc-zero" style="left:${zero}%"></b>` : ""}${segs}</div>
    </div>`;
  };

  el.innerHTML = `
    <div class="lc-legend">${modules.map((m) => `<span><i style="background:${MODULE_COLOR[m]}"></i>${m}</span>`).join("")}</div>
    ${rows.map(bar).join("")}
    ${modules.includes("D") ? `<p class="hint">Module D is shown for information and isn't in the totals.</p>` : ""}
    <details class="lc-table"><summary>Show as table</summary>
      <table><thead><tr><th></th>${modules.map((m) => `<th>${m}</th>`).join("")}<th>Total</th></tr></thead>
      <tbody>${rows
        .map((g) => `<tr><td>${esc(g.group)}</td>${modules.map((m) => `<td>${t(g.modules[m] ?? 0)}</td>`).join("")}<td>${t(g.total)}</td></tr>`)
        .join("")}</tbody></table>
    </details>
    <div class="lc-tip hidden"></div>`;

  // Hover tooltip on each segment (the hit target is the whole segment).
  const tip = el.querySelector<HTMLElement>(".lc-tip")!;
  el.querySelectorAll<HTMLElement>(".seg").forEach((s) => {
    s.addEventListener("pointerenter", () => {
      tip.textContent = s.dataset.tip!;
      tip.classList.remove("hidden");
    });
    s.addEventListener("pointermove", (e) => {
      const box = el.getBoundingClientRect();
      tip.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 180)}px`;
      tip.style.top = `${e.clientY - box.top + 14}px`;
    });
    s.addEventListener("pointerleave", () => tip.classList.add("hidden"));
  });
}
