// Minimal MCP server over stdio (JSON-RPC 2.0, one message per line). No dependencies.
// Read-only by design: the only tool runs envdiff --json, which never prints values.
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const BIN = fileURLToPath(new URL('../bin/envdiff.js', import.meta.url));

const TOOLS = [{
  name: 'envdiff_compare',
  title: 'Compare .env files',
  description: 'Compare .env files in the project (dev, staging, prod, .env.example) and report missing keys, keys whose values differ, real secrets committed to template files, lint warnings and, with "scan", keys the code reads that no .env file defines. Values are NEVER returned: only key names, file names and line numbers. With no files, compares every .env* file in the project folder. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'Paths of .env files inside the project, e.g. [".env.example", ".env"]. Omit to compare every .env* file.' },
      keysOnly: { type: 'boolean', description: 'Only compare key names, not values.' },
      ignore: { type: 'array', items: { type: 'string' }, description: 'Keys to skip, * wildcard allowed, e.g. ["APP_URL", "DEBUG_*"].' },
      strict: { type: 'boolean', description: 'Treat warnings (duplicates, empty values, invalid lines) as failures.' },
      scan: { type: 'string', description: 'Folder inside the project to scan for env keys used in source code, e.g. ".".' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}];

// The agent may only point envdiff at files inside the folder the server was started in.
const insideProject = (p) => { const r = relative(process.cwd(), resolve(p)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

function checkArgs(a = {}) {
  if (typeof a !== 'object' || Array.isArray(a)) return 'arguments must be an object';
  for (const k of Object.keys(a)) if (!TOOLS[0].inputSchema.properties[k]) return `unknown argument "${k}"`;
  const strings = (v, n) => v === undefined || (Array.isArray(v) && v.length <= 100 && v.every((s) => typeof s === 'string' && s.length <= 500)) ? null : `"${n}" must be a list of strings`;
  const err = strings(a.files, 'files') ?? strings(a.ignore, 'ignore');
  if (err) return err;
  for (const k of ['keysOnly', 'strict']) if (a[k] !== undefined && typeof a[k] !== 'boolean') return `"${k}" must be true or false`;
  if (a.scan !== undefined && typeof a.scan !== 'string') return '"scan" must be a folder path';
  for (const p of [...(a.files ?? []), ...(a.scan !== undefined ? [a.scan] : [])]) {
    if (p.startsWith('-')) return `invalid path "${p}"`;
    if (!insideProject(p)) return `"${p}" is outside the project folder`;
  }
  return null;
}

function runEnvdiff(a) {
  // In a standalone executable (process.argv[1] is the executable itself) there is no script path to pass.
  const argv = [...(process.argv[1] === process.execPath ? [] : [BIN]), ...(a.files ?? []), '--json'];
  if (a.keysOnly) argv.push('--keys-only');
  if (a.strict) argv.push('--strict');
  for (const i of a.ignore ?? []) argv.push('--ignore', i);
  if (a.scan !== undefined) argv.push('--scan', a.scan);
  return new Promise((done) => {
    // No shell: arguments go straight to node, so nothing in them is interpreted.
    const p = spawn(process.execPath, argv, { cwd: process.cwd(), env: { ...process.env, NO_COLOR: '1' }, windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { if (out.length < 5e6) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
    const timer = setTimeout(() => p.kill(), 60000);
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === 1) {
        try { const r = JSON.parse(out); return done({ ok: true, result: r }); } catch {}
      }
      done({ ok: false, message: err.trim().split('\n')[0] || `envdiff exited with code ${code}` });
    });
  });
}

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fail = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

export function serveMcp({ version }) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set();
  rl.on('line', (line) => { const p = handle(line); pending.add(p); p.finally(() => pending.delete(p)); });
  const handle = async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
    const { id, method, params } = msg ?? {};
    if (id === undefined) return; // notifications (initialized, cancelled) need no answer
    if (method === 'initialize') {
      const asked = params?.protocolVersion;
      return reply(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS.at(-1),
        capabilities: { tools: {} },
        serverInfo: { name: 'envdiff', version },
        instructions: 'envdiff compares .env files without ever revealing values. Use envdiff_compare to check that environments are in sync before deploys or after editing .env files.',
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      if (params?.name !== 'envdiff_compare') return fail(id, -32602, `Unknown tool: ${params?.name}`);
      const bad = checkArgs(params.arguments);
      if (bad) return reply(id, { content: [{ type: 'text', text: `envdiff: ${bad}` }], isError: true });
      const r = await runEnvdiff(params.arguments ?? {});
      if (!r.ok) return reply(id, { content: [{ type: 'text', text: `envdiff: ${r.message}` }], isError: true });
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(r.result, null, 2) }], structuredContent: r.result });
    }
    fail(id, -32601, `Method not found: ${method}`);
  };
  // Resolves when the client closes stdin, after in-flight calls have answered.
  return new Promise((done) => rl.on('close', async () => { await Promise.allSettled([...pending]); done(); }));
}
