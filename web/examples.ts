// The example designs that come with the app, in every technique, and where
// each design opens.

import { type DesignKind, exampleId, type FeedItem, titleOfYaml } from "../src/collection/designs.js";

// The Thread A Bead pattern is a paid pattern, so it stays out of the app (tests still use it).
const peyoteFiles = import.meta.glob<string>(["../patterns/*.peyote.yaml", "!../patterns/04-christmas-mug-trinket-box.peyote.yaml"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const flatFiles = import.meta.glob<string>("../patterns/flat/*.flat-peyote.yaml", { query: "?raw", import: "default", eager: true });
const noraFiles = import.meta.glob<string>("../patterns/nora/*.nora.yaml", { query: "?raw", import: "default", eager: true });

export interface Example extends FeedItem {
  /** The file name without its extension, e.g. "07-whale". */
  name: string;
  example: true;
}

const of = (kind: DesignKind, files: Record<string, string>, ext: RegExp): Example[] =>
  Object.entries(files)
    .map(([path, yaml]) => {
      const name = path.split("/").pop()!.replace(ext, "");
      return { id: exampleId(kind, name), kind, name, title: titleOfYaml(yaml) ?? name, yaml, example: true as const };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

export const EXAMPLES: readonly Example[] = [
  ...of("peyote", peyoteFiles, /\.peyote\.ya?ml$/),
  ...of("flat", flatFiles, /\.flat-peyote\.ya?ml$/),
  ...of("nora", noraFiles, /\.nora\.ya?ml$/),
];

export function findExample(kind: DesignKind, name: string): Example | undefined {
  return EXAMPLES.find((e) => e.kind === kind && e.name === name);
}

const DESIGNER: Record<DesignKind, string> = { peyote: "./editor.html", flat: "./flat.html", nora: "./nora.html" };

/** The designer, with the design open in it. */
export function designUrl(item: FeedItem): string {
  const name = item.example ? EXAMPLES.find((e) => e.id === item.id)?.name : undefined;
  return `${DESIGNER[item.kind]}#${name ? `example=${encodeURIComponent(name)}` : `design=${encodeURIComponent(item.id)}`}`;
}

/** The step viewer, for a circular peyote design. */
export function stepsUrl(item: FeedItem): string | undefined {
  if (item.kind !== "peyote") return undefined;
  const name = item.example ? EXAMPLES.find((e) => e.id === item.id)?.name : undefined;
  return `./steps.html#pattern=${encodeURIComponent(name ?? `design:${item.id}`)}`;
}

/** An empty design in a designer. */
export function newDesignUrl(kind: DesignKind): string {
  return `${DESIGNER[kind]}#new`;
}
