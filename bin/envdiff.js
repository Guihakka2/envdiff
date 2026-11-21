#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { compare } from '../src/index.js';

const HELP = `Usage: envdiff [<file> <file> [more files...]] [options]

Compares keys across .env files. Values are compared but NEVER printed.
With no files, compares .env.example and .env in the current folder (keys only).

Options:
  --keys-only   Only compare keys (useful against .env.example)
  --ignore LIST Skip keys, comma-separated, * wildcard (e.g. --ignore APP_URL,DEBUG_*)
  --strict      Warnings (duplicate, empty, invalid line) also fail
  --json        Machine-readable output
  -h, --help    Show help
  -v, --version Show version

Exit codes: 0 = in sync, 1 = differences or leaked secret, 2 = usage error`;

let args;
try {
  args = parseArgs({ allowPositionals: true, options: {
    'keys-only': { type: 'boolean' }, json: { type: 'boolean' }, ignore: { type: 'string', multiple: true }, strict: { type: 'boolean' },
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
const r = compare(files, { keysOnly: o['keys-only'] || zeroArg, ignore, strict: o.strict });
if (o.json) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); }

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const at = (w) => (w.lines ? ` (line ${w.lines.join(', ')})` : '');
const out = [c(1, `envdiff  ${r.files.join('  vs  ')}`), ''];
for (const m of r.missing) if (m.keys.length) out.push(c(31, `Missing in ${m.file}:`), ...m.keys.map((k) => `  - ${k}`), '');
if (r.different.length) out.push(c(33, 'Different values (hidden):'), ...r.different.map((k) => `  ~ ${k}`), '');
if (r.leaks.length) out.push(c(31, 'Possible real secrets in template files:'), ...r.leaks.map((w) => `  ! ${w.file}: ${w.key}${at(w)}`), '');
if (r.warnings.length) out.push(c(36, 'Warnings:'), ...r.warnings.map((w) => `  ! ${w.file}: ${w.type}${w.key ? ' ' + w.key : ''}${at(w)}`), '');
out.push(r.ok ? c(32, '✓ In sync') : c(31, '✗ Not in sync'));
console.log(out.join('\n'));
process.exit(r.ok ? 0 : 1);
