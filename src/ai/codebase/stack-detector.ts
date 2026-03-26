/**
 * Detects the tech stack of a project by reading manifest files.
 *
 * Looks for package.json (Node.js), go.mod (Go), requirements.txt / pyproject.toml
 * (Python), Cargo.toml (Rust), and more. Returns a structured TechStack object
 * used to enrich AI prompts with codebase awareness.
 */

import path from 'node:path';
import { fileExists, readFile } from '../../utils/fs.js';

export interface TechStack {
  language: string;
  framework?: string;
  packageManager?: string;
  dependencies: string[];
  devDependencies: string[];
}

interface StackDetector {
  file: string;
  detect: (content: string, projectDir: string) => Promise<TechStack>;
}

const DETECTORS: StackDetector[] = [
  {
    file: 'package.json',
    detect: async (content) => {
      const pkg = JSON.parse(content);
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      const allDeps = [...deps, ...devDeps];

      let framework: string | undefined;
      if (allDeps.includes('next')) framework = 'Next.js';
      else if (allDeps.includes('nuxt')) framework = 'Nuxt';
      else if (allDeps.includes('react')) framework = 'React';
      else if (allDeps.includes('vue')) framework = 'Vue';
      else if (allDeps.includes('svelte')) framework = 'Svelte';
      else if (allDeps.includes('@angular/core')) framework = 'Angular';
      else if (allDeps.includes('express')) framework = 'Express';
      else if (allDeps.includes('fastify')) framework = 'Fastify';
      else if (allDeps.includes('hono')) framework = 'Hono';
      else if (allDeps.includes('nestjs')) framework = 'NestJS';

      const hasTS = allDeps.includes('typescript');
      const language = hasTS ? 'TypeScript' : 'JavaScript';

      let packageManager = 'npm';
      if (pkg.packageManager?.startsWith('pnpm')) packageManager = 'pnpm';
      else if (pkg.packageManager?.startsWith('yarn')) packageManager = 'yarn';
      else if (pkg.packageManager?.startsWith('bun')) packageManager = 'bun';

      return {
        language,
        framework,
        packageManager,
        dependencies: deps.slice(0, 20),
        devDependencies: devDeps.slice(0, 10),
      };
    },
  },
  {
    file: 'go.mod',
    detect: async (content) => {
      const moduleMatch = content.match(/^module\s+(.+)$/m);
      const deps = [...content.matchAll(/^\t(\S+)\s/gm)].map((m) => m[1]).slice(0, 20);
      return {
        language: 'Go',
        framework: deps.find((d) => d.includes('gin')) ? 'Gin' :
                   deps.find((d) => d.includes('fiber')) ? 'Fiber' :
                   deps.find((d) => d.includes('echo')) ? 'Echo' : undefined,
        packageManager: 'go modules',
        dependencies: deps,
        devDependencies: [],
      };
    },
  },
  {
    file: 'requirements.txt',
    detect: async (content) => {
      const deps = content.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('==')[0].split('>=')[0].trim()).slice(0, 20);
      return {
        language: 'Python',
        framework: deps.find((d) => d === 'django') ? 'Django' :
                   deps.find((d) => d === 'flask') ? 'Flask' :
                   deps.find((d) => d === 'fastapi') ? 'FastAPI' : undefined,
        packageManager: 'pip',
        dependencies: deps,
        devDependencies: [],
      };
    },
  },
  {
    file: 'pyproject.toml',
    detect: async (content) => {
      const deps = [...content.matchAll(/"([a-zA-Z][\w-]*)(?:[><=!]|")/g)].map((m) => m[1]).slice(0, 20);
      return {
        language: 'Python',
        framework: deps.find((d) => d === 'django') ? 'Django' :
                   deps.find((d) => d === 'flask') ? 'Flask' :
                   deps.find((d) => d === 'fastapi') ? 'FastAPI' : undefined,
        packageManager: content.includes('[tool.poetry]') ? 'poetry' : 'pip',
        dependencies: deps,
        devDependencies: [],
      };
    },
  },
  {
    file: 'Cargo.toml',
    detect: async (content) => {
      const deps = [...content.matchAll(/^(\w[\w-]*)\s*=/gm)].map((m) => m[1]).filter((d) => d !== 'name' && d !== 'version' && d !== 'edition').slice(0, 20);
      return {
        language: 'Rust',
        framework: deps.find((d) => d === 'actix-web') ? 'Actix' :
                   deps.find((d) => d === 'axum') ? 'Axum' :
                   deps.find((d) => d === 'rocket') ? 'Rocket' : undefined,
        packageManager: 'cargo',
        dependencies: deps,
        devDependencies: [],
      };
    },
  },
];

export async function detectTechStack(projectDir: string): Promise<TechStack | null> {
  for (const detector of DETECTORS) {
    const filePath = path.join(projectDir, detector.file);
    if (await fileExists(filePath)) {
      try {
        const content = await readFile(filePath);
        return await detector.detect(content, projectDir);
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Format tech stack as a human-readable string for prompt injection. */
export function formatTechStack(stack: TechStack): string {
  const parts: string[] = [];
  parts.push(`Language: ${stack.language}`);
  if (stack.framework) parts.push(`Framework: ${stack.framework}`);
  if (stack.packageManager) parts.push(`Package Manager: ${stack.packageManager}`);
  if (stack.dependencies.length > 0) {
    parts.push(`Key Dependencies: ${stack.dependencies.join(', ')}`);
  }
  return parts.join('\n');
}
