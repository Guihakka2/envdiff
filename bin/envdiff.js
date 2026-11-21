#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { compare } from '../src/index.js';

const HELP = `Usage: envdiff [<file> <file> [more files...]] [options]

Compares keys across .env files. Values are compared but NEVER printed.
With no files, compares .env.example and .env in the current folder (keys only).

Options:
  --keys-only   Only compare keys (useful against .env.example)
  --ignore LIST Skip keys, comma-separated, * wildcard (e.g. --ignore APP_URL,DEBUG_*)
  --strict      Warnings (duplicate, empty, invalid line) also fail
  --table       Key x file grid: ✗ missing, same letter = same value
  --fix         Append missing keys (empty values) to the files that lack them
  --json        Machine-readable output
  -h, --help    Show help
  -v, --version Show version

Exit codes: 0 = in sync, 1 = differences or leaked secret, 2 = usage error`;

let args;
try {
  args = parseArgs({ allowPositionals: true, options: {
    'keys-only': { type: 'boolean' }, json: { type: 'boolean' }, ignore: { type: 'string', multiple: true }, strict: { type: 'boolean' },
    table: { type: 'boolean' }, fix: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } } });
} catch (e) { console.error(e.message + '\n\n' + HELP); process.exit(2); }
const { values: o, positionals } = args;
if (o.help) { console.log(HELP); process.exit(0); }
if (o.version) { console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version); process.exit(0); }
const zeroArg = positionals.length === 0;
const names = zeroArg ? ['.env.example', '.env'] : positionals;
if (names.length < 2) { console.error(HELP); process.exit(2); }

let files;
try { files = names.map((name) => ({ name, text: readFileSync(name, 'utf8') })); }
catch (e) {
  console.error(`envdiff: cannot read ${e.path}: ${e.code}`);
  if (zeroArg) console.error('With no arguments envdiff compares .env.example and .env in the current folder.\nRun envdiff --help for usage.');
  process.exit(2);
}

const ignore = (o.ignore ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
const opts = { keysOnly: o['keys-only'] || zeroArg, ignore, strict: o.strict };
let r = compare(files, opts);
const fixed = [];
if (o.fix) {
  // Only appends `KEY=` lines; existing lines are never changed and values are never copied.
  for (const [i, m] of r.missing.entries()) {
    if (!m.keys.length) continue;
    const f = files[i], eol = f.text.includes('\r\n') ? '\r\n' : '\n';
    const add = (f.text && !f.text.endsWith('\n') ? eol : '') + m.keys.map((k) => `${k}=`).join(eol) + eol;
    try { appendFileSync(f.name, add); } catch (e) { console.error(`envdiff: cannot write ${f.name}: ${e.code}`); process.exit(2); }
    f.text += add;
    fixed.push({ file: f.name, keys: m.keys });
  }
  r = compare(files, opts);
}
if (o.json) { console.log(JSON.stringify(o.fix ? { ...r, fixed } : r, null, 2)); process.exit(r.ok ? 0 : 1); }

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const at = (w) => (w.lines ? ` (line ${w.lines.join(', ')})` : '');
const out = [c(1, `envdiff  ${r.files.join('  vs  ')}`), ''];
if (o.table) {
  // Cells: ✗ missing, ✓ present (keys only), or A/B/C… where equal letters mean equal values.
  const cell = (v) => (v === null ? '✗' : opts.keysOnly ? '✓' : String.fromCharCode(65 + v));
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
for (const m of r.missing) if (m.keys.length) out.push(c(31, `Missing in ${m.file}:`), ...m.keys.map((k) => `  - ${k}`), '');
if (r.different.length) out.push(c(33, 'Different values (hidden):'), ...r.different.map((k) => `  ~ ${k}`), '');
if (r.leaks.length) out.push(c(31, 'Possible real secrets in template files:'), ...r.leaks.map((w) => `  ! ${w.file}: ${w.key}${at(w)}`), '');
if (r.warnings.length) out.push(c(36, 'Warnings:'), ...r.warnings.map((w) => `  ! ${w.file}: ${w.type}${w.key ? ' ' + w.key : ''}${at(w)}`), '');
out.push(r.ok ? c(32, '✓ In sync') : c(31, '✗ Not in sync'));
console.log(out.join('\n'));
process.exit(r.ok ? 0 : 1);
