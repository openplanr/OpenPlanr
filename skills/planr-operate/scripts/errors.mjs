export class SkillRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SkillRuntimeError';
    this.code = code;
    this.details = details;
  }
}
