// @ts-check
// Recognizes a planning folder that another tool created, so OpenPlanr never writes into it.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_COMMAND, PLANNING_FOLDER } from './names.mjs';

export { PLANNING_FOLDER };

const FOREIGN_FILES = Object.freeze(['planr.config.json', 'board.html']);
const GOAL_DIRECTORIES = Object.freeze(['tasks', 'plans']);

const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory();

/** @type {typeof import('./planning-folder.d.mts').foreignPlanningFolderSigns} */
export function foreignPlanningFolderSigns(projectRoot) {
  const folder = join(projectRoot, PLANNING_FOLDER);
  if (!isDirectory(folder) || existsSync(join(folder, 'config.json'))) return [];
  const signs = FOREIGN_FILES.filter((name) => existsSync(join(folder, name)));
  for (const name of GOAL_DIRECTORIES) {
    const directory = join(folder, name);
    if (
      isDirectory(directory) &&
      readdirSync(directory).some((entry) => entry.endsWith('-goal.md'))
    )
      signs.push(`*-goal.md files in ${name}`);
  }
  return signs;
}

/** @type {typeof import('./planning-folder.d.mts').planningFolderConflict} */
export function planningFolderConflict(projectRoot) {
  const signs = foreignPlanningFolderSigns(projectRoot);
  if (signs.length === 0) return null;
  return Object.freeze({
    code: 'E_PLANNING_FOLDER_FOREIGN',
    problem: `The ${PLANNING_FOLDER} folder in this project belongs to another tool: it has ${signs.join(', ')} and no OpenPlanr config.json. OpenPlanr wrote nothing there.`,
    fix: `Move or rename that folder, or use ${CLI_COMMAND} in a project without it, then retry.`,
    signs: Object.freeze(signs),
  });
}
