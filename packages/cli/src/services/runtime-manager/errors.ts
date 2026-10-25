export class RuntimeManagerError extends Error {
  constructor(
    public code: string,
    message: string,
    public recovery?: string,
  ) {
    super(message);
    this.name = 'RuntimeManagerError';
  }

  toJSON() {
    return { ok: false, code: this.code, problem: this.message, recovery: this.recovery };
  }
}
