import type {
  DiagramAuthoringValidationError,
  DiagramBounds,
  DiagramPlacement,
  DiagramSemanticEntry,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type { VersionedDiagramAuthoringBundle as DiagramAuthoringBundle } from '@openplanr/protocol/studio-presentation-contracts';
import {
  clone,
  elementIndex,
  inspectPlainData,
  validateAuthoringBundle,
} from '../authoring/model.mjs';
import { resolveDiagramSceneElement } from '../authoring/scene.mjs';

export interface DiagramGeometryCamera {
  x: number;
  y: number;
  scale: number;
}
export interface DiagramGeometryRecord {
  id: string;
  collection: DiagramSemanticEntry['collection'];
  bounds: DiagramBounds | null;
  points: Array<{ x: number; y: number }>;
  labelBounds: DiagramBounds | null;
  zIndex: number;
  order: number;
}
export interface DiagramGeometryHit {
  id: string;
  collection: DiagramSemanticEntry['collection'];
  kind: 'bounds' | 'segment' | 'label';
  /** Distance from the pointer in screen pixels. */
  distance: number;
  zIndex: number;
}
export interface DiagramGeometryFailure {
  ok: false;
  diagnostics: DiagramAuthoringValidationError[];
}
export interface DiagramGeometryStats {
  entries: number;
  primitives: number;
  cells: number;
  overflowPrimitives: number;
  fullBuilds: number;
  updates: number;
  validations: number;
  validatedElements: number;
  metadataEntriesScanned: number;
  geometryResolved: number;
  lastUpdateResolved: number;
  lastUpdateRemoved: number;
  lastMetadataEntriesScanned: number;
  queries: number;
  lastQueryCandidates: number;
  lastQueryChecks: number;
  lastQueryCells: number;
  lastQueryOverflow: number;
}
export interface DiagramGeometryIndex {
  /** Validate a revision, then refresh affected geometry and its dependencies. Equal revisions are no-ops. */
  update(
    bundle: DiagramAuthoringBundle,
    affectedIds: string[],
  ):
    | { ok: true; updatedIds: string[]; removedIds: string[]; diagnostics: [] }
    | DiagramGeometryFailure;
  /** x/y and optional tolerance (default 6) are screen pixels; screen = world * scale + camera offset. */
  query(input: { x: number; y: number; tolerance?: number; camera: DiagramGeometryCamera }):
    | {
        ok: true;
        hits: DiagramGeometryHit[];
        world: { x: number; y: number };
        tolerance: number;
        diagnostics: [];
      }
    | DiagramGeometryFailure;
  /** Detached world geometry suitable for controls, without access to internal cache storage. */
  get(id: string): DiagramGeometryRecord | null;
  stats(): DiagramGeometryStats;
}

interface Point {
  x: number;
  y: number;
}
interface CellRange {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
/** Only groups and lanes carry members; the index reads them from every entry. */
type IndexedEntry = DiagramSemanticEntry & { value: { members?: string[] } };
type EmphasisLevel = DiagramAuthoringBundle['document']['emphasis'][number]['level'];
interface GeometryMetadata {
  byId: Map<string, IndexedEntry>;
  placements: Map<string, DiagramPlacement>;
  order: Map<string, number>;
  emphasis: Map<string, EmphasisLevel>;
  signatures: Map<string, string>;
  children: Map<string, string[]>;
  incident: Map<string, Set<string>>;
}
type GeometryDependencies = Pick<GeometryMetadata, 'signatures' | 'children' | 'incident'>;
type Primitive = { id: string; bounds: DiagramBounds; cells: string[] | null } & (
  | { kind: 'bounds' | 'label' }
  | { kind: 'segment'; start: Point; end: Point }
);
type GeometryQuery = Parameters<DiagramGeometryIndex['query']>[0];
// Map lookups asserted with `as` read keys this module inserted or checked first; the
// assertion keeps the emitted code identical to the JavaScript it replaces.

const CELL_SIZE = 256;
const MAX_PRIMITIVE_CELLS = 16;
const MAX_QUERY_CELLS = 4096;
const MAX_QUERY_PRIMITIVES = 20000;
const fail = (rule: string, detail: string, path = '$.geometry'): DiagramGeometryFailure => ({
  ok: false,
  diagnostics: [{ path, rule, detail }],
});
const cellRange = (bounds: DiagramBounds): CellRange => ({
  left: Math.floor(bounds.x / CELL_SIZE),
  right: Math.floor((bounds.x + bounds.width) / CELL_SIZE),
  top: Math.floor(bounds.y / CELL_SIZE),
  bottom: Math.floor((bounds.y + bounds.height) / CELL_SIZE),
});
const cellCount = (range: CellRange) =>
  (range.right - range.left + 1) * (range.bottom - range.top + 1);
const cellKey = (x: number, y: number) => `${x},${y}`;
const rectDistance = (point: Point, bounds: DiagramBounds) =>
  Math.hypot(
    Math.max(bounds.x - point.x, 0, point.x - bounds.x - bounds.width),
    Math.max(bounds.y - point.y, 0, point.y - bounds.y - bounds.height),
  );
function segmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    squared = dx * dx + dy * dy;
  const t =
    squared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
function metadata(bundle: DiagramAuthoringBundle): GeometryMetadata {
  const byId: Map<string, IndexedEntry> = elementIndex(bundle.document);
  const placements = new Map<string, DiagramPlacement>(),
    signatures = new Map<string, string>(),
    order = new Map<string, number>(),
    children = new Map<string, string[]>(),
    incident = new Map<string, Set<string>>();
  const emphasis = new Map(bundle.document.emphasis.map((value) => [value.targetId, value.level]));
  bundle.presentation.elements.forEach((value, index) => {
    placements.set(value.elementId, value);
    order.set(value.elementId, index);
  });
  for (const [id, entry] of byId) {
    signatures.set(id, JSON.stringify([entry, placements.get(id), emphasis.get(id) ?? null]));
    if (entry.value.members) children.set(id, [...entry.value.members]);
    if (entry.collection === 'relations')
      for (const endpoint of [entry.value.from, entry.value.to]) {
        if (!incident.has(endpoint)) incident.set(endpoint, new Set());
        (incident.get(endpoint) as Set<string>).add(id);
      }
  }
  return { byId, placements, order, emphasis, signatures, children, incident };
}
function resolveGeometry(data: GeometryMetadata, id: string): DiagramGeometryRecord {
  const element = resolveDiagramSceneElement(
    data.byId.get(id) as IndexedEntry,
    data.placements.get(id) as DiagramPlacement,
    data.placements,
    data.order.get(id) as number,
    data.emphasis.get(id) ?? null,
  );
  return {
    id,
    collection: element.collection,
    bounds: element.bounds,
    points: element.points ?? [],
    labelBounds: element.text?.bounds ?? null,
    zIndex: element.zIndex,
    order: element.order,
  };
}
function primitives(record: DiagramGeometryRecord) {
  const result: Primitive[] = [];
  if (record.bounds)
    result.push({ id: record.id, kind: 'bounds', bounds: record.bounds, cells: null });
  if (record.labelBounds)
    result.push({ id: record.id, kind: 'label', bounds: record.labelBounds, cells: null });
  for (let index = 1; index < record.points.length; index++) {
    const start = record.points[index - 1],
      end = record.points[index];
    result.push({
      id: record.id,
      kind: 'segment',
      bounds: {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      },
      start,
      end,
      cells: null,
    });
  }
  return result;
}
function affectedClosure(
  ids: Iterable<string>,
  oldData: GeometryDependencies,
  nextData: GeometryDependencies,
) {
  const result = new Set(ids),
    pending = [...result];
  while (pending.length) {
    const id = pending.pop() as string;
    for (const data of [oldData, nextData])
      for (const child of data.children.get(id) ?? [])
        if (!result.has(child)) {
          result.add(child);
          pending.push(child);
        }
  }
  for (const id of [...result])
    for (const data of [oldData, nextData])
      for (const edge of data.incident.get(id) ?? []) result.add(edge);
  return result;
}
function readQuery(
  input: GeometryQuery,
):
  | DiagramGeometryFailure
  | { ok: true; world: Point; radius: number; range: CellRange; scale: number } {
  const diagnostics = inspectPlainData(input);
  if (diagnostics.length) return { ok: false, diagnostics };
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['x', 'y', 'tolerance', 'camera'].includes(key))
  )
    return fail('query-options', 'Supply a screen point, pixel tolerance and one camera.');
  const { camera } = input;
  const tolerance = input.tolerance === undefined ? 6 : input.tolerance;
  if (
    !camera ||
    typeof camera !== 'object' ||
    Array.isArray(camera) ||
    Object.keys(camera).some((key) => !['x', 'y', 'scale'].includes(key)) ||
    ![input.x, input.y, camera.x, camera.y, camera.scale, tolerance].every(Number.isFinite) ||
    camera.scale <= 0 ||
    tolerance < 0 ||
    tolerance > 128
  )
    return fail(
      'query-options',
      'Camera values and screen coordinates must be finite; scale must be positive and tolerance must be 0–128 pixels.',
    );
  const world = { x: (input.x - camera.x) / camera.scale, y: (input.y - camera.y) / camera.scale },
    radius = tolerance / camera.scale;
  if (![world.x, world.y, radius].every(Number.isFinite))
    return fail(
      'query-range',
      'The camera cannot resolve this query into finite canvas coordinates.',
    );
  const range = cellRange({
    x: world.x - radius,
    y: world.y - radius,
    width: radius * 2,
    height: radius * 2,
  });
  if (
    !Number.isSafeInteger(range.left) ||
    !Number.isSafeInteger(range.right) ||
    !Number.isSafeInteger(range.top) ||
    !Number.isSafeInteger(range.bottom) ||
    cellCount(range) > MAX_QUERY_CELLS
  )
    return fail(
      'query-range',
      'The screen tolerance covers too much of the canvas; zoom in before precise selection.',
    );
  return { ok: true, world, radius, range, scale: camera.scale };
}

