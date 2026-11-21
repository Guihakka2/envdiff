// Finds env variable names referenced in source code. Read-only, no network, values never involved.
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'vendor', 'coverage', '.venv', 'venv', '__pycache__', 'target']);
const CODE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte', '.astro', '.py', '.go', '.rb', '.php', '.java', '.kt', '.rs', '.cs']);
const CONFIG = new Set(['.yml', '.yaml', '.sh']); // ${VAR} interpolation only makes sense here
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
];
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
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path); continue; }
      const ext = extname(e.name).toLowerCase();
      const patterns = CODE.has(ext) ? CODE_PATTERNS : CONFIG.has(ext) || /^(docker-)?compose/.test(e.name) ? CONFIG_PATTERNS : null;
      if (!patterns) continue;
      try { if (lstatSync(path).size > MAX_BYTES) continue; } catch { continue; }
      count++;
      const lines = readFileSync(path, 'utf8').split(/\r?\n/);
      lines.forEach((text, i) => {
        for (const re of patterns) {
          re.lastIndex = 0;
          for (const m of text.matchAll(re)) {
            const key = m[1];
            if (BUILTIN.has(key)) continue;
            if (!found.has(key)) found.set(key, []);
            found.get(key).push({ file: relative(root, path).replace(/\\/g, '/'), line: i + 1 });
          }
        }
      });
    }
  };
  walk(root);
  return found;
}
