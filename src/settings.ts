// Project settings: the system boundary every dataset is checked against, and
// the reference area for kg CO2e per m². Saved in this browser.
import { DEFAULT_BOUNDARY, type Module, type Standard, type SystemBoundary } from "./lca-data";

export interface Settings {
  boundary: SystemBoundary;
  /** Manual reference area in m², or null to use the rooms in the model. */
  area: number | null;
}

const KEY = "ifc-carbon-settings";
export const DEFAULT_SETTINGS: Settings = { boundary: DEFAULT_BOUNDARY, area: null };

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s?.boundary?.modules?.length) return s;
  } catch {
    /* storage blocked or bad data: use defaults */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* edits last for this visit only */
  }
}

const OPTIONAL: { m: Module; label: string; note: string }[] = [
  { m: "C3", label: "C3 Waste processing", note: "Sorting, crushing, incineration. Releases stored biogenic carbon." },
  { m: "C4", label: "C4 Disposal", note: "Landfill." },
  { m: "D", label: "D Beyond the system boundary", note: "Recycling and energy recovery benefits. Shown next to the total, never added to it (EN 15978)." },
];

export function renderSettings(
  el: HTMLElement,
  s: Settings,
  modelArea: { value: number; rooms: number } | null,
  onChange: (s: Settings) => void,
) {
  const has = (m: Module) => s.boundary.modules.includes(m);
  el.innerHTML = `
    <div class="lib-head"><div>
      <h2>Project settings</h2>
      <p class="hint">The system boundary decides which life-cycle modules are calculated and which EN 15804 version datasets must follow. A dataset outside it is flagged in the material library and only counts once accepted with a reason. Settings are kept in this browser.</p>
    </div></div>
    <section class="set-group">
      <h3>Life-cycle modules (EN 15978)</h3>
      <label class="set-row"><input type="checkbox" checked disabled /><span><b>A1–A3 Product stage</b><small>Raw materials, transport, manufacturing. Always included.</small></span></label>
      ${OPTIONAL.map((o) => `<label class="set-row"><input type="checkbox" data-mod="${o.m}" ${has(o.m) ? "checked" : ""}/><span><b>${o.label}</b><small>${o.note}</small></span></label>`).join("")}
      <p class="hint">Not available: A4–A5 (transport to site, construction) and B (use stage). Ökobaudat has scenarios for them, but the model holds no site or operation data to choose one.</p>
    </section>
    <section class="set-group">
      <h3>EN 15804 version</h3>
      ${(["EN 15804+A2", "EN 15804+A1"] as Standard[])
        .map((v) => `<label class="set-row"><input type="radio" name="std" value="${v}" ${s.boundary.standard === v ? "checked" : ""}/><span><b>${v}</b><small>${v.endsWith("A2") ? "Current version, required for new EPDs since 2022. GWP is GWP-total (fossil + biogenic + land use)." : "Older version. Most Ökobaudat data has moved to +A2, so most datasets would be flagged."}</small></span></label>`)
        .join("")}
    </section>
    <section class="set-group">
      <h3>Reference area for kg CO₂e/m²</h3>
      <label class="set-row"><input type="radio" name="area" value="model" ${s.area === null ? "checked" : ""} ${modelArea ? "" : "disabled"}/><span><b>Room area from the model</b><small>${modelArea ? `${Math.round(modelArea.value)} m², summed from ${modelArea.rooms} rooms (IfcSpace).` : "This model has no rooms."}</small></span></label>
      <label class="set-row"><input type="radio" name="area" value="manual" ${s.area !== null ? "checked" : ""}/><span><b>Enter an area</b><small>For example the gross floor area from the drawings.</small></span>
        <input type="number" id="set-area" min="1" step="1" value="${s.area ?? (modelArea ? Math.round(modelArea.value) : "")}" /> m²</label>
    </section>
    <div class="card-actions"><button class="btn btn-ghost" id="set-reset">Reset to defaults</button></div>`;

  const update = (next: Settings) => {
    save(next);
    onChange(next);
  };
  el.querySelectorAll<HTMLInputElement>("input[data-mod]").forEach((c) =>
    c.addEventListener("change", () => {
      const order: Module[] = ["A1-A3", "C3", "C4", "D"];
      const set = new Set(s.boundary.modules);
      c.checked ? set.add(c.dataset.mod as Module) : set.delete(c.dataset.mod as Module);
      update({ ...s, boundary: { ...s.boundary, modules: order.filter((m) => set.has(m)) } });
    }),
  );
  el.querySelectorAll<HTMLInputElement>("input[name=std]").forEach((r) =>
    r.addEventListener("change", () => update({ ...s, boundary: { ...s.boundary, standard: r.value as Standard } })),
  );
  const areaInput = el.querySelector<HTMLInputElement>("#set-area")!;
  const manual = () => {
    const v = Number(areaInput.value);
    if (v > 0) update({ ...s, area: v });
  };
  el.querySelectorAll<HTMLInputElement>("input[name=area]").forEach((r) =>
    r.addEventListener("change", () => (r.value === "model" ? update({ ...s, area: null }) : manual())),
  );
  areaInput.addEventListener("change", manual);
  el.querySelector("#set-reset")!.addEventListener("click", () => update(structuredClone(DEFAULT_SETTINGS)));
}
