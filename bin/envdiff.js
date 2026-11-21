#!/usr/bin/env node
import { readFileSync, appendFileSync, writeFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { compare, printable, distance, problemIds, applyBaseline } from '../src/index.js';
import { renderHtml } from '../src/html.js';
import { scanCode } from '../src/scan.js';

const HELP = `Usage: envdiff [<file> <file> [more files...]] [options]

Compares keys across .env files. Values are compared but NEVER printed.
With no files, compares every .env* file in the current folder (or the "files" in
.envdiffrc.json). Template files (.env.example…) only count for key presence.

Options:
  --keys-only   Only compare keys (useful against .env.example)
  --ignore LIST Skip keys, comma-separated, * wildcard (e.g. --ignore APP_URL,DEBUG_*)
  --strict      Warnings (duplicate, empty, invalid line) also fail
  --table       Key x file grid: ✗ missing, same letter = same value
  --fix         Append missing keys (empty values) to the files that lack them
  --html FILE   Also write a visual HTML report (never contains values)
  --open        Open the visual report in your browser (temp file if no --html)
  --scan DIR    Scan source code in DIR: keys used in code but not defined fail,
                defined keys never used in code warn (e.g. --scan .)
  --baseline    Save current problems to .envdiff-baseline.json; later runs only
                report new ones (security problems are never baselined)
  --ignore-baseline  Show every problem, even ones in the baseline
  --json        Machine-readable output
  -h, --help    Show help
  -v, --version Show version

Exit codes: 0 = in sync, 1 = differences or leaked secret, 2 = usage error`;

const OPTIONS = {
  'keys-only': { type: 'boolean' }, json: { type: 'boolean' }, ignore: { type: 'string', multiple: true }, strict: { type: 'boolean' },
  table: { type: 'boolean' }, fix: { type: 'boolean' }, html: { type: 'string' }, scan: { type: 'string' }, open: { type: 'boolean' },
  baseline: { type: 'boolean' }, 'ignore-baseline': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } };
