export interface CanonicalRegistries {
  readonly 'roles.json': Record<string, unknown>;
  readonly 'task-kinds.json': Record<string, unknown>;
  readonly 'rules.json': Record<string, unknown>;
  readonly 'commands.json': Record<string, unknown>;
  readonly 'skills.json': Record<string, unknown>;
  readonly 'outputs.json': Record<string, unknown>;
  readonly 'output-paths.json'?: Record<string, unknown>;
}
export type OutputProjectMode = 'default' | 'spec-driven';
export interface ProjectModePathTemplates {
  readonly default: string;
  readonly 'spec-driven': string;
}
export interface OutputCatalogEntry extends Record<string, unknown> {
  readonly outputId: string;
  readonly pathTemplate: string;
}
export interface ResolveOutputPathOptions {
  readonly projectMode?: OutputProjectMode;
  readonly pathArguments?: Readonly<Record<string, string>>;
}
export declare const CANONICAL_REGISTRIES: CanonicalRegistries;
export declare function getCanonicalRegistry(name: keyof CanonicalRegistries): Record<string, unknown>;
export declare function validateCanonicalRegistries(registries?: CanonicalRegistries): true;
export declare function getRole(roleId: string): Record<string, unknown>;
export declare function resolveLegacyRoleAlias(alias: string): Record<string, unknown> | null;
export declare function resolveTaskKind(taskKind: string): Record<string, unknown>;
export declare function getOutput(outputId: string, registries?: CanonicalRegistries): OutputCatalogEntry;
export declare function getOutputPathTemplate(
  outputId: string,
  projectMode?: OutputProjectMode,
  registries?: CanonicalRegistries,
): string;
export declare function resolveOutputPath(
  outputId: string,
  options?: ResolveOutputPathOptions,
  registries?: CanonicalRegistries,
): string;
export declare function routeLegacyTask(value: { legacyType: 'UI' | 'Tech'; legacyAgent?: string | null }): Record<string, unknown>;
