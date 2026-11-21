// Renders a compare() report as one self-contained HTML page (no network, no values).
// Keys and file names come from user files, so everything is HTML-escaped.
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const letter = (n) => String.fromCharCode(65 + n);

export function renderHtml(r, { keysOnly = false, generated = new Date().toISOString() } = {}) {
  const missingCount = r.missing.reduce((n, m) => n + m.keys.length, 0);
  const problemKeys = new Set([...r.missing.flatMap((m) => m.keys), ...r.different]);
  const stats = [
    ['Keys', r.table.length, ''],
    ['Missing', missingCount, missingCount ? 'bad' : 'good'],
    ['Different', r.different.length, r.different.length ? 'warn' : 'good'],
    ['Security', r.leaks.length, r.leaks.length ? 'bad' : 'good'],
    ['Warnings', r.warnings.length, r.warnings.length ? 'warn' : 'good'],
  ];
  const hint = (file, key) => r.suggestions.find((s) => s.file === file && s.missing === key);
  const cell = (v, file, key) => {
    if (v === null) {
      const s = hint(file, key);
      return `<td><span class="chip miss" title="Missing in ${esc(file)}">✗</span>${s ? `<span class="hint">did you mean ${esc(s.similar)}?</span>` : ''}</td>`;
    }
    return keysOnly || v < 0 ? '<td><span class="chip ok" title="Present (template value not compared)">✓</span></td>' : `<td><span class="chip g${v % 6}" title="Value group ${letter(v)}">${letter(v)}</span></td>`;
  };
  const rows = r.table.map((t) => {
    const state = t.cells.includes(null) ? 'missing' : t.cells.some((v) => v > 0) ? 'different' : 'same';
    return `<tr data-state="${state}" data-key="${esc(t.key.toLowerCase())}"><th scope="row"><span class="dot ${state}"></span>${esc(t.key)}</th>${t.cells.map((v, i) => cell(v, r.files[i], t.key)).join('')}</tr>`;
  }).join('');
  const leakText = (w) => (w.type === 'tracked-by-git'
    ? `<b>${esc(w.file)}</b> is committed to git — remove it with <code>git rm --cached</code> and rotate its secrets.`
    : `<b>${esc(w.file)}</b>: <code>${esc(w.key)}</code> (line ${w.lines?.[0] ?? '?'}) looks like a real secret in a template file.`);
  const warnText = (w) => `<b>${esc(w.file)}</b>: ${esc(w.type)}${w.key ? ` <code>${esc(w.key)}</code>` : ''}${w.lines ? ` (line ${w.lines.join(', ')})` : ''}`;
  const list = (title, cls, items) => (items.length ? `<section class="panel ${cls}"><h2>${title}</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></section>` : '');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>envdiff report</title>
<style>
:root{--bg:#0b0f14;--panel:#121821;--line:#1f2937;--fg:#e6edf3;--muted:#8b98a9;--good:#34d399;--warn:#fbbf24;--bad:#f87171;--accent:#a78bfa}
@media (prefers-color-scheme:light){:root{--bg:#f6f8fa;--panel:#fff;--line:#d8dee4;--fg:#1f2328;--muted:#59636e;--good:#1a7f37;--warn:#9a6700;--bad:#cf222e;--accent:#8250df}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:20px}
h1{font-size:20px;margin:0;letter-spacing:.2px}h1 span{color:var(--accent)}.sub{color:var(--muted);font-size:12px;margin-top:2px}
.pill{padding:6px 12px;border-radius:999px;font-weight:600;font-size:13px;border:1px solid}
.pill.good{color:var(--good);border-color:var(--good)}.pill.bad{color:var(--bad);border-color:var(--bad)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:1px}.stat .n{font-size:28px;font-weight:700;margin-top:4px}
.stat.good .n{color:var(--good)}.stat.warn .n{color:var(--warn)}.stat.bad .n{color:var(--bad)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
.panel h2{font-size:12px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 12px;color:var(--muted)}
.panel.bad{border-color:var(--bad)}.panel.bad h2{color:var(--bad)}.panel ul{margin:0;padding-left:18px}.panel li{margin:4px 0}
.tools{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
input[type=search]{flex:1;min-width:200px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}
.tools button{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font:inherit;cursor:pointer}
.tools button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
thead th{position:sticky;top:0;background:var(--panel);text-align:left;color:var(--muted);font-weight:600;padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
tbody th{text-align:left;font-weight:500;padding:8px 12px;white-space:nowrap}td{padding:8px 12px;white-space:nowrap}
tbody tr{border-bottom:1px solid var(--line)}tbody tr:hover{background:color-mix(in srgb,var(--accent) 6%,transparent)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle}
.dot.same{background:var(--good)}.dot.different{background:var(--warn)}.dot.missing{background:var(--bad)}
.chip{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:22px;padding:0 6px;border-radius:6px;font-weight:700;font-size:12px}
.chip.miss{color:var(--bad);background:color-mix(in srgb,var(--bad) 15%,transparent)}.chip.ok{color:var(--good);background:color-mix(in srgb,var(--good) 15%,transparent)}
.g0{color:#34d399;background:#34d39922}.g1{color:#fbbf24;background:#fbbf2422}.g2{color:#a78bfa;background:#a78bfa22}.g3{color:#60a5fa;background:#60a5fa22}.g4{color:#f472b6;background:#f472b622}.g5{color:#2dd4bf;background:#2dd4bf22}
.hint{margin-left:8px;color:var(--muted);font-size:12px}.legend{color:var(--muted);font-size:12px;margin-top:10px}
code{font-family:ui-monospace,Menlo,Consolas,monospace;background:color-mix(in srgb,var(--muted) 15%,transparent);padding:1px 5px;border-radius:4px}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:24px}
</style></head><body><div class="wrap">
<header><div><h1><span>envdiff</span> report</h1><div class="sub">${r.files.map(esc).join(' &nbsp;vs&nbsp; ')}</div></div>
<div class="pill ${r.ok ? 'good' : 'bad'}">${r.ok ? '✓ In sync' : '✗ Not in sync'}</div></header>
<div class="stats">${stats.map(([l, n, c]) => `<div class="stat ${c}"><div class="label">${l}</div><div class="n">${n}</div></div>`).join('')}</div>
${list('Security problems', 'bad', r.leaks.map(leakText))}
<section class="panel"><h2>Keys by environment</h2>
<div class="tools"><input type="search" id="q" placeholder="Filter keys…" aria-label="Filter keys">
<button type="button" id="only" aria-pressed="false">Only problems (${problemKeys.size})</button></div>
<div class="scroll"><table><thead><tr><th scope="col">Key</th>${r.files.map((f) => `<th scope="col">${esc(f)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<div class="legend">✗ missing · ✓ present${keysOnly ? '' : ' (templates: value not compared) · same letter = same value'} · values are never included in this file</div></section>
${list('Warnings', '', r.warnings.map(warnText))}
<footer>Generated by envdiff · ${esc(generated)}</footer></div>
<script>
const q=document.getElementById('q'),only=document.getElementById('only'),rows=[...document.querySelectorAll('tbody tr')];
function apply(){const t=q.value.toLowerCase(),p=only.getAttribute('aria-pressed')==='true';for(const r of rows)r.hidden=!r.dataset.key.includes(t)||(p&&r.dataset.state==='same');}
q.addEventListener('input',apply);only.addEventListener('click',()=>{only.setAttribute('aria-pressed',String(only.getAttribute('aria-pressed')!=='true'));apply();});
</script></body></html>
`;
}
