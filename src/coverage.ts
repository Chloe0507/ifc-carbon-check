// Where the LCA inputs for each element come from. An LCA is only as
// trustworthy as its inputs, so the dashboard shows this next to the results.
import type { ElementRecord } from "./ifc-data";

export type QuantitySource = "ifc" | "geometry" | "none";

export interface Coverage {
  total: number;
  material: Record<"element" | "type" | "parent" | "missing", number>;
  quantity: Record<QuantitySource, number>;
  /** Layered elements (walls, slabs, roofs) whose every layer has a thickness. */
  layers: { complete: number; of: number };
  /** Elements with both a material and a quantity: the carbon can be calculated. */
  calculable: number;
  /** Per element, where its quantity will come from. */
  quantitySource: Map<number, QuantitySource>;
}

const QUANTITY = /^(net|gross)?(volume|area|sidearea|footprintarea)$/i;

export function hasIfcQuantity(el: ElementRecord) {
  return Object.values(el.qsets).some((q) => Object.keys(q).some((k) => QUANTITY.test(k)));
}

/** `volumes` holds the volume worked out from each element's 3D geometry (m³). */
export function measureCoverage(assessed: ElementRecord[], volumes: Map<number, number>): Coverage {
  const c: Coverage = {
    total: assessed.length,
    material: { element: 0, type: 0, parent: 0, missing: 0 },
    quantity: { ifc: 0, geometry: 0, none: 0 },
    layers: { complete: 0, of: 0 },
    calculable: 0,
    quantitySource: new Map(),
  };

  for (const el of assessed) {
    c.material[el.materialSource ?? "missing"]++;

    const source: QuantitySource = hasIfcQuantity(el) ? "ifc" : (volumes.get(el.id) ?? 0) > 0 ? "geometry" : "none";
    c.quantity[source]++;
    c.quantitySource.set(el.id, source);

    if (el.layered) {
      c.layers.of++;
      if (el.materials.every((m) => m.thickness)) c.layers.complete++;
    }
    if (el.materials.length && source !== "none") c.calculable++;
  }
  return c;
}
