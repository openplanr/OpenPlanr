const DAY_MS = 86_400_000;
const STATUSES = new Set(['outstanding', 'in-progress', 'blocked', 'addressed', 'done']);
const PRIORITIES = new Map([
  ['p0', 0],
  ['critical', 0],
  ['p1', 1],
  ['high', 1],
  ['p2', 2],
  ['medium', 2],
  ['p3', 3],
  ['low', 3],
]);

function compareId(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function terminal(node) {
  return node.status === 'done' || node.status === 'addressed';
}

function priority(node) {
  return (
    PRIORITIES.get(
      String(node.frontmatter.priority ?? '')
        .trim()
        .toLowerCase(),
    ) ?? 4
  );
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/u.exec(
    value,
  );
  if (!match) return null;
  // Date.parse normalizes impossible calendar days, which would fabricate authored evidence.
  const calendar = Date.parse(`${match[1]}T00:00:00.000Z`);
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== match[1])
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function reachable(start, adjacency) {
  const seen = new Set([start]);
  const pending = [...(adjacency.get(start) ?? [])];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(adjacency.get(id) ?? []));
  }
  seen.delete(start);
  return [...seen];
}

function findCycles(adjacency) {
  const seen = new Set();
  const order = [];
  const reverse = new Map([...adjacency.keys()].map((id) => [id, new Set()]));
  for (const [id, targets] of adjacency) for (const target of targets) reverse.get(target).add(id);
  // Iterative component traversal handles long chains and overlapping cycles without stack limits.
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [{ id: start, targets: adjacency.get(start).values() }];
    while (stack.length) {
      const frame = stack.at(-1);
      const next = frame.targets.next();
      if (next.done) {
        order.push(frame.id);
        stack.pop();
      } else if (!seen.has(next.value)) {
        seen.add(next.value);
        stack.push({ id: next.value, targets: adjacency.get(next.value).values() });
      }
    }
  }
  seen.clear();
  const cycles = new Set();
  for (const start of order.reverse()) {
    if (seen.has(start)) continue;
    // Restrict this pass to unvisited nodes so earlier components cannot be merged.
    const pending = [start];
    const members = [];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      members.push(id);
      pending.push(...reverse.get(id));
    }
    if (members.length > 1 || adjacency.get(start).has(start))
      for (const id of members) cycles.add(id);
  }
  return [...cycles].sort(compareId);
}

