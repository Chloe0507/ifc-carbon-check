// Embodied carbon per element (EN 15978): for each material layer, the layer's
// quantity in the dataset's declared unit times the dataset's GWP, per module.
import type { ElementRecord } from "./ifc-data";
import { mappingState, type Dataset, type Mapping, type Module, type SystemBoundary } from "./lca-data";

export interface LayerResult {
  material: string;
  thickness?: number; // m
  dataset?: Dataset;
  /** Quantity in the dataset's unit (m³, m², kg), after the volume share. */
  quantity?: number;
  unit?: string;
  gwp: Partial<Record<Module, number>>; // kg CO2e
  total: number;
  /** Counted with an AI match that nobody approved yet. */
  provisional: boolean;
  /** Why this layer has no result, when it has none. */
  skipped?: string;
}

export interface ElementCarbon {
  id: number;
  volume: number; // m³, whole element
  volumeSource: "ifc" | "geometry";
  layers: LayerResult[];
  total: number;
  provisional: boolean;
}

export interface CarbonReport {
  elements: Map<number, ElementCarbon>;
  byModule: Partial<Record<Module, number>>;
  byMaterial: { material: string; total: number; provisional: boolean }[];
  total: number;
  provisionalTotal: number;
  /** Elements in scope that got no result at all, with the reason. */
  missing: Map<number, string>;
  /** Layers skipped inside otherwise calculated elements. */
  skippedLayers: number;
  /** Per element group (walls, floors, roof…), GWP per module. */
  byGroup: { group: string; modules: Partial<Record<Module, number>>; total: number }[];
}

/** Element groups for the life-cycle chart, in reading order. */
export const GROUPS = ["Walls", "Floors and slabs", "Roof", "Beams and columns", "Coverings", "Other"] as const;

export function groupOf(el: ElementRecord, all: Map<number, ElementRecord> | undefined) {
  const parent = el.parentId !== null ? all?.get(el.parentId) : undefined;
  if (el.ifcClass === "IFCROOF" || parent?.ifcClass === "IFCROOF") return "Roof";
  if (/^IFC(WALL|WALLSTANDARDCASE|CURTAINWALL)$/.test(el.ifcClass)) return "Walls";
  if (el.ifcClass === "IFCSLAB") return "Floors and slabs";
  if (/^IFC(BEAM|COLUMN|MEMBER|FOOTING|PILE)$/.test(el.ifcClass)) return "Beams and columns";
  if (el.ifcClass === "IFCCOVERING") return "Coverings";
  return "Other";
}

const IFC_VOLUME = /^(net|gross)volume$/i;

function ifcVolume(el: ElementRecord) {
  for (const q of Object.values(el.qsets)) {
    for (const [k, v] of Object.entries(q)) if (IFC_VOLUME.test(k) && v > 0) return v;
  }
  return null;
}

