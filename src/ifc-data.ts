// Reads the information the checks and the LCA need straight from the IFC file
// with web-ifc: materials (with layer thicknesses), property and quantity sets,
// classifications, storeys and how elements are nested. The 3D fragments keep
// only part of these relations, so we read them once here and keep a table.
import * as WEBIFC from "web-ifc";

export interface MaterialLayer {
  name: string;
  /** Layer thickness in metres, when the IFC gives one. */
  thickness?: number;
}

export interface ElementRecord {
  id: number; // IFC express id (= fragments local id)
  guid: string;
  ifcClass: string; // e.g. IFCWALLSTANDARDCASE
  name: string;
  materials: MaterialLayer[];
  /** True when the materials come from a layer set (walls, slabs, roofs). */
  layered: boolean;
  /** Where the material assignment was found. */
  materialSource: "element" | "type" | "parent" | null;
  /** Property sets: set name -> property name -> value. */
  psets: Record<string, Record<string, unknown>>;
  /** Quantity sets: set name -> quantity name -> value (SI units). */
  qsets: Record<string, Record<string, number>>;
  classifications: string[];
  storeyId: number | null;
  /** The element this one is part of (e.g. a slab inside an IfcRoof). */
  parentId: number | null;
  typeId: number | null;
}

export interface Storey {
  id: number;
  name: string;
  elevation: number | null;
}

export interface ModelData {
  schema: string;
  /** GlobalId of the IfcProject, which BCF files point back to. */
  projectGuid: string;
  /** Metres per model length unit, or null when the length unit isn't SI. */
  lengthScale: number | null;
  elements: Map<number, ElementRecord>;
  storeys: Storey[];
  /** Sum of the rooms' floor areas (m²) and where it came from, or null without rooms. */
  floorArea: { value: number; rooms: number; source: string } | null;
}

/** The building elements the checks and the LCA cover. Furniture and MEP are out of scope. */
export const SCOPE_CLASSES = [
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL", "IFCSLAB", "IFCROOF", "IFCBEAM",
  "IFCCOLUMN", "IFCFOOTING", "IFCPILE", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAMP", "IFCDOOR",
  "IFCWINDOW", "IFCCOVERING", "IFCRAILING", "IFCMEMBER", "IFCPLATE", "IFCBUILDINGELEMENTPROXY",
];

const asset = (path: string) => new URL(path, window.location.href).href;

let api: WEBIFC.IfcAPI | null = null;

async function getApi() {
  if (!api) {
    api = new WEBIFC.IfcAPI();
    api.SetWasmPath(asset("wasm/"), true);
    await api.Init();
  }
  return api;
}