let args;
try {
  args = parseArgs({ allowPositionals: true, options: OPTIONS });
} catch (e) {
  // Short, friendly error with a suggestion instead of Node's long parseArgs message.
  const bad = e.message.match(/'(-[^' <]*)/)?.[1];
  const near = bad && Object.keys(OPTIONS).map((k) => `--${k}`).find((k) => distance(bad, k) <= 2);
  const why = /argument missing/.test(e.message) ? `${bad} needs a value` : `unknown option ${bad}${near ? `. Did you mean ${near}?` : ''}`;
  console.error(`envdiff: ${bad ? printable(why) : e.message}\nRun envdiff --help for all options.`);
  process.exit(2);
}
const { values: o, positionals } = args;
if (o.help) { console.log(HELP); process.exit(0); }
if (o.version) { console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version); process.exit(0); }
// Optional .envdiffrc.json in the current folder; CLI flags win. Only read-only settings are allowed here.
let rc = {};
try { rc = JSON.parse(readFileSync('.envdiffrc.json', 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') { console.error(`envdiff: invalid .envdiffrc.json: ${e.message}`); process.exit(2); } }
const list = (v, name) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) { console.error(`envdiff: .envdiffrc.json "${name}" must be a list of strings`); process.exit(2); }
  return v;
};
// A repo's config must not make envdiff read outside that repo (e.g. ../../.ssh).
const inside = (p, name) => {
  const rel = relative(process.cwd(), resolve(p));
  if (rel.startsWith('..') || isAbsolute(rel)) { console.error(`envdiff: .envdiffrc.json "${name}" must stay inside this folder: ${printable(p)}`); process.exit(2); }
  return p;
};
const rcFiles = list(rc.files, 'files').map((p) => inside(p, 'files'));

// No files given: config files, else every .env* file here (templates first, then .env, then the rest).
const zeroArg = positionals.length === 0 && !rcFiles.length;
const rank = (n) => (/example|sample|template|dist/i.test(n) ? 0 : n === '.env' ? 1 : 2);
const discovered = () => readdirSync('.').filter((n) => /^\.env(\..+)?$/.test(n) && !/(\.(bak|swp|tmp|orig|vault|keys|local\.php)|~)$/.test(n) && statSync(n).isFile())
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const names = positionals.length ? positionals : rcFiles.length ? rcFiles : discovered();
// One file is enough with --scan: the code is the other side (.env.example vs what the code reads).
const scanning = o.scan !== undefined || typeof rc.scan === 'string';
if (names.length < (scanning ? 1 : 2)) {
  if (zeroArg) console.error(`envdiff: found ${names.length} .env file(s) here, need at least 2.\nWith no arguments envdiff compares all .env* files in the current folder (e.g. .env.example and .env).\nRun envdiff --help for usage.`);
  else console.error(HELP);
  process.exit(2);
}

let files;
// Display names are stripped of terminal control characters; real paths stay in names[].
// Read each file on its own so the error names the right path (EISDIR has no e.path).
files = names.map((name) => {
  try { return { name: printable(name), text: readFileSync(name, 'utf8') }; }
  catch (e) { console.error(`envdiff: cannot read ${printable(name)}: ${e.code === 'EISDIR' ? 'it is a folder, not a file' : e.code}`); process.exit(2); }
});

const ignore = [...list(rc.ignore, 'ignore'), ...(o.ignore ?? [])].flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
if (o.scan === undefined && typeof rc.scan === 'string') o.scan = inside(rc.scan, 'scan');
if (o.strict === undefined && rc.strict === true) o.strict = true;
if (o['keys-only'] === undefined && rc.keysOnly === true) o['keys-only'] = true;
// Ask git (if installed and the file is in a repo) whether each file is committed or not ignored.
const gitCode = (name, args) => {
  const res = spawnSync('git', [...args, '--', basename(name)], { cwd: dirname(resolve(name)), stdio: 'ignore' });
  return res.error ? null : res.status;
};
const git = { tracked: [], unignored: [] };
for (const [i, name] of names.entries()) {
  if (gitCode(name, ['rev-parse', '--is-inside-work-tree']) !== 0) continue;
  if (gitCode(name, ['ls-files', '--error-unmatch']) === 0) git.tracked.push(files[i].name);
  else if (gitCode(name, ['check-ignore', '-q']) === 1) git.unignored.push(files[i].name);
}
if (o.scan !== undefined && !statSync(o.scan, { throwIfNoEntry: false })?.isDirectory()) { console.error(`envdiff: --scan folder not found: ${printable(o.scan)}`); process.exit(2); }
const opts = { keysOnly: !!o['keys-only'], ignore, strict: o.strict, git, used: o.scan === undefined ? null : scanCode(resolve(o.scan)) };
let r = compare(files, opts);
const fixed = [];
if (o.fix) {
  // Only appends `KEY=` lines; existing lines are never changed and values are never copied.
  for (const [i, m] of r.missing.entries()) {
    if (!m.keys.length) continue;
    const f = files[i], eol = f.text.includes('\r\n') ? '\r\n' : '\n';
    const add = (f.text && !f.text.endsWith('\n') ? eol : '') + m.keys.map((k) => `${k}=`).join(eol) + eol;
    try { appendFileSync(names[i], add); } catch (e) { console.error(`envdiff: cannot write ${f.name}: ${e.code}`); process.exit(2); }
    f.text += add;
    fixed.push({ file: f.name, keys: m.keys });
  }
  r = compare(files, opts);
}
// Baseline: known problems recorded once, so big projects can adopt envdiff and only fail on new ones.
const BASELINE = '.envdiff-baseline.json';
if (o.baseline) {
  const ids = problemIds(r);
  writeFileSync(BASELINE, JSON.stringify({ version: 1, note: 'Known envdiff problems: key names only, never values. Security problems are never stored here.', problems: ids }, null, 2) + '\n');
  console.error(`envdiff: saved ${ids.length} known problem(s) to ${BASELINE}; future runs only report new ones`);
}
if (!o['ignore-baseline']) {
  let b;
  try { b = JSON.parse(readFileSync(BASELINE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') { console.error(`envdiff: invalid ${BASELINE}: ${e.message}`); process.exit(2); } }
  if (b) {
    if (!Array.isArray(b.problems) || !b.problems.every((s) => typeof s === 'string')) { console.error(`envdiff: ${BASELINE} "problems" must be a list of strings`); process.exit(2); }
    r = applyBaseline(r, b.problems, { strict: o.strict });
  }
}
// --open without --html: write the report to a temp file (it never contains values) and open it.
if (o.open && !o.html) o.html = join(mkdtempSync(join(tmpdir(), 'envdiff-')), 'report.html'); // private new dir: no symlink tricks
if (o.html) {
  if (names.some((n) => resolve(n) === resolve(o.html))) { console.error("envdiff: --html must not overwrite an input file"); process.exit(2); }
  try { writeFileSync(o.html, renderHtml(r, { keysOnly: opts.keysOnly })); } catch (e) { console.error(`envdiff: cannot write ${o.html}: ${e.code}`); process.exit(2); }
  if (!o.json) console.error(`envdiff: report written to ${printable(o.html)}`);
  if (o.open) {
    // explorer.exe / open / xdg-open take the path as one argument: no shell, so file names can't inject commands.
    const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = [resolve(o.html)];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => console.error('envdiff: could not open a browser; open the file above manually')).unref();
  }
}
if (o.json) { console.log(JSON.stringify(o.fix ? { ...r, fixed } : r, null, 2)); process.exit(r.ok ? 0 : 1); }

const color = (process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const at = (w) => (w.lines ? ` (line ${w.lines.join(', ')})` : '');
const out = [c(1, `envdiff  ${r.files.join('  vs  ')}`), ''];
if (o.table) {
  // Cells: ✗ missing, ✓ present (keys only), or A/B/C… where equal letters mean equal values.
  const cell = (v) => (v === null ? '✗' : opts.keysOnly || v < 0 ? '✓' : String.fromCharCode(65 + v));
  const w = [Math.max(3, ...r.table.map((t) => t.key.length)), ...r.files.map((f) => f.length)];
  const row = (cols) => cols.map((s, i) => s.padEnd(w[i])).join('  ').trimEnd();
  out.push(c(1, row(['KEY', ...r.files])));
  for (const t of r.table) {
    const line = row([t.key, ...t.cells.map(cell)]);
    out.push(t.cells.includes(null) ? c(31, line) : t.cells.some((v) => v > 0) ? c(33, line) : line);
  }
  out.push('', c(2, 'Same letter = same value. Values are never shown.'), '');
}
for (const f of fixed) out.push(c(32, `Added to ${f.file} (empty values):`), ...f.keys.map((k) => `  + ${k}`), '');
const hint = (file, k) => { const s = r.suggestions.find((x) => x.file === file && x.missing === k); return s ? c(2, `  (did you mean ${s.similar}?)`) : ''; };
for (const m of r.missing) if (m.keys.length) out.push(c(31, `Missing in ${m.file}:`), ...m.keys.map((k) => `  - ${k}${hint(m.file, k)}`), '');
if (r.undefinedInCode.length) out.push(c(31, 'Used in code but not defined in any env file:'), ...r.undefinedInCode.map((u) => `  - ${u.key}${c(2, `  (${u.refs[0].file}:${u.refs[0].line}${u.refs.length > 1 ? ` +${u.refs.length - 1}` : ''})`)}`), '');
if (r.different.length) out.push(c(33, 'Different values (hidden):'), ...r.different.map((k) => `  ~ ${k}`), '');
const leakMsg = (w) => (w.type === 'tracked-by-git' ? `  ! ${w.file} is committed to git: remove it (git rm --cached) and rotate its secrets` : `  ! ${w.file}: ${w.key}${at(w)} looks like a real secret in a template file`);
if (r.leaks.length) out.push(c(31, 'Security problems:'), ...r.leaks.map(leakMsg), '');
if (r.warnings.length) out.push(c(36, 'Warnings:'), ...r.warnings.map((w) => `  ! ${w.file}: ${w.type}${w.key ? ' ' + w.key : ''}${at(w)}`), '');
if (r.baselined) out.push(c(2, `${r.baselined} known problem(s) hidden by ${BASELINE} (--ignore-baseline shows them)`));
out.push(r.ok ? c(32, '✓ In sync') : c(31, '✗ Not in sync'));
console.log(out.join('\n'));
process.exit(r.ok ? 0 : 1);
