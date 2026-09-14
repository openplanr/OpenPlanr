const OPERATE_PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Exact shared identifier boundary for public Operate request and command surfaces. */
export function isOperatePublicId(value: unknown): value is string {
  return typeof value === 'string' && OPERATE_PUBLIC_ID.test(value);
}