export async function readModel(bytes: Uint8Array): Promise<ModelData> {
  const ifc = await getApi();
  const modelId = ifc.OpenModel(bytes);

  try {
    const lengthScale = readLengthScale(ifc, modelId);
    const scale = lengthScale ?? 1;
    const elements = new Map<number, ElementRecord>();
    const typeOf = new Map<number, number>();
    const typeMaterials = new Map<number, { layers: MaterialLayer[]; layered: boolean }>();
    const typeClassifications = new Map<number, string[]>();

    const ids = (typeName: string, inherited = false) => {
      const v = ifc.GetLineIDsWithType(modelId, ifc.GetTypeCodeFromName(typeName), inherited);
      const out: number[] = [];
      for (let i = 0; i < v.size(); i++) out.push(v.get(i));
      return out;
    };
    const line = (id: number, flatten = false) => ifc.GetLine(modelId, id, flatten);

    // 1. The elements themselves.
    for (const cls of SCOPE_CLASSES) {
      for (const id of ids(cls)) {
        const e = line(id);
        elements.set(id, {
          id,
          guid: e.GlobalId?.value ?? "",
          ifcClass: cls,
          name: e.Name?.value ?? "Unnamed",
          materials: [],
          layered: false,
          materialSource: null,
          psets: {},
          qsets: {},
          classifications: [],
          storeyId: null,
          parentId: null,
          typeId: null,
        });
      }
    }

    // 2. Types (IFC2X3 uses IfcRelDefinesByType, as does IFC4).
    for (const relId of ids("IFCRELDEFINESBYTYPE")) {
      const rel = line(relId);
      for (const o of rel.RelatedObjects ?? []) typeOf.set(o.value, rel.RelatingType?.value);
    }
    for (const [elId, typeId] of typeOf) {
      const el = elements.get(elId);
      if (el) el.typeId = typeId;
    }

    // 3. Materials, on elements or on their types.
    for (const relId of ids("IFCRELASSOCIATESMATERIAL")) {
      const rel = line(relId, true); // flatten resolves nested layer sets
      const layered = isLayered(ifc, rel.RelatingMaterial);
      const layers = layersOf(ifc, rel.RelatingMaterial).map((x) =>
        x.thickness === undefined ? x : { ...x, thickness: x.thickness * scale },
      );
      if (!layers.length) continue;
      for (const o of rel.RelatedObjects ?? []) {
        const el = elements.get(o.expressID);
        if (el) Object.assign(el, { materials: layers, layered, materialSource: "element" });
        else typeMaterials.set(o.expressID, { layers, layered });
      }
    }

    // 4. Property and quantity sets.
    for (const relId of ids("IFCRELDEFINESBYPROPERTIES")) {
      const rel = line(relId);
      const targets = (rel.RelatedObjects ?? []).map((o: any) => elements.get(o.value)).filter(Boolean);
      if (!targets.length) continue;
      const def = line(rel.RelatingPropertyDefinition.value, true);
      const setName = def.Name?.value ?? "Unnamed set";
      if (def.HasProperties) {
        const props = Object.fromEntries(
          def.HasProperties.map((p: any) => [p.Name?.value, p.NominalValue?.value ?? null]),
        );
        for (const el of targets) el.psets[setName] = props;
      } else if (def.Quantities) {
        const qs: Record<string, number> = {};
        for (const q of def.Quantities) {
          const v = q.VolumeValue ?? q.AreaValue ?? q.LengthValue ?? q.CountValue ?? q.WeightValue;
          if (typeof v?.value !== "number") continue;
          const power = q.VolumeValue ? 3 : q.AreaValue ? 2 : q.LengthValue ? 1 : 0;
          qs[q.Name?.value] = v.value * scale ** power;
        }
        for (const el of targets) el.qsets[setName] = qs;
      }
    }

    // 5. Classifications, on elements or on their types.
    for (const relId of ids("IFCRELASSOCIATESCLASSIFICATION")) {
      const rel = line(relId, true);
      const c = rel.RelatingClassification;
      const label = [c?.ItemReference?.value ?? c?.Identification?.value, c?.Name?.value]
        .filter(Boolean)
        .join(" ");
      for (const o of rel.RelatedObjects ?? []) {
        const el = elements.get(o.expressID);
        if (el) el.classifications.push(label);
        else typeClassifications.set(o.expressID, [...(typeClassifications.get(o.expressID) ?? []), label]);
      }
    }

    // 6. Spatial containment and aggregation (parts of a roof, a stair, a curtain wall).
    const storeys: Storey[] = ids("IFCBUILDINGSTOREY").map((id) => {
      const s = line(id);
      const elev = s.Elevation?.value;
      return { id, name: s.Name?.value ?? "", elevation: typeof elev === "number" ? elev * scale : null };
    });
    const storeyIds = new Set(storeys.map((s) => s.id));
    for (const relId of ids("IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
      const rel = line(relId);
      if (!storeyIds.has(rel.RelatingStructure?.value)) continue;
      for (const o of rel.RelatedElements ?? []) {
        const el = elements.get(o.value);
        if (el) el.storeyId = rel.RelatingStructure.value;
      }
    }
    for (const relId of ids("IFCRELAGGREGATES")) {
      const rel = line(relId);
      for (const o of rel.RelatedObjects ?? []) {
        const el = elements.get(o.value);
        if (el && elements.has(rel.RelatingObject?.value)) el.parentId = rel.RelatingObject.value;
      }
    }

    // 7. Fill gaps from the type, then from the parent (a roof slab inherits the roof's material).
    for (const el of elements.values()) {
      if (!el.materials.length && el.typeId !== null && typeMaterials.has(el.typeId)) {
        const t = typeMaterials.get(el.typeId)!;
        Object.assign(el, { materials: t.layers, layered: t.layered, materialSource: "type" });
      }
      if (!el.classifications.length && el.typeId !== null) {
        el.classifications = typeClassifications.get(el.typeId) ?? [];
      }
    }
    for (const el of elements.values()) {
      const parent = el.parentId !== null ? elements.get(el.parentId) : undefined;
      if (!el.materials.length && parent?.materials.length) {
        Object.assign(el, { materials: parent.materials, layered: parent.layered, materialSource: "parent" });
      }
    }

    // 8. Floor area from the rooms (IfcSpace), for kg CO2e per m².
    let area = 0;
    let rooms = 0;
    const sources = new Set<string>();
    const spaceIds = new Set(ids("IFCSPACE"));
    const spaceArea = new Map<number, { value: number; source: string; rank: number }>();
    for (const relId of ids("IFCRELDEFINESBYPROPERTIES")) {
      const rel = line(relId);
      const targets = (rel.RelatedObjects ?? []).map((o: any) => o.value).filter((id: number) => spaceIds.has(id));
      if (!targets.length) continue;
      const def = line(rel.RelatingPropertyDefinition.value, true);
      // Prefer the standard quantity, then a property called Area (as Revit exports it).
      const found =
        (def.Quantities ?? []).map((q: any) => [q.Name?.value, q.AreaValue?.value]).find(([n]: any) => /^NetFloorArea$/i.test(n)) ??
        (def.Quantities ?? []).map((q: any) => [q.Name?.value, q.AreaValue?.value]).find(([n]: any) => /^GrossFloorArea$/i.test(n)) ??
        (def.HasProperties ?? []).map((p: any) => [p.Name?.value, p.NominalValue?.value]).find(([n]: any) => /^Area$/i.test(n));
      if (!found || typeof found[1] !== "number") continue;
      const rank = /NetFloorArea/i.test(found[0]) ? 0 : /GrossFloorArea/i.test(found[0]) ? 1 : 2;
      const prev = spaceArea.get(targets[0]);
      if (prev && prev.rank <= rank) continue;
      for (const t of targets) spaceArea.set(t, { value: found[1] * scale * scale, source: `${def.Name?.value}.${found[0]}`, rank });
    }
    for (const a of spaceArea.values()) {
      area += a.value;
      rooms++;
      sources.add(a.source);
    }
    const floorArea = rooms ? { value: area, rooms, source: [...sources].join(", ") } : null;

    const project = ids("IFCPROJECT")[0];
    const projectGuid = project !== undefined ? (line(project).GlobalId?.value ?? "") : "";
    return { schema: ifc.GetModelSchema(modelId), projectGuid, lengthScale, elements, storeys, floorArea };
  } finally {
    ifc.CloseModel(modelId);
  }
}

/** Metres per model length unit (1 for metres, 0.001 for millimetres); null if not SI. */
function readLengthScale(ifc: WEBIFC.IfcAPI, modelId: number) {
  const prefixes: Record<string, number> = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1 };
  const assignments = ifc.GetLineIDsWithType(modelId, WEBIFC.IFCUNITASSIGNMENT);
  if (!assignments.size()) return null;
  const assignment = ifc.GetLine(modelId, assignments.get(0), true);
  for (const unit of assignment.Units ?? []) {
    if (unit.UnitType?.value !== "LENGTHUNIT") continue;
    if (ifc.GetNameFromTypeCode(unit.type).toUpperCase() !== "IFCSIUNIT") return null; // feet, inches
    return prefixes[unit.Prefix?.value] ?? 1;
  }
  return null;
}

