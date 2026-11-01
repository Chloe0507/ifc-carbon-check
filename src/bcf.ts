// Writes readiness issues as a BCF 2.1 file (BIM Collaboration Format), which
// Revit, Archicad, Solibri and BIMcollab can open next to the IFC model.
// One topic per failing rule: the failing elements are selected and coloured
// in its viewpoint, and a snapshot shows them.
import JSZip from "jszip";

export interface BcfCamera {
  /** IFC coordinates (metres, Z up). */
  position: [number, number, number];
  direction: [number, number, number];
  up: [number, number, number];
  fieldOfView: number;
}

export interface BcfTopic {
  title: string;
  description: string;
  priority: "High" | "Normal";
  labels: string[];
  /** IFC GlobalIds of the elements the issue is about. */
  guids: string[];
  /** Show only these elements when the viewpoint opens. */
  isolate: boolean;
  camera: BcfCamera;
  snapshot: Blob;
}

export interface BcfFile {
  projectGuid: string;
  ifcFilename: string;
  author: string;
  topics: BcfTopic[];
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

const xyz = (tag: string, [x, y, z]: number[]) =>
  `<${tag}><X>${x.toFixed(4)}</X><Y>${y.toFixed(4)}</Y><Z>${z.toFixed(4)}</Z></${tag}>`;

const ISSUE_COLOR = "FFD64545"; // ARGB

export async function buildBcf(file: BcfFile): Promise<Blob> {
  const zip = new JSZip();
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  zip.file(
    "bcf.version",
    `<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>`,
  );

  for (const topic of file.topics) {
    const topicGuid = crypto.randomUUID();
    const viewpointGuid = crypto.randomUUID();
    const folder = zip.folder(topicGuid)!;
    const components = topic.guids.map((g) => `<Component IfcGuid="${esc(g)}"/>`).join("");

    folder.file(
      "markup.bcf",
      `<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  <Header>
    <File IfcProject="${esc(file.projectGuid)}" isExternal="true">
      <Filename>${esc(file.ifcFilename)}</Filename>
      <Date>${now}</Date>
    </File>
  </Header>
  <Topic Guid="${topicGuid}" TopicType="Issue" TopicStatus="Open">
    <Title>${esc(topic.title)}</Title>
    <Priority>${topic.priority}</Priority>
    ${topic.labels.map((l) => `<Labels>${esc(l)}</Labels>`).join("")}
    <CreationDate>${now}</CreationDate>
    <CreationAuthor>${esc(file.author)}</CreationAuthor>
    <Description>${esc(topic.description)}</Description>
  </Topic>
  <Viewpoints Guid="${viewpointGuid}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>
    <Snapshot>snapshot.png</Snapshot>
  </Viewpoints>
</Markup>`,
    );

    const c = topic.camera;
    folder.file(
      "viewpoint.bcfv",
      `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${viewpointGuid}">
  <Components>
    ${components ? `<Selection>${components}</Selection>` : ""}
    ${topic.isolate ? `<Visibility DefaultVisibility="false"><Exceptions>${components}</Exceptions></Visibility>` : `<Visibility DefaultVisibility="true"/>`}
    ${components ? `<Coloring><Color Color="${ISSUE_COLOR}">${components}</Color></Coloring>` : ""}
  </Components>
  <PerspectiveCamera>
    ${xyz("CameraViewPoint", c.position)}
    ${xyz("CameraDirection", c.direction)}
    ${xyz("CameraUpVector", c.up)}
    <FieldOfView>${c.fieldOfView}</FieldOfView>
  </PerspectiveCamera>
</VisualizationInfo>`,
    );

    folder.file("snapshot.png", topic.snapshot);
  }

  return zip.generateAsync({ type: "blob", mimeType: "application/octet-stream" });
}
