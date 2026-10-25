// Reads the information we need out of a loaded model: what categories it
// holds, and the attributes, property sets and materials of one element.
import * as FRAGS from "@thatopen/fragments";
import type { MaterialIndex, MaterialLayer } from "./ifc-data";

export interface ModelSummary {
  schema: string;
  elementCount: number;
  furnitureCount: number;
  categories: { name: string; count: number }[];
}

export interface ElementInfo {
  localId: number;
  category: string;
  name: string;
  guid: string;
  materials: MaterialLayer[];
  psets: { name: string; props: { name: string; value: string }[] }[];
}

/** The schema name written in the IFC header, e.g. IFC2X3 or IFC4. */
export function readSchema(bytes: Uint8Array) {
  const head = new TextDecoder().decode(bytes.subarray(0, 4000));
  return head.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? "unknown";
}

// Categories that are drawn but are not building elements we assess.
const IGNORED = new Set(["IFCSPACE", "IFCOPENINGELEMENT", "IFCANNOTATION", "IFCSITE", "IFCBUILDINGSTOREY"]);
// Loose furniture is outside the building LCA scope (EN 15978 covers the building itself).
const FURNITURE = new Set(["IFCFURNISHINGELEMENT", "IFCFURNITURE"]);

export async function summarise(model: FRAGS.FragmentsModel, schema: string): Promise<ModelSummary> {
  const withGeometry = new Set(await model.getItemsIdsWithGeometry());
  const byCategory = await model.getItemsOfCategories([/^IFC/i]);

  // Merge IFC classes that read the same to a person (IfcWall + IfcWallStandardCase).
  const counts = new Map<string, number>();
  let furnitureCount = 0;
  for (const [raw, ids] of Object.entries(byCategory)) {
    if (IGNORED.has(raw.toUpperCase())) continue;
    const n = ids.filter((id) => withGeometry.has(id)).length;
    if (FURNITURE.has(raw.toUpperCase())) {
      furnitureCount += n;
      continue;
    }
    if (n) counts.set(prettyCategory(raw), (counts.get(prettyCategory(raw)) ?? 0) + n);
  }
  const categories = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  return { schema, elementCount: categories.reduce((n, c) => n + c.count, 0), furnitureCount, categories };
}

export async function describeElement(
  model: FRAGS.FragmentsModel,
  localId: number,
  materials: MaterialIndex,
): Promise<ElementInfo> {
  const [data] = await model.getItemsData([localId], {
    attributesDefault: true,
    relations: {
      IsDefinedBy: { attributes: true, relations: true },
    },
  });

  const info: ElementInfo = {
    localId,
    category: prettyCategory(String(attr(data, "_category") ?? "")),
    name: String(attr(data, "Name") ?? "Unnamed"),
    guid: String(attr(data, "_guid") ?? ""),
    materials: materials.get(localId) ?? [],
    psets: [],
  };

  for (const rel of list(data.IsDefinedBy)) {
    // Property sets carry HasProperties; quantity sets carry Quantities.
    const entries = [...list(rel.HasProperties), ...list(rel.Quantities)];
    if (!entries.length) continue;
    info.psets.push({
      name: String(attr(rel, "Name") ?? "Unnamed set"),
      props: entries.map((p) => ({ name: String(attr(p, "Name")), value: formatValue(p) })),
    });
  }

  return info;
}

// --- helpers -----------------------------------------------------------

type Item = Record<string, unknown>;

/** Attribute values come back as { value, type }; unwrap them. */
function attr(item: Item | undefined, key: string): unknown {
  const v = item?.[key] as { value?: unknown } | undefined;
  return v && typeof v === "object" && "value" in v ? v.value : undefined;
}

function list(v: unknown): Item[] {
  return Array.isArray(v) ? (v as Item[]) : [];
}

function formatValue(p: Item) {
  for (const key of ["NominalValue", "LengthValue", "AreaValue", "VolumeValue", "CountValue", "WeightValue"]) {
    const v = attr(p, key);
    if (v !== undefined && v !== null) return typeof v === "number" ? round(v) : String(v);
  }
  return "–";
}

function round(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/** IFCWALLSTANDARDCASE -> Wall standard case */
export function prettyCategory(raw: string) {
  const name = raw.replace(/^IFC/i, "").toLowerCase();
  const known: Record<string, string> = {
    wallstandardcase: "Wall", wall: "Wall", slab: "Slab", roof: "Roof", beam: "Beam",
    column: "Column", door: "Door", window: "Window", stair: "Stair", stairflight: "Stair flight",
    railing: "Railing", covering: "Covering", footing: "Footing", member: "Member", plate: "Plate",
    furnishingelement: "Furniture", flowterminal: "Sanitary / terminal", buildingelementproxy: "Proxy element",
    curtainwall: "Curtain wall",
  };
  return known[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}
