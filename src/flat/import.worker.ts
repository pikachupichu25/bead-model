// Runs the picture-to-beads conversion off the main thread, so the import
// dialog stays responsive (docs/flat-peyote-spec.md §6.8). The sampled cell
// colors are kept, and reused while only the palette or the color limit change.

import type { Lab } from "./color.js";
import type { BeadBox } from "./grid.js";
import { matchColors, type Pixels, type Sampled, sampleCells } from "./import.js";

export interface ImportRequest {
  id: number;
  /** Changes whenever the picture, size or transparency threshold change. */
  sampleKey: string;
  /** Sent only when `sampleKey` is new to the worker. */
  pixels?: Pixels;
  columns: number;
  rows: number;
  box: BeadBox;
  alphaThreshold: number;
  palette: Lab[];
  maxColors: number;
}

export interface ImportResponse {
  id: number;
  /** The worker needs the pixels for this sample key: it had none, or a different one. */
  needPixels?: boolean;
  columns: number;
  rows: number;
  assign?: Int32Array;
  used?: { index: number; count: number }[];
  meanDeltaE?: number;
  ms?: number;
}

let last: { key: string; sampled: Sampled } | undefined;

const scope = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; addEventListener: typeof addEventListener };

scope.addEventListener("message", (event) => {
  const req = (event as MessageEvent<ImportRequest>).data;
  const start = performance.now();
  if (req.pixels) {
    last = { key: req.sampleKey, sampled: sampleCells(req.pixels, req.columns, req.rows, req.box, req.alphaThreshold) };
  } else if (last?.key !== req.sampleKey) {
    scope.postMessage({ id: req.id, needPixels: true, columns: req.columns, rows: req.rows } satisfies ImportResponse);
    return;
  }
  const match = matchColors(last!.sampled, req.palette, req.maxColors);
  const response: ImportResponse = {
    id: req.id,
    columns: req.columns,
    rows: req.rows,
    assign: match.assign,
    used: match.used,
    meanDeltaE: match.meanDeltaE,
    ms: performance.now() - start,
  };
  scope.postMessage(response, [match.assign.buffer]);
});
