// Regenerates docs/demo.svg from REAL envdiff output on fake env files. Run: npm run demo
// Re-run it whenever the CLI output changes so the README never shows an outdated design.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/envdiff.js', import.meta.url));
const out = fileURLToPath(new URL('../docs/demo.svg', import.meta.url));
const d = mkdtempSync(join(tmpdir(), 'envdiff-demo-'));
const fakeKey = 'AKIA' + 'EXAMPLE'.padEnd(16, 'X'); // fake, only to show leak detection
const files = {
  '.env.example': `DATABASE_URL=\nREDIS_URL=\nSTRIPE_SECRET=\nAWS_ACCESS_KEY_ID=${fakeKey}\n`,
  '.env': 'DATABSE_URL=postgres://local\nSTRIPE_SECRET=sk_test_local\n',
  '.env.staging': 'DATABASE_URL=postgres://stg\nREDIS_URL=redis://stg\nSTRIPE_SECRET=sk_test_stg\n',
  '.env.production': 'DATABASE_URL=postgres://prod\nSTRIPE_SECRET=sk_test_stg\n',
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);

const scenes = [
  ['npx @guihakka2/envdiff'],
  ['npx @guihakka2/envdiff .env.staging .env.production --table'],
  ['npx @guihakka2/envdiff .env.staging .env.production --fix --html report.html'],
].map(([cmd]) => {
  const args = cmd.split(' ').slice(2);
  let text;
  try { text = execFileSync(process.execPath, [bin, ...args], { cwd: d, env: { ...process.env, FORCE_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
  catch (e) { text = e.stdout.toString() + e.stderr.toString(); }
  return [cmd, text.trimEnd().split('\n')];
});

// ANSI SGR -> SVG colors (same palette as a dark GitHub terminal).
const COLORS = { 1: '#ffffff', 2: '#8b949e', 31: '#f87171', 32: '#4ade80', 33: '#fbbf24', 36: '#67e8f9' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const spans = (line) => {
  let code = 0, html = '';
  for (const part of line.split(/(\x1b\[\d+m)/)) {
    const m = part.match(/^\x1b\[(\d+)m$/);
    if (m) { code = Number(m[1]); continue; }
    if (part) html += `<tspan fill="${COLORS[code] || '#e6edf3'}"${code === 1 ? ' font-weight="700"' : ''}>${esc(part)}</tspan>`;
  }
  return html;
};

const SCENE = 7, T = SCENE * scenes.length, LH = 21, TOP = 56, W = 820;
const H = TOP + LH * Math.max(...scenes.map(([, l]) => l.length + 1)) + 16;
const pct = (s) => ((s / T) * 100).toFixed(2);
let css = '', body = '', n = 0;
scenes.forEach(([cmd, lines], si) => {
  const start = si * SCENE, end = start + SCENE - 0.4;
  [`\x1b[0m$ ${cmd}`, ...lines].forEach((line, li) => {
    if (!line.replace(/\x1b\[\d+m/g, '')) return;
    const at = start + (li === 0 ? 0.3 : 1.2 + li * 0.08);
    css += `@keyframes k${n}{0%,${pct(at)}%{opacity:0}${pct(at + 0.01)}%,${pct(end)}%{opacity:1}${pct(end + 0.01)}%,100%{opacity:0}}.l${n}{animation:k${n} ${T}s infinite}`;
    const content = li === 0 ? `<tspan fill="#a78bfa">$ </tspan><tspan fill="#e6edf3">${esc(cmd)}</tspan>` : spans(line);
    body += `<text class="l${n++}" x="20" y="${TOP + li * LH}" opacity="0">${content}</text>`;
  });
});

writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="envdiff demo: real terminal output comparing .env files without showing values">
<style>text{font:13.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}${css}</style>
<rect width="${W}" height="${H}" rx="10" fill="#0d1117"/>
<circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>
<text x="${W / 2}" y="22" text-anchor="middle" fill="#8b949e" style="font-size:12px">envdiff</text>
${body}
</svg>
`);
console.log(`docs/demo.svg: ${n} lines from real output, ${T}s loop`);
