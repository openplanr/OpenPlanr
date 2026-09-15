import { readdirSync } from "node:fs";
import { join } from "node:path";

export function collectFilePaths(root) {
	const files = [];
	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(path);
			} else if (entry.isFile()) {
				files.push(path);
			}
		}
	};
	visit(root);
	return files.sort();
}
