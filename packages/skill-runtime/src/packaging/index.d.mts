export declare function renderOpenAiSkillMetadata(input: { skillId: string; description: string; invocation?: string }): string;
export declare function createDeterministicZip(entries: ReadonlyArray<{ path: string; bytes: string | Buffer }>): Buffer;
export declare function readDeterministicZip(archive: Uint8Array): ReadonlyArray<{ readonly path: string; readonly bytes: Buffer }>;
export declare function buildSkillReleaseTree(input: {
  workspaceVersion: string;
  sourceRegistry: { skills: ReadonlyArray<{ skillId: string; skillVersion: string }>; aliases: ReadonlyArray<{ id: string; canonicalSkillId: string }> };
  contentManifest: { pluginRoot: string; skillRoot: string; skills: ReadonlyArray<{ skillId: string; classification: string }> };
  readProductEntries: (source: string) => Array<{ path: string; bytes: Buffer }>;
  licenseBytes: Buffer;
  hostProducts?: ReadonlyArray<{ id: string; host: string; source: string }>;
}): {
  readonly tree: ReadonlyMap<string, Buffer>;
  readonly index: Record<string, unknown>;
};
