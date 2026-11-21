import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, compare } from '../src/index.js';

const bin = fileURLToPath(new URL('../bin/envdiff.js', import.meta.url));
const run = (args, cwd) => {
  try { return { code: 0, out: execFileSync(process.execPath, [bin, ...args], { cwd, stdio: 'pipe' }).toString() }; }
  catch (e) { return { code: e.status, out: e.stdout.toString() + e.stderr.toString() }; }
};

test('parse handles export, quotes, comments, duplicates, invalid lines', () => {
  const r = parse('# c\nexport A=1\nB="x # y"\nC=z # note\nA=2\nnot a line\nD=\r\n');
  assert.equal(r.vars.get('A').value, '2');
  assert.equal(r.vars.get('B').value, 'x # y');
  assert.equal(r.vars.get('C').value, 'z');
  assert.equal(r.vars.get('D').value, '');
  assert.deepEqual(r.duplicates, [{ key: 'A', lines: [2, 5] }]);
  assert.deepEqual(r.invalid, [6]);
});

test('compare finds missing and different keys', () => {
  const r = compare([{ name: 'dev', text: 'A=1\nB=2' }, { name: 'prod', text: 'A=1\nB=3\nC=4' }]);
  assert.deepEqual(r.missing, [{ file: 'dev', keys: ['C'] }, { file: 'prod', keys: [] }]);
  assert.deepEqual(r.different, ['B']);
  assert.equal(r.ok, false);
  assert.equal(compare([{ name: 'a', text: 'A=1' }, { name: 'b', text: 'A=2' }], { keysOnly: true }).ok, true);
});

test('flags real-looking secrets only in template files', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  assert.equal(compare([{ name: '.env', text: `K=${key}` }, { name: '.env.example', text: `K=${key}` }]).leaks.length, 1);
  assert.equal(compare([{ name: '.env', text: `K=${key}` }, { name: '.env.prod', text: `K=${key}` }]).leaks.length, 0);
});

test('empty values warn in real env files but not in templates', () => {
  const r = compare([{ name: '.env.example', text: 'A=' }, { name: '.env', text: 'A=' }]);
  assert.deepEqual(r.warnings.map((w) => w.file), ['.env']);
});

test('CLI never prints values and sets exit codes', () => {
  const d = mkdtempSync(join(tmpdir(), 'envdiff-'));
  const a = join(d, 'a.env'), b = join(d, 'b.env');
  writeFileSync(a, 'PASSWORD=supersecret123\nX=1');
  writeFileSync(b, 'PASSWORD=othersecret456');
  for (const args of [[a, b], [a, b, '--json']]) {
    const { code, out } = run(args);
    assert.equal(code, 1);
    assert.ok(!out.includes('supersecret123') && !out.includes('othersecret456'));
  }
  assert.deepEqual(JSON.parse(run([a, b, '--json']).out).different, ['PASSWORD']);
  assert.equal(run([a]).code, 2);
  assert.equal(run([a, join(d, 'nope.env')]).code, 2);
  assert.equal(run([a, a]).code, 0);
});

test('zero-arg mode compares .env.example with .env, keys only', () => {
  const d = mkdtempSync(join(tmpdir(), 'envdiff-'));
  const missing = run([], d);
  assert.equal(missing.code, 2);
  assert.match(missing.out, /\.env\.example and \.env/);
  writeFileSync(join(d, '.env.example'), 'A=\nB=');
  writeFileSync(join(d, '.env'), 'A=real\nB=other');
  assert.equal(run([], d).code, 0);
  writeFileSync(join(d, '.env'), 'A=real');
  const r = run([], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /Missing in \.env:\n  - B/);
});
