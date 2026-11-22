import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/envdiff.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

// Sends JSON-RPC messages over stdin (one per line) and returns the responses by id.
function mcp(cwd, messages) {
  const input = messages.map((m) => JSON.stringify({ jsonrpc: '2.0', ...m })).join('\n') + '\n';
  const r = spawnSync(process.execPath, [BIN, '--mcp'], { cwd, input, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { byId: Object.fromEntries(out.map((x) => [x.id, x])), raw: r.stdout };
}
const call = (id, args) => ({ id, method: 'tools/call', params: { name: 'envdiff_compare', arguments: args } });

function project() {
  const d = mkdtempSync(join(tmpdir(), 'envdiff-mcp-'));
  writeFileSync(join(d, '.env.example'), 'DATABASE_URL=\nAPI_KEY=\nREDIS_URL=\n');
  writeFileSync(join(d, '.env'), 'DATABASE_URL=postgres://user:SUPERSECRET@db/app\nAPI_KEY=sk_live_VALUE123\n');
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'app.js'), 'const u = process.env.DATABASE_URL; const s = process.env.STRIPE_SECRET;\n');
  return d;
}

test('MCP: initialize, tools/list, ping, unknown method', () => {
  const { byId } = mcp(project(), [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'ping' },
    { id: 4, method: 'resources/list' },
  ]);
  assert.equal(byId[1].result.protocolVersion, '2025-06-18');
  assert.equal(byId[1].result.serverInfo.name, 'envdiff');
  assert.deepEqual(byId[1].result.capabilities, { tools: {} });
  const [tool] = byId[2].result.tools;
  assert.equal(tool.name, 'envdiff_compare');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(byId[3].result, {});
  assert.equal(byId[4].error.code, -32601);
});

test('MCP: compare and scan return key names, never values', () => {
  const { byId, raw } = mcp(project(), [
    { id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
    call(2, {}),
    call(3, { files: ['.env.example', '.env'], scan: '.' }),
  ]);
  assert.equal(byId[1].result.protocolVersion, '2025-11-25'); // unknown version: latest supported
  const r = byId[2].result.structuredContent;
  assert.equal(r.ok, false);
  assert.ok(JSON.stringify(r.missing).includes('REDIS_URL'));
  assert.ok(JSON.stringify(byId[3].result.structuredContent.undefinedInCode).includes('STRIPE_SECRET'));
  assert.doesNotMatch(raw, /SUPERSECRET|sk_live_VALUE123|postgres:\/\//);
});

test('MCP: refuses paths outside the project, writes and bad arguments', () => {
  const { byId } = mcp(project(), [
    call(1, { files: ['../../etc/passwd'] }),
    call(2, { files: ['/etc/hosts'] }),
    call(3, { scan: '..' }),
    call(4, { files: ['--fix'] }),
    call(5, { fix: true }),
    call(6, { ignore: 'NOT_A_LIST' }),
    { id: 7, method: 'tools/call', params: { name: 'rm_rf', arguments: {} } },
  ]);
  for (const id of [1, 2, 3]) assert.match(byId[id].result.content[0].text, /outside the project folder/);
  assert.match(byId[4].result.content[0].text, /invalid path/);
  assert.match(byId[5].result.content[0].text, /unknown argument "fix"/);
  assert.match(byId[6].result.content[0].text, /must be a list of strings/);
  for (const id of [1, 2, 3, 4, 5, 6]) assert.equal(byId[id].result.isError, true);
  assert.equal(byId[7].error.code, -32602);
});
