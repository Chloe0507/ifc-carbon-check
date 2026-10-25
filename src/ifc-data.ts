// Reads material assignments straight from the IFC file with web-ifc.
// The 3D fragments keep only part of the IFC relations (layer sets come back
// without their layers), and LCA needs every layer with its thickness.
import * as WEBIFC from "web-ifc";

export interface MaterialLayer {
  name: string;
  /** Layer thickness in metres, when the IFC gives one. */
  thickness?: number;
}

/** Material layers per element, keyed by IFC express id (= fragments local id). */
export type MaterialIndex = Map<number, MaterialLayer[]>;

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

export async function readMaterials(bytes: Uint8Array): Promise<MaterialIndex> {
  const ifc = await getApi();
  const modelId = ifc.OpenModel(bytes);
  const index: MaterialIndex = new Map();

  try {
    const scale = lengthScale(ifc, modelId);
    const rels = ifc.GetLineIDsWithType(modelId, WEBIFC.IFCRELASSOCIATESMATERIAL);
    for (let i = 0; i < rels.size(); i++) {
      // flatten = true resolves references, so nested layer sets come back whole.
      const rel = ifc.GetLine(modelId, rels.get(i), true);
      const layers = layersOf(rel.RelatingMaterial).map((x) =>
        x.thickness === undefined ? x : { ...x, thickness: x.thickness * scale },
      );
      if (!layers.length) continue;
      for (const obj of rel.RelatedObjects ?? []) {
        index.set(obj.expressID, layers);
      }
    }
  } finally {
    ifc.CloseModel(modelId);
  }
  return index;
}

/** Metres per model length unit (1 for metres, 0.001 for millimetres). */
function lengthScale(ifc: WEBIFC.IfcAPI, modelId: number) {
  const prefixes: Record<string, number> = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1 };
  const units = ifc.GetLineIDsWithType(modelId, WEBIFC.IFCSIUNIT);
  for (let i = 0; i < units.size(); i++) {
    const unit = ifc.GetLine(modelId, units.get(i));
    if (unit.UnitType?.value !== "LENGTHUNIT") continue;
    return prefixes[unit.Prefix?.value] ?? 1;
  }
  return 1; // imperial units are not handled yet
}

// IFC has several ways to say "this element is made of": a single material,
// a layer set (walls, slabs), a list, or (IFC4) constituent and profile sets.
function layersOf(m: any): MaterialLayer[] {
  if (!m) return [];
  const type = ifcTypeName(m.type);
  switch (type) {
    case "IFCMATERIAL":
      return [{ name: val(m.Name) }];
    case "IFCMATERIALLAYERSETUSAGE":
      return layersOf(m.ForLayerSet);
    case "IFCMATERIALLAYERSET":
      return (m.MaterialLayers ?? []).flatMap((l: any) => layersOf(l));
    case "IFCMATERIALLAYER":
      return [{ name: l(m.Material), thickness: num(m.LayerThickness) }];
    case "IFCMATERIALLIST":
      return (m.Materials ?? []).flatMap((x: any) => layersOf(x));
    case "IFCMATERIALCONSTITUENTSET":
      return (m.MaterialConstituents ?? []).map((c: any) => ({ name: l(c.Material) }));
    case "IFCMATERIALPROFILESETUSAGE":
      return layersOf(m.ForProfileSet);
    case "IFCMATERIALPROFILESET":
      return (m.MaterialProfiles ?? []).map((p: any) => ({ name: l(p.Material) }));
    default:
      return [];
  }
}

const l = (material: any) => (material ? val(material.Name) : "Unnamed material");
const val = (v: any) => String(v?.value ?? "Unnamed material");
const num = (v: any) => (typeof v?.value === "number" ? v.value : undefined);

function ifcTypeName(code: number) {
  return (api?.GetNameFromTypeCode(code) ?? "").toUpperCase();
}
