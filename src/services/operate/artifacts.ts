import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OPENPLANR_VERSION } from '../../utils/package-version.js';
import { canonicalDigest, sha256Digest } from './canonical.js';
import { applyJournalTransaction, prepareJournalTransaction } from './journal.js';
import { assertOperatingArtifact } from './protocol.js';
import { sanitizeGeneratedPlainText } from './redaction.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingArtifactSession,
  type OperatingEventHead,
} from './types.js';

const EXTENSIONS: Record<OperatingArtifactSession['artifactType'], string> = {
  markdown: '.md',
  html: '.html',
  json: '.json',
  csv: '.csv',
};

export async function createArtifactSession(input: {
  id: string;
  cycleId: string;
  artifactType: OperatingArtifactSession['artifactType'];
  inputDigest: `sha256:${string}`;
  destination: string;
  evidenceRefs: string[];
  runtime: string;
  capability?: 'analysis-standard' | 'analysis-high';
  now?: string;
}): Promise<OperatingArtifactSession> {
  if (
    path.isAbsolute(input.destination) ||
    path.extname(input.destination).toLowerCase() !== EXTENSIONS[input.artifactType]
  ) {
    throw new OperateError(
      'E_OPERATE_ARTIFACT_REJECTED',
      'Artifact destination must be project-relative and match the declared type.',
    );
  }
  const now = input.now ?? new Date().toISOString();
  const session: OperatingArtifactSession = {
    kind: 'operating-artifact-session',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: input.id,
    cycleId: input.cycleId,
    state: 'prepared',
    artifactType: input.artifactType,
    inputDigest: input.inputDigest,
    destination: input.destination,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
    producer: {
      product: 'openplanr',
      version: OPENPLANR_VERSION,
      runtime: input.runtime,
      capability: input.capability ?? 'analysis-standard',
    },
    createdAt: now,
    updatedAt: now,
  };
  return assertOperatingArtifact('operating-artifact-session', session);
}

export async function commitGeneratedArtifact(input: {
  projectRoot: string;
  session: OperatingArtifactSession;
  content: string;
  eventHead: OperatingEventHead;
  previewDigest: `sha256:${string}`;
  localRoot?: string;
}): Promise<OperatingArtifactSession> {
  if (input.session.state !== 'prepared' && input.session.state !== 'generating') {
    throw new OperateError(
      'E_OPERATE_ARTIFACT_REJECTED',
      `Artifact session cannot commit from ${input.session.state}.`,
    );
  }
  const sanitized =
    input.session.artifactType === 'json'
      ? `${JSON.stringify(JSON.parse(input.content), null, 2)}\n`
      : sanitizeGeneratedPlainText(input.content);
  const outputDigest = sha256Digest(sanitized);
  const now = new Date().toISOString();
  const committed: OperatingArtifactSession = {
    ...input.session,
    state: 'committed',
    outputDigest,
    updatedAt: now,
  };
  await assertOperatingArtifact('operating-artifact-session', committed);
  const sessionPath = `.planr/operate/artifacts/${input.session.id}.json`;
  const existingSession = await readFile(path.join(input.projectRoot, sessionPath)).catch(
    () => null,
  );
  const writes = [
    {
      relativePath: input.session.destination,
      operation: (await readFile(path.join(input.projectRoot, input.session.destination)).catch(
        () => null,
      ))
        ? ('replace' as const)
        : ('create' as const),
      content: sanitized,
    },
    {
      relativePath: sessionPath,
      operation: existingSession ? ('replace' as const) : ('create' as const),
      content: `${JSON.stringify(committed, null, 2)}\n`,
    },
  ];
  const transaction = await prepareJournalTransaction(input.projectRoot, {
    writes,
    eventHead: input.eventHead,
    previewDigest: input.previewDigest,
    localRoot: input.localRoot,
  });
  await applyJournalTransaction(input.projectRoot, transaction, {
    currentEventHead: input.eventHead,
  });
  return committed;
}

export function artifactInputDigest(input: {
  cycleId: string;
  evidenceRefs: string[];
  purpose: string;
}): `sha256:${string}` {
  return canonicalDigest({
    cycleId: input.cycleId,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
    purpose: input.purpose,
  });
}
