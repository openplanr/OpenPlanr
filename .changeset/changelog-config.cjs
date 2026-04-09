/**
 * Custom Changesets changelog formatter.
 *
 * Produces clean entries without "Thanks @user" or "Patch/Minor Changes" noise.
 * Format: - <commit-link> <summary> (<PR-link>)
 */

const getReleaseLine = async (changeset, _type, options) => {
  const repo = options?.repo;

  const links = [];

  if (changeset.commit && repo) {
    const short = changeset.commit.slice(0, 7);
    links.push(`[\`${short}\`](https://github.com/${repo}/commit/${changeset.commit})`);
  }

  if (repo) {
    const prMatch = changeset.summary.match(/\(#(\d+)\)/);
    if (prMatch) {
      // PR number already in summary — linkify it
      const prNum = prMatch[1];
      const linked = changeset.summary.replace(
        `(#${prNum})`,
        `([#${prNum}](https://github.com/${repo}/pull/${prNum}))`,
      );
      return `\n- ${links.length ? links.join(' ') + ' ' : ''}${linked}`;
    }
  }

  return `\n- ${links.length ? links.join(' ') + ' ' : ''}${changeset.summary}`;
};

const getDependencyReleaseLine = async () => {
  return '';
};

module.exports = {
  getReleaseLine,
  getDependencyReleaseLine,
};
