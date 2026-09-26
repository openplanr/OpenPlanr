// biome-ignore lint/suspicious/noRedundantUseStrict: the bundle ships as a classic script, which runs sloppy without this directive
'use strict';

/**
 * Browser entry for templates/studio/studio.js: mounts the studio and its review
 * experience once the artifact stage exists, then publishes their window globals.
 */

import { whenArtifactStage } from '@openplanr/artifact/ui/stage-mount.mjs';
import { mountDesignEnhancements } from './enhancements.mjs';
import { mountDesignStudio } from './studio.mjs';

const PAYLOAD_ID = 'planr-design-studio-payload';
// The artifact server loads its trusted bridge and adapter before the stage, and those
// scripts may arrive after DOMContentLoaded; only a stage still absent then is missing.
const STAGE_TIMEOUT_MS = 15_000;

function documentReady() {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });
}

function stageBefore(deadline) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, deadline - Date.now()), null);
  });
  return Promise.race([whenArtifactStage(window), timeout]).finally(() => clearTimeout(timer));
}

async function start(payloadNode, payload, deadline) {
  const current = () => document.getElementById(PAYLOAD_ID) === payloadNode;
  await documentReady();
  if (!current()) return;
  const stage = await stageBefore(deadline);
  if (!current()) return;
  const studio = mountDesignStudio({ payload, stage });
  if (!studio) return;
  window.__openPlanrDesignStudio = studio;
  const { experience, handoffCenter } = mountDesignEnhancements({ payload, studio, stage });
  window.__openPlanrDesignExperience = experience;
  if (handoffCenter) window.__openPlanrDesignHandoffCenter = handoffCenter;
}

// Removing a pending classic script does not cancel its download. A canceled
// hosted opening must not attach its runtime to a replacement review shell.
const script = document.currentScript;
const payloadNode = document.getElementById(PAYLOAD_ID);
if ((!script || script.isConnected) && payloadNode) {
  void start(payloadNode, JSON.parse(payloadNode.textContent), Date.now() + STAGE_TIMEOUT_MS);
}
