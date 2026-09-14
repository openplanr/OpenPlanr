import { Buffer } from 'node:buffer';

import { SkillRuntimeError } from './errors.mjs';
import {
  OPERATE_REVIEW_CONTRACTS,
  OPERATE_REVIEW_CONTRACT_VERSION,
  OPERATE_REVIEW_CONTRACT_VERSIONS,
} from './operate-review-contract.mjs';

const canonicalText = (value) => String(value).replace(/\r\n/gu, '\n');
const normalizeHeading = (value) => value.trim().replace(/\s+/gu, ' ');
const PLACEHOLDER = /^(?:<[^>]+>|\.{3}|tbd|todo)$/iu;
const CONTRACT_DECLARATION = /^(?:>|-)\s+\*\*Contract:\*\*\s*([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+)\s*$/gmu;
const AUTO_CONTRACT_VERSION = 'auto';

function diagnostic(code, message, details = {}) {
  return Object.freeze({ code, message, ...details });
}

function contractFor(version) {
  const contract = OPERATE_REVIEW_CONTRACTS[version];
  if (!contract) {
    throw new SkillRuntimeError(
      'E_OPERATE_REVIEW_CONTRACT_VERSION_INVALID',
      `Unknown Operate review-note contract version ${String(version)}.`,
      { version, versions: OPERATE_REVIEW_CONTRACT_VERSIONS },
    );
  }
  return contract;
}

function declaredContract(markdown) {
  const declarations = [...markdown.matchAll(CONTRACT_DECLARATION)].map((match) => ({
    kind: match[1],
    version: match[2],
  }));
  if (declarations.length > 1) {
    throw new SkillRuntimeError(
      'E_OPERATE_REVIEW_CONTRACT_DECLARATION_DUPLICATE',
      'Operate review note declares more than one contract version.',
      { declarations },
    );
  }
  if (declarations.length === 0) return null;
  const declaration = declarations[0];
  const contract = OPERATE_REVIEW_CONTRACTS[declaration.version];
  if (!contract || contract.kind !== declaration.kind) {
    throw new SkillRuntimeError(
      'E_OPERATE_REVIEW_CONTRACT_DECLARATION_INVALID',
      `Unsupported Operate review-note contract ${declaration.kind}@${declaration.version}.`,
      { declaration, versions: OPERATE_REVIEW_CONTRACT_VERSIONS },
    );
  }
  return Object.freeze(declaration);
}

function sectionIndex(markdown) {
  const headings = [...markdown.matchAll(/^##\s+(.+?)\s*$/gmu)].map((match) => ({
    name: normalizeHeading(match[1]),
    start: match.index,
    bodyStart: match.index + match[0].length,
  }));
  return headings.map((heading, index) => Object.freeze({
    ...heading,
    body: markdown.slice(heading.bodyStart, headings[index + 1]?.start ?? markdown.length).trim(),
  }));
}

function profileFor(contract, profile) {
  const profileContract = contract.profiles[profile];
  if (!profileContract) {
    throw new SkillRuntimeError(
      'E_OPERATE_REVIEW_PROFILE_INVALID',
      `Unknown Operate review-note profile ${String(profile)}.`,
      { profile, profiles: Object.keys(contract.profiles) },
    );
  }
  return profileContract;
}

