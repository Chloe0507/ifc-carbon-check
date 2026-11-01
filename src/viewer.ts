// The 3D viewer: sets up a That Open Engine world, loads IFC files into it
// and turns mouse clicks into selected element ids.
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";

// Resolve static files relative to the page, so the built site works from
// any folder (for example a GitHub Pages sub-path).
const asset = (path: string) => new URL(path, window.location.href).href;

const SELECT_COLOR = new THREE.Color("#1f6feb");

const solid = (color: THREE.Color): FRAGS.MaterialDefinition => ({
  color,
  renderedFaces: FRAGS.RenderedFaces.TWO,
  opacity: 1,
  transparent: false,
});

export class Viewer {
  readonly components = new OBC.Components();
  readonly world: OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>;
  readonly fragments: OBC.FragmentsManager;
  model: FRAGS.FragmentsModel | null = null;

  constructor(container: HTMLElement) {
    const worlds = this.components.get(OBC.Worlds);
    this.world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();

    this.world.scene = new OBC.SimpleScene(this.components);
    this.world.scene.setup();
    this.world.scene.three.background = null; // let the CSS gradient show through

    this.world.renderer = new OBC.SimpleRenderer(this.components, container);
    this.world.camera = new OBC.SimpleCamera(this.components);
    this.world.camera.controls.setLookAt(20, 15, 20, 0, 0, 0);

    this.components.init();
    const grid = this.components.get(OBC.Grids).create(this.world);
    grid.setup({ color: new THREE.Color("#c9d3da"), primarySize: 1, secondarySize: 5, distance: 300 });

    this.fragments = this.components.get(OBC.FragmentsManager);
    this.fragments.init(asset("worker/worker.mjs"));

    // Fragments stream geometry by camera position, so refresh when the camera stops.
    this.world.camera.controls.addEventListener("rest", () => this.fragments.core.update(true));

    this.fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(this.world.camera.three);
      this.world.scene.three.add(model.object);
      this.fragments.core.update(true);
    });

  }

  /** Loads an IFC file (as raw bytes), replacing any model already shown. */
  async loadIfc(bytes: Uint8Array, name: string) {
    if (this.model) {
      await this.fragments.core.disposeModel(this.model.modelId);
      this.model = null;
    }
    const loader = this.components.get(OBC.IfcLoader);
    await loader.setup({ autoSetWasm: false, wasm: { path: asset("wasm/"), absolute: true } });
    this.model = await loader.load(bytes, true, name);
    // Spaces are room volumes, not physical elements: hide them so they don't block clicks.
    const spaces = await this.model.getItemsOfCategories([/^IFCSPACE$/i]);
    await this.model.setVisible(Object.values(spaces).flat(), false);
    await this.fitView();
    return this.model;
  }

  async fitView() {
    if (!this.model) return;
    const sphere = new THREE.Sphere();
    this.model.box.getBoundingSphere(sphere);
    await this.world.camera.controls.fitToSphere(sphere, true);
  }

  /** Calls back with the clicked element's local id, or null for empty space. */
  onPick(callback: (localId: number | null) => void) {
    const dom = this.world.renderer!.three.domElement;
    let down = { x: 0, y: 0 };
    dom.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
    dom.addEventListener("pointerup", async (e) => {
      // Ignore drags: only a click (little mouse movement) selects.
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !this.model) return;
      const hit = await this.model.raycast({
        camera: this.world.camera.three,
        mouse: new THREE.Vector2(e.clientX, e.clientY),
        dom,
      });
      const id = hit ? hit.localId : null;
      await this.select(id);
      callback(id);
    });
  }

  // Colours are applied as highlights, the one styling layer fragments keep
  // per item. We remember them so a selection can be drawn on top and undone.
  private painted: { ids: number[]; style: FRAGS.MaterialDefinition }[] = [];

  /**
   * Colours groups of elements; everything else fades out when `fadeOthers` is set.
   * Pass no groups to go back to the model's own colours.
   */
  async paint(groups: { ids: number[]; color: string }[], fadeOthers = true) {
    if (!this.model) return;
    this.painted = groups
      .filter((g) => g.ids.length)
      .map((g) => ({ ids: g.ids, style: solid(new THREE.Color(g.color)) }));
    if (groups.length && fadeOthers) {
      const painted = new Set(groups.flatMap((g) => g.ids));
      const others = (await this.model.getItemsIdsWithGeometry()).filter((id) => !painted.has(id));
      this.painted.unshift({ ids: others, style: solid(new THREE.Color("#e4e9ed")) });
    }
    await this.redraw();
  }

  private async redraw(selected: number | null = null) {
    if (!this.model) return;
    await this.model.resetHighlight();
    for (const p of this.painted) await this.model.highlight(p.ids, p.style);
    if (selected !== null) await this.model.highlight([selected], solid(SELECT_COLOR));
    // Highlights are applied in the fragments worker; refresh once now and once
    // more after it settles, otherwise some tiles keep their old colours.
    await this.fragments.core.update(true);
    await new Promise((r) => setTimeout(r, 300));
    await this.fragments.core.update(true);
  }

  /** A key per element from its bounding box (rounded to 1 cm), to spot duplicates. */
  async boxKeys(ids: number[]) {
    const keys = new Map<number, string>();
    if (!this.model || !ids.length) return keys;
    const boxes = await this.model.getBoxes(ids);
    const r = (v: THREE.Vector3) => [v.x, v.y, v.z].map((n) => Math.round(n * 100)).join(",");
    ids.forEach((id, i) => {
      const b = boxes[i];
      if (b && !b.isEmpty()) keys.set(id, `${r(b.min)}|${r(b.max)}`);
    });
    return keys;
  }

  async select(localId: number | null) {
    await this.redraw(localId);
  }
}
