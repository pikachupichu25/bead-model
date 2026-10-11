// The two 3D models, side by side, so they can be compared on the same pattern.
//   - tension: the thread-tension model (tension.ts, docs/physics-model-proposal.md)
//   - profile: one ring per round from the bead counts (shape.ts, docs/shape-model.md)

import { buildShape, type Shape, type ShapeModel } from "./shape.js";
import { buildTensionShape } from "./tension.js";

export type ShapeEngine = "tension" | "profile";

export const SHAPE_ENGINES: Record<ShapeEngine, string> = {
  tension: "Thread tension",
  profile: "Profile (from counts)",
};

export function solveShape(model: ShapeModel, engine: ShapeEngine, options: { upToStep?: number } = {}): Shape {
  return engine === "tension" ? buildTensionShape(model, options) : buildShape(model, options);
}

export function isShapeEngine(value: unknown): value is ShapeEngine {
  return value === "tension" || value === "profile";
}
