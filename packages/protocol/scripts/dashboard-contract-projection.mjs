/**
 * Returns a Protocol dashboard contract with its `../../src/` imports pointed at the pipeline's
 * `lib/protocol` projection. Throws when an import has no projected target.
 */
export function projectDashboardContract(name, source, projectedProtocolFiles) {
  const projected = source.replace(
    /from '\.\.\/\.\.\/src\/([\w-]+\.mjs)'/gu,
    (_specifier, file) => {
      if (!projectedProtocolFiles.has(file)) {
        throw new Error(
          `lib/dashboard/${name} imports src/${file}, which has no pipeline lib/protocol projection.`,
        );
      }
      return `from '../protocol/${file}'`;
    },
  );
  const leftover = /['"](\.\.\/\.\.\/[^'"]*)['"]/u.exec(projected);
  if (leftover) {
    throw new Error(
      `lib/dashboard/${name} still references ${leftover[1]}, a path outside the pipeline package after projection.`,
    );
  }
  return projected;
}
