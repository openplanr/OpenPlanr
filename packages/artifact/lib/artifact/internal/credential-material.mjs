// Publication screening recognizes credential literals, never an identifier by itself.
// Callers can additionally supply known sensitive values; this is not a complete secret audit.
const RECOGNIZED_CREDENTIAL =
  /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}/iu;
const QUOTED_CREDENTIAL =
  /(?:^|[^A-Za-z0-9_])(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|PASSWORD|TOKEN|SECRET(?:[_-]?KEY)?)["']?\s*[:=]\s*(["'`])((?:(?!\1|\$\{)[^\r\n\\]|\\.){16,})\1/giu;
const CONFIG_CREDENTIAL =
  /(?:^|[\r\n>])[ \t]*(?:export[ \t]+)?(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|PASSWORD|TOKEN|SECRET(?:[_-]?KEY)?)[ \t]*[:=][ \t]*(?!process\.env(?:\.|\[)|import\.meta\.env(?:\.|\[)|Deno\.env\.|os\.environ|env\.)([^\s"'`#()[\]{}$<>]{16,})[ \t]*(?:#[^\r\n<]*)?(?=\r?$|<)/gimu;
const DOCUMENTATION_PLACEHOLDER =
  /^(?:example(?:[-_].*)?|placeholder(?:[-_].*)?|your[-_].*|(?:change|replace)[-_]me(?:[-_].*)?|(?:dummy|fake|mock|test|never[-_]return)[-_](?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|token|secret(?:[-_]?key)?))$/iu;

/** Detect recognized provider/key formats and complete assigned credential literals. */
export function containsCredentialMaterial(text) {
  if (RECOGNIZED_CREDENTIAL.test(text)) return true;
  for (const match of text.matchAll(QUOTED_CREDENTIAL))
    if (!DOCUMENTATION_PLACEHOLDER.test(match[2])) return true;
  for (const match of text.matchAll(CONFIG_CREDENTIAL))
    if (!DOCUMENTATION_PLACEHOLDER.test(match[1])) return true;
  return false;
}
