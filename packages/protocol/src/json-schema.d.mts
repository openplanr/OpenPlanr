export interface JsonSchemaDiagnostic { path: string; rule: string; detail: string }
export interface JsonSchemaResolverResult { schema: unknown; rootSchema?: unknown; base?: string }
export declare function validateJson(value: unknown, schema: unknown, options?: {
  base?: string | null;
  resolveRef?: (reference: string, context: { base?: string | null }) => JsonSchemaResolverResult | unknown;
}): JsonSchemaDiagnostic[];
export { validateJson as validate };
