import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export function readOpenPlanrVersion() {
    const packagePath = resolve(moduleDirectory, '../../package.json');
    if (!existsSync(packagePath))
        return '0.0.0';
    try {
        const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
        return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * The installed package version is the provenance source of truth.
 *
 * Changesets updates package.json for every release, so operating artifacts
 * must derive their producer version here instead of carrying copied literals.
 */
export const OPENPLANR_VERSION = readOpenPlanrVersion();
//# sourceMappingURL=package-version.js.map