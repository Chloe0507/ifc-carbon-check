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

  /** Remembers where the camera is, so it can be put back after snapshots. */
  saveView() {
    const c = this.world.camera.controls;
    const position = c.getPosition(new THREE.Vector3());
    const target = c.getTarget(new THREE.Vector3());
    return () => c.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false);
  }

  /**
   * Points the camera at the given elements (or the whole model), then returns
   * the camera in IFC coordinates and a PNG snapshot, as BCF viewpoints need.
   */
  async viewpoint(ids: number[], isolate = false) {
    if (!this.model) throw new Error("No model loaded");
    // A few elements inside the building would be hidden by walls: show only them.
    const hidden = isolate ? (await this.model.getItemsByVisibility(true)).filter((id) => !ids.includes(id)) : [];
    if (hidden.length) await this.model.setVisible(hidden, false);
    const box = ids.length ? await this.model.getMergedBox(ids) : this.model.box;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Look from the front-right, a bit from above, far enough to see everything.
    const offset = new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(Math.max(sphere.radius, 2) * 2.4);
    const eye = sphere.center.clone().add(offset);
    const c = this.world.camera.controls;
    await c.setLookAt(eye.x, eye.y, eye.z, sphere.center.x, sphere.center.y, sphere.center.z, false);

    await this.fragments.core.update(true);
    await new Promise((r) => setTimeout(r, 400));
    await this.fragments.core.update(true);

    const camera = this.world.camera.three as THREE.PerspectiveCamera;
    c.update(0); // apply the new look-at to the camera now, not on the next frame
    camera.updateMatrixWorld();
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    // The model was moved near the origin when loaded (its coordination offset);
    // undo that, then swap axes: three.js is Y-up, IFC and BCF are Z-up.
    const toModel = (await this.model.getCoordinationMatrix()).clone().invert(); // clone: the model keeps a reference
    const toIfc = (v: THREE.Vector3): [number, number, number] => [v.x, -v.z, v.y];
    const position = camera.position.clone().applyMatrix4(toModel);

    const snapshot = await this.snapshot();
    if (hidden.length) await this.model.setVisible(hidden, true);
    return {
      camera: { position: toIfc(position), direction: toIfc(direction), up: toIfc(up), fieldOfView: camera.fov },
      snapshot,
    };
  }

  /** The current view as a PNG on a white background. */
  private async snapshot(): Promise<Blob> {
    const renderer = this.world.renderer!.three;
    renderer.render(this.world.scene.three, this.world.camera.three);
    const src = renderer.domElement;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0); // must run right after render(), before the buffer clears
    return new Promise((resolve) => out.toBlob((b) => resolve(b!), "image/png"));
  }

  /** Volume of each element worked out from its 3D geometry, in m³. */
  async volumes(ids: number[]) {
    const out = new Map<number, number>();
    if (!this.model) return out;
    for (const id of ids) out.set(id, await this.model.getItemsVolume([id]));
    return out;
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
