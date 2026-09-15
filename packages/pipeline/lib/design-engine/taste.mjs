/**
 * Taste memory (hard rule 11): per-project profile updated on BOTH approve and
 * reject. Confidence is stored RAW; the 5%/week decay is computed AT READ TIME
 * (0.95^weeks since last_seen) and never persisted back. Conflicts between the
 * profile and a fresh brief are FLAGGED, never silently resolved.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { assertValid } from '../design/schema-loader.mjs';

export const DIMENSIONS = ['fonts', 'colors', 'layouts', 'aesthetics'];
const WEEK_MS = 7 * 24 * 3600 * 1000;
export const DECAY_PER_WEEK = 0.95;

export function emptyProfile() {
  return {
    schema_version: '1.0.0',
    profile_version: 1,
    dimensions: { fonts: [], colors: [], layouts: [], aesthetics: [] },
    sessions: [],
  };
}

export function assertValidProfile(profile) {
  return assertValid(profile, 'taste-profile');
}

/** Decayed confidence for one entry, computed at read time. */
export function decayedConfidence(entry, now = new Date()) {
  const ageMs = Math.max(0, now.getTime() - new Date(entry.last_seen).getTime());
  const weeks = ageMs / WEEK_MS;
  return entry.confidence * DECAY_PER_WEEK ** weeks;
}

/** Load the profile with per-entry `effective` confidence added (raw values untouched on disk). */
export function loadProfile(path, { now = new Date() } = {}) {
  const profile = existsSync(path)
    ? assertValidProfile(JSON.parse(readFileSync(path, 'utf-8')))
    : emptyProfile();
  const withEffective = structuredClone(profile);
  for (const dim of DIMENSIONS) {
    for (const entry of withEffective.dimensions[dim]) {
      entry.effective = Math.round(decayedConfidence(entry, now) * 10000) / 10000;
    }
  }
  return withEffective;
}

function stripEffective(profile) {
  const clean = structuredClone(profile);
  for (const dim of DIMENSIONS) for (const e of clean.dimensions[dim]) delete e.effective;
  return clean;
}

export function saveProfile(path, profile) {
  const clean = assertValidProfile(stripEffective(profile));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(clean, null, 2)}\n`);
  return clean;
}

/**
 * Apply a verdict. `attributes` = { fonts: [..], colors: [..], layouts: [..], aesthetics: [..] }
 * (any subset). Approve: +count, confidence toward 1. Reject: +rejected, confidence toward 0.
 * For claude-svg sessions the attributes are EXACT (the agent authored them) — better
 * than vision extraction; for openai they come from the vision pass or flags.
 */
export function updateTaste(profile, { verdict, attributes = {}, sessionId, artifact, now = new Date() }) {
  if (verdict !== 'approved' && verdict !== 'rejected') {
    throw new Error(`updateTaste: verdict must be approved|rejected, got "${verdict}"`);
  }
  const ts = now.toISOString();
  const next = stripEffective(profile);

  for (const dim of DIMENSIONS) {
    for (const rawValue of attributes[dim] ?? []) {
      const value = String(rawValue).trim();
      if (!value) continue;
      let entry = next.dimensions[dim].find((e) => e.value.toLowerCase() === value.toLowerCase());
      if (!entry) {
        entry = { value, confidence: 0.5, approved_count: 0, rejected_count: 0, last_seen: ts };
        next.dimensions[dim].push(entry);
      }
      if (verdict === 'approved') {
        entry.approved_count += 1;
        entry.confidence = Math.min(1, entry.confidence + (1 - entry.confidence) * 0.3);
      } else {
        entry.rejected_count += 1;
        entry.confidence = Math.max(0, entry.confidence * 0.6);
      }
      entry.last_seen = ts;
    }
  }

  const sessionRecord = { sessionId, verdict, at: ts };
  if (artifact) sessionRecord.artifact = artifact;
  next.sessions.push(sessionRecord);
  return assertValidProfile(next);
}

/**
 * Flag profile↔brief conflicts (hard rule 11): a high-confidence preference the
 * new brief contradicts. Returns human sentences; the loop SHOWS them and asks —
 * it never silently overrides either side.
 */
export function detectConflicts(profile, briefAttributes = {}, { threshold = 0.55, now = new Date() } = {}) {
  const conflicts = [];
  for (const dim of DIMENSIONS) {
    const asked = (briefAttributes[dim] ?? []).map((v) => String(v).toLowerCase());
    if (asked.length === 0) continue;
    for (const entry of profile.dimensions[dim]) {
      const effective = entry.effective ?? decayedConfidence(entry, now);
      if (effective >= threshold && !asked.includes(entry.value.toLowerCase())) {
        conflicts.push(
          `You usually prefer ${dim.slice(0, -1)} "${entry.value}" (confidence ${effective.toFixed(2)}), ` +
            `but this brief asks for ${asked.join(', ')}.`,
        );
      }
    }
  }
  return conflicts;
}
