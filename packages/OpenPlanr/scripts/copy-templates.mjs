import { cpSync, rmSync } from 'node:fs';

rmSync('dist/templates', { recursive: true, force: true });
cpSync('src/templates', 'dist/templates', { recursive: true });
