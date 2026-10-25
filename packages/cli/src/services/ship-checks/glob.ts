const cache = new Map<string, RegExp>();

/** GitHub Actions path-filter glob: `*` stays in one segment, `**` crosses them. */
export function matchesFilterGlob(path: string, pattern: string): boolean {
  let expression = cache.get(pattern);
  if (expression === undefined) {
    let source = '';
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index] ?? '';
      if (char === '*' && pattern[index + 1] === '*') {
        const slash = pattern[index + 2] === '/';
        source += slash ? '(?:.*/)?' : '.*';
        index += slash ? 2 : 1;
      } else if (char === '*') source += '[^/]*';
      else if (char === '?') source += '[^/]';
      else source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
    }
    expression = new RegExp(`^${source}$`, 'u');
    cache.set(pattern, expression);
  }
  return expression.test(path);
}

/** Applies ordered include and `!` exclude patterns; the last matching pattern wins. */
export function matchesFilterList(path: string, patterns: readonly string[]): boolean {
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (matchesFilterGlob(path, pattern.slice(1))) matched = false;
    } else if (matchesFilterGlob(path, pattern)) matched = true;
  }
  return matched;
}
