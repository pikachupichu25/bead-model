// Parser for the round notation in docs/pattern-format.md:
//   2A          2 beads of A in one gap
//   1A+1B       A then B in one gap
//   0           no bead in this gap
//   (2A, 1B) x3 repeat a group
//   1B*         fill the remaining gaps of the group with this stitch

/** Beads of one type picked up together, e.g. `2A`. */
export interface Pick {
  count: number;
  key: string;
}

/** What goes into one gap. An empty `picks` list is the `0` stitch. */
export interface Stitch {
  picks: Pick[];
}

export type Item =
  | { kind: "stitch"; stitch: Stitch; fill: boolean }
  | { kind: "group"; items: Item[]; times: number };

export class NotationError extends Error {}

/** Parses a comma-separated stitch list, such as `(2A, 1B*) x3`. */
export function parseStitchList(text: string): Item[] {
  const parser = new Parser(text);
  const items = parser.list();
  parser.expectEnd();
  return items;
}

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  list(): Item[] {
    const items = [this.item()];
    while (this.peek() === ",") {
      this.pos++;
      items.push(this.item());
    }
    return items;
  }

  expectEnd(): void {
    this.skipSpace();
    if (this.pos < this.text.length) {
      this.fail(`unexpected "${this.text[this.pos]}"`);
    }
  }

  private item(): Item {
    if (this.peek() === "(") {
      this.pos++;
      const items = this.list();
      if (this.peek() !== ")") this.fail('expected ")"');
      this.pos++;
      let times = 1;
      const repeat = this.match(/x\s*(\d+)/y);
      if (repeat) times = Number(repeat[1]);
      if (times < 1) this.fail("a group must repeat at least once");
      return { kind: "group", items, times };
    }
    const stitch = this.stitch();
    const fill = this.peek() === "*";
    if (fill) this.pos++;
    return { kind: "stitch", stitch, fill };
  }

  private stitch(): Stitch {
    if (this.match(/0(?![0-9A-Za-z])/y)) return { picks: [] };
    const picks = [this.pick()];
    while (this.peek() === "+") {
      this.pos++;
      picks.push(this.pick());
    }
    return { picks };
  }

  private pick(): Pick {
    const m = this.match(/(\d+)\s*([A-Za-z][A-Za-z0-9_]*)/y);
    if (!m) this.fail("expected a stitch such as 1A, 2B or 0");
    const count = Number(m[1]);
    if (count < 1) this.fail("a bead count must be at least 1 (use 0 for no bead)");
    return { count, key: m[2]! };
  }

  /** Skips spaces, then returns the next character without consuming it. */
  private peek(): string | undefined {
    this.skipSpace();
    return this.text[this.pos];
  }

  private match(re: RegExp): RegExpExecArray | null {
    this.skipSpace();
    re.lastIndex = this.pos;
    const m = re.exec(this.text);
    if (m) this.pos = re.lastIndex;
    return m;
  }

  private skipSpace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos]!)) this.pos++;
  }

  private fail(message: string): never {
    throw new NotationError(`${message} at position ${this.pos + 1} in "${this.text}"`);
  }
}

/**
 * Expands items into exactly `gaps` stitches, working out any `*` fill.
 * Each list may contain at most one elastic item: a fill stitch, or a group
 * that contains one. Throws if the fill can't come out to a whole,
 * non-negative number.
 */
export function expandStitches(items: Item[], gaps: number): Stitch[] {
  const elastic = items.filter(isElastic);
  if (elastic.length > 1) {
    throw new NotationError("only one * fill is allowed per group");
  }
  const fixed = items.filter((item) => !isElastic(item)).reduce((n, item) => n + fixedSize(item), 0);

  let elasticSize = 0;
  if (elastic.length === 1) {
    elasticSize = gaps - fixed;
    if (elasticSize < 0) {
      throw new NotationError(`the * fill would be negative: ${fixed} stitches are listed but there are only ${gaps} gaps`);
    }
  }

  const out: Stitch[] = [];
  for (const item of items) {
    if (!isElastic(item)) {
      out.push(...expandFixed(item));
    } else if (item.kind === "stitch") {
      for (let i = 0; i < elasticSize; i++) out.push(item.stitch);
    } else {
      if (elasticSize % item.times !== 0) {
        throw new NotationError(`${elasticSize} gaps can't be split evenly into ${item.times} repeats`);
      }
      const perRepeat = expandStitches(item.items, elasticSize / item.times);
      for (let i = 0; i < item.times; i++) out.push(...perRepeat);
    }
  }
  return out;
}

/** Expands items that contain no fill. Used where the gap count isn't known yet. */
export function expandFixed(item: Item): Stitch[] {
  if (item.kind === "stitch") {
    if (item.fill) throw new NotationError("a * fill needs a known number of gaps");
    return [item.stitch];
  }
  const once = item.items.flatMap(expandFixed);
  return Array.from({ length: item.times }, () => once).flat();
}

function isElastic(item: Item): boolean {
  return item.kind === "stitch" ? item.fill : item.items.some(isElastic);
}

function fixedSize(item: Item): number {
  return item.kind === "stitch" ? 1 : item.times * item.items.reduce((n, i) => n + fixedSize(i), 0);
}

/** Bead keys in pickup order for one stitch, e.g. `1A+2B` → A, B, B. */
export function stitchBeads(stitch: Stitch): string[] {
  return stitch.picks.flatMap((p) => Array.from({ length: p.count }, () => p.key));
}

/** Writes a stitch back in the notation, e.g. `1A+1B` or `0`. */
export function formatStitch(stitch: Stitch): string {
  return stitch.picks.length === 0 ? "0" : stitch.picks.map((p) => `${p.count}${p.key}`).join("+");
}