/** Identify the contract used by a current or historical Operate Markdown note. */
export function detectOperateReviewNoteContract(
  markdown,
  { profile, contractVersion = AUTO_CONTRACT_VERSION } = {},
) {
  if (
    contractVersion !== AUTO_CONTRACT_VERSION
    && !OPERATE_REVIEW_CONTRACT_VERSIONS.includes(contractVersion)
  ) {
    contractFor(contractVersion);
  }
  const source = canonicalText(markdown);
  const firstSection = source.search(/^##\s+/mu);
  const preamble = source.slice(0, firstSection === -1 ? source.length : firstSection);
  const declaration = declaredContract(preamble);
  if (contractVersion !== AUTO_CONTRACT_VERSION) {
    const contract = contractFor(contractVersion);
    profileFor(contract, profile);
    return Object.freeze({
      contractVersion,
      contractKind: contract.kind,
      versionSource: 'requested',
      declaredContractVersion: declaration?.version ?? null,
    });
  }
  if (declaration) {
    const contract = contractFor(declaration.version);
    profileFor(contract, profile);
    return Object.freeze({
      contractVersion: declaration.version,
      contractKind: contract.kind,
      versionSource: 'declared',
      declaredContractVersion: declaration.version,
    });
  }

  const headings = new Set(sectionIndex(source).map(({ name }) => name));
  const scores = OPERATE_REVIEW_CONTRACT_VERSIONS.map((version) => {
    const contract = contractFor(version);
    const profileContract = profileFor(contract, profile);
    return {
      version,
      score: profileContract.sections.filter((section) => headings.has(section)).length,
    };
  });
  const legacy = scores.find(({ version }) => version === '1.0.0');
  const current = scores.find(({ version }) => version === OPERATE_REVIEW_CONTRACT_VERSION);
  const contractVersionDetected = legacy.score > current.score
    ? legacy.version
    : current.version;
  const contract = contractFor(contractVersionDetected);
  return Object.freeze({
    contractVersion: contractVersionDetected,
    contractKind: contract.kind,
    versionSource: Math.max(legacy.score, current.score) > 0 ? 'structure' : 'default',
    declaredContractVersion: null,
  });
}

function fieldsIn(markdown) {
  const fields = new Map();
  for (const match of markdown.matchAll(/^(?:>|-)\s+\*\*([^*\n]+?):\*\*\s*(.*?)\s*$/gmu)) {
    const name = normalizeHeading(match[1]);
    if (!fields.has(name)) fields.set(name, []);
    fields.get(name).push(match[2]);
  }
  return fields;
}

function requireFields(markdown, required, diagnostics, context, allowedValues = {}) {
  const fields = fieldsIn(markdown);
  for (const field of required) {
    const values = fields.get(field) ?? [];
    if (values.length === 0 || values.every((value) => value.length === 0 || PLACEHOLDER.test(value))) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_FIELD_MISSING',
        `${context} requires a non-empty ${field} field.`,
        { context, field },
      ));
    } else if (values.length > 1) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_FIELD_DUPLICATE',
        `${context} contains ${values.length} ${field} fields.`,
        { context, field, count: values.length },
      ));
    } else if (allowedValues[field] && !allowedValues[field].includes(values[0])) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_FIELD_VALUE_INVALID',
        `${context} has an invalid ${field} value.`,
        { context, field, expected: allowedValues[field], actual: values[0] },
      ));
    }
  }
}

function validateSections(markdown, contract, diagnostics) {
  const headings = sectionIndex(markdown);
  const expected = contract.sections;
  const actual = headings.map(({ name }) => name);
  for (const section of expected) {
    const count = actual.filter((name) => name === section).length;
    if (count === 0) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_SECTION_MISSING',
        `Required section ${section} is missing.`,
        { section },
      ));
    } else if (count > 1) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_SECTION_DUPLICATE',
        `Required section ${section} appears ${count} times.`,
        { section, count },
      ));
    }
  }
  const unexpected = actual.filter((section) => !expected.includes(section));
  for (const section of unexpected) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_SECTION_UNEXPECTED',
      `Unexpected top-level section ${section} is not part of this review contract.`,
      { section },
    ));
  }
  const presentExpected = actual.filter((section) => expected.includes(section));
  const expectedPresentOrder = expected.filter((section) => actual.includes(section));
  if (JSON.stringify(presentExpected) !== JSON.stringify(expectedPresentOrder)) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_SECTION_ORDER',
      'Review sections are not in contract order.',
      { expected: expectedPresentOrder, actual: presentExpected },
    ));
  }
  return new Map(headings.map(({ name, body }) => [name, body]));
}

function validateItems(sectionBody, itemContract, diagnostics) {
  if (typeof sectionBody !== 'string') return 0;
  const prefix = itemContract.idPrefix;
  const pattern = new RegExp(`^###\\s+(${prefix}[1-9][0-9]*)\\s+—\\s+(.+?)\\s*$`, 'gmu');
  const items = [...sectionBody.matchAll(pattern)].map((match) => ({
    id: match[1],
    headingSuffix: match[2],
    start: match.index,
    bodyStart: match.index + match[0].length,
  }));
  if (items.length === 0) {
    if (!sectionBody.includes(itemContract.emptyText)) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_ITEM_OR_EMPTY_STATE_MISSING',
        `${itemContract.section} requires an item or the exact empty state.`,
        { section: itemContract.section, emptyText: itemContract.emptyText },
      ));
    }
    return 0;
  }
  if (items.length > itemContract.maxItems) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_ITEM_LIMIT',
      `${itemContract.section} has ${items.length} items; at most ${itemContract.maxItems} are allowed.`,
      { section: itemContract.section, count: items.length, maxItems: itemContract.maxItems },
    ));
  }
  const expectedIds = items.map((_, index) => `${prefix}${index + 1}`);
  const actualIds = items.map(({ id }) => id);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_ITEM_SEQUENCE',
      `${itemContract.section} item IDs must be unique and contiguous.`,
      { section: itemContract.section, expected: expectedIds, actual: actualIds },
    ));
  }
  for (const [index, item] of items.entries()) {
    if (itemContract.headingSuffixPattern && !itemContract.headingSuffixPattern.test(item.headingSuffix)) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_ITEM_HEADING_INVALID',
        `${item.id} must declare a contracted priority in its heading.`,
        { section: itemContract.section, itemId: item.id },
      ));
    }
    const body = sectionBody.slice(item.bodyStart, items[index + 1]?.start ?? sectionBody.length).trim();
    requireFields(body, itemContract.fields, diagnostics, item.id, itemContract.fieldValues);
  }
  return items.length;
}

