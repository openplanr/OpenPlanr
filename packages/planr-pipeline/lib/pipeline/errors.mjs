export class PipelineError extends Error {
  constructor(code, message, fix = '') {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
    this.fix = fix;
  }

  toJSON() {
    return {
      ok: false,
      code: this.code,
      problem: this.message,
      ...(this.fix ? { fix: this.fix } : {}),
    };
  }
}
