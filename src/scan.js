// Finds env variable names referenced in source code. Read-only, no network, values never involved.
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { printable } from './index.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'vendor', 'coverage', '.venv', 'venv', '__pycache__', 'target']);
const CODE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte', '.astro', '.py', '.go', '.rb', '.php', '.java', '.kt', '.rs', '.cs']);
const isCompose = (n) => /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(n); // ${VAR} only in compose files (CI/Helm yaml use other vars)
const NAME = '([A-Za-z_][A-Za-z0-9_]*)';
const CODE_PATTERNS = [
  new RegExp(`process\\.env\\.${NAME}`, 'g'),
  new RegExp(`process\\.env\\[\\s*['"\`]${NAME}['"\`]\\s*\\]`, 'g'),
  new RegExp(`import\\.meta\\.env\\.${NAME}`, 'g'),
  new RegExp(`Deno\\.env\\.get\\(\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`os\\.environ\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`os\\.(?:getenv|environ\\.get)\\(\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`os\\.(?:Getenv|LookupEnv)\\(\\s*"${NAME}"`, 'g'),
  new RegExp(`ENV(?:\\.fetch\\(|\\[)\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`(?:^|[^.\\w])getenv\\(\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`\\$_ENV\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`System\\.getenv\\(\\s*"${NAME}"`, 'g'),
  new RegExp(`env::var\\(\\s*"${NAME}"`, 'g'),
  new RegExp(`GetEnvironmentVariable\\(\\s*"${NAME}"`, 'g'),
  // Common helpers: env('X') / getEnv('X') (next-runtime-env etc.), t3-env style env.X and zod schemas X: z.string()
  new RegExp(`\\b(?:env|getEnv|requireEnv|readEnv|mustEnv)\\(\\s*['"\`]${NAME}['"\`]`, 'g'),
  /(?<![.\w$])env\.([A-Z][A-Z0-9_]*)\b/g, // not process.env.X / import.meta.env.X (matched above)
];
// const { A, B: alias } = process.env
const DESTRUCTURE = /\{([^}]*)\}\s*=\s*process\.env\b/g;
// t3-env style schemas (X: z.string()) count only inside env files, not in any zod schema.
const ZOD_KEY = /^\s*([A-Z][A-Z0-9_]+)\s*:\s*z\./g;
const isEnvFile = (n) => /^env(\.[\w-]+)*\.[cm]?[jt]s$/i.test(n);
const CONFIG_PATTERNS = [/\$\{([A-Z_][A-Z0-9_]*)(?::?[-?+][^}]*)?\}/g];
// Set by the OS/runtime, almost never in .env files.
export const BUILTIN = new Set(['NODE_ENV', 'PATH', 'HOME', 'PWD', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'TZ', 'CI', 'HOSTNAME', 'GITHUB_ACTIONS', 'GITHUB_TOKEN', 'DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL']);

const MAX_FILES = 20000, MAX_BYTES = 1_000_000;

// Returns Map<key, [{ file, line }]> with paths relative to root.
export function scanCode(root) {
  const found = new Map();
  let count = 0;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (count >= MAX_FILES) return;
      const path = join(dir, e.name);
      if (e.isSymbolicLink()) continue; // avoid loops and leaving the project
      // Dot folders (.github, .husky, .agents…) hold CI/tooling vars, not app config.
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path); continue; }
      const code = CODE.has(extname(e.name).toLowerCase());
      const patterns = code ? CODE_PATTERNS : isCompose(e.name) ? CONFIG_PATTERNS : null;
      if (!patterns) continue;
      try { if (lstatSync(path).size > MAX_BYTES) continue; } catch { continue; }
      count++;
      const file = printable(relative(root, path).replace(/\\/g, '/'));
      const add = (key, line) => {
        if (BUILTIN.has(key) || key.startsWith('__')) return; // __X: framework internals
        if (!found.has(key)) found.set(key, []);
        found.get(key).push({ file, line });
      };
      readFileSync(path, 'utf8').split(/\r?\n/).forEach((text, i) => {
        for (const re of patterns) for (const m of text.matchAll(re)) add(m[1], i + 1);
        if (code && isEnvFile(e.name)) for (const m of text.matchAll(ZOD_KEY)) add(m[1], i + 1);
        if (code) for (const m of text.matchAll(DESTRUCTURE)) {
          for (const part of m[1].split(',')) { const k = part.split(':')[0].trim(); if (/^[A-Za-z_]\w*$/.test(k)) add(k, i + 1); }
        }
      });
    }
  };
  walk(root);
  return found;
}
