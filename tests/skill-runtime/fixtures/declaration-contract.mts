import type {
  CompiledAsset,
  Digest,
  SourceMapOwner,
  SourceMapRange,
} from '@openplanr/skill-runtime/compiler';
import type { GenerateReport } from '@openplanr/skill-runtime/authoring';
import type { AssetCustody, GeneratedAsset } from '@openplanr/skill-runtime/manifests';
import type {
  CompletionResult,
  SkillSessionDocument,
  SkillSessionRecoveryResult,
} from '@openplanr/skill-runtime/lifecycle';
import { completionFromRuntimeResult, createCompletion } from '@openplanr/skill-runtime/lifecycle';
import type {
  HostInteractionBinding,
  HostInteractionBindings,
  HostProfile,
  InteractionSessionInput,
  QuestionnaireBindingInput,
} from '@openplanr/skill-runtime/resolver';
import { resolveInteraction } from '@openplanr/skill-runtime/resolver';

const digest = `sha256:${'a'.repeat(64)}` as Digest;
const compilerOwner: SourceMapOwner = {
  ownerKind: 'compiler',
  pointer: 'packages/skill-runtime/src/compiler/render-primitives.mjs#/HOST_SUBSTITUTIONS/codex',
  version: '1.0.0',
  digest,
};
const sourceMap: ReadonlyArray<SourceMapRange> = [
  {
    startByte: 0,
    endByte: 1,
    owner: compilerOwner,
  },
];
const compiled: CompiledAsset = {
  host: 'codex',
  path: 'skills/planr-demo/SKILL.md',
  bytes: 'x',
  digest,
  byteLength: 1,
  sourceMap,
};
const generated: GeneratedAsset = {
  path: compiled.path,
  host: compiled.host,
  byteLength: compiled.byteLength,
  digest: compiled.digest,
  sourceMap: compiled.sourceMap,
};
const custody: AssetCustody = {
  path: generated.path,
  host: generated.host ?? null,
  digest: generated.digest,
  byteLength: generated.byteLength,
  contributors: [{ ...compilerOwner, ranges: [{ startByte: 0, endByte: 1 }] }],
};
const generation: GenerateReport = {
  skillId: 'planr-demo',
  skillVersion: '1.0.0',
  graph: {
    skillId: 'planr-demo',
    skillVersion: '1.0.0',
    sourceFormat: 'composed-v1',
    sources: {
      skill: 'skill.json',
      modules: 'modules.json',
      hostProfiles: 'host-profiles.json',
      template: 'SKILL.md.tmpl',
    },
    modules: [],
    hostProfiles: [],
  },
  outputDir: 'dist',
  assetSetId: 'sas_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  assets: [
    {
      host: generated.host ?? 'codex',
      path: generated.path,
      outputPath: `codex/${generated.path}`,
      digest: generated.digest,
      byteLength: generated.byteLength,
    },
  ],
  content: [
    {
      skillId: 'planr-demo',
      host: 'codex',
      entrypoint: generated.path,
      assets: [generated.path],
      links: [],
      linkedSupport: [],
    },
  ],
  manifests: ['manifests/generated-assets.json', 'manifests/generated-custody.json'],
};

declare const lifecycleSession: SkillSessionDocument;
declare const recovered: SkillSessionRecoveryResult;
declare const hostProfile: HostProfile;
declare const questionnaire: QuestionnaireBindingInput;

const hostBindings: HostInteractionBindings = [
  { surface: 'native', protocolInteraction: 'native', capabilityId: 'native-questions' },
  { surface: 'chat', protocolInteraction: 'chat', capabilityId: 'structured-chat' },
  { surface: 'terminal', protocolInteraction: 'terminal', capabilityId: 'attached-terminal' },
  { surface: 'headless', protocolInteraction: 'none' },
];
const legacySession: InteractionSessionInput = {
  sessionId: 'GIS-legacy-session-0001',
  questionnaireDigest: digest,
  questionnaireVersion: '1.0.0',
};
const completedResult: CompletionResult = createCompletion({
  status: 'completed',
  summary: 'All checks passed.',
  checks: [{ name: 'runtime', status: 'passed' }],
});

// @ts-expect-error Native interaction is always backed by native-questions.
const impossibleBinding: HostInteractionBinding = {
  surface: 'native',
  protocolInteraction: 'native',
  capabilityId: 'attached-terminal',
};
// @ts-expect-error Headless is a final fallback and cannot precede an interactive surface.
const nonFinalHeadlessBindings: HostInteractionBindings = [
  { surface: 'headless', protocolInteraction: 'none' },
  { surface: 'native', protocolInteraction: 'native', capabilityId: 'native-questions' },
];
// @ts-expect-error A branded Protocol session must be the complete digest-bound document.
const incompleteProtocolSession: InteractionSessionInput = { kind: 'skill-session' };
// @ts-expect-error Completed inputs cannot contain failed checks.
createCompletion({
  status: 'completed',
  summary: 'Contradictory.',
  checks: [{ name: 'runtime', status: 'failed' }],
});
// @ts-expect-error Completed runtime results cannot be paired with unresolved issues.
completionFromRuntimeResult(
  { status: 'completed' },
  {
    summary: 'Contradictory.',
    issues: [{ problem: 'Open.', impact: 'Incomplete.', nextAction: 'Resolve it.' }],
  },
);

resolveInteraction({
  hostProfile,
  runtimeCapabilities: {},
  session: lifecycleSession,
  questionnaire,
});
resolveInteraction({
  hostProfile,
  runtimeCapabilities: {},
  session: recovered.session,
  questionnaire,
});
resolveInteraction({
  hostProfile: { ...hostProfile, interactionBindings: hostBindings },
  runtimeCapabilities: {},
  session: legacySession,
  questionnaire,
});

// Runtime source-map values and manifest projections are immutable API results.
// @ts-expect-error SourceMapOwner fields are readonly.
compilerOwner.ownerKind = 'source';
// @ts-expect-error SourceMapRange fields are readonly.
sourceMap[0].startByte = 1;
// @ts-expect-error GeneratedAsset source maps are readonly.
generated.sourceMap.push(sourceMap[0]);
// @ts-expect-error Custody contributor collections are readonly.
custody.contributors.push(custody.contributors[0]);

void custody;
void generation;
void completedResult;
void impossibleBinding;
void incompleteProtocolSession;