export function deriveAttention(graph, nowUTC, options = {}) {
  const now = timestamp(nowUTC);
  if (now === null || !nowUTC.endsWith('Z')) throw new TypeError('nowUTC must be a UTC instant.');
  const sprintLengthDays = options.sprintLengthDays ?? 14;
  const quietDays = options.quietDays ?? Math.ceil(sprintLengthDays / 2);
  if (!Number.isInteger(sprintLengthDays) || sprintLengthDays < 1 || sprintLengthDays > 366)
    throw new RangeError('sprintLengthDays must be an integer from 1 to 366.');
  if (!Number.isInteger(quietDays) || quietDays < 1 || quietDays > 365)
    throw new RangeError('quietDays must be an integer from 1 to 365.');

  const nodes = new Map();
  for (const node of graph.nodes) {
    const previous = nodes.get(node.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(node))
      throw new TypeError(`Conflicting graph identity: ${node.id}`);
    nodes.set(node.id, node);
  }
  const ids = [...nodes.keys()].sort(compareId);
  const aliases = new Map();
  const dependencies = new Map(ids.map((id) => [id, new Set()]));
  const parents = new Map(ids.map((id) => [id, new Set()]));
  const dependents = new Map(ids.map((id) => [id, new Set()]));
  const unresolved = new Map(ids.map((id) => [id, new Map()]));
  for (const id of ids) {
    const local = id.split('/').at(-1);
    if (!aliases.has(local)) aliases.set(local, []);
    aliases.get(local).push(id);
  }
  const resolve = (reference, sourceId) => {
    if (typeof reference !== 'string') return { id: null, reason: 'invalid', candidates: [] };
    if (reference.includes('/'))
      return nodes.has(reference)
        ? { id: reference }
        : { id: null, reason: 'missing', candidates: [] };
    const scope =
      nodes.get(sourceId).frontmatter.specScope ??
      (sourceId.includes('/') ? sourceId.slice(0, sourceId.lastIndexOf('/')) : null);
    const scoped = typeof scope === 'string' && !/^SPEC-\d+/u.test(reference);
    const target = scoped ? `${scope}/${reference}` : reference;
    const candidates = nodes.has(target) ? [target] : scoped ? [] : (aliases.get(reference) ?? []);
    return candidates.length === 1
      ? { id: candidates[0] }
      : { id: null, reason: candidates.length ? 'ambiguous' : 'missing', candidates };
  };
  const addDependency = (source, reference, canonical = false) => {
    if (!nodes.has(source)) throw new TypeError(`Missing graph edge source: ${source}`);
    const resolved =
      canonical && nodes.has(reference) ? { id: reference } : resolve(reference, source);
    if (resolved.id) dependencies.get(source).add(resolved.id);
    else {
      const ref = typeof reference === 'string' ? reference : String(reference);
      unresolved.get(source).set(ref, {
        reference: ref,
        reason: resolved.reason,
        candidates: resolved.candidates,
      });
    }
  };
  for (const edge of graph.edges) {
    if (edge.kind === 'depends_on') addDependency(edge.from, edge.to, true);
    else if (edge.kind === 'contains' && nodes.has(edge.from) && nodes.has(edge.to))
      parents.get(edge.to).add(edge.from);
  }
  for (const node of nodes.values()) {
    const authored = node.frontmatter.dependsOn;
    if (authored != null && !Array.isArray(authored))
      throw new TypeError(`dependsOn must be an array: ${node.id}`);
    for (const reference of authored ?? []) addDependency(node.id, reference);
  }
  for (const [id, targets] of dependencies) {
    if (terminal(nodes.get(id))) continue;
    for (const target of targets) if (!terminal(nodes.get(target))) dependents.get(target).add(id);
  }

  const specOf = (node) => {
    if (node.type === 'spec') return node.id;
    const scope = node.id.includes('/') ? node.id.split('/')[0] : null;
    const explicit = scope ?? node.frontmatter.specScope ?? node.frontmatter.specId;
    if (typeof explicit === 'string') return nodes.get(explicit)?.type === 'spec' ? explicit : null;
    // Sprint membership and nested specs do not establish ownership of a task.
    const owners = new Set();
    const seen = new Set([node.id]);
    const pending = [...parents.get(node.id)];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const parent = nodes.get(id);
      if (parent.type === 'spec') owners.add(id);
      else if (parent.type !== 'sprint') pending.push(...parents.get(id));
    }
    return owners.size === 1 ? [...owners][0] : null;
  };

  const statusTotals = {
    total: ids.length,
    outstanding: 0,
    inProgress: 0,
    addressed: 0,
    done: 0,
    unknown: 0,
    blocked: 0,
  };
  const byId = Object.create(null);
  const waiting = [];
  const stale = [];
  const unknownStaleIds = [];
  const highPriorityNotStarted = [];
  const changedIds = [];
  const changedGroups = new Map();
  const specs = new Map(
    ids
      .filter((id) => nodes.get(id).type === 'spec')
      .map((id) => [id, { id, done: 0, total: 0, taskIds: [] }]),
  );
  const today = new Date(now).toISOString().slice(0, 10);
  for (const id of ids) {
    const node = nodes.get(id);
    const status = STATUSES.has(node.status) ? node.status : 'unknown';
    // Blocked overlays open work, so it must not become an extra base-status bucket.
    statusTotals[
      status === 'blocked' ? 'outstanding' : status === 'in-progress' ? 'inProgress' : status
    ] += 1;
    const dependencyIds = [...dependencies.get(id)].sort(compareId);
    const openDependencyIds = dependencyIds.filter((target) => !terminal(nodes.get(target)));
    const unresolvedDependencies = [...unresolved.get(id).values()].sort((a, b) =>
      compareId(a.reference, b.reference),
    );
    const readiness = terminal(node)
      ? 'not-applicable'
      : unresolvedDependencies.length ||
          status === 'unknown' ||
          (status === 'blocked' && !openDependencyIds.length)
        ? 'unknown'
        : openDependencyIds.length
          ? 'blocked'
          : 'ready';
    const downstreamUnblockCount = reachable(id, dependents).filter(
      (target) => nodes.get(target).type === 'task',
    ).length;
    const item = {
      id,
      status,
      readiness,
      dependencyIds,
      openDependencyIds,
      unresolvedDependencies,
      downstreamUnblockCount,
    };
    byId[id] = item;
    if (!terminal(node) && openDependencyIds.length) {
      waiting.push(item);
      statusTotals.blocked += 1;
    }
    if (status === 'outstanding' && priority(node) <= 1) highPriorityNotStarted.push(id);

    const updated = timestamp(node.frontmatter.updated);
    const created = timestamp(node.frontmatter.created);
    const activity = node.frontmatter.updated == null ? created : updated;
    if (status === 'in-progress') {
      if (activity === null || activity > now) unknownStaleIds.push(id);
      else if (now - activity >= quietDays * DAY_MS)
        stale.push({
          id,
          authoredAt: new Date(activity).toISOString(),
          ageDays: (now - activity) / DAY_MS,
        });
    }
    const specId = specOf(node);
    if (
      activity !== null &&
      activity <= now &&
      new Date(activity).toISOString().slice(0, 10) === today
    ) {
      changedIds.push(id);
      if (!changedGroups.has(specId)) changedGroups.set(specId, []);
      changedGroups.get(specId).push(id);
    }
    if (node.type === 'task' && specs.has(specId)) {
      const spec = specs.get(specId);
      spec.taskIds.push(id);
      spec.total += 1;
      if (status === 'done') spec.done += 1;
    }
  }
  const comparePriority = (left, right) =>
    priority(nodes.get(left)) - priority(nodes.get(right)) || compareId(left, right);
  waiting.sort(
    (a, b) => b.downstreamUnblockCount - a.downstreamUnblockCount || comparePriority(a.id, b.id),
  );
  stale.sort((a, b) => b.ageDays - a.ageDays || compareId(a.id, b.id));
  highPriorityNotStarted.sort(comparePriority);
  return freeze({
    statusTotals,
    byId,
    waiting,
    stale,
    unknownStaleIds,
    quietDays,
    highPriorityNotStarted,
    changedToday: {
      date: today,
      ids: changedIds,
      groups: [...changedGroups]
        .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : compareId(a, b)))
        .map(([specId, groupIds]) => ({ specId, ids: groupIds })),
    },
    perSpec: [...specs.values()],
    dependencyCycleIds: findCycles(dependencies),
    containmentCycleIds: findCycles(new Map(ids.map((id) => [id, parents.get(id)]))),
  });
}
