// LCA datasets (Ökobaudat), the project's system boundary, and the mapping
// from IFC material names to datasets. A dataset only counts in the results
// when its mapping is approved and its scope matches the system boundary (or
// a mismatch was approved with a recorded reason).

/** Life-cycle modules of EN 15978 / EN 15804 that the app calculates. */
export const MODULES = ["A1-A3", "C3", "C4", "D"] as const;
export type Module = (typeof MODULES)[number];

export type Standard = "EN 15804+A1" | "EN 15804+A2";

export interface Dataset {
  uuid: string;
  name: string; // English name
  nameDe: string;
  category: string;
  /** Ökobaudat data type: generic, average, representative, specific or template. */
  type: string;
  standard: Standard;
  /** Declared unit: m3, m2, kg, m or pcs. GWP values are per 1 of it. */
  unit: string;
  /** Bulk density in kg/m³, when given. */
  density: number | null;
  /** Mass per m², when given (for products declared per m²). */
  areaWeight: number | null;
  /** GWP in kg CO₂e per declared unit. For +A2 datasets this is GWP-total. */
  gwp: Partial<Record<Module, number>>;
  validUntil: string;
  conformity: string;
  /** End-of-life scenario per module, when the dataset names one. */
  scenarios?: Partial<Record<Module, string>>;
}

export interface DatasetFile {
  source: string;
  version: string;
  datasets: Dataset[];
}

export interface SystemBoundary {
  modules: Module[];
  standard: Standard;
}

/** The project's system boundary. Editable in project settings (day 6). */
export const DEFAULT_BOUNDARY: SystemBoundary = {
  modules: ["A1-A3", "C3", "C4"],
  standard: "EN 15804+A2",
};

export interface Mapping {
  /** IFC material name, exactly as in the model. */
  material: string;
  /** Matched dataset, or null when the material is excluded. */
  uuid: string | null;
  /** Why this dataset (or why excluded). */
  reason: string;
  /** Other datasets worth considering, for the swap and the review. */
  alternatives: string[];
  /**
   * Share of the layer volume that is this material. 1 for a solid layer;
   * less for layers like stud walls, where the layer is mostly cavity.
   */
  share: number;
  status: "suggested" | "approved" | "excluded";
  /** Set when the dataset's scope differs from the system boundary and that was accepted. */
  scopeApproval?: { reason: string; date: string };
}

export interface MappingFile {
  model: string;
  dataset: string; // dataset file version this mapping refers to
  suggestedBy: string;
  /** Who approved the mapping, and when. */
  reviewedBy?: string;
  reviewed?: string;
  mappings: Mapping[];
}

/** How a dataset differs from the system boundary. Empty when it fits. */
export function scopeIssues(ds: Dataset, boundary: SystemBoundary): string[] {
  const issues: string[] = [];
  if (ds.standard !== boundary.standard) {
    issues.push(`declared to ${ds.standard}, project uses ${boundary.standard}`);
  }
  // End of life: Ökobaudat datasets follow one scenario, so a recycled product
  // declares C3 (processing) and a landfilled one C4 (disposal). One of the two
  // is enough; neither means the end of life is missing.
  const eol: Module[] = boundary.modules.filter((m) => m === "C3" || m === "C4");
  // D is reported for information only, so a dataset without it still fits.
  const missing = boundary.modules.filter((m) => m !== "D" && !eol.includes(m) && ds.gwp[m] === undefined);
  if (eol.length && eol.every((m) => ds.gwp[m] === undefined)) missing.push(eol.join("/") as Module);
  if (missing.length) issues.push(`no value for ${missing.join(", ")}`);
  return issues;
}

export type MappingState =
  | "counts" // approved, scope fits or mismatch approved
  | "excluded" // approved as not counted (e.g. an air gap)
  | "to-review" // suggested, waiting for approval
  | "scope" // approved, but the scope mismatch isn't approved yet
  | "unmatched"; // no mapping at all

export function mappingState(m: Mapping | undefined, ds: Dataset | undefined, boundary: SystemBoundary): MappingState {
  if (!m) return "unmatched";
  if (m.status === "excluded") return "excluded";
  if (!ds) return "unmatched";
  if (m.status !== "approved") return "to-review";
  if (scopeIssues(ds, boundary).length && !m.scopeApproval) return "scope";
  return "counts";
}

/** Plain-language label for each state, as shown in the review table. */
export const STATE_LABEL: Record<MappingState, string> = {
  counts: "Counts",
  excluded: "Excluded",
  "to-review": "To review",
  scope: "Scope mismatch",
  unmatched: "No dataset",
};

/** Loads the dataset file and the mapping for a model; reviewer edits are kept in the browser. */
export async function loadLca(mappingUrl: string) {
  const [data, mapping] = await Promise.all([
    fetch("data/oekobaudat-2024-II.json").then((r) => r.json() as Promise<DatasetFile>),
    mappingUrl ? fetch(mappingUrl).then((r) => (r.ok ? (r.json() as Promise<MappingFile>) : null)) : null,
  ]);
  const byUuid = new Map(data.datasets.map((d) => [d.uuid, d]));
  return { data, byUuid, mapping };
}

const STORE_KEY = (model: string) => `ifc-carbon-mapping:${model}`;

/** Reviewer edits saved in this browser, on top of the published mapping. */
export function loadEdits(model: string): Record<string, Mapping> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY(model)) ?? "{}");
  } catch {
    return {};
  }
}

export function saveEdits(model: string, edits: Record<string, Mapping>) {
  try {
    localStorage.setItem(STORE_KEY(model), JSON.stringify(edits));
  } catch {
    // Storage blocked (private window): edits last for this visit only.
  }
}