function isLayered(ifc: WEBIFC.IfcAPI, m: any) {
  const type = m ? ifc.GetNameFromTypeCode(m.type).toUpperCase() : "";
  return type === "IFCMATERIALLAYERSETUSAGE" || type === "IFCMATERIALLAYERSET";
}

// IFC has several ways to say "this element is made of": a single material,
// a layer set (walls, slabs), a list, or (IFC4) constituent and profile sets.
function layersOf(ifc: WEBIFC.IfcAPI, m: any): MaterialLayer[] {
  if (!m) return [];
  const name = (material: any) => String(material?.Name?.value ?? "Unnamed material");
  switch (ifc.GetNameFromTypeCode(m.type).toUpperCase()) {
    case "IFCMATERIAL":
      return [{ name: name(m) }];
    case "IFCMATERIALLAYERSETUSAGE":
      return layersOf(ifc, m.ForLayerSet);
    case "IFCMATERIALLAYERSET":
      return (m.MaterialLayers ?? []).flatMap((l: any) => layersOf(ifc, l));
    case "IFCMATERIALLAYER":
      return [{ name: name(m.Material), thickness: m.LayerThickness?.value }];
    case "IFCMATERIALLIST":
      return (m.Materials ?? []).flatMap((x: any) => layersOf(ifc, x));
    case "IFCMATERIALCONSTITUENTSET":
      return (m.MaterialConstituents ?? []).map((c: any) => ({ name: name(c.Material) }));
    case "IFCMATERIALPROFILESETUSAGE":
      return layersOf(ifc, m.ForProfileSet);
    case "IFCMATERIALPROFILESET":
      return (m.MaterialProfiles ?? []).map((p: any) => ({ name: name(p.Material) }));
    default:
      return [];
  }
}
