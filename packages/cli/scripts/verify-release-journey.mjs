#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPathInside, resolvePipelineCandidateSourceRoot } from './release-package-input.mjs';

/**
 * Runs the complete public Operate candidate journey against packed OpenPlanr
 * and packed planr-pipeline bytes. It uses only the executor-facing
 * prepare -> validate -> submit workflow and exact owner Review choices.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADVISOR_ROLE_IDS = new Set([
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
]);

class JourneyStop extends Error {}
const failures = [];
const notes = [];

function check(description, condition, detail = '') {
  if (condition) console.log(`  ✓ ${description}`);
  else {
    console.log(`  ✗ ${description}${detail ? ` — ${detail}` : ''}`);
    failures.push(description);
  }
}

function must(description, condition, detail = '') {
  check(description, condition, detail);
  if (!condition) throw new JourneyStop(description);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function packArchive(sourceRoot, destination) {
  const report = JSON.parse(
    run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
      cwd: sourceRoot,
    }),
  );
  const filename = report[0]?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error(`npm pack did not report an archive for ${sourceRoot}.`);
  }
  return join(destination, filename);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readJsonFile(target) {
  return JSON.parse(readFileSync(target, 'utf8'));
}

function writeJsonFile(target, value) {
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function issuedEvidenceRefIds(assignment) {
  const bundle = record(record(assignment.intelligenceContext).inputBundle);
  return Array.isArray(bundle.issuedEvidence)
    ? bundle.issuedEvidence
        .map((entry) => String(record(entry).evidenceRefId ?? ''))
        .filter(Boolean)
    : [];
}

function fillGaps(value, impact, recoveryPath) {
  value.gaps = (Array.isArray(value.gaps) ? value.gaps : []).map((gap) => ({
    ...record(gap),
    impact,
    recoveryPath,
  }));
}

function authorAdvisor(claim, recommendation) {
  const value = structuredClone(claim.template);
  const assignment = claim.assignment;
  const evidenceRefIds = issuedEvidenceRefIds(assignment);
  const absenceIds = (Array.isArray(assignment.inputAbsences) ? assignment.inputAbsences : [])
    .map((absence) => String(record(absence).absenceId ?? ''))
    .filter(Boolean);
  value.summary = recommendation
    ? 'A bounded measurement should precede any material allocation change.'
    : 'No additional primary recommendation is justified from this role evidence.';
  value.analysisMarkdown =
    'This result preserves exact evidence custody and states its uncertainty explicitly.';
  fillGaps(
    value,
    'The missing evidence limits confidence in this professional lens.',
    'Issue a current authorized Evidence Artifact for this requirement.',
  );
  const analysis = record(value.analysis);
  for (const answer of Array.isArray(analysis.executiveQuestionAnswers)
    ? analysis.executiveQuestionAnswers
    : []) {
    answer.answer = recommendation
      ? 'The evidence supports a reversible measurement-first direction.'
      : 'The evidence does not support a distinct material direction change.';
    answer.evidenceRefIds = [...evidenceRefIds];
    answer.absenceIds = [...absenceIds];
  }
  if (!recommendation) {
    value.outcome = absenceIds.length > 0 ? 'partial' : 'quiet';
    value.recommendation = null;
    return value;
  }
  if (evidenceRefIds.length === 0) throw new Error('Recommendation has no issued EvidenceRef.');
  const assignmentId = String(assignment.assignmentId);
  const claimId = `claim:${assignmentId}:1`;
  const riskId = `risk:${assignmentId}:1`;
  const alternativeId = `alternative:${assignmentId}:1`;
  const recommendationId = `recommendation:${assignmentId}:1`;
  value.outcome = 'recommendation';
  value.claims = [
    {
      localClaimId: claimId,
      statement: 'A fresh measurement reduces the downside of changing allocation prematurely.',
      epistemicStatus: 'probable',
      confidence: 0.68,
      supportingEvidenceRefIds: [...evidenceRefIds],
      contradictingEvidenceRefIds: [],
      assumptionIds: [],
      changeCondition: 'A current accepted measurement contradicts the observed direction.',
    },
  ];
  value.risks = [
    {
      localRiskId: riskId,
      title: 'Premature allocation change',
      statement: 'Changing allocation before measuring can amplify an unpriced downside.',
      likelihood: 0.5,
      impact: 'high',
      exposure: 'The operating scope may spend the next window on the wrong constraint.',
      exposedSurfaces: ['Allocation planning'],
      claimIds: [claimId],
      evidenceRefIds: [...evidenceRefIds],
      mitigation: 'Run one bounded measurement first.',
      reversibility: 'The measurement is reversible before an allocation change.',
    },
  ];
  value.alternatives = [
    {
      localAlternativeId: alternativeId,
      title: 'Hold current allocation',
      description: 'Keep allocation unchanged through the next measurement window.',
      supportingClaimIds: [claimId],
      evidenceRefIds: [...evidenceRefIds],
      tradeoffs: ['Preserves reversibility but defers another learning loop.'],
      costOfDelay: 'One observation window of delayed allocation learning.',
      reversibility: 'Fully reversible after the observation window.',
    },
  ];
  value.recommendation = {
    localRecommendationId: recommendationId,
    title: 'Measure before reallocating',
    proposal: 'Run one bounded measurement before changing allocation.',
    rationaleClaimIds: [claimId],
    alternativeIds: [alternativeId],
    riskIds: [riskId],
    confidence: 0.68,
    expectedUpside: 'Narrows the most consequential uncertainty before committing resources.',
    expectedDownside: 'Defers another learning loop by one observation window.',
    uncertainty: 'The current evidence remains limited.',
    reversibility: 'The measurement can stop without an allocation commitment.',
    successMeasurementIds: [],
    revisitConditions: ['A current accepted measurement materially changes the direction.'],
  };
  for (const answer of Array.isArray(analysis.executiveQuestionAnswers)
    ? analysis.executiveQuestionAnswers
    : []) {
    answer.claimIds = [claimId];
    answer.riskIds = [riskId];
  }
  return value;
}

function authorChallenger(claim) {
  const advisor = claim.issuedArtifacts.find(
    ({ body }) => body.kind === 'operating-advisor-result' && body.recommendation !== null,
  );
  if (!advisor) throw new Error('Challenger has no issued Advisor recommendation.');
  const advisorClaim = record(advisor.body.claims?.[0]);
  const advisorRisk = record(advisor.body.risks?.[0]);
  const recommendation = record(advisor.body.recommendation);
  const value = structuredClone(claim.template);
  const assignmentId = String(claim.assignment.assignmentId);
  const findingId = `finding:${assignmentId}:1`;
  const dissentId = `dissent:${assignmentId}:1`;
  const evidenceRefIds = Array.isArray(advisorClaim.supportingEvidenceRefIds)
    ? [...advisorClaim.supportingEvidenceRefIds]
    : [];
  const target = {
    advisorArtifactId: advisor.artifactId,
    analysisIds: [],
    claimIds: [String(advisorClaim.localClaimId)],
    measurementIds: [],
    riskIds: [String(advisorRisk.localRiskId)],
    recommendationIds: [String(recommendation.localRecommendationId)],
  };
  value.summary = 'The recommendation is reversible, but its downside must remain explicit.';
  value.analysisMarkdown =
    'The challenge targets the exact Advisor claim, risk, and recommendation.';
  value.findings = [
    {
      localFindingId: findingId,
      title: 'Unpriced delay downside',
      statement:
        'The recommendation does not fully price the opportunity cost of delaying another learning loop.',
      type: 'unpriced-downside',
      severity: 'medium',
      confidence: 0.62,
      targets: [target],
      supportingEvidenceRefIds: [...evidenceRefIds],
      contradictingEvidenceRefIds: [],
      rationale: 'The source claim supports measurement but does not quantify delayed learning.',
      correctionCondition: 'Price the delayed learning cost in the Chair decision.',
    },
  ];
  value.missingAlternatives = [
    {
      localAlternativeId: `alternative:${assignmentId}:1`,
      title: 'Parallel bounded measurement',
      description: 'Measure the constraint while preserving a small parallel learning lane.',
      targets: [target],
      evidenceRefIds: [...evidenceRefIds],
      tradeoffs: ['Costs more capacity but preserves both learning loops.'],
    },
  ];
  const longDissent =
    'Do not approve a measurement-only path unless the parallel-learning delay is bounded. '.padEnd(
      615,
      'x',
    );
  value.dissent = [
    {
      localDissentId: dissentId,
      findingIds: [findingId],
      statement: longDissent,
      evidenceRefIds: [...evidenceRefIds],
      resolutionCondition: 'Bound and price the delayed learning in the accepted decision.',
    },
  ];
  value.questionCoverage = value.questionCoverage.map((entry) => ({
    ...entry,
    disposition: 'answered',
    answer: `The exact Challenger Finding, alternative, and dissent address ${entry.questionId}.`,
    findingIds: [findingId],
    alternativeIds: [value.missingAlternatives[0].localAlternativeId],
    dissentIds: [dissentId],
    gapIds: [],
    justification: null,
  }));
  fillGaps(
    value,
    'The missing input limits challenge coverage.',
    'Recover the exact missing role or Evidence Artifact and rerun challenge.',
  );
  return { value, longDissent };
}

function authorChair(claim) {
  const advisor = claim.issuedArtifacts.find(
    ({ body }) => body.kind === 'operating-advisor-result' && body.recommendation !== null,
  );
  const challenger = claim.issuedArtifacts.find(
    ({ body }) => body.kind === 'operating-challenger-review',
  );
  if (!advisor || !challenger) {
    throw new Error('Chair has no exact Advisor recommendation and Challenger review.');
  }
  const advisorClaim = record(advisor.body.claims?.[0]);
  const recommendation = record(advisor.body.recommendation);
  const alternative = record(advisor.body.alternatives?.[0]);
  const finding = record(challenger.body.findings?.[0]);
  const dissent = record(challenger.body.dissent?.[0]);
  const evidenceRefIds = Array.isArray(advisorClaim.supportingEvidenceRefIds)
    ? [...advisorClaim.supportingEvidenceRefIds]
    : [];
  const value = structuredClone(claim.template);
  const decisionId = `decision:${claim.assignment.assignmentId}:1`;
  value.summary = 'Approve one bounded measurement while explicitly limiting delayed learning.';
  value.decisions = [
    {
      localDecisionId: decisionId,
      title: 'Run a bounded measurement',
      question: 'How should the operating scope reduce uncertainty?',
      outcome: 'Run one bounded measurement and cap delayed learning to one window.',
      rationale:
        'The Advisor claim supports a reversible measurement and the Challenger prices its downside.',
      sourceClaimRefs: [
        { advisorArtifactId: advisor.artifactId, localClaimId: advisorClaim.localClaimId },
      ],
      sourceRecommendationRefs: [
        {
          advisorArtifactId: advisor.artifactId,
          localRecommendationId: recommendation.localRecommendationId,
        },
      ],
      challengerFindingIds: [finding.localFindingId],
      evidenceRefIds,
      alternativeDispositions: [
        {
          sourceArtifactId: advisor.artifactId,
          localAlternativeId: alternative.localAlternativeId,
          title: alternative.title,
          disposition: 'deferred',
          rationale: 'The bounded measurement is more informative than holding all allocation.',
        },
      ],
      confidence: 0.66,
      assumptionIds: [],
      upside: 'Narrows uncertainty before a resource commitment.',
      downside: 'Defers another learning loop for one bounded window.',
      uncertainty: 'The response remains uncertain until the next accepted measurement.',
      reversibility: 'The measurement can stop without committing the allocation change.',
      ownerActorId: claim.assignment.intelligenceContext.decisionOwnerActorId,
      revisitConditions: ['The next accepted measurement materially changes the direction.'],
      dissentIds: [dissent.localDissentId],
      actionHypotheses: [],
    },
  ];
  value.sourceDispositions = value.sourceDispositions.map((disposition) => {
    const relevant =
      disposition.sourceKind === 'advisor-recommendation' ||
      disposition.sourceKind === 'challenger-finding' ||
      disposition.sourceKind === 'challenger-dissent';
    return {
      ...disposition,
      disposition: relevant ? 'accepted' : 'noted',
      localDecisionId: relevant ? decisionId : null,
      rationale: relevant
        ? 'The Decision cites this exact source item.'
        : 'The quiet Advisor outcome is retained without inventing a recommendation.',
    };
  });
  value.questionCoverage = value.questionCoverage.map((entry) => ({
    ...entry,
    disposition: 'answered',
    answer: `The accepted Decision and exact Challenger sources address ${entry.questionId}.`,
    decisionIds: [decisionId],
    findingIds: [finding.localFindingId],
    dissentIds: [dissent.localDissentId],
    absenceIds: [],
    justification: null,
  }));
  return value;
}

function loadPreparedClaim(prepared) {
  const assignment = readJsonFile(prepared.assignmentPath);
  const matrix = readJsonFile(prepared.evidenceMatrixPath);
  const packetRoot = dirname(prepared.evidenceMatrixPath);
  const issuedArtifacts = matrix.inputs
    .filter((input) => input.representation === 'decoded-json')
    .map((input) => ({
      artifactId: String(input.artifactId),
      metadata: input.metadata,
      body: readJsonFile(join(packetRoot, ...String(input.contentPath).split('/'))),
    }));
  return {
    assignment,
    issuedArtifacts,
    template: readJsonFile(prepared.resultPath),
  };
}

async function probeDashboard(cli, project, environment, cycleId, ownerActorId) {
  const child = spawn(
    cli,
    ['operate', 'dashboard', cycleId, '--actor', ownerActorId, '--port', '0', '--no-watch'],
    { cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 20_000;
  try {
    let url = null;
    while (!url && Date.now() < deadline) {
      const match = stdout.match(/DASHBOARD_URL:\s+(http:\/\/127\.0\.0\.1:[0-9]+\/[^\s]*)/u);
      if (match) url = match[1];
      else {
        if (child.exitCode !== null) {
          throw new Error(
            `dashboard exited ${child.exitCode}: ${(stderr || stdout).slice(0, 500)}`,
          );
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
    }
    if (!url)
      throw new Error(`dashboard did not report a URL: ${(stderr || stdout).slice(0, 500)}`);
    const response = await fetch(url);
    const html = await response.text();
    return { url, status: response.status, html };
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

let workspace;
try {
  const pipelineCandidate = resolvePipelineCandidateSourceRoot({ openPlanrRoot: repositoryRoot });
  workspace = mkdtempSync(join(tmpdir(), 'openplanr-release-journey-'));
  const prefix = join(workspace, 'prefix');
  const home = join(workspace, 'home');
  const project = join(workspace, 'project');
  for (const directory of [prefix, home, project]) mkdirSync(directory, { recursive: true });

  console.log('Packing OpenPlanr…');
  run('npm', ['run', 'build'], { cwd: repositoryRoot });
  const tarball = packArchive(repositoryRoot, workspace);
  const pipelinePackRoot = join(workspace, 'pipeline-pack');
  mkdirSync(pipelinePackRoot, { recursive: true });
  const pipelineTarball = packArchive(pipelineCandidate.root, pipelinePackRoot);
  writeFileSync(join(prefix, 'package.json'), '{"name":"release-journey","private":true}\n');
  run('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: prefix, stdio: 'pipe' });
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', pipelineTarball],
    { cwd: prefix, stdio: 'pipe' },
  );

  const cli = join(prefix, 'node_modules', '.bin', 'planr');
  const environment = { ...process.env, HOME: home, USERPROFILE: home };
  delete environment.OPENPLANR_PIPELINE_ROOT;
  delete environment.OPENPLANR_ECOSYSTEM_SOURCE;
  delete environment.OPENPLANR_PIPELINE_TARBALL;
  const cliOutput = (args, options = {}) =>
    run(cli, args, { cwd: project, env: environment, ...options });
  const json = (args) => {
    let raw;
    try {
      raw = cliOutput(args);
    } catch (error) {
      raw = String(error.stdout ?? '');
      if (!raw.trim()) {
        throw new Error(
          `${args.join(' ')} failed (exit ${error.status ?? '?'}): ${String(error.stderr ?? error.message).slice(0, 500)}`,
        );
      }
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${args.join(' ')} did not emit JSON: ${raw.slice(0, 500)}`);
    }
  };

  console.log('\nJourney:');
  const installedPipelineRoot = realpathSync(join(prefix, 'node_modules', 'planr-pipeline'));
  check(
    'installed pipeline resolves inside the disposable prefix',
    isPathInside(prefix, installedPipelineRoot),
    installedPipelineRoot,
  );
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'operate-release-journey', private: true, type: 'module' }, null, 2)}\n`,
  );

  const inspection = json(['operate', 'recovery', 'inspect', '--json']);
  must(
    'operate recovery inspect succeeds on a fresh project',
    inspection.ok === true && inspection.operation === 'operate.recovery.inspect',
  );
  check(
    'recovery inspection returns the current Operate empty-store contract',
    inspection.data?.status === 'empty' &&
      inspection.data?.allowedRecovery === 'none' &&
      inspection.data?.integrityBoundary?.model === 'project-local-integrity',
    JSON.stringify(inspection.data),
  );

  cliOutput(['setup', '--yes', '--runtime', 'codex'], { stdio: 'pipe' });
  const skills = readdirSync(join(home, '.codex', 'skills')).sort();
  const generatedDistribution = readJsonFile(
    join(
      installedPipelineRoot,
      'conformance',
      'fixtures',
      'operate-adapter-parity',
      'generated-assets.json',
    ),
  );
  const expectedSkills = generatedDistribution.skillDistribution.skills
    .map(({ skillId }) => String(skillId))
    .sort();
  const { BUSINESS_EXECUTIVE_SKILL_BINDINGS } = await import(
    pathToFileURL(join(installedPipelineRoot, 'lib', 'operate', 'contracts', 'role-skills.mjs'))
      .href
  );
  const expectedBusinessExecutorSkills = BUSINESS_EXECUTIVE_SKILL_BINDINGS.map(({ skillName }) =>
    String(skillName),
  ).sort();
  must(
    'setup installs the exact generated Codex skill distribution',
    JSON.stringify(skills) === JSON.stringify(expectedSkills),
    skills.join(', '),
  );
  check('setup installs the Operate parent skill', skills.includes('planr-operate'));
  check(
    'setup installs the exact registry-owned business executor skills',
    expectedBusinessExecutorSkills.length === 7 &&
      expectedBusinessExecutorSkills.every((skillName) => skills.includes(skillName)),
    expectedBusinessExecutorSkills.join(', '),
  );
  const doctor = json(['doctor', '--json']);
  check(
    'doctor verifies the clean global skill bundle',
    doctor.ok === true,
    JSON.stringify(doctor),
  );

  const domainCatalog = json(['operate', 'domains', '--json']);
  must(
    'installed pipeline exposes its exact public operating domain catalog',
    domainCatalog.ok === true &&
      domainCatalog.operation === 'operate.domains.list' &&
      Array.isArray(domainCatalog.data?.domains),
    JSON.stringify(domainCatalog),
  );
  const businessDomains = domainCatalog.data.domains.filter(
    (domain) => domain.domainId === 'business',
  );
  must(
    'business intent resolves to one exact registered domain identity',
    businessDomains.length === 1 &&
      typeof businessDomains[0].domainVersion === 'string' &&
      businessDomains[0].domainVersion.length > 0,
    JSON.stringify(businessDomains),
  );
  check(
    'domain discovery includes the registered role choreography',
    Array.isArray(businessDomains[0].roles) && businessDomains[0].roles.length > 0,
    JSON.stringify(businessDomains[0]),
  );
  const businessDomain = businessDomains[0];
  const scope = {
    scopeId: 'scope-release-journey',
    domainId: businessDomain.domainId,
    domainVersion: businessDomain.domainVersion,
  };
  const owner = 'owner-release-journey';
  const started = json([
    'operate',
    'start',
    '--scope',
    scope.scopeId,
    '--domain',
    scope.domainId,
    '--domain-version',
    scope.domainVersion,
    '--focus',
    'packed candidate evidence and decision quality',
    '--owner',
    owner,
    '--route',
    'observe-only',
    '--json',
  ]);
  must(
    'Cycle starts from packed bytes with automatic screened evidence',
    started.ok === true && started.operation === 'operate.cycle.start',
    JSON.stringify(started),
  );
  const cycleId = String(started.data?.cycle?.cycleId ?? '');
  must('Cycle exposes an exact identity', /^cyc_[A-Za-z0-9._-]{8,}$/u.test(cycleId), cycleId);

  const prepareAndSubmit = (assignment, buildBody) => {
    const prepared = json([
      'operate',
      'assignment',
      'prepare',
      assignment.assignmentId,
      '--actor',
      `agent-${assignment.roleId}`,
      '--runtime',
      'codex',
      '--json',
    ]);
    must(
      `prepare returns the complete ${assignment.roleId} packet paths`,
      typeof prepared.packetId === 'string' &&
        typeof prepared.resultPath === 'string' &&
        typeof prepared.assignmentPath === 'string' &&
        typeof prepared.evidenceMatrixPath === 'string',
      JSON.stringify(prepared),
    );
    const claim = loadPreparedClaim(prepared);
    const result = buildBody(claim);
    writeJsonFile(prepared.resultPath, result);
    const validation = json([
      'operate',
      'assignment',
      'validate',
      prepared.packetId,
      '--content-file',
      prepared.resultPath,
      '--json',
    ]);
    must(
      `${assignment.roleId} result passes schema and semantic preflight`,
      validation.ok === true,
      JSON.stringify(validation.errors ?? validation),
    );
    const receipt = json([
      'operate',
      'assignment',
      'submit',
      prepared.packetId,
      '--content-file',
      prepared.resultPath,
      '--json',
    ]);
    must(
      `${assignment.roleId} submission is accepted`,
      receipt.packetId === prepared.packetId && receipt.assignmentId === assignment.assignmentId,
      JSON.stringify(receipt),
    );
    return { claim, result };
  };

  let current = json(['operate', 'get', cycleId, '--json']);
  const advisors = current.data.availableAssignments.filter((assignment) =>
    ADVISOR_ROLE_IDS.has(assignment.roleId),
  );
  must('runtime issues all five executive Advisor Assignments', advisors.length === 5);
  let recommendationAuthored = false;
  for (const assignment of advisors) {
    prepareAndSubmit(assignment, (claim) => {
      const recommendation =
        !recommendationAuthored && issuedEvidenceRefIds(claim.assignment).length > 0;
      recommendationAuthored ||= recommendation;
      return authorAdvisor(claim, recommendation);
    });
  }
  must('one Advisor recommendation cites exact issued evidence', recommendationAuthored);

  current = json(['operate', 'get', cycleId, '--json']);
  const challenger = current.data.availableAssignments.find(
    (assignment) => assignment.roleId === 'independent-challenge',
  );
  must('Challenger becomes available after the five Advisors', Boolean(challenger));
  let longDissent = '';
  prepareAndSubmit(challenger, (claim) => {
    const authored = authorChallenger(claim);
    longDissent = authored.longDissent;
    return authored.value;
  });
  check('Challenger preserves a 615-character dissent statement', longDissent.length === 615);

  current = json(['operate', 'get', cycleId, '--json']);
  const chair = current.data.availableAssignments.find(
    (assignment) => assignment.roleId === 'chair',
  );
  must('Chair becomes available after the Challenger', Boolean(chair));
  prepareAndSubmit(chair, authorChair);

  const experienceBeforeReview = json([
    'operate',
    'experience',
    cycleId,
    '--actor',
    owner,
    '--json',
  ]);
  const reviewReadAction = (experienceBeforeReview.allowedActions ?? []).find(
    (action) => action.tool === 'operate.review.get',
  );
  must('Experience advertises the exact owner Review read', Boolean(reviewReadAction));
  const readArguments = reviewReadAction.arguments;
  const review = json([
    'operate',
    'review',
    readArguments.reviewId,
    '--actor',
    owner,
    '--cycle',
    cycleId,
    '--scope',
    scope.scopeId,
    '--domain',
    scope.domainId,
    '--domain-version',
    scope.domainVersion,
    '--json',
  ]);
  must(
    'owner Review read contains decisions, Findings, dissent, gaps, and exact choices',
    review.ok === true &&
      review.data.decisions.length > 0 &&
      review.data.findings.length > 0 &&
      review.data.dissent.length > 0 &&
      review.data.gaps.length > 0 &&
      review.data.dispositionChoices.length > 0,
    JSON.stringify(review.data),
  );
  const approval = review.data.dispositionChoices.find(
    (choice) => choice.submitArguments?.disposition === 'approved',
  );
  must('Review advertises an exact approved disposition choice', Boolean(approval));
  const decided = json([
    'operate',
    'decide',
    readArguments.reviewId,
    '--actor',
    owner,
    '--cycle',
    cycleId,
    '--scope',
    scope.scopeId,
    '--domain',
    scope.domainId,
    '--domain-version',
    scope.domainVersion,
    '--choice',
    approval.choiceId,
    '--choice-hash',
    approval.choiceHash,
    '--json',
  ]);
  must(
    'exact advertised Review choice commits one owner-bound receipt',
    decided.ok === true && decided.operation === 'operate.review.submit',
    JSON.stringify(decided),
  );

  const experience = json(['operate', 'experience', cycleId, '--actor', owner, '--json']);
  const cycle = json(['operate', 'cycle', cycleId, '--actor', owner, '--json']);
  const exported = json([
    'operate',
    'export',
    cycleId,
    '--actor',
    owner,
    '--format',
    'json',
    '--json',
  ]);
  check('Experience renders the approved Cycle', experience.ok === true);
  check('Cycle renders the approved board', cycle.ok === true);
  check('Export renders the approved board', exported.ok === true);
  check(
    'Experience, Cycle, and Export preserve the full long dissent',
    [experience, cycle, exported].every((surface) => JSON.stringify(surface).includes(longDissent)),
  );

  const dashboard = await probeDashboard(cli, project, environment, cycleId, owner);
  check(
    'loopback Dashboard serves the packed production shell',
    dashboard.status === 200 &&
      dashboard.html.includes('<title>OpenPlanr</title>') &&
      dashboard.html.includes('<div id="root"></div>'),
    `${dashboard.status} ${dashboard.url}`,
  );
  console.log('');
} catch (error) {
  if (!(error instanceof JourneyStop)) {
    console.error(`\nRelease journey could not run: ${error.message}`);
    notes.push(error.stack ?? String(error));
    if (workspace) rmSync(workspace, { recursive: true, force: true });
    process.exit(2);
  }
}

if (workspace) rmSync(workspace, { recursive: true, force: true });
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\n${failures.length} journey assertion(s) failed against the packed candidate.`);
  console.error('Do not release: the installed Operate journey is incomplete.');
  process.exit(1);
}
console.log('The packed candidate completes the full Operate journey.');
