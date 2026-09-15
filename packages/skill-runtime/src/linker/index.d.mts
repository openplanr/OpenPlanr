export interface SkillContentAsset {
  readonly path: string;
  readonly bytes: string;
}

export interface SkillContentLink {
  readonly target: string;
  readonly localPath: string | null;
  readonly line: number;
  readonly syntax: 'markdown-link';
}

export interface SkillContentLinkResult {
  readonly skillId: string;
  readonly host: string;
  readonly entrypoint: string;
  readonly assets: ReadonlyArray<string>;
  readonly links: ReadonlyArray<{ readonly from: string; readonly to: string; readonly line: number }>;
  readonly linkedSupport: ReadonlyArray<string>;
}

export declare function parseSkillContentLinks(input: {
  bytes: string;
  path: string;
  skillId: string;
  host: string;
}): {
  readonly links: ReadonlyArray<SkillContentLink>;
  readonly ambiguous: ReadonlyArray<{ readonly target: string; readonly line: number; readonly syntax: 'inline-code' }>;
};

export declare function linkSkillProjection(input: {
  skillId: string;
  host: string;
  primary: SkillContentAsset;
  references?: ReadonlyArray<SkillContentAsset>;
  auxiliary?: ReadonlyArray<SkillContentAsset>;
}): SkillContentLinkResult;

export declare function linkSkillProjections(projections: ReadonlyArray<{
  readonly skillId: string;
  readonly host: string;
  readonly primary: SkillContentAsset;
  readonly references: ReadonlyArray<SkillContentAsset>;
}>): ReadonlyArray<SkillContentLinkResult>;
