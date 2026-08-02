import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { canonicalize } from './canonical.js';
import { OperateError } from './types.js';
import { isPathInside } from './workspace.js';
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
class StrictJsonParser {
    source;
    limits;
    index = 0;
    scalars = 0;
    constructor(source, limits) {
        this.source = source;
        this.limits = limits;
    }
    parse() {
        if (Buffer.byteLength(this.source) > this.limits.maxBytes)
            this.fail('JSON exceeds byte limit');
        this.skipWhitespace();
        const value = this.value(0);
        this.skipWhitespace();
        if (this.index !== this.source.length)
            this.fail('Unexpected trailing JSON content');
        return value;
    }
    value(depth) {
        if (depth > this.limits.maxDepth)
            this.fail('JSON exceeds nesting limit');
        this.skipWhitespace();
        const char = this.source[this.index];
        if (char === '{')
            return this.object(depth + 1);
        if (char === '[')
            return this.array(depth + 1);
        if (char === '"')
            return this.scalar(this.string());
        if (this.source.startsWith('true', this.index)) {
            this.index += 4;
            return this.scalar(true);
        }
        if (this.source.startsWith('false', this.index)) {
            this.index += 5;
            return this.scalar(false);
        }
        if (this.source.startsWith('null', this.index)) {
            this.index += 4;
            return this.scalar(null);
        }
        return this.scalar(this.number());
    }
    object(depth) {
        this.index += 1;
        const result = Object.create(null);
        const seen = new Set();
        this.skipWhitespace();
        if (this.source[this.index] === '}') {
            this.index += 1;
            return result;
        }
        while (true) {
            this.skipWhitespace();
            if (this.source[this.index] !== '"')
                this.fail('Object key must be a string');
            const key = this.string();
            if (FORBIDDEN_KEYS.has(key))
                this.fail(`Forbidden JSON key: ${key}`);
            if (seen.has(key))
                this.fail(`Duplicate JSON key: ${key}`);
            seen.add(key);
            this.skipWhitespace();
            if (this.source[this.index] !== ':')
                this.fail('Expected colon after object key');
            this.index += 1;
            result[key] = this.value(depth);
            this.skipWhitespace();
            const separator = this.source[this.index++];
            if (separator === '}')
                return result;
            if (separator !== ',')
                this.fail('Expected comma or closing brace');
        }
    }
    array(depth) {
        this.index += 1;
        const result = [];
        this.skipWhitespace();
        if (this.source[this.index] === ']') {
            this.index += 1;
            return result;
        }
        while (true) {
            result.push(this.value(depth));
            this.skipWhitespace();
            const separator = this.source[this.index++];
            if (separator === ']')
                return result;
            if (separator !== ',')
                this.fail('Expected comma or closing bracket');
        }
    }
    string() {
        const start = this.index;
        this.index += 1;
        let escaped = false;
        while (this.index < this.source.length) {
            const code = this.source.charCodeAt(this.index);
            if (!escaped && code < 0x20)
                this.fail('Unescaped control character in string');
            if (!escaped && this.source[this.index] === '"') {
                this.index += 1;
                const value = JSON.parse(this.source.slice(start, this.index));
                if (value.length > this.limits.maxStringLength)
                    this.fail('JSON string exceeds limit');
                return value;
            }
            if (!escaped && this.source[this.index] === '\\') {
                escaped = true;
            }
            else {
                escaped = false;
            }
            this.index += 1;
        }
        this.fail('Unterminated JSON string');
    }
    number() {
        const match = this.source
            .slice(this.index)
            .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (!match)
            this.fail('Invalid JSON value');
        this.index += match[0].length;
        const value = Number(match[0]);
        if (!Number.isFinite(value))
            this.fail('JSON number is not finite');
        return value;
    }
    scalar(value) {
        this.scalars += 1;
        if (this.scalars > this.limits.maxScalars)
            this.fail('JSON exceeds scalar limit');
        return value;
    }
    skipWhitespace() {
        while (/[\t\n\r ]/.test(this.source[this.index] ?? ''))
            this.index += 1;
    }
    fail(message) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', `${message} at character ${this.index}.`);
    }
}
export function parseStrictJson(source, limits = {}) {
    return new StrictJsonParser(source.replace(/^\ufeff/, ''), {
        maxDepth: limits.maxDepth ?? 32,
        maxScalars: limits.maxScalars ?? 20_000,
        maxStringLength: limits.maxStringLength ?? 100_000,
        maxBytes: limits.maxBytes ?? 1_000_000,
    }).parse();
}
export function parseStrictCsv(source, limits = {}) {
    const resolved = {
        maxRows: limits.maxRows ?? 10_000,
        maxColumns: limits.maxColumns ?? 256,
        maxFieldLength: limits.maxFieldLength ?? 100_000,
        maxBytes: limits.maxBytes ?? 1_000_000,
    };
    if (Buffer.byteLength(source) > resolved.maxBytes || source.includes('\0')) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'CSV is oversized or contains NUL.');
    }
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let quoteClosed = false;
    const input = source.replace(/^\ufeff/, '');
    const pushField = () => {
        if (field.length > resolved.maxFieldLength) {
            throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'CSV field exceeds limit.');
        }
        row.push(field);
        field = '';
        if (row.length > resolved.maxColumns) {
            throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'CSV exceeds column limit.');
        }
    };
    const pushRow = () => {
        pushField();
        rows.push(row);
        row = [];
        if (rows.length > resolved.maxRows) {
            throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'CSV exceeds row limit.');
        }
    };
    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        if (quoted) {
            if (char === '"' && input[index + 1] === '"') {
                field += '"';
                index += 1;
            }
            else if (char === '"') {
                quoted = false;
                quoteClosed = true;
            }
            else {
                field += char;
            }
            continue;
        }
        if (quoteClosed && char !== ',' && char !== '\n' && char !== '\r') {
            throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'CSV contains characters after a closing quote.');
        }
        if (char === '"' && field.length === 0 && !quoteClosed) {
            quoted = true;
        }
        else if (char === '"') {
            throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'CSV contains a quote inside an unquoted field.');
        }
        else if (char === ',') {
            pushField();
            quoteClosed = false;
        }
        else if (char === '\n') {
            pushRow();
            quoteClosed = false;
        }
        else if (char === '\r') {
            if (input[index + 1] === '\n')
                index += 1;
            pushRow();
            quoteClosed = false;
        }
        else {
            field += char;
        }
    }
    if (quoted) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'CSV has an unterminated quote.');
    }
    if (field.length > 0 || row.length > 0)
        pushRow();
    return rows;
}
export function escapeSpreadsheetCell(value) {
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
export function serializeSafeCsv(rows) {
    return `${rows
        .map((row) => row
        .map((raw) => {
        const value = escapeSpreadsheetCell(raw);
        return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    })
        .join(','))
        .join('\n')}\n`;
}
function decodeUtf8(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    }
    catch {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Imported evidence is not valid UTF-8.');
    }
}
export async function resolveEvidenceImportPath(projectRoot, configuredPath, roots) {
    if (!configuredPath.trim() || configuredPath.includes('\0')) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Imported evidence path is empty or contains NUL.');
    }
    const canonicalRoots = await Promise.all(roots.map(async (entry) => ({
        componentId: entry.componentId,
        root: await realpath(entry.root),
    })));
    const candidate = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(await realpath(projectRoot), configuredPath);
    let resolved;
    try {
        resolved = await realpath(candidate);
    }
    catch {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', `Imported evidence file does not exist: ${configuredPath}.`);
    }
    const owner = canonicalRoots
        .filter((entry) => isPathInside(entry.root, resolved))
        .sort((left, right) => right.root.length - left.root.length)[0];
    if (!owner) {
        throw new OperateError('E_OPERATE_PATH_ESCAPE', 'Imported evidence must remain inside the configured product workspace.');
    }
    const info = await stat(resolved);
    if (!info.isFile()) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Imported evidence must be a regular file.');
    }
    const extension = path.extname(resolved).toLowerCase();
    if (extension !== '.json' && extension !== '.csv') {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Imported evidence supports .json and .csv files only.');
    }
    return {
        absolutePath: resolved,
        location: `${owner.componentId}/${path.relative(owner.root, resolved).split(path.sep).join('/')}`,
    };
}
export async function readImportedEvidenceFile(input) {
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Imported evidence byte limit must be a positive integer.');
    }
    const resolved = await resolveEvidenceImportPath(input.projectRoot, input.configuredPath, input.roots);
    const before = await stat(resolved.absolutePath);
    if (before.size > input.maxBytes) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Imported evidence exceeds the configured byte limit.');
    }
    const buffer = await readFile(resolved.absolutePath);
    if (buffer.byteLength > input.maxBytes) {
        throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Imported evidence changed while reading and exceeds the byte limit.');
    }
    const source = decodeUtf8(buffer);
    const extension = path.extname(resolved.absolutePath).toLowerCase();
    if (extension === '.json') {
        const parsed = parseStrictJson(source, {
            ...input.jsonLimits,
            maxBytes: Math.min(input.maxBytes, input.jsonLimits?.maxBytes ?? input.maxBytes),
        });
        return {
            ...resolved,
            format: 'json',
            content: canonicalize(parsed),
            byteCount: buffer.byteLength,
        };
    }
    const rows = parseStrictCsv(source, {
        ...input.csvLimits,
        maxBytes: Math.min(input.maxBytes, input.csvLimits?.maxBytes ?? input.maxBytes),
    });
    return {
        ...resolved,
        format: 'csv',
        content: serializeSafeCsv(rows),
        byteCount: buffer.byteLength,
    };
}
//# sourceMappingURL=evidence-import.js.map