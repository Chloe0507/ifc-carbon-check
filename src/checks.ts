// The readiness check. Step 0 (B-rules) asks "is this a usable BIM model?",
// then the R-rules ask "does it hold what an LCA needs?". Each rule mirrors a
// specification in public/requirements/lca-ready.ids where IDS can express it.
import type { ElementRecord, ModelData } from "./ifc-data";

export type RuleGroup = "BIM-ready" | "LCA-ready";

export interface Rule {
  id: string;
  group: RuleGroup;
  title: string;
  /** Which elements the rule looks at; model-level rules have none. */
  appliesTo?: (el: ElementRecord) => boolean;
  /** Returns why an element fails, or null when it passes. */
  test?: (el: ElementRecord, ctx: Context) => string | null;
  /** Model-level rules return a list of problems (empty = pass). */
  testModel?: (model: ModelData, ctx: Context) => string[];
  /** Can this rule be written as IDS? Shown in the UI for transparency. */
  inIds: boolean;
}

export interface Context {
  model: ModelData;
  /** Elements that share a class and an identical bounding box with another one. */
  duplicates: Set<number>;
}

export interface RuleResult {
  rule: Rule;
  checked: number;
  failed: number[]; // element ids
  modelProblems: string[];
}

export interface CheckReport {
  results: RuleResult[];
  /** The elements we assess: building elements that aren't just containers for parts. */
  assessed: ElementRecord[];
  /** Element id -> the rules it fails, with reasons. */
  failures: Map<number, { rule: Rule; reason: string }[]>;
  passRate: number; // 0..1, share of assessed elements passing every element rule
}

const has = (cls: string, ...names: string[]) => names.some((n) => cls.startsWith(n));
const isLayeredClass = (el: ElementRecord) => has(el.ifcClass, "IFCWALL", "IFCSLAB", "IFCROOF");
const isStructuralClass = (el: ElementRecord) =>
  has(el.ifcClass, "IFCWALL", "IFCSLAB", "IFCBEAM", "IFCCOLUMN") && el.ifcClass !== "IFCCURTAINWALL";

/** Finds a property by name in any "common" property set (Pset_WallCommon, Pset_SlabCommon…). */
function commonProp(el: ElementRecord, prop: string) {
  for (const [set, props] of Object.entries(el.psets)) {
    if (/^pset_.*common$/i.test(set) && prop in props && props[prop] !== null) return props[prop];
  }
  return undefined;
}

const KNOWN_SCHEMAS = ["IFC2X3", "IFC4", "IFC4X3", "IFC4X3_ADD2"];
const VAGUE_NAME = /^(default|unnamed( material)?|<unnamed>|material|generic|none|-)?$/i;
const QUANTITIES = /^(net|gross)?(volume|area|sidearea|footprintarea|length|width|height|depth)$/i;