function validateSectionItemLimits(sectionBodies, limits, diagnostics) {
  for (const [section, maxItems] of Object.entries(limits ?? {})) {
    const body = sectionBodies.get(section);
    if (typeof body !== 'string' || /^None\.\s*$/iu.test(body)) continue;
    const count = [...body.matchAll(/^\s*-\s+\S/gmu)].length;
    if (count > maxItems) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_SECTION_ITEM_LIMIT',
        `${section} has ${count} items; at most ${maxItems} are allowed.`,
        { section, count, maxItems },
      ));
    }
  }
}

function legacyBoardDecisions(sectionBody) {
  if (typeof sectionBody !== 'string') return [];
  const headings = [...sectionBody.matchAll(/^###\s+(D[1-9][0-9]*)\s+—\s+.+?\s*$/gmu)].map((match) => ({
    id: match[1],
    start: match.index,
    bodyStart: match.index + match[0].length,
  }));
  return headings.map((heading, index) => {
    const body = sectionBody.slice(
      heading.bodyStart,
      headings[index + 1]?.start ?? sectionBody.length,
    ).trim();
    return Object.freeze({
      id: heading.id,
      owner: fieldsIn(body).get('Owner')?.[0] ?? null,
    });
  });
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function validateLegacyDecisionGate(gate, decision, diagnostics) {
  const statements = gate.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && new RegExp(`\\b${decision.id}\\b`, 'u').test(line));
  if (statements.length !== 1) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_HUMAN_GATE_INCOMPLETE',
      `Human gate must contain exactly one disposition statement for ${decision.id}.`,
      { section: 'Human gate', decisionId: decision.id, statementCount: statements.length },
    ));
    return;
  }

  const statement = statements[0];
  const missing = [];
  for (const disposition of ['adopt', 'reject', 'defer']) {
    if (!new RegExp(`\\b${disposition}\\b`, 'iu').test(statement)) missing.push(disposition);
  }
  if (!decision.owner || !new RegExp(escapedPattern(decision.owner), 'iu').test(statement)) {
    missing.push('named owner');
  }
  if (!/\breason\b/iu.test(statement)) missing.push('reason');
  if (missing.length > 0) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_HUMAN_GATE_INCOMPLETE',
      `Human gate disposition for ${decision.id} is missing: ${missing.join(', ')}.`,
      { section: 'Human gate', decisionId: decision.id, missing },
    ));
  }
}

function absentLegacyReviewSeats(reviewTrail) {
  if (typeof reviewTrail !== 'string') return [];
  const seats = [];
  for (const line of reviewTrail.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2 || !/^absent(?:\b|\s*[:—-])/iu.test(cells[1])) continue;
    const seat = cells[0].replace(/[`*_]/gu, '').trim();
    if (seat.length > 0 && !seats.includes(seat)) seats.push(seat);
  }
  return seats;
}

function legacyGateNamesAbsentSeat(gate, absentSeats) {
  return absentSeats.some((seat) => new RegExp(
    `\\bre[- ]run\\s+(?:\`${escapedPattern(seat)}\`|${escapedPattern(seat)})(?=$|[^\\p{L}\\p{N}-])`,
    'iu',
  ).test(gate));
}

function validateLegacyNoDecisionGate(gate, diagnostics, absentSeats) {
  const contradictoryDispositions = ['adopt', 'reject', 'defer']
    .filter((disposition) => new RegExp(`\\b${disposition}\\b`, 'iu').test(gate));
  if (contradictoryDispositions.length > 0) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_HUMAN_GATE_CONTRADICTORY',
      'A no-decision Human gate must not offer decision dispositions.',
      { section: 'Human gate', dispositions: contradictoryDispositions },
    ));
  }
  for (const [option, pattern] of [
    ['close', /\bclose\b/iu],
    ['supply evidence', /\bsupply\s+evidence\b/iu],
  ]) {
    if (!pattern.test(gate)) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_HUMAN_GATE_INCOMPLETE',
        `A no-decision Human gate must offer ${option}.`,
        { section: 'Human gate', option },
      ));
    }
  }
  if (absentSeats.length > 0 && !legacyGateNamesAbsentSeat(gate, absentSeats)) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_HUMAN_GATE_INCOMPLETE',
      'A no-decision Human gate with an absent review seat must offer re-run for a named absent seat.',
      { section: 'Human gate', option: 're-run <seat>', absentSeats },
    ));
  }
}

