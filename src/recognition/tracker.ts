import type { InkChange } from '../document/InkStore';
import { isRecognitionEligible } from '../ink/geometry';
import type {
  Bounds,
  EquationGroupData,
  GroupResult,
  InkDocument,
  Stroke,
} from '../shared/types';
import { estimateBodySize } from './grouping';

interface TrackedGroup {
  group: EquationGroupData;
  fingerprint: number;
  bodySize: number;
}
export interface GroupUpdate {
  changed: EquationGroupData[];
  retired: string[];
}
const gap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, a0 - b1, b0 - a1);
const centerY = (b: Bounds) => (b.minY + b.maxY) / 2;

/** Cached equation rectangles and ownership narrow worker grouping to edited ink.
 * Candidate equations keep their answers until reconciliation proves they changed. */
export class EquationTracker {
  private document!: InkDocument;
  private strokes = new Map<string, Stroke>();
  private groups = new Map<string, TrackedGroup>();
  private ownership = new Map<string, string>();
  private candidates = new Set<string>();
  private changedStrokes = new Set<string>();
  private dirtyOwners = new Set<string>();
  private regions: Bounds[] = [];
  private bootstrap = true;
  private tombstones = new Map<string, TrackedGroup>();

  constructor(document: InkDocument) {
    this.reset(document);
  }
  reset(document: InkDocument): void {
    this.document = document;
    this.strokes = new Map(
      document.strokes.filter(isRecognitionEligible).map((s) => [s.id, s]),
    );
    this.groups.clear();
    this.ownership.clear();
    this.candidates.clear();
    this.changedStrokes.clear();
    this.dirtyOwners.clear();
    this.regions = [];
    this.bootstrap = true;
    this.tombstones.clear();
  }
  get all(): EquationGroupData[] {
    return [...this.groups.values()].map((entry) => entry.group);
  }
  owner(strokeId: string): string | undefined {
    return this.ownership.get(strokeId);
  }

  /** Changed IDs include erase masks; bounds come from cached old/new canonical ink. */
  change(document: InkDocument, change: InkChange): string[] {
    this.document = document;
    const ids = new Set([
      ...change.changedStrokeIds,
      ...change.deletedStrokeIds,
    ]);
    const next = new Map(
      document.strokes.filter((s) => ids.has(s.id)).map((s) => [s.id, s]),
    );
    const invalidated = new Set<string>();
    for (const id of ids) {
      const old = this.strokes.get(id);
      const stroke = next.get(id);
      if (!old && (!stroke || !isRecognitionEligible(stroke))) continue;
      const owner = this.ownership.get(id);
      if (owner) {
        invalidated.add(owner);
        this.dirtyOwners.add(owner);
        this.candidates.add(owner);
        this.regions.push(this.groups.get(owner)!.group.bounds);
      }
      if (old) this.regions.push(old.bounds);
      if (stroke && isRecognitionEligible(stroke)) {
        this.strokes.set(id, stroke);
        this.regions.push(stroke.bounds);
      } else this.strokes.delete(id);
      this.changedStrokes.add(id);
    }
    return [...invalidated];
  }
  get dirty(): boolean {
    return this.bootstrap || this.changedStrokes.size > 0;
  }