export const RULES: Rule[] = [
  // --- Step 0: BIM-ready -------------------------------------------------
  {
    id: "B1",
    group: "BIM-ready",
    title: "File is readable IFC with a known schema",
    inIds: false,
    testModel: (m) => (KNOWN_SCHEMAS.includes(m.schema.toUpperCase()) ? [] : [`Unknown schema "${m.schema}"`]),
  },
  {
    id: "B2",
    group: "BIM-ready",
    title: "Elements use a specific IFC class, not a generic proxy",
    inIds: true,
    appliesTo: () => true,
    test: (el) => (el.ifcClass === "IFCBUILDINGELEMENTPROXY" ? "Modelled as a generic proxy element" : null),
  },
  {
    id: "B3",
    group: "BIM-ready",
    title: "Every element sits in a building storey",
    inIds: true,
    appliesTo: () => true,
    test: (el, { model }) => {
      const parent = el.parentId !== null ? model.elements.get(el.parentId) : undefined;
      return el.storeyId !== null || parent?.storeyId != null ? null : "Not contained in any storey";
    },
  },
  {
    id: "B4",
    group: "BIM-ready",
    title: "Storeys are named and ordered; length unit is SI",
    inIds: false,
    testModel: (m) => {
      const problems: string[] = [];
      if (m.lengthScale === null) problems.push("Length unit is not an SI unit");
      if (!m.storeys.length) problems.push("Model has no building storeys");
      for (const s of m.storeys) {
        if (!s.name.trim()) problems.push(`Storey #${s.id} has no name`);
        if (s.elevation === null) problems.push(`Storey "${s.name}" has no elevation`);
      }
      const elevations = m.storeys.map((s) => s.elevation).filter((e): e is number => e !== null);
      if (new Set(elevations).size !== elevations.length) problems.push("Two storeys share the same elevation");
      return problems;
    },
  },
  {
    id: "B5",
    group: "BIM-ready",
    title: "No duplicate elements in the same place",
    inIds: false,
    appliesTo: () => true,
    test: (el, { duplicates }) => (duplicates.has(el.id) ? "Duplicate: same class and same position as another element" : null),
  },

  // --- LCA-ready ---------------------------------------------------------
  {
    id: "R1",
    group: "LCA-ready",
    title: "Every element has a material assigned",
    inIds: true,
    appliesTo: () => true,
    test: (el) => (el.materials.length ? null : "No material assigned"),
  },
  {
    id: "R2",
    group: "LCA-ready",
    title: "Walls, slabs and roofs use a layer set with thicknesses",
    inIds: false, // IDS can require a material, but not a thickness per layer
    appliesTo: isLayeredClass,
    test: (el) => {
      if (!el.materials.length) return "No material, so no layers";
      if (!el.layered) return "Material is not a layer set";
      const missing = el.materials.filter((m) => !m.thickness);
      return missing.length ? `${missing.length} layer(s) without thickness` : null;
    },
  },
  {
    id: "R3",
    group: "LCA-ready",
    title: "Material names describe the material",
    inIds: true,
    appliesTo: (el) => el.materials.length > 0,
    test: (el) => {
      const vague = el.materials.filter((m) => VAGUE_NAME.test(m.name.trim()));
      return vague.length ? `Vague material name: "${vague[0].name}"` : null;
    },
  },
  {
    id: "R4",
    group: "LCA-ready",
    title: "Element carries base quantities (volume or area)",
    inIds: true,
    appliesTo: () => true,
    test: (el) =>
      Object.values(el.qsets).some((q) => Object.keys(q).some((k) => QUANTITIES.test(k)))
        ? null
        : "No quantity set with volume or area",
  },
  {
    id: "R5",
    group: "LCA-ready",
    title: "IsExternal is set",
    inIds: true,
    appliesTo: () => true,
    test: (el) => (commonProp(el, "IsExternal") === undefined ? "IsExternal missing" : null),
  },
  {
    id: "R6",
    group: "LCA-ready",
    title: "LoadBearing is set on walls, slabs, beams and columns",
    inIds: true,
    appliesTo: isStructuralClass,
    test: (el) => (commonProp(el, "LoadBearing") === undefined ? "LoadBearing missing" : null),
  },
  {
    id: "R7",
    group: "LCA-ready",
    title: "Element has a classification reference",
    inIds: true,
    appliesTo: () => true,
    test: (el) => (el.classifications.length ? null : "No classification"),
  },
];

/**
 * Runs every rule. `boxes` maps element id -> rounded bounding box key, used to
 * find duplicates (computed from the 3D geometry by the caller).
 */
export function runChecks(model: ModelData, boxes: Map<number, string>): CheckReport {
  // Containers (an IfcRoof made of slabs, a stair made of flights) are judged by their parts.
  const parents = new Set([...model.elements.values()].map((e) => e.parentId).filter((p) => p !== null));
  const assessed = [...model.elements.values()].filter((e) => !parents.has(e.id));

  const seen = new Map<string, number>();
  const duplicates = new Set<number>();
  for (const el of assessed) {
    const box = boxes.get(el.id);
    if (!box) continue;
    const key = `${el.ifcClass}|${box}`;
    if (seen.has(key)) {
      duplicates.add(el.id);
      duplicates.add(seen.get(key)!);
    } else seen.set(key, el.id);
  }

  const ctx: Context = { model, duplicates };
  const failures = new Map<number, { rule: Rule; reason: string }[]>();
  const results: RuleResult[] = RULES.map((rule) => {
    if (rule.testModel) return { rule, checked: 0, failed: [], modelProblems: rule.testModel(model, ctx) };
    const targets = assessed.filter((el) => rule.appliesTo!(el));
    const failed: number[] = [];
    for (const el of targets) {
      const reason = rule.test!(el, ctx);
      if (reason === null) continue;
      failed.push(el.id);
      failures.set(el.id, [...(failures.get(el.id) ?? []), { rule, reason }]);
    }
    return { rule, checked: targets.length, failed, modelProblems: [] };
  });

  const passing = assessed.filter((el) => !failures.has(el.id)).length;
  return { results, assessed, failures, passRate: assessed.length ? passing / assessed.length : 0 };
}
