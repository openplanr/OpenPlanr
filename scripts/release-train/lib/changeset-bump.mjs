/** Label a maintainer adds to a pull request to approve a major release. */
export const MAJOR_APPROVAL_LABEL = 'semver:major-approved';

const RANK = Object.freeze({ none: 0, patch: 1, minor: 2, major: 3 });

/** Splits a Conventional Commit title into its type and breaking marker, or null. */
export function parseTitle(title) {
  const match = /^([a-z]+)(?:\([^()]*\))?(!)?: \S/u.exec(title);
  return match ? { type: match[1], breaking: Boolean(match[2]) } : null;
}

/** Reads the `package: bump` releases from a changeset's frontmatter. */
export function parseChangeset(text, file) {
  const match = /^---\r?\n([\s\S]*?)^---[ \t]*$/mu.exec(text);
  if (!match) throw new Error(`${file}: no changeset frontmatter between --- lines`);
  const releases = {};
  for (const line of match[1].split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const release = /^\s*(['"]?)([^'":\s]+)\1\s*:\s*(none|patch|minor|major)\s*$/u.exec(line);
    if (!release) throw new Error(`${file}: cannot read release line ${JSON.stringify(line)}`);
    releases[release[2]] = release[3];
  }
  return releases;
}

/** Highest bump each published package declares across the changesets. */
function declaredReleases(changesets, targets) {
  const published = new Set(targets.map((target) => target.name));
  const declared = new Map();
  for (const { file, releases } of changesets) {
    for (const [name, bump] of Object.entries(releases)) {
      if (!published.has(name)) continue;
      const current = declared.get(name);
      if (!current || RANK[bump] > RANK[current.bump]) declared.set(name, { bump, file });
    }
  }
  return declared;
}

function minimumBump(type, breaking) {
  if (breaking) return { minimum: 'major', missingIsError: true };
  if (type === 'feat') return { minimum: 'minor', missingIsError: true };
  // Dependency and small fixes have shipped without changesets; only a declared bump is held to patch.
  if (type === 'fix' || type === 'perf') return { minimum: 'patch', missingIsError: false };
  return null;
}

function bumpFindings({ label, rule, checked, declared, errors, warnings }) {
  const { minimum, missingIsError } = rule;
  for (const name of checked) {
    const found = declared.get(name);
    if (!found) {
      const message = `${label}: ${name} changes with no changeset; requires ${minimum}. Add a changeset with "${name}": ${minimum}.`;
      (missingIsError ? errors : warnings).push(message);
    } else if (RANK[found.bump] < RANK[minimum]) {
      errors.push(
        `${label}: ${name} declares ${found.bump} in ${found.file}; requires ${minimum}. Change it to "${name}": ${minimum}.`,
      );
    }
  }
}

/**
 * Checks a pull request's changesets against its title type and approval labels.
 * `files` are the paths the pull request changes; `targets` are the published packages.
 */
export function checkChangesetBumps({ title, body = '', labels, files, changesets, targets }) {
  const errors = [];
  const warnings = [];
  const parsed = parseTitle(title);
  if (!parsed) {
    errors.push(
      `PR title ${JSON.stringify(title)} is not a Conventional Commit ("type(scope): summary"), so the required changeset bump is unknown.`,
    );
    return { errors, warnings };
  }
  const breaking = parsed.breaking || /^BREAKING[ -]CHANGE:/mu.test(body);
  const label = `${parsed.type}${breaking ? '!' : ''}`;
  const declared = declaredReleases(changesets, targets);
  const touched = targets
    .filter((target) => files.some((file) => file.startsWith(`${target.path}/`)))
    .map((target) => target.name);
  const checked = [...new Set([...touched, ...declared.keys()])];

  if (breaking && checked.length === 0)
    errors.push(
      `${label}: no published package declares a changeset; requires major. Add a major changeset for the package that breaks.`,
    );
  const rule = minimumBump(parsed.type, breaking);
  if (rule) bumpFindings({ label, rule, checked, declared, errors, warnings });
  if (!labels.includes(MAJOR_APPROVAL_LABEL)) {
    for (const [name, { bump, file }] of declared) {
      if (bump !== 'major') continue;
      errors.push(
        `${label}: ${name} declares major in ${file}; a major release requires the ${MAJOR_APPROVAL_LABEL} label. Ask a maintainer to approve the major release and add the label, or lower the bump.`,
      );
    }
  }
  return { errors, warnings };
}
