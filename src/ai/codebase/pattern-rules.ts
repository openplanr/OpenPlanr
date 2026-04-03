/**
 * Heuristic-based pattern detection from architecture files.
 *
 * Produces human-readable rules that are injected into AI prompts
 * to prevent common mistakes like creating parallel CRUD services,
 * forgetting to register commands, or scattering type definitions.
 *
 * Every detector is a pure function — fast, deterministic, no AI.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternRule {
  /** Short identifier (e.g., "generic-crud"). */
  name: string;
  /** Rule text injected into the prompt. */
  rule: string;
  /** Which file(s) this was detected from. */
  evidence: string[];
  /** What NOT to do — helps the AI avoid common mistakes. */
  antiPattern: string;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Extract exported function names from TypeScript/JavaScript source. */
function extractExportedFunctions(content: string): string[] {
  return [...content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
}

/** Extract exported type/interface names from TypeScript source. */
function extractExportedTypes(content: string): string[] {
  return [...content.matchAll(/export\s+(?:type|interface)\s+(\w+)/g)].map((m) => m[1]);
}

/** Count individual files matching a pattern in the source inventory. */
function countInventoryMatches(inventory: string, pattern: RegExp): number {
  let count = 0;
  for (const line of inventory.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const fileList = line.slice(colonIdx + 1);
    for (const file of fileList.split(',')) {
      if (pattern.test(file.trim())) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Pattern detectors
// ---------------------------------------------------------------------------

/**
 * Detect a generic CRUD service pattern.
 *
 * If the service exports only generic functions (create, read, list, update,
 * delete) that take a `type` parameter and no entity-specific variants like
 * `createUser()`, emit a rule forbidding entity-specific services.
 */
function detectGenericCRUD(filePath: string, content: string): PatternRule | null {
  const fns = extractExportedFunctions(content);
  if (fns.length === 0) return null;

  const crudNames = /^(create|read|list|update|delete|get|find|remove)/i;
  const crudFns = fns.filter((f) => crudNames.test(f));
  if (crudFns.length < 2) return null;

  // Check if functions are entity-specific (createUser, deleteOrder) vs generic
  // Generic names use abstract nouns: Artifact, Entry, Item, Record, Entity, Resource, Document, Object
  const genericSuffixes =
    /^(create|read|list|update|delete|get|find|remove)(Artifact|Entry|Item|Record|Entity|Resource|Document|Object|Many|All|By)/i;
  const entitySpecific = /^(create|read|list|update|delete|get|find|remove)[A-Z][a-z]{3,}/;
  const hasEntitySpecific = crudFns.some((f) => entitySpecific.test(f) && !genericSuffixes.test(f));
  if (hasEntitySpecific) return null;

  return {
    name: 'generic-crud',
    rule: `This project uses a generic CRUD service (${filePath}). All entity operations go through the generic functions: ${crudFns.join(', ')}. Business logic lives in command files or dedicated orchestration modules, NOT in this service.`,
    evidence: [filePath],
    antiPattern: `Do NOT create entity-specific CRUD functions (e.g., createBacklogItem, deleteUser) in ${filePath}. Use the existing generic functions with the appropriate type parameter.`,
  };
}

/**
 * Detect a command registration pattern.
 *
 * If the entry point file has `register*Command()` calls, emit a rule
 * requiring new commands to follow the same pattern.
 */
function detectCommandRegistration(filePath: string, content: string): PatternRule | null {
  const registerCalls = content.match(/register\w+Command\s*\(/g);
  if (!registerCalls || registerCalls.length < 2) return null;

  const names = registerCalls.map((c) => c.replace(/\s*\($/, ''));

  return {
    name: 'command-registration',
    rule: `New commands MUST be registered in ${filePath} using the register<Name>Command() pattern. Existing registrations: ${names.join(', ')}.`,
    evidence: [filePath],
    antiPattern: `Do NOT create command files without also adding a register*Command() call in ${filePath}. A command file that isn't registered will never be reachable.`,
  };
}

/**
 * Detect a central types file pattern.
 *
 * If one types file contains 5+ exported types/interfaces and no other
 * type files exist in the source inventory, emit a rule requiring all
 * types to live in that file.
 */
function detectCentralTypes(
  filePath: string,
  content: string,
  sourceInventory: string,
): PatternRule | null {
  const types = extractExportedTypes(content);
  if (types.length < 5) return null;

  // Check if there are other type files in the inventory
  const otherTypeFiles = countInventoryMatches(sourceInventory, /types\.\w+|interfaces\.\w+/i);
  // The central types file itself counts as 1 match
  if (otherTypeFiles > 1) return null;

  return {
    name: 'central-types',
    rule: `All type definitions go in ${filePath} (currently has ${types.length} exports). Do NOT create new type files — add interfaces, enums, and type aliases to this file.`,
    evidence: [filePath],
    antiPattern: `Do NOT create files like types/<entity>.ts or interfaces/<entity>.ts. All types belong in ${filePath}.`,
  };
}

/**
 * Detect an ID generation pattern.
 *
 * If an id-service exports a function with "id" in its name that accepts
 * a prefix parameter, emit a rule about configuring new prefixes.
 */
function detectIDGeneration(filePath: string, content: string): PatternRule | null {
  const fns = extractExportedFunctions(content);
  const idFn = fns.find((f) => /id/i.test(f) && /next|generate|create/i.test(f));
  if (!idFn) return null;

  // Look for prefix-related parameters or constants
  const hasPrefix = /prefix/i.test(content);
  if (!hasPrefix) return null;

  return {
    name: 'id-generation',
    rule: `IDs are generated via ${idFn}() in ${filePath} using configurable prefixes. New entity types MUST have their prefix registered in the project config (idPrefix map) and use ${idFn}() for ID assignment.`,
    evidence: [filePath],
    antiPattern: `Do NOT hardcode IDs or create separate ID generation logic. Always use ${idFn}() with the correct prefix.`,
  };
}

/**
 * Detect a template rendering pattern.
 *
 * If a templates directory contains Handlebars or similar template files,
 * emit a rule requiring new artifact types to have corresponding templates.
 */
function detectTemplateRendering(sourceInventory: string): PatternRule | null {
  const templateLines = sourceInventory.split('\n').filter((line) => /templates/i.test(line));
  if (templateLines.length === 0) return null;

  const hasHandlebars = templateLines.some((line) => /\.hbs/.test(line));
  if (!hasHandlebars) return null;

  return {
    name: 'template-rendering',
    rule: 'This project uses Handlebars templates for artifact generation. New artifact types MUST have a corresponding .md.hbs template in the templates directory.',
    evidence: templateLines.map((l) => l.split(':')[0].trim()),
    antiPattern:
      'Do NOT generate markdown directly in code. Create a .md.hbs template and use the template rendering service.',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect architectural patterns from architecture file contents.
 * Returns rules the AI should follow when generating tasks.
 *
 * @param architectureFiles - Map of relative path → labeled content (from findArchitectureFiles)
 * @param sourceInventory - Compact source listing (from buildSourceInventory)
 */
export function detectPatternRules(
  architectureFiles: Map<string, string>,
  sourceInventory: string,
): PatternRule[] {
  const rules: PatternRule[] = [];

  for (const [filePath, labeledContent] of architectureFiles) {
    // Strip the label comment line added by findArchitectureFiles
    const content = labeledContent.replace(/^\/\/[^\n]*\n/, '');

    // Try each detector against each architecture file
    const crudRule = detectGenericCRUD(filePath, content);
    if (crudRule) rules.push(crudRule);

    const cmdRule = detectCommandRegistration(filePath, content);
    if (cmdRule) rules.push(cmdRule);

    const typesRule = detectCentralTypes(filePath, content, sourceInventory);
    if (typesRule) rules.push(typesRule);

    const idRule = detectIDGeneration(filePath, content);
    if (idRule) rules.push(idRule);
  }

  // Template detection uses inventory only (not a specific architecture file)
  const templateRule = detectTemplateRendering(sourceInventory);
  if (templateRule) rules.push(templateRule);

  return rules;
}
