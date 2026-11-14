import { deepFreeze, exactJson, safeDataClone } from './closed-json-contract.mjs';

export const PLANNING_FILE_LINK_ERROR_CODES = Object.freeze([
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOTDIR',
  'ELOOP',
  'ENAMETOOLONG',
  'EIO',
  'EBADF',
  'EINVAL',
  'EMFILE',
  'ENFILE',
  'ESTALE',
  'UNKNOWN',
]);

export const PLANNING_FILE_PATH_LIMIT = 1024;
export const PLANNING_FILE_LINK_MAX_BYTES = 16 * 1024;

function hasControl(value) {
  return [...value].some(
    (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
  );
}

export function validPlanningFilePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > PLANNING_FILE_PATH_LIMIT ||
    /[\\:%]/u.test(value) ||
    hasControl(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function validEditorUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('vscode://file/')) return false;
  try {
    const path = value.slice('vscode://file/'.length);
    const decoded = path.split('/').map(decodeURIComponent);
    return (
      decoded.every(
        (part) =>
          part !== '' && part !== '.' && part !== '..' && !/[/\\]/u.test(part) && !hasControl(part),
      ) && `vscode://file/${decoded.map(encodeURIComponent).join('/')}` === value
    );
  } catch {
    return false;
  }
}

// Identity comes from an already validated Planning read, so this cannot admit a second binding model.
export function assertPlanningFileLinkEnvelope(value, expected) {
  const record = safeDataClone(value);
  if (
    Object.keys(record).sort().join(',') !==
      'binding,cursor,editorUrl,errorCode,kind,nodeId,path,reason,schemaVersion,sourceViewHash,state' ||
    record.kind !== 'planning-file-link' ||
    record.schemaVersion !== '1.0.0' ||
    !exactJson(record.binding, expected.binding) ||
    !exactJson(record.cursor, expected.cursor) ||
    record.sourceViewHash !== expected.cursor.viewHash ||
    record.nodeId !== expected.nodeId ||
    !['available', 'unavailable', 'error'].includes(record.state) ||
    (record.state === 'error'
      ? !PLANNING_FILE_LINK_ERROR_CODES.includes(record.errorCode)
      : record.errorCode !== null) ||
    (record.path !== null && !validPlanningFilePath(record.path)) ||
    (expected.path !== undefined && record.path !== null && record.path !== expected.path) ||
    (record.state === 'available'
      ? record.reason !== null || record.path === null || !validEditorUrl(record.editorUrl)
      : typeof record.reason !== 'string' ||
        record.reason.length === 0 ||
        record.reason.length > 500 ||
        record.editorUrl !== null) ||
    new TextEncoder().encode(JSON.stringify(record)).byteLength > PLANNING_FILE_LINK_MAX_BYTES
  ) {
    throw new TypeError('Invalid Planning file link envelope.');
  }
  return deepFreeze(record);
}
