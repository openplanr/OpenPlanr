export interface TemplateService {
  render(templatePath: string, data: Record<string, unknown>): Promise<string>; // Template data is inherently untyped
}