function validateLegacyDecisionLedger(sectionBodies, itemCount, diagnostics, {
  requireExecutiveCallSection = false,
  requireNoDecisionOptions = false,
} = {}) {
  const executiveCall = sectionBodies.get('Executive call') ?? '';
  if (requireExecutiveCallSection && executiveCall.length === 0) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_EXECUTIVE_CALL_MISSING',
      'Executive call must lead with one concise decision signal.',
      { section: 'Executive call' },
    ));
  }

  const actionPlan = sectionBodies.get('Action plan') ?? '';
  if (itemCount > 0) {
    const header = /^\|\s*ID\s*\|\s*Priority\s*\|\s*Action\s*\|\s*Owner\s*\|\s*First step\s*\|\s*Success measure\s*\|\s*Verification\s*\|\s*Depends on\s*\|\s*$/mu;
    const action = /^\|\s*A[1-9][0-9]*\s*\|/mu;
    if (!header.test(actionPlan) || !action.test(actionPlan)) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_ACTION_PLAN_INVALID',
        'A non-empty decision queue requires the contracted action table and at least one action row.',
        { section: 'Action plan' },
      ));
    } else {
      const actionRows = actionPlan.split('\n')
        .filter((line) => /^\|\s*A[1-9][0-9]*\s*\|/u.test(line))
        .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
      if (actionRows.length > 7) {
        diagnostics.push(diagnostic(
          'E_OPERATE_REVIEW_ACTION_LIMIT',
          `Action plan has ${actionRows.length} actions; at most 7 are allowed.`,
          { section: 'Action plan', count: actionRows.length, maxItems: 7 },
        ));
      }
      for (const row of actionRows) {
        if (row.length !== 8 || row.some((cell) => cell.length === 0 || PLACEHOLDER.test(cell))) {
          diagnostics.push(diagnostic(
            'E_OPERATE_REVIEW_ACTION_ROW_INVALID',
            `Action ${row[0] ?? '(unknown)'} must populate all eight contracted columns.`,
            { section: 'Action plan', actionId: row[0] ?? null },
          ));
        }
      }
    }
  }

  const gate = sectionBodies.get('Human gate') ?? '';
  if (itemCount === 0) {
    if (requireNoDecisionOptions) {
      validateLegacyNoDecisionGate(
        gate,
        diagnostics,
        absentLegacyReviewSeats(sectionBodies.get('Review trail')),
      );
    }
    return;
  }
  const decisions = legacyBoardDecisions(sectionBodies.get('Decision queue'));
  for (const decision of decisions) validateLegacyDecisionGate(gate, decision, diagnostics);
}

function validateCurrentDecisionLedger(sectionBodies, itemCount, diagnostics, { summarySection } = {}) {
  if (summarySection && (sectionBodies.get(summarySection) ?? '').trim().length === 0) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_SUMMARY_MISSING',
      `${summarySection} must contain a concise decision signal.`,
      { section: summarySection },
    ));
  }

  const actionPlan = sectionBodies.get('Action plan') ?? '';
  if (itemCount > 0) {
    const header = /^\|\s*ID\s*\|\s*Priority\s*\|\s*Action\s*\|\s*Suggested owner\s*\|\s*First step\s*\|\s*Success measure\s*\|\s*Check\s*\|\s*Depends on\s*\|\s*$/mu;
    const action = /^\|\s*A[1-9][0-9]*\s*\|/mu;
    if (!header.test(actionPlan) || !action.test(actionPlan)) {
      diagnostics.push(diagnostic(
        'E_OPERATE_REVIEW_ACTION_PLAN_INVALID',
        'A non-empty decision queue requires the contracted action table and at least one action row.',
        { section: 'Action plan' },
      ));
    } else {
      const actionRows = actionPlan.split('\n')
        .filter((line) => /^\|\s*A[1-9][0-9]*\s*\|/u.test(line))
        .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
      if (actionRows.length > 7) {
        diagnostics.push(diagnostic(
          'E_OPERATE_REVIEW_ACTION_LIMIT',
          `Action plan has ${actionRows.length} actions; at most 7 are allowed.`,
          { section: 'Action plan', count: actionRows.length, maxItems: 7 },
        ));
      }
      for (const row of actionRows) {
        if (row.length !== 8 || row.some((cell) => cell.length === 0 || PLACEHOLDER.test(cell))) {
          diagnostics.push(diagnostic(
            'E_OPERATE_REVIEW_ACTION_ROW_INVALID',
            `Action ${row[0] ?? '(unknown)'} must populate all eight contracted columns.`,
            { section: 'Action plan', actionId: row[0] ?? null },
          ));
        }
      }
    }
  }
}

