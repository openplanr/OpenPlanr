#!/usr/bin/env node
/**
 * Proves that two independent skill changes made from HEAD merge in either order without conflicts,
 * that `generate` leaves the merge result unchanged and that `check:generated` passes on it.
 * Runs in a temporary detached worktree, so uncommitted changes in this checkout are not included.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SKILLS = ['planr-status', 'planr-sync'];
const GIT_IDENTITY = [
  '-c',
  'user.name=Independent Skill Merge',
  '-c',
  'user.email=independent-skill-merge@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

function parseSkills(argv) {
  if (argv.length === 0) return DEFAULT_SKILLS;
  const flag = argv.indexOf('--skills');
  const skills = flag === -1 ? [] : (argv[flag + 1] ?? '').split(',').filter(Boolean);
  if (argv.length !== 2 || skills.length !== 2 || skills[0] === skills[1])
    throw new Error(
      `Usage: check-independent-skill-merge.mjs [--skills <a>,<b>]; got: ${argv.join(' ')}`,
    );
  return skills;
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').slice(-20);
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}:\n${output.join('\n')}`);
  }
}

const git = (cwd, ...args) => run('git', [...GIT_IDENTITY, ...args], cwd).trim();

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Mirrors a skill PR: edits the entrypoint, patch-bumps the version and regenerates. */
function commitSkillChange(tree, base, skillId) {
  git(tree, 'checkout', '--quiet', '--detach', base);
  const packagePath = join(tree, 'skills', skillId, 'openplanr.skill.json');
  if (!existsSync(packagePath)) throw new Error(`Unknown skill: ${skillId}`);
  appendFileSync(
    join(tree, 'skills', skillId, 'SKILL.md'),
    `\nIndependent change to ${skillId}.\n`,
  );
  const skillPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
  const [major, minor, patch] = skillPackage.skillVersion.split('.').map(Number);
  const version = `${major}.${minor}.${patch + 1}`;
  writeJson(packagePath, { ...skillPackage, skillVersion: version });
  const registryPath = join(tree, 'skills', 'registry.json');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const entry = registry.skills.find((skill) => skill.skillId === skillId);
  if (!entry) throw new Error(`skills/registry.json has no entry for ${skillId}`);
  entry.skillVersion = version;
  writeJson(registryPath, registry);
  run('npm', ['run', '--silent', 'generate'], tree);
  git(tree, 'add', '--all');
  git(tree, 'commit', '--quiet', '--no-verify', '-m', `test: change ${skillId}`);
  return git(tree, 'rev-parse', 'HEAD');
}

function mergeBothWays(tree, [first, second]) {
  return [
    [first, second],
    [second, first],
  ].map(([ours, theirs]) => {
    git(tree, 'checkout', '--quiet', '--detach', ours.commit);
    const merge = spawnSync('git', [...GIT_IDENTITY, 'merge', '--no-edit', theirs.commit], {
      cwd: tree,
      encoding: 'utf8',
    });
    const order = `${theirs.skillId} into ${ours.skillId}`;
    if (merge.status !== 0) {
      const conflicts = git(tree, 'diff', '--name-only', '--diff-filter=U')
        .split('\n')
        .filter(Boolean);
      git(tree, 'merge', '--abort');
      return { order, conflicts, regenerated: [], checkGenerated: null };
    }
    // Ignored outputs still reflect the last branch built, so rebuild them as CI does.
    run('npm', ['run', '--silent', 'generate'], tree);
    const regenerated = git(tree, 'status', '--porcelain', '--untracked-files=all')
      .split('\n')
      .filter(Boolean);
    const check = spawnSync('npm', ['run', '--silent', 'check:generated'], {
      cwd: tree,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    return {
      order,
      conflicts: [],
      regenerated,
      checkGenerated: check.status,
      checkOutput: `${check.stdout}${check.stderr}`.trim().split('\n').slice(-40).join('\n'),
    };
  });
}

const skills = parseSkills(process.argv.slice(2));
const base = git(root, 'rev-parse', 'HEAD');
const temporary = mkdtempSync(join(tmpdir(), 'planr-skill-merge-'));
const tree = join(temporary, 'tree');
git(root, 'worktree', 'add', '--quiet', '--detach', tree, base);
let results;
try {
  // Workspace packages are linked inside node_modules, so dependencies are installed per tree.
  run('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], tree);
  const changes = skills.map((skillId) => ({
    skillId,
    commit: commitSkillChange(tree, base, skillId),
  }));
  results = mergeBothWays(tree, changes);
} finally {
  run('git', ['worktree', 'remove', '--force', tree], root);
  rmSync(temporary, { recursive: true, force: true });
}

let failed = false;
for (const { order, conflicts, regenerated, checkGenerated, checkOutput } of results) {
  if (conflicts.length > 0) {
    failed = true;
    console.error(`FAIL merge ${order}: conflicts in ${conflicts.join(', ')}`);
  } else if (regenerated.length > 0) {
    failed = true;
    console.error(
      `FAIL merge ${order}: generate changed the merge result:\n${regenerated.join('\n')}`,
    );
  } else if (checkGenerated !== 0) {
    failed = true;
    console.error(`FAIL merge ${order}: check:generated exited ${checkGenerated}\n${checkOutput}`);
  } else {
    console.log(`ok   merge ${order}: clean, generate unchanged, check:generated passed`);
  }
}
console.log(`Base ${base.slice(0, 12)}; skills ${skills.join(', ')}.`);
process.exitCode = failed ? 1 : 0;
