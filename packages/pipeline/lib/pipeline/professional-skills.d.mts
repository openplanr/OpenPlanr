export type ProfessionalSkillId =
  | 'planr-browser-qa'
  | 'planr-investigate'
  | 'planr-plan-review'
  | 'planr-spec';
export type ProfessionalSkillHost = 'claude-code' | 'codex' | 'cursor';
export type ProfessionalSkillAuthority =
  | 'planning-write'
  | 'review-evidence'
  | 'diagnose-or-authorized-fix'
  | 'quality-evidence';
export interface ProfessionalSkillContractRef {
  id: string;
  version: string;
}
export interface ProfessionalSkillCliRequirement {
  id: string;
  argv: string[];
  requiredOptions: string[];
  inputOptions?: string[];
  authority?: 'agent' | 'owner-only';
}
export interface ProfessionalSkillCatalogRow {
  skillId: ProfessionalSkillId;
  sourceOwner: 'skills';
  sourceVersion: '1.0.0';
  sourceSnapshot: string;
  sourceDigest: `sha256:${string}`;
  contracts: { inputs: ProfessionalSkillContractRef[]; outputs: ProfessionalSkillContractRef[] };
  authorityClass: ProfessionalSkillAuthority;
  triggerPolicy: { include: string[]; exclude: string[]; deferTo: string[] };
  cliRequirements: ProfessionalSkillCliRequirement[];
  hosts: Array<{ host: ProfessionalSkillHost; entrypoint: string; path: string }>;
}
export interface ProfessionalSkillsCatalog {
  kind: 'professional-skills';
  schemaVersion: '1.0.0';
  protocolVersion: '1.1.0';
  catalogVersion: '1.0.0';
  digestAlgorithm: 'sha256';
  skills: ProfessionalSkillCatalogRow[];
}
export interface ProfessionalSkillsManifest {
  kind: 'professional-skill-assets';
  schemaVersion: '1.0.0';
  protocolVersion: '1.1.0';
  catalog: { path: string; catalogVersion: '1.0.0'; digest: `sha256:${string}` };
  digestAlgorithm: 'sha256';
  skillIds: ProfessionalSkillId[];
  membershipDigest: `sha256:${string}`;
  skills: Array<
    Omit<ProfessionalSkillCatalogRow, 'sourceSnapshot' | 'hosts'> & {
      assets: Array<{
        host: ProfessionalSkillHost;
        entrypoint: string;
        path: string;
        digest: `sha256:${string}`;
      }>;
    }
  >;
  bundleDigest: `sha256:${string}`;
}
export const PROFESSIONAL_SKILLS_CATALOG_PATH: 'registry/professional-skills.json';
export const PROFESSIONAL_SKILLS_MANIFEST_PATH: 'conformance/fixtures/professional-skills/generated-assets.json';
export const PROFESSIONAL_SKILL_IDS: readonly ProfessionalSkillId[];
export function assertProfessionalSkillsCatalog(catalog: unknown): ProfessionalSkillsCatalog;
export interface ProfessionalSkillsReadOptions {
  /** Package root containing the bundled registry. Defaults to this installation. */
  projectRoot?: string;
  /** Bundled compatibility snapshots by default; active requires an explicit sourceRoot. */
  view?: 'active' | 'legacy';
  /** Caller-owned source root containing skills/<skillId>/SKILL.md. Never discovered. */
  sourceRoot?: string;
}
export function readProfessionalSkillsCatalog(
  options?: ProfessionalSkillsReadOptions,
): ProfessionalSkillsCatalog;
export function renderProfessionalSkillAssets(
  catalog: ProfessionalSkillsCatalog,
): Record<string, string>;
export function buildProfessionalSkillsManifest(
  catalog: ProfessionalSkillsCatalog,
  assets?: Record<string, string>,
  options?: {
    cliRequirementsBySkill?: Map<ProfessionalSkillId, ProfessionalSkillCliRequirement[]>;
  },
): ProfessionalSkillsManifest;
export function renderProfessionalSkillsBundle(
  options?: ProfessionalSkillsReadOptions,
): Readonly<Record<string, string>>;
export function professionalSkillCliRequirements(
  catalog: ProfessionalSkillsCatalog,
): Array<ProfessionalSkillCliRequirement & { skillId: ProfessionalSkillId }>;
export function professionalSkillDigest(value: string): `sha256:${string}`;
