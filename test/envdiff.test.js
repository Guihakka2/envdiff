import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, compare, looksSecret } from '../src/index.js';
import { renderHtml } from '../src/html.js';

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

test('parse handles multiline values and escaped quotes', () => {
  const r = parse([
    'KEY="-----BEGIN PRIVATE KEY-----', 'abc', '-----END PRIVATE KEY-----"',
    'Q="say \\"hi\\"\\nbye"', "S='a\\nb'", "M='x", "y'",
    'BROKEN="never closed', 'AFTER=ok',
  ].join('\n'));
  assert.equal(r.vars.get('KEY').value, '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
  assert.equal(r.vars.get('KEY').line, 1);
  assert.equal(r.vars.get('Q').value, 'say "hi"\nbye');
  assert.equal(r.vars.get('S').value, 'a\\nb');
  assert.equal(r.vars.get('M').value, 'x\ny');
  assert.equal(r.vars.get('AFTER').value, 'ok');
  assert.deepEqual(r.invalid, [8]);
  const leak = compare([{ name: '.env.example', text: 'KEY="-----BEGIN RSA PRIVATE KEY-----\nzz\n-----END RSA PRIVATE KEY-----"' }, { name: '.env', text: 'KEY=' }]);
  assert.equal(leak.leaks.length, 1);
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

test('ignore skips keys by name and * wildcard, but never hides leaks', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const files = [{ name: '.env.example', text: `APP_URL=a\nDEBUG_X=1\nA.B=1\nAWS=${key}` }, { name: '.env', text: 'APP_URL=b\nAxB=1\nAWS=' }];
  const r = compare(files, { ignore: ['APP_URL', 'DEBUG_*', 'A.B', 'AWS'] });
  assert.deepEqual(r.different, []);
  assert.deepEqual(r.missing, [{ file: '.env.example', keys: ['AxB'] }, { file: '.env', keys: [] }]);
  assert.equal(r.leaks.length, 1);
  const d = mkdtempSync(join(tmpdir(), 'envdiff-'));
  writeFileSync(join(d, 'a.env'), 'X=1\nY=1\nZ=1');
  writeFileSync(join(d, 'b.env'), 'X=2\nY=2\nZ=1');
  assert.equal(run(['a.env', 'b.env', '--ignore', 'X, Y'], d).code, 0);
  assert.equal(run(['a.env', 'b.env', '--ignore', 'X', '--ignore', 'Y'], d).code, 0);
  assert.equal(run(['a.env', 'b.env', '--ignore', 'X'], d).code, 1);
});

test('secret patterns: GitLab, npm, Azure, JWT (positive and negative)', () => {
  // Built from parts so repo secret scanners don't flag these fake fixtures.
  const yes = [
    'glpat-' + 'a'.repeat(20), 'npm_' + 'A1'.repeat(18),
    'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=' + 'Ab1+'.repeat(22) + '==',
    'eyJ' + 'hbGciOiJIUzI1' + '.eyJ' + 'zdWIiOiIxMjM0' + '.' + 'SflKxwRJSMeKKF2QT4fw',
  ];
  const no = ['glpat-short', 'npm_tooshort', 'AccountKey=<your-key>', 'eyJhbGciOi', 'changeme', ''];
  for (const v of yes) assert.equal(looksSecret(v), true, v);
  for (const v of no) assert.equal(looksSecret(v), false, v);
});

test('table groups equal values without exposing them', () => {
  const r = compare([{ name: 'a', text: 'X=1\nY=1' }, { name: 'b', text: 'X=2' }, { name: 'c', text: 'X=1\nY=9' }]);
  assert.deepEqual(r.table, [{ key: 'X', cells: [0, 1, 0] }, { key: 'Y', cells: [0, null, 1] }]);
  const d = mkdtempSync(join(tmpdir(), 'envdiff-'));
  writeFileSync(join(d, 'a.env'), 'X=topsecret\nY=1');
  writeFileSync(join(d, 'b.env'), 'X=othersecret');
  const out = run(['a.env', 'b.env', '--table'], d).out;
  assert.match(out, /X\s+A\s+B/);
  assert.match(out, /Y\s+A\s+✗/);
  assert.ok(!out.includes('topsecret') && !out.includes('othersecret'));
});

test('fix appends missing keys with empty values, never copies values', () => {
  const d = mkdtempSync(join(tmpdir(), 'envdiff-'));
  writeFileSync(join(d, '.env.example'), 'A=\r\nB=\r\n');
  writeFileSync(join(d, '.env'), 'A=1\r\nC=supersecret'); // CRLF, no trailing newline
  const r = run(['--fix'], d);
  assert.equal(r.code, 0);
  assert.equal(readFileSync(join(d, '.env'), 'utf8'), 'A=1\r\nC=supersecret\r\nB=\r\n');
  assert.equal(readFileSync(join(d, '.env.example'), 'utf8'), 'A=\r\nB=\r\nC=\r\n');
  assert.ok(!r.out.includes('supersecret'));
  assert.equal(run(['--fix'], d).out.includes('Added'), false); // idempotent
});

test('did-you-mean suggests likely typos', () => {
  const r = compare([{ name: 'a', text: 'DATABASE_URL=1\nPORT=1' }, { name: 'b', text: 'DATABSE_URL=1\nHOST=1' }]);
  assert.deepEqual(r.suggestions, [{ file: 'a', missing: 'DATABSE_URL', similar: 'DATABASE_URL' }, { file: 'b', missing: 'DATABASE_URL', similar: 'DATABSE_URL' }]);
  assert.equal(compare([{ name: 'a', text: 'PORT=1' }, { name: 'b', text: 'HOST=1' }]).suggestions.length, 0); // too short / too different
});

test('git: committed .env fails, un-ignored .env warns, templates are fine', () => {
  const git = { tracked: ['.env', '.env.example'], unignored: ['.env.prod'] };
  const r = compare([{ name: '.env', text: 'A=1' }, { name: '.env.example', text: 'A=' }, { name: '.env.prod', text: 'A=1' }], { keysOnly: true, git });
  assert.deepEqual(r.leaks, [{ file: '.env', type: 'tracked-by-git' }]);
  assert.deepEqual(r.warnings, [{ file: '.env.prod', type: 'not-gitignored' }]);
  assert.equal(r.ok, false);

  const d = mkdtempSync(join(tmpdir(), 'envdiff-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, stdio: 'ignore' });
  g('init', '-q');
  writeFileSync(join(d, '.env.example'), 'A=');
  writeFileSync(join(d, '.env'), 'A=1');
  const warned = run([], d);
  assert.equal(warned.code, 0);
  assert.match(warned.out, /\.env: not-gitignored/);
  g('add', '.env'); g('commit', '-qm', 'oops');
  const failed = run([], d);
  assert.equal(failed.code, 1);
  assert.match(failed.out, /\.env is committed to git/);
});

test('html report: no values, escaped names, refuses to overwrite inputs', () => {
  const evil = '<img src=x onerror=alert(1)>.env';
  const html = renderHtml(compare([{ name: evil, text: 'A=topsecret' }, { name: 'b.env', text: 'A=other\nB=1' }]));
  assert.ok(!html.includes('<img') && html.includes('&lt;img'));
  assert.ok(!html.includes('topsecret') && !html.includes('other'));
  assert.match(html, /Content-Security-Policy/);

  const d = mkdtempSync(join(tmpdir(), 'envdiff-'));
  writeFileSync(join(d, 'a.env'), 'X=supersecret\nY=1');
  writeFileSync(join(d, 'b.env'), 'X=othersecret');
  const r = run(['a.env', 'b.env', '--html', 'report.html'], d);
  assert.equal(r.code, 1);
  const out = readFileSync(join(d, 'report.html'), 'utf8');
  assert.match(out, /Keys by environment/);
  assert.ok(!out.includes('supersecret') && !out.includes('othersecret'));
  assert.equal(run(['a.env', 'b.env', '--html', 'b.env'], d).code, 2);
  assert.equal(readFileSync(join(d, 'b.env'), 'utf8'), 'X=othersecret');
});

test('strict turns warnings into failures', () => {
  const files = [{ name: 'a.env', text: 'A=1\nA=1' }, { name: 'b.env', text: 'A=1' }];
  assert.equal(compare(files).ok, true);
  assert.equal(compare(files, { strict: true }).ok, false);
  const d = mkdtempSync(join(tmpdir(), 'envdiff-'));
  writeFileSync(join(d, 'a.env'), 'A=\n');
  assert.equal(run(['a.env', 'a.env'], d).code, 0);
  assert.equal(run(['a.env', 'a.env', '--strict'], d).code, 1);
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

test('template values are placeholders: never counted as different', () => {
  const r = compare([{ name: '.env.example', text: 'A=changeme' }, { name: '.env.dev', text: 'A=1' }, { name: '.env.prod', text: 'A=1' }]);
  assert.deepEqual(r.different, []);
  assert.deepEqual(r.table, [{ key: 'A', cells: [-1, 0, 0] }]);
  assert.equal(r.ok, true);
});

test('scan finds env usage across languages, skips node_modules and builtins', async () => {
  const { scanCode } = await import('../src/scan.js');
  const { mkdirSync } = await import('node:fs');
  const d = mkdtempSync(join(tmpdir(), 'envdiff-scan-'));
  mkdirSync(join(d, 'src')); mkdirSync(join(d, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(d, 'src', 'a.ts'), 'const a = process.env.DATABASE_URL;\nconst b = process.env["API_KEY"];\nimport.meta.env.VITE_URL; process.env.NODE_ENV;\nconst t = `${NOT_ENV}`;');
  writeFileSync(join(d, 'app.py'), 'os.getenv("SMTP_HOST")\nos.environ["SMTP_PORT"]');
  writeFileSync(join(d, 'main.go'), 'os.Getenv("GO_KEY")');
  writeFileSync(join(d, 'docker-compose.yml'), 'image: ${IMAGE_TAG:-latest}');
  writeFileSync(join(d, 'node_modules', 'x', 'i.js'), 'process.env.FROM_DEPENDENCY');
  const used = scanCode(d);
  assert.deepEqual([...used.keys()].sort(), ['API_KEY', 'DATABASE_URL', 'GO_KEY', 'IMAGE_TAG', 'SMTP_HOST', 'SMTP_PORT', 'VITE_URL']);
  assert.deepEqual(used.get('DATABASE_URL'), [{ file: 'src/a.ts', line: 1 }]);

  writeFileSync(join(d, '.env.example'), 'DATABASE_URL=\nAPI_KEY=\nVITE_URL=\nSMTP_HOST=\nSMTP_PORT=\nGO_KEY=\nOLD_FLAG=\n');
  writeFileSync(join(d, '.env'), 'DATABASE_URL=secretdb\nAPI_KEY=k\nVITE_URL=u\nSMTP_HOST=h\nSMTP_PORT=1\nGO_KEY=g\nOLD_FLAG=1\n');
  const r = run(['--scan', '.'], d);
  assert.equal(r.code, 1);
  assert.match(r.out, /Used in code but not defined in any env file:\n  - IMAGE_TAG  \(docker-compose\.yml:1\)/);
  assert.match(r.out, /unused OLD_FLAG/);
  assert.ok(!r.out.includes('secretdb'));
  assert.equal(run(['--scan', '.', '--ignore', 'IMAGE_TAG'], d).code, 0);
});