/**
 * Cached world geometry. Query converts screen coordinates through one camera;
 * no query validates the bundle, resolves scene geometry, or reads browser DOM.
 */
export function createDiagramGeometryIndex(
  bundle: DiagramAuthoringBundle,
): { ok: true; index: DiagramGeometryIndex; diagnostics: [] } | DiagramGeometryFailure {
  const checked = validateAuthoringBundle(bundle);
  if (!checked.ok) return checked;
  const diagramId = bundle.diagramId;
  const initial = metadata(bundle);
  let digest = bundle.bundleDigest;
  const records = new Map<string, DiagramGeometryRecord>(),
    buckets = new Map<string, Set<Primitive>>(),
    overflow = new Set<Primitive>(),
    members = new Map<string, Primitive[]>();
  const work = {
    fullBuilds: 1,
    updates: 0,
    validations: 1,
    validatedElements: bundle.presentation.elements.length,
    metadataEntriesScanned: initial.byId.size,
    geometryResolved: 0,
    lastUpdateResolved: 0,
    lastUpdateRemoved: 0,
    lastMetadataEntriesScanned: initial.byId.size,
    queries: 0,
    lastQueryCandidates: 0,
    lastQueryChecks: 0,
    lastQueryCells: 0,
    lastQueryOverflow: 0,
  };
  let primitiveCount = 0;
  function remove(id: string) {
    for (const primitive of members.get(id) ?? []) {
      if (primitive.cells === null) overflow.delete(primitive);
      else
        for (const key of primitive.cells) {
          const bucket = buckets.get(key) as Set<Primitive>;
          bucket.delete(primitive);
          if (!bucket.size) buckets.delete(key);
        }
      primitiveCount--;
    }
    records.delete(id);
    members.delete(id);
  }
  function insert(record: DiagramGeometryRecord) {
    const values = primitives(record);
    for (const primitive of values) {
      const range = cellRange(primitive.bounds);
      if (cellCount(range) > MAX_PRIMITIVE_CELLS) {
        primitive.cells = null;
        overflow.add(primitive);
      } else {
        primitive.cells = [];
        for (let x = range.left; x <= range.right; x++)
          for (let y = range.top; y <= range.bottom; y++) {
            const key = cellKey(x, y);
            primitive.cells.push(key);
            if (!buckets.has(key)) buckets.set(key, new Set());
            (buckets.get(key) as Set<Primitive>).add(primitive);
          }
      }
      primitiveCount++;
    }
    records.set(record.id, record);
    members.set(record.id, values);
  }
  for (const id of initial.byId.keys()) insert(resolveGeometry(initial, id));
  work.geometryResolved = records.size;
  work.lastUpdateResolved = records.size;
  // Only detached signatures and dependency IDs survive this call. Mutable caller
  // objects cannot later change the cached geometry or the previous dependency set.
  let data: GeometryDependencies = {
    signatures: initial.signatures,
    children: initial.children,
    incident: initial.incident,
  };
  function update(
    nextBundle: DiagramAuthoringBundle,
    affectedIds: string[],
  ): ReturnType<DiagramGeometryIndex['update']> {
    const checked = validateAuthoringBundle(nextBundle);
    work.validations++;
    if (!checked.ok) return checked;
    work.validatedElements += nextBundle.presentation.elements.length;
    const diagnostics = inspectPlainData(affectedIds);
    if (diagnostics.length) return { ok: false, diagnostics };
    if (nextBundle.diagramId !== diagramId)
      return fail('diagram-identity', 'An index cannot replace its diagram identity.');
    if (
      !Array.isArray(affectedIds) ||
      affectedIds.some((id) => typeof id !== 'string') ||
      new Set(affectedIds).size !== affectedIds.length
    )
      return fail('affected-ids', 'Supply distinct stable IDs affected by the edit.');
    if (nextBundle.bundleDigest === digest && affectedIds.some((id) => !data.signatures.has(id)))
      return fail('affected-ids', 'Affected IDs must exist in the current or next diagram.');
    if (nextBundle.bundleDigest === digest) {
      work.lastUpdateResolved = 0;
      work.lastUpdateRemoved = 0;
      work.lastMetadataEntriesScanned = 0;
      return { ok: true, updatedIds: [], removedIds: [], diagnostics: [] };
    }
    const nextData = metadata(nextBundle),
      changed = new Set(affectedIds);
    // Cover insertions/removals and callers with an incomplete affected list.
    // This metadata scan is measured separately from expensive geometry work.
    for (const [id, signature] of nextData.signatures)
      if (signature !== data.signatures.get(id)) changed.add(id);
    for (const id of data.signatures.keys()) if (!nextData.signatures.has(id)) changed.add(id);
    if (affectedIds.some((id) => !nextData.signatures.has(id) && !data.signatures.has(id)))
      return fail('affected-ids', 'Affected IDs must exist in the current or next diagram.');
    const closure = affectedClosure(changed, data, nextData);
    const nextRecords: DiagramGeometryRecord[] = [],
      removedIds: string[] = [];
    for (const id of closure) {
      if (nextData.byId.has(id)) nextRecords.push(resolveGeometry(nextData, id));
      else if (records.has(id)) removedIds.push(id);
    }
    for (const id of closure) remove(id);
    for (const record of nextRecords) insert(record);
    // Array insertions/deletions shift draw-order positions without changing
    // shape or route geometry. Refresh that scalar metadata without resolving.
    // biome-ignore format: bundles keep this one-line layout; wrapping would change their bytes.
    for (const [id, order] of nextData.order) (records.get(id) as DiagramGeometryRecord).order = order;
    data = {
      signatures: nextData.signatures,
      children: nextData.children,
      incident: nextData.incident,
    };
    digest = nextBundle.bundleDigest;
    work.updates++;
    work.metadataEntriesScanned += nextData.byId.size;
    work.lastMetadataEntriesScanned = nextData.byId.size;
    work.geometryResolved += nextRecords.length;
    work.lastUpdateResolved = nextRecords.length;
    work.lastUpdateRemoved = removedIds.length;
    return {
      ok: true,
      updatedIds: nextRecords.map((record) => record.id).sort(),
      removedIds: removedIds.sort(),
      diagnostics: [],
    };
  }
  function query(input: GeometryQuery): ReturnType<DiagramGeometryIndex['query']> {
    work.queries++;
    work.lastQueryCandidates = 0;
    work.lastQueryChecks = 0;
    work.lastQueryCells = 0;
    work.lastQueryOverflow = 0;
    const query = readQuery(input);
    if (!query.ok) return query;
    const candidates = new Set<Primitive>();
    for (let x = query.range.left; x <= query.range.right; x++)
      for (let y = query.range.top; y <= query.range.bottom; y++) {
        work.lastQueryCells++;
        for (const primitive of buckets.get(cellKey(x, y)) ?? []) {
          candidates.add(primitive);
          if (candidates.size > MAX_QUERY_PRIMITIVES)
            return fail(
              'query-density',
              'Too many overlapping segments occupy this selection region; narrow the view before precise selection.',
            );
        }
      }
    for (const primitive of overflow) {
      work.lastQueryOverflow++;
      if (rectDistance(query.world, primitive.bounds) <= query.radius) candidates.add(primitive);
      if (work.lastQueryOverflow > MAX_QUERY_PRIMITIVES || candidates.size > MAX_QUERY_PRIMITIVES)
        return fail(
          'query-density',
          'Too many long primitives occupy this selection region; narrow the view before precise selection.',
        );
    }
    const hitById = new Map<string, DiagramGeometryHit>(),
      visited = new Set<string>();
    const priority = { bounds: 0, segment: 1, label: 2 };
    for (const primitive of candidates) {
      visited.add(primitive.id);
      work.lastQueryChecks++;
      const distance =
        primitive.kind === 'segment'
          ? segmentDistance(query.world, primitive.start, primitive.end)
          : rectDistance(query.world, primitive.bounds);
      if (distance > query.radius) continue;
      const record = records.get(primitive.id) as DiagramGeometryRecord;
      const hit = {
        id: primitive.id,
        collection: record.collection,
        kind: primitive.kind,
        distance: distance * query.scale,
        zIndex: record.zIndex,
      };
      const existing = hitById.get(hit.id);
      if (
        !existing ||
        hit.distance < existing.distance ||
        (hit.distance === existing.distance && priority[hit.kind] > priority[existing.kind])
      )
        hitById.set(hit.id, hit);
    }
    work.lastQueryCandidates = visited.size;
    const hits = [...hitById.values()].sort(
      (a, b) =>
        b.zIndex - a.zIndex ||
        a.distance - b.distance ||
        (records.get(b.id) as DiagramGeometryRecord).order -
          (records.get(a.id) as DiagramGeometryRecord).order ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return { ok: true, hits, world: query.world, tolerance: query.radius, diagnostics: [] };
  }
  return {
    ok: true,
    index: {
      update,
      query,
      get: (id) => {
        const record = records.get(id);
        return record ? clone(record) : null;
      },
      stats: () => ({
        ...work,
        entries: records.size,
        primitives: primitiveCount,
        cells: buckets.size,
        overflowPrimitives: overflow.size,
      }),
    },
    diagnostics: [],
  };
}