export function calculate(
  assessed: ElementRecord[],
  geometryVolumes: Map<number, number>,
  mappings: Map<string, Mapping>,
  byUuid: Map<string, Dataset>,
  boundary: SystemBoundary,
  includeProvisional: boolean,
  all?: Map<number, ElementRecord>,
): CarbonReport {
  const report: CarbonReport = {
    elements: new Map(),
    byModule: {},
    byMaterial: [],
    total: 0,
    provisionalTotal: 0,
    missing: new Map(),
    skippedLayers: 0,
    byGroup: [],
  };
  const groups = new Map<string, { modules: Partial<Record<Module, number>>; total: number }>();
  const byMaterial = new Map<string, { total: number; provisional: boolean }>();

  for (const el of assessed) {
    if (!el.materials.length) {
      report.missing.set(el.id, "no material");
      continue;
    }
    const fromIfc = ifcVolume(el);
    const volume = fromIfc ?? geometryVolumes.get(el.id) ?? 0;
    if (!(volume > 0)) {
      report.missing.set(el.id, "no quantity");
      continue;
    }

    // Layers split the volume by thickness. Without thicknesses (a material
    // list), each material gets an equal share.
    const totalThickness = el.materials.reduce((s, m) => s + (m.thickness ?? 0), 0);
    const byThickness = el.layered && totalThickness > 0 && el.materials.every((m) => m.thickness);
    const area = byThickness ? volume / totalThickness : null; // m² of wall/slab face

    const layers: LayerResult[] = el.materials.map((layer) => {
      const r: LayerResult = { material: layer.name, thickness: layer.thickness, gwp: {}, total: 0, provisional: false };
      const m = mappings.get(layer.name);
      const ds = m?.uuid ? byUuid.get(m.uuid) : undefined;
      const state = mappingState(m, ds, boundary);
      if (state === "excluded") return { ...r, skipped: "excluded" };
      if (state === "unmatched") return { ...r, skipped: "no dataset" };
      if (state === "scope") return { ...r, dataset: ds, skipped: "scope mismatch not accepted" };
      if (state === "to-review" && !includeProvisional) return { ...r, dataset: ds, skipped: "match not reviewed" };
      r.dataset = ds;
      r.provisional = state === "to-review";

      const layerVolume = (byThickness ? volume * (layer.thickness! / totalThickness) : volume / el.materials.length) * m!.share;
      let quantity: number | undefined;
      if (ds!.unit === "m3") quantity = layerVolume;
      else if (ds!.unit === "kg" && ds!.density) quantity = layerVolume * ds!.density;
      else if (ds!.unit === "m2" && area !== null) quantity = area * m!.share;
      if (quantity === undefined) {
        const why = ds!.unit === "kg" ? "dataset has no density" : ds!.unit === "m2" ? "no layer thickness to get an area" : `can't convert to ${ds!.unit}`;
        return { ...r, skipped: why };
      }
      r.quantity = quantity;
      r.unit = ds!.unit;
      for (const mod of boundary.modules) {
        const g = ds!.gwp[mod];
        if (g === undefined) continue;
        r.gwp[mod] = quantity * g;
        // Module D (benefits beyond the system boundary) is reported next to the total, never in it (EN 15978).
        if (mod !== "D") r.total += quantity * g;
      }
      return r;
    });

    const counted = layers.filter((l) => !l.skipped);
    if (!counted.length) {
      report.missing.set(el.id, layers[0]?.skipped ?? "no result");
      continue;
    }
    report.skippedLayers += layers.filter((l) => l.skipped && l.skipped !== "excluded").length;
    const result: ElementCarbon = {
      id: el.id,
      volume,
      volumeSource: fromIfc !== null ? "ifc" : "geometry",
      layers,
      total: counted.reduce((s, l) => s + l.total, 0),
      provisional: counted.some((l) => l.provisional),
    };
    report.elements.set(el.id, result);
    const g = groups.get(groupOf(el, all)) ?? { modules: {}, total: 0 };
    groups.set(groupOf(el, all), g);
    for (const l of counted) {
      g.total += l.total;
      for (const [mod, v] of Object.entries(l.gwp)) g.modules[mod as Module] = (g.modules[mod as Module] ?? 0) + v;
      report.total += l.total;
      if (l.provisional) report.provisionalTotal += l.total;
      for (const [mod, v] of Object.entries(l.gwp)) report.byModule[mod as Module] = (report.byModule[mod as Module] ?? 0) + v;
      const agg = byMaterial.get(l.material) ?? { total: 0, provisional: false };
      agg.total += l.total;
      agg.provisional ||= l.provisional;
      byMaterial.set(l.material, agg);
    }
  }
  report.byGroup = GROUPS.filter((g) => groups.has(g)).map((g) => ({ group: g, ...groups.get(g)! }));
  report.byMaterial = [...byMaterial].map(([material, v]) => ({ material, ...v })).sort((a, b) => b.total - a.total);
  return report;
}
