// Renders a compare() report as one self-contained, editor-style HTML page (no network, no values).
// Keys and file names come from user files, so everything is HTML-escaped.
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const letter = (n) => String.fromCharCode(65 + n);
const isTemplate = (name) => /example|sample|template|dist/i.test(name);
const MASK = '••••••'; // fixed width: does not even reveal value length

export function renderHtml(r, { keysOnly = false, generated = new Date().toISOString() } = {}) {
  const n = r.files.length;
  const missingCount = r.missing.reduce((s, m) => s + m.keys.length, 0);
  const undef = r.undefinedInCode || [];
  const hint = (file, key) => r.suggestions.find((s) => s.file === file && s.missing === key);
  const cols = `style="grid-template-columns:repeat(${n},minmax(260px,1fr))"`;

  const heads = r.files.map((f) => `<div class="tab"><span class="role ${isTemplate(f) ? 'tpl' : 'env'}">${isTemplate(f) ? 'TEMPLATE' : 'ENV'}</span><span class="path" title="${esc(f)}">${esc(f)}</span></div>`).join('');

  let problems = 0;
  const rows = r.table.map((t) => {
    const missingIn = t.cells.map((v, i) => (v === null ? r.files[i] : null)).filter(Boolean);
    const differs = r.different.includes(t.key);
    const state = missingIn.length ? 'missing' : differs ? 'different' : 'same';
    let band = '';
    if (state !== 'same') {
      problems++;
      const what = missingIn.length ? `Missing in ${missingIn.map(esc).join(', ')}` : 'Different values (hidden)';
      band = `<div class="band ${state}"><span class="tag">${state === 'missing' ? '⚠ Missing' : '≠ Different'}</span><span>${what}</span>${missingIn.length ? '<span class="fixhint">fix: <code>envdiff --fix</code></span>' : ''}</div>`;
    }
    const cells = t.cells.map((v, i) => {
      if (v === null) {
        const s = hint(r.files[i], t.key);
        return `<div class="cell gone"><span class="ln"></span><span class="ghost">${esc(t.key)} — missing${s ? ` · did you mean <b>${esc(s.similar)}</b>?` : ''}</span></div>`;
      }
      const chip = keysOnly || v < 0 ? '<span class="chip tplchip" title="Template: value not compared">✓</span>' : `<span class="chip g${v % 6}" title="Value group ${letter(v)}: same letter means same value">${letter(v)}</span>`;
      const tint = !keysOnly && v >= 0 && state === 'different' ? ` g${v % 6}bg` : '';
      return `<div class="cell${tint}"><span class="ln">${t.lines[i] ?? ''}</span><code><span class="k">${esc(t.key)}</span> <span class="eq">=</span> <span class="mask">${MASK}</span></code>${chip}</div>`;
    }).join('');
    return `<div class="item" data-state="${state}" data-key="${esc(t.key.toLowerCase())}">${band}<div class="row" ${cols}>${cells}</div></div>`;
  }).join('');

  const leakText = (w) => (w.type === 'tracked-by-git'
    ? `<b>${esc(w.file)}</b> is committed to git. Remove it with <code>git rm --cached</code> and rotate its secrets.`
    : `<b>${esc(w.file)}</b>: <code>${esc(w.key)}</code> (line ${w.lines?.[0] ?? '?'}) looks like a real secret in a template file.`);
  const warnText = (w) => `<b>${esc(w.file)}</b>: ${esc(w.type)}${w.key ? ` <code>${esc(w.key)}</code>` : ''}${w.lines ? ` <span class="muted">line ${w.lines.join(', ')}</span>` : ''}`;
  const panel = (title, cls, items) => (items.length ? `<section class="panel ${cls}"><h2>${title} <span class="count">${items.length}</span></h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></section>` : '');
  const stat = (label, value, cls) => `<span class="stat ${value ? cls : 'zero'}"><b>${value}</b> ${label}</span>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>envdiff report</title>
<style>
:root{--bg:#0d1117;--bar:#161b22;--panel:#11161d;--line:#21262d;--fg:#e6edf3;--muted:#7d8590;--bad:#f85149;--badbg:#3a1416;--warn:#d29922;--warnbg:#2e2410;--good:#3fb950;--accent:#a371f7}
@media (prefers-color-scheme:light){:root{--bg:#ffffff;--bar:#f6f8fa;--panel:#ffffff;--line:#d0d7de;--fg:#1f2328;--muted:#59636e;--bad:#cf222e;--badbg:#ffebe9;--warn:#9a6700;--warnbg:#fff8c5;--good:#1a7f37;--accent:#8250df}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:10px 16px;background:var(--bar);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:3}
.brand{font-weight:700;letter-spacing:.3px}.brand span{color:var(--accent)}
.status{padding:2px 10px;border-radius:6px;font-weight:600;font-size:12px}.status.bad{color:var(--bad);background:var(--badbg)}.status.good{color:var(--good);background:color-mix(in srgb,var(--good) 15%,transparent)}
.stat{font-size:12px;color:var(--muted)}.stat b{font-size:13px}.stat.bad b{color:var(--bad)}.stat.warn b{color:var(--warn)}.stat.zero b{color:var(--muted)}
.spacer{flex:1}
.nav{display:flex;align-items:center;gap:6px}.nav .count{font-size:12px;color:var(--bad);border:1px solid var(--bad);border-radius:4px;padding:0 6px}
button,input[type=search]{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;font:inherit;font-size:12px;padding:4px 8px}
button{cursor:pointer}button:hover{border-color:var(--accent)}button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
input[type=search]{width:180px}
.editor{overflow-x:auto}
.heads,.row{display:grid}
.heads{background:var(--bar);border-bottom:1px solid var(--line)}
.tab{display:flex;align-items:center;gap:8px;padding:6px 12px;border-right:1px solid var(--line);min-width:0}
.role{font-size:10px;font-weight:700;letter-spacing:.8px;padding:1px 6px;border-radius:4px;border:1px solid var(--line);color:var(--muted)}.role.env{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 50%,transparent)}
.path{font-family:ui-monospace,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell{display:flex;align-items:center;gap:10px;padding:2px 12px 2px 0;border-right:1px solid var(--line);min-height:26px;white-space:nowrap}
.ln{width:40px;text-align:right;color:var(--muted);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;flex:none;opacity:.7}
.cell code{flex:1;overflow:hidden;text-overflow:ellipsis}.k{color:var(--fg)}.eq{color:var(--muted)}.mask{color:var(--muted);letter-spacing:1px}
.ghost{color:var(--bad);font-style:italic;opacity:.85;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}.ghost b{font-style:normal}
.cell.gone{background:repeating-linear-gradient(135deg,transparent 0 6px,color-mix(in srgb,var(--bad) 7%,transparent) 6px 12px)}
.item .row:hover{background:color-mix(in srgb,var(--accent) 5%,transparent)}
.band{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:3px 12px;font-size:12px;border-top:1px solid;border-bottom:1px solid}
.band.missing{background:var(--badbg);border-color:color-mix(in srgb,var(--bad) 40%,transparent)}.band.missing .tag{color:var(--bad)}
.band.different{background:var(--warnbg);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}.band.different .tag{color:var(--warn)}
.band .tag{font-weight:700}.fixhint{margin-left:auto;color:var(--muted)}
.item.current .band{outline:2px solid var(--accent);outline-offset:-2px}
.chip{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:18px;padding:0 5px;border-radius:4px;font-weight:700;font-size:11px;flex:none}
.tplchip{color:var(--good);background:color-mix(in srgb,var(--good) 14%,transparent)}
.g0{color:#3fb950;background:#3fb95024}.g1{color:#d29922;background:#d2992224}.g2{color:#a371f7;background:#a371f724}.g3{color:#58a6ff;background:#58a6ff24}.g4{color:#f778ba;background:#f778ba24}.g5{color:#39c5cf;background:#39c5cf24}
.g0bg{background:#3fb95012}.g1bg{background:#d2992212}.g2bg{background:#a371f712}.g3bg{background:#58a6ff12}.g4bg{background:#f778ba12}.g5bg{background:#39c5cf12}
.legend{padding:8px 16px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);background:var(--bar)}
.panels{padding:16px;display:grid;gap:12px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px}.panel.bad{border-color:var(--bad)}
.panel h2{margin:0 0 6px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted)}.panel.bad h2{color:var(--bad)}
.panel .count{border:1px solid currentColor;border-radius:4px;padding:0 5px;margin-left:4px}.panel ul{margin:0;padding-left:18px}.panel li{margin:3px 0}
.muted{color:var(--muted)}
code{background:color-mix(in srgb,var(--muted) 14%,transparent);padding:0 4px;border-radius:4px}.cell code{background:none;padding:0}
footer{color:var(--muted);font-size:11px;text-align:center;padding:16px}
</style></head><body>
<div class="top">
<span class="brand"><span>env</span>diff</span>
<span class="status ${r.ok ? 'good' : 'bad'}">${r.ok ? '✓ In sync' : '✗ Not in sync'}</span>
${stat('keys', r.table.length, '')}${stat('missing', missingCount, 'bad')}${stat('different', r.different.length, 'warn')}${stat('security', r.leaks.length, 'bad')}${undef.length ? stat('undefined in code', undef.length, 'bad') : ''}${stat('warnings', r.warnings.length, 'warn')}
<span class="spacer"></span>
<input type="search" id="q" placeholder="Filter keys…" aria-label="Filter keys">
<button type="button" id="only" aria-pressed="false">Only problems</button>
<span class="nav"><span class="count" id="pos">${problems} problem${problems === 1 ? '' : 's'}</span><button type="button" id="prev" aria-label="Previous problem">▲</button><button type="button" id="next" aria-label="Next problem">▼</button></span>
</div>
<div class="editor"><div class="heads" ${cols}>${heads}</div>${rows}</div>
<div class="legend">Same letter = same value · ✓ template (value not compared) · <span class="mono">${MASK}</span> values are never included in this file</div>
<div class="panels">
${panel('Security problems', 'bad', r.leaks.map(leakText))}
${panel('Used in code but not defined in any env file', 'bad', undef.map((u) => `<code>${esc(u.key)}</code> — ${esc(u.refs[0].file)}:${u.refs[0].line}${u.refs.length > 1 ? ` <span class="muted">(+${u.refs.length - 1} more)</span>` : ''}`))}
${panel('Warnings', '', r.warnings.map(warnText))}
</div>
<footer>Generated by envdiff · ${esc(generated)}</footer>
<script>
const q=document.getElementById('q'),only=document.getElementById('only'),items=[...document.querySelectorAll('.item')];
const probs=()=>items.filter(i=>i.dataset.state!=='same'&&!i.hidden);let cur=-1;
function apply(){const t=q.value.toLowerCase(),p=only.getAttribute('aria-pressed')==='true';for(const i of items)i.hidden=!i.dataset.key.includes(t)||(p&&i.dataset.state==='same');}
function go(d){const ps=probs();if(!ps.length)return;cur=(cur+d+ps.length)%ps.length;items.forEach(i=>i.classList.remove('current'));ps[cur].classList.add('current');ps[cur].scrollIntoView({block:'center',behavior:'smooth'});document.getElementById('pos').textContent=(cur+1)+' / '+ps.length;}
q.addEventListener('input',apply);only.addEventListener('click',()=>{only.setAttribute('aria-pressed',String(only.getAttribute('aria-pressed')!=='true'));apply();});
document.getElementById('prev').onclick=()=>go(-1);document.getElementById('next').onclick=()=>go(1);
document.addEventListener('keydown',e=>{if(e.target===q)return;if(e.key==='j')go(1);if(e.key==='k')go(-1);});
</script></body></html>
`;
}
