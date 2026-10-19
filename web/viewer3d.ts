// Interactive 3D view of a Shape: one instanced mesh per bead type, each bead
// drawn as its real shape and size with its hole along the thread.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ResolvedBead } from "../src/catalog/catalog.js";
import type { Shape, ShapeModel, Vec3 } from "../src/shape/shape.js";
import { VERDICT_COLORS } from "./growth-chart.js";

export interface ViewOptions {
  /** The step being shown; its beads get a colored outline when `highlight` is on. */
  step: number;
  highlight: boolean;
  colorBy: "bead" | "shape";
}

export class BeadViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
  private readonly controls: OrbitControls;
  private readonly group = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  /** For picking: which bead each instance of each mesh is. */
  private meshes: { mesh: THREE.InstancedMesh; ids: number[] }[] = [];
  /** Outlines round the current step's beads; not pickable. */
  private outlines: THREE.InstancedMesh[] = [];
  private geometries = new Map<string, THREE.BufferGeometry>();
  private model?: ShapeModel;
  private running = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8273, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 10, 6);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(-6, -3, -5);
    this.scene.add(key, rim, this.group);

    new ResizeObserver(() => this.resize()).observe(container);
  }

  /** Draws a shape. Call `frame()` afterwards to fit the camera to it. */
  show(model: ShapeModel, shape: Shape, options: ViewOptions): void {
    if (model !== this.model) {
      this.geometries.forEach((g) => g.dispose());
      this.geometries.clear();
      this.model = model;
    }
    this.clear();
    const { compiled, beads } = model;
    const verdictOf = new Map(shape.rounds.map((r) => [r.round, r.verdict]));
    this.scene.background = new THREE.Color(this.background());
    const stroke = new THREE.Color(this.stroke());

    const byKey = new Map<string, number[]>();
    for (const id of shape.ids) {
      const key = compiled.beads[id]!.key;
      byKey.set(key, [...(byKey.get(key) ?? []), id]);
    }

    const matrix = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    for (const [key, ids] of byKey) {
      const bead = beads.get(key)!;
      const opacity = bead.display.opacity ?? 1;
      const material = new THREE.MeshStandardMaterial({
        roughness: 0.35,
        metalness: 0.05,
        transparent: opacity < 1,
        opacity: Math.max(opacity, 0.45),
      });
      const mesh = new THREE.InstancedMesh(this.geometry(bead), material, ids.length);
      ids.forEach((id, i) => {
        const p = toThree(shape.position.get(id)!);
        const a = toThree(shape.axis.get(id)!);
        const q = new THREE.Quaternion().setFromUnitVectors(up, a);
        matrix.compose(p, q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, matrix);

        const info = compiled.beads[id]!;
        color.set(options.colorBy === "shape" ? VERDICT_COLORS[verdictOf.get(info.round) ?? "start"] : bead.display.rgb);
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.meshes.push({ mesh, ids });
      if (options.highlight) this.outline(bead, ids.filter((id) => compiled.beads[id]!.step === options.step), shape, stroke);
    }
    this.start();
  }

  /**
   * Strokes beads with a slightly larger copy drawn inside out: only its back
   * faces render, so it shows as a rim round the bead's silhouette.
   */
  private outline(bead: ResolvedBead, ids: number[], shape: Shape, stroke: THREE.Color): void {
    if (ids.length === 0) return;
    const material = new THREE.MeshBasicMaterial({ color: stroke, side: THREE.BackSide });
    const mesh = new THREE.InstancedMesh(this.geometry(bead), material, ids.length);
    const matrix = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(1, 1, 1).multiplyScalar(OUTLINE_SCALE);
    ids.forEach((id, i) => {
      const q = new THREE.Quaternion().setFromUnitVectors(up, toThree(shape.axis.get(id)!));
      matrix.compose(toThree(shape.position.get(id)!), q, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.outlines.push(mesh);
  }

  /** Points the camera at the shape from above and a little to the side. */
  frame(shape: Shape): void {
    const box = new THREE.Box3();
    for (const id of shape.ids) box.expandByPoint(toThree(shape.position.get(id)!));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 2);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    const direction = new THREE.Vector3(0.35, 1, 0.75).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.update();
  }

  /** The bead under a point on the canvas (client coordinates), if any. */
  pick(clientX: number, clientY: number): number | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes.map((m) => m.mesh), false)[0];
    if (!hit || hit.instanceId === undefined) return undefined;
    return this.meshes.find((m) => m.mesh === hit.object)?.ids[hit.instanceId];
  }

  /** Stops drawing while the view is hidden. */
  setActive(active: boolean): void {
    if (active) this.start();
    else {
      this.running = false;
      this.renderer.setAnimationLoop(null);
    }
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private clear(): void {
    for (const { mesh } of this.meshes) {
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.meshes = [];
    for (const mesh of this.outlines) {
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.outlines = [];
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private background(): string {
    return getComputedStyle(this.container).getPropertyValue("--diagram-bg").trim() || "#fdfcf9";
  }

  private stroke(): string {
    return getComputedStyle(this.container).getPropertyValue("--current-stroke").trim() || "#ff2e88";
  }

  /** A bead turned on a lathe round its hole (the y axis), at its real size. */
  private geometry(bead: ResolvedBead): THREE.BufferGeometry {
    const cached = this.geometries.get(bead.key);
    if (cached) return cached;
    const radius = bead.outerDiameter / 2;
    const half = bead.length / 2;
    const hole = Math.min((bead.hole ?? bead.outerDiameter * (bead.shape === "cylinder" ? 0.5 : 0.35)) / 2, radius * 0.7);
    const points: THREE.Vector2[] = [];
    if (bead.shape === "round") {
      // Doughnut-like: rounded all the way from one end of the hole to the other.
      for (let i = 0; i <= 16; i++) {
        const t = -Math.PI / 2 + (Math.PI * i) / 16;
        const c = Math.cos(t);
        points.push(new THREE.Vector2(hole + (radius - hole) * Math.sign(c) * Math.abs(c) ** 0.6, half * Math.sin(t)));
      }
    } else {
      // A short tube with rounded edges (cylinder beads, and a stand-in for other shapes).
      const corner = Math.min(radius - hole, half) * 0.45;
      points.push(new THREE.Vector2(hole, -half));
      for (const [cy, from] of [
        [-half + corner, -Math.PI / 2],
        [half - corner, 0],
      ] as const) {
        for (let i = 0; i <= 4; i++) {
          const t = from + (Math.PI / 2) * (i / 4);
          points.push(new THREE.Vector2(radius - corner + corner * Math.cos(t), cy + corner * Math.sin(t)));
        }
      }
      points.push(new THREE.Vector2(hole, half));
    }
    points.push(points[0]!.clone()); // close through the hole
    const geometry = new THREE.LatheGeometry(points, 20);
    geometry.computeVertexNormals();
    this.geometries.set(bead.key, geometry);
    return geometry;
  }
}

/** How much bigger the outline copy is than its bead; the rim is about half of the extra. */
const OUTLINE_SCALE = 1.22;

/** The model is z-up; three.js is y-up. */
function toThree([x, y, z]: Vec3): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}
