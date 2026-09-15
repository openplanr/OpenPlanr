const LEGACY_TASK_FIELDS = Object.freeze({
  review_risks: 'reviewRisks',
  browser_surfaces: 'browserSurfaces',
  acceptance_refs: 'acceptanceRefs',
});

/** Translate released snake-case task metadata into the canonical 1.7 names. */
export function normalizePlanningTask(value) {
  const task = structuredClone(value ?? {});
  for (const [legacy, canonical] of Object.entries(LEGACY_TASK_FIELDS)) {
    if (task[canonical] === undefined && task[legacy] !== undefined) task[canonical] = task[legacy];
    delete task[legacy];
  }
  task.reviewRisks ??= [];
  task.browserSurfaces ??= [];
  task.acceptanceRefs ??= [];
  return task;
}

/** Validate that every story criterion is assigned and named in task verification. */
export function validatePlanningAcceptanceCoverage(stories, tasks) {
  const issues = [];
  const tasksByStory = new Map();
  for (const rawTask of tasks ?? []) {
    const task = normalizePlanningTask(rawTask);
    const bucket = tasksByStory.get(task.storyId) ?? [];
    bucket.push(task);
    tasksByStory.set(task.storyId, bucket);
  }
  for (const story of stories ?? []) {
    const criteria = story.acceptanceCriteria ?? [];
    const ids = new Set(criteria.map((criterion) => criterion.id));
    if (ids.size !== criteria.length) {
      issues.push({ path: `${story.id}.acceptanceCriteria`, rule: 'unique', detail: 'Acceptance IDs must be unique within the story.' });
    }
    for (const criterion of criteria) {
      const mapped = (tasksByStory.get(story.id) ?? []).filter((task) => task.acceptanceRefs.includes(criterion.id));
      if (mapped.length === 0) {
        issues.push({ path: `${story.id}.${criterion.id}`, rule: 'coverage', detail: 'Acceptance criterion is not mapped to a task.' });
        continue;
      }
      if (mapped.every((task) => !String(task.testRequirements ?? '').includes(criterion.id))) {
        issues.push({ path: `${story.id}.${criterion.id}`, rule: 'verification', detail: 'A mapped task must name the acceptance ID in Test Requirements.' });
      }
    }
    for (const task of tasksByStory.get(story.id) ?? []) {
      for (const reference of task.acceptanceRefs) {
        if (!ids.has(reference)) issues.push({ path: `${task.id}.acceptanceRefs`, rule: 'reference', detail: `${reference} is not declared by ${story.id}.` });
      }
    }
  }
  return issues;
}
