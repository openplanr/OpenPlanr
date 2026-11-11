import { spawn } from 'node:child_process';
import { listArtifactReviewServers } from './design-review.mjs';
import { findArtifactProjectRoot } from './design-handoff.mjs';
import { renderDesignDocument } from './design-document.mjs';
import { validateDesignDocument } from './design-shared-artifact-support-dependencies-design-support-protocol-contracts-d707e49b.mjs';

// design.mjs:287
export async function importDesignFeedback(file, { env = process.env } = {}) {
  return { file, env, servers: await listArtifactReviewServers({ env }) };
}

// design.mjs:1475-1477
export const openUrl = async (url) => {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  return spawn(command, [url], { stdio: 'ignore' });
};

export { findArtifactProjectRoot, renderDesignDocument, validateDesignDocument };
