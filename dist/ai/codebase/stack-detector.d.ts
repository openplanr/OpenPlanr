/**
 * Detects the tech stack of a project by reading manifest files.
 *
 * Looks for package.json (Node.js), go.mod (Go), requirements.txt / pyproject.toml
 * (Python), Cargo.toml (Rust), and more. Returns a structured TechStack object
 * used to enrich AI prompts with codebase awareness.
 */
export interface TechStack {
    language: string;
    framework?: string;
    packageManager?: string;
    dependencies: string[];
    devDependencies: string[];
}
export declare function detectTechStack(projectDir: string): Promise<TechStack | null>;
/** Format tech stack as a human-readable string for prompt injection. */
export declare function formatTechStack(stack: TechStack): string;
//# sourceMappingURL=stack-detector.d.ts.map