/** Return structural quality diagnostics without changing or rejecting the note. */
export function inspectOperateReviewNote(markdown, {
  profile,
  contractVersion = AUTO_CONTRACT_VERSION,
} = {}) {
  const source = canonicalText(markdown);
  const detected = detectOperateReviewNoteContract(source, { profile, contractVersion });
  const versionedContract = contractFor(detected.contractVersion);
  const contract = profileFor(versionedContract, profile);
  const diagnostics = [];
  if (
    detected.declaredContractVersion
    && detected.declaredContractVersion !== detected.contractVersion
  ) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_CONTRACT_VERSION_MISMATCH',
      `Note declares contract ${detected.declaredContractVersion} but ${detected.contractVersion} was requested.`,
      {
        declaredContractVersion: detected.declaredContractVersion,
        requestedContractVersion: detected.contractVersion,
      },
    ));
  }
  const titles = [...source.matchAll(/^#\s+\S.*$/gmu)];
  if (titles.length === 0) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_TITLE_MISSING',
      'Review note requires one non-empty level-one title.',
    ));
  } else if (titles.length > 1) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_TITLE_DUPLICATE',
      `Review note contains ${titles.length} level-one titles.`,
      { count: titles.length },
    ));
  }
  const byteLength = Buffer.byteLength(source, 'utf8');
  if (byteLength > contract.maxBytes) {
    diagnostics.push(diagnostic(
      'E_OPERATE_REVIEW_SIZE_LIMIT',
      `Review note is ${byteLength} bytes; the ${profile} limit is ${contract.maxBytes}.`,
      { byteLength, maxBytes: contract.maxBytes },
    ));
  }
  const firstSection = source.search(/^##\s+/mu);
  const preamble = source.slice(0, firstSection === -1 ? source.length : firstSection);
  requireFields(
    preamble,
    contract.summaryFields,
    diagnostics,
    'summary',
    contract.summaryValues,
  );
  const sectionBodies = validateSections(source, contract, diagnostics);
  validateSectionItemLimits(sectionBodies, contract.sectionItemLimits, diagnostics);
  for (const [section, fields] of Object.entries(contract.sectionFields)) {
    if (!sectionBodies.has(section)) continue;
    const body = sectionBodies.get(section);
    if (body === contract.sectionEmptyStates?.[section]) continue;
    requireFields(body, fields, diagnostics, section);
  }
  const itemCount = validateItems(sectionBodies.get(contract.item.section), contract.item, diagnostics);
  if (detected.contractVersion === '1.0.0') {
    if (profile === 'chair') validateLegacyDecisionLedger(sectionBodies, itemCount, diagnostics);
    if (profile === 'board-report') {
      validateLegacyDecisionLedger(sectionBodies, itemCount, diagnostics, {
        requireExecutiveCallSection: true,
        requireNoDecisionOptions: true,
      });
    }
  } else {
    if (profile === 'chair') validateCurrentDecisionLedger(sectionBodies, itemCount, diagnostics);
    if (profile === 'board-report') {
      validateCurrentDecisionLedger(sectionBodies, itemCount, diagnostics, {
        summarySection: 'Executive summary',
      });
    }
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    profile,
    contractVersion: detected.contractVersion,
    contractKind: detected.contractKind,
    versionSource: detected.versionSource,
    byteLength,
    itemCount,
    diagnostics: Object.freeze(diagnostics),
  });
}

/** Strict opt-in assertion for callers that explicitly require a conforming durable artifact. */
export function validateOperateReviewNote(markdown, options) {
  const result = inspectOperateReviewNote(markdown, options);
  if (!result.ok) {
    throw new SkillRuntimeError(
      'E_OPERATE_REVIEW_NOTE_INVALID',
      `Operate ${result.profile} note failed ${result.diagnostics.length} contract check${result.diagnostics.length === 1 ? '' : 's'}.`,
      {
        profile: result.profile,
        contractVersion: result.contractVersion,
        diagnostics: result.diagnostics,
      },
    );
  }
  return result;
}