  /** This is a subset after bootstrap, retaining the real document revision guard. */
  request(): InkDocument {
    if (this.bootstrap)
      return {
        ...this.document,
        strokes: [...this.strokes.values()],
        objects: [],
      };
    // Scan cached rectangles only. Vertical candidate selection uses each original
    // edit region independently, so neighboring rows cannot cascade into the page.
    for (const [id, entry] of this.groups) {
      const b = entry.group.bounds;
      const size = entry.bodySize;
      if (
        this.regions.some(
          (r) =>
            gap(b.minX, b.maxX, r.minX, r.maxX) <= size * 3 &&
            gap(b.minY, b.maxY, r.minY, r.maxY) <= size * 1.1,
        )
      )
        this.candidates.add(id);
    }
    // Horizontal bridges may span several seeded clusters. Follow compatible
    // baselines, never the growing vertical union used by the old invalidator.
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const [id, entry] of this.groups) {
        if (this.candidates.has(id)) continue;
        for (const candidate of this.candidates) {
          const other = this.groups.get(candidate)!;
          const size = Math.max(entry.bodySize, other.bodySize);
          const a = entry.group.bounds,
            b = other.group.bounds;
          if (
            Math.abs(centerY(a) - centerY(b)) <= size * 0.6 &&
            gap(a.minX, a.maxX, b.minX, b.maxX) <= size * 3
          ) {
            this.candidates.add(id);
            expanded = true;
            break;
          }
        }
      }
    }
    const ids = new Set(this.changedStrokes);
    for (const id of this.candidates)
      for (const stroke of this.groups.get(id)!.group.strokes)
        ids.add(stroke.id);
    return {
      ...this.document,
      strokes: [...ids].flatMap((id) => this.strokes.get(id) ?? []),
      erasures: this.document.erasures.flatMap((e) => {
        const targetStrokeIds = e.targetStrokeIds.filter(
          (id) => ids.has(id) && this.strokes.has(id),
        );
        return targetStrokeIds.length ? [{ ...e, targetStrokeIds }] : [];
      }),
      objects: [],
    };
  }

  apply(result: GroupResult): GroupUpdate | undefined {
    if (
      result.documentId !== this.document.documentId ||
      result.generation !== this.document.generation ||
      result.documentRevision !== this.document.revision
    )
      return undefined;
    const previous = this.bootstrap
      ? [...this.groups.keys()]
      : [...this.candidates];
    // Greedy maximum-overlap assignment keeps the largest surviving fragment's
    // identity on a split and the strongest owner's identity on a merge.
    const matches: {
      index: number;
      id: string;
      overlap: number;
      live: boolean;
    }[] = [];
    const available = new Map([
      ...this.tombstones,
      ...previous.map((id) => [id, this.groups.get(id)!] as const),
    ]);
    result.groups.forEach((group, index) => {
      const ids = new Set(group.strokes.map((s) => s.id));
      for (const [id, old] of available) {
        const overlap = old.group.strokes.filter((s) => ids.has(s.id)).length;
        if (overlap)
          matches.push({ index, id, overlap, live: this.groups.has(id) });
      }
    });
    matches.sort(
      (a, b) =>
        b.overlap - a.overlap ||
        Number(b.live) - Number(a.live) ||
        a.id.localeCompare(b.id) ||
        a.index - b.index,
    );
    const assigned = new Map<number, string>(),
      used = new Set<string>();
    for (const match of matches)
      if (!assigned.has(match.index) && !used.has(match.id)) {
        assigned.set(match.index, match.id);
        used.add(match.id);
      }
    const changed: EquationGroupData[] = [];
    const next = new Map<string, TrackedGroup>();
    const masks = new Map(
      this.document.erasures.map((mask) => [mask.id, mask]),
    );
    for (let index = 0; index < result.groups.length; index++) {
      const source = result.groups[index];
      let id =
        assigned.get(index) ??
        `equation-${encodeURIComponent(source.strokes.map((s) => s.id).sort()[0])}`;
      // A split may use the old group's anchor for a new fragment. Never duplicate IDs.
      if (
        next.has(id) ||
        (!assigned.has(index) && (this.groups.has(id) || used.has(id)))
      )
        id = `${id}:${encodeURIComponent(
          source.strokes
            .map((s) => s.id)
            .sort()
            .join(':'),
        )}`;
      const old = available.get(id);
      if (
        old &&
        this.groups.has(id) &&
        old.fingerprint === source.revision &&
        !this.dirtyOwners.has(id)
      ) {
        next.set(id, old);
      } else {
        const group = {
          ...source,
          id,
          revision: (old?.group.revision ?? 0) + 1,
          strokes: source.strokes.map((stroke) => this.strokes.get(stroke.id)!),
          erasures: source.erasures.map((mask) => ({
            ...mask,
            path: masks.get(mask.id)?.path ?? mask.path,
          })),
        };
        next.set(id, {
          group,
          fingerprint: source.revision,
          bodySize: estimateBodySize(group.strokes),
        });
        changed.push(group);
      }
    }
    const retired = previous.filter((id) => !next.has(id));
    for (const id of previous) {
      const old = this.groups.get(id)!;
      for (const stroke of old.group.strokes) this.ownership.delete(stroke.id);
      if (retired.includes(id)) this.tombstones.set(id, old);
      this.groups.delete(id);
    }
    for (const [id, entry] of next) {
      this.groups.set(id, entry);
      this.tombstones.delete(id);
      for (const stroke of entry.group.strokes)
        this.ownership.set(stroke.id, id);
    }
    // Tombstones retain recent erase/undo identities without growing indefinitely.
    while (this.tombstones.size > 512)
      this.tombstones.delete(this.tombstones.keys().next().value!);
    this.bootstrap = false;
    this.candidates.clear();
    this.changedStrokes.clear();
    this.dirtyOwners.clear();
    this.regions = [];
    return { changed, retired };
  }
}
