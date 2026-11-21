const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

// [index of the closing quote or -1, where scanning stopped].
// Backslash escapes apply only inside double quotes (dotenv semantics).
const closing = (s, q, from = 0) => {
  let k = from;
  for (; k < s.length; k++) {
    if (q === '"' && s[k] === '\\') k++;
    else if (s[k] === q) return [k, k];
  }
  return [-1, k];
};

// Strips terminal control characters (ESC etc.) from names before printing them.
export const printable = (s) => String(s).replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
const unescape = (s) => s.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);

export function parse(text) {
  const vars = new Map(), duplicates = [], invalid = [];
  const noCloseFrom = {}; // quote char -> first line index from which no closing quote exists (hostile files stay linear)
  const lines = text.replace(/^﻿/, '').split(/\r?\n/); // BOM: Windows Notepad adds it
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(LINE);
    if (!m) { invalid.push(i + 1); continue; }
    let [, key, val] = m;
    const start = i + 1, q = val[0];
    if (q === '"' || q === "'" || q === '`') {
      // Search each line on its own and join once: linear even if the quote is never closed.
      // (A backslash at a line end only escapes the newline, so lines can be scanned independently.)
      const parts = [val.slice(1)];
      let [end] = closing(parts[0], q), j = i;
      if (end < 0 && noCloseFrom[q] !== undefined && i >= noCloseFrom[q]) j = lines.length; // known: never closes
      while (end < 0 && j + 1 < lines.length) { parts.push(lines[++j]); [end] = closing(parts[parts.length - 1], q); }
      if (end < 0) { noCloseFrom[q] = Math.min(noCloseFrom[q] ?? i, i); invalid.push(start); val = val.slice(1); } // unclosed quote: don't swallow the rest of the file
      else { parts[parts.length - 1] = parts[parts.length - 1].slice(0, end); val = parts.join('\n'); i = j; if (q === '"') val = unescape(val); }
    } else val = val.replace(/\s+#.*$/, '').trim();
    if (vars.has(key)) duplicates.push({ key, lines: [vars.get(key).line, start] });
    vars.set(key, { value: val, line: start });
  }
  return { vars, duplicates, invalid };
}

// Style problems that break some dotenv loaders, plus `# @expire YYYY-MM-DD` comments on the line above a key.
export function lint(text, today = new Date().toISOString().slice(0, 10)) {
  const issues = [];
  let expire = null;
  const soon = new Date(Date.parse(today) + 30 * 864e5).toISOString().slice(0, 10);
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1, t = raw.trim();
    const exp = t.match(/^#\s*@expire\s+(\S+)/);
    if (exp) {
      const dt = new Date(exp[1]); // also rejects impossible dates like 2026-02-30
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(exp[1]) && !isNaN(dt) && dt.toISOString().slice(0, 10) === exp[1];
      if (ok) expire = exp[1]; else issues.push({ type: 'invalid-expire-date', line });
      return;
    }
    const m = t.match(LINE);
    if (!m) { if (t && !t.startsWith('#')) expire = null; return; }
    const [, key, val] = m;
    if (/[a-z]/.test(key)) issues.push({ type: 'lowercase-key', key, line });
    if (/^\s/.test(raw)) issues.push({ type: 'leading-space', key, line });
    if (/[ \t]+$/.test(raw)) issues.push({ type: 'trailing-whitespace', key, line });
    if (/^(?:export\s+)?\S+\s+=|=[ \t]+\S/.test(t)) issues.push({ type: 'space-around-equals', key, line });
    if (!/^["'`]/.test(val) && /\s/.test(val.replace(/\s+#.*$/, '').trim())) issues.push({ type: 'unquoted-space', key, line });
    if (expire) issues.push({ type: expire < today ? 'expired' : expire <= soon ? 'expires-soon' : null, key, line, date: expire });
    expire = null;
  });
  return issues.filter((x) => x.type);
}

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_\w{20,}/, /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b[sr]k_live_\w{10,}/, /\bxox[abprs]-[\w-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY/, /\bAIza[\w-]{35}/,
  /\bglpat-[\w-]{20,}/, /\bnpm_[A-Za-z0-9]{36}\b/, /AccountKey=[A-Za-z0-9+/]{80,}={0,2}/,
  /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/,
];
export const looksSecret = (v) => SECRET_PATTERNS.some((re) => re.test(v));
const isTemplate = (name) => /example|sample|template|dist/i.test(name);

// files: [{ name, text }] -> report with keys only; values never leave this function.
// Glob patterns (only * is special) -> anchored regexes.
const toRegex = (glob) => new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

const deletions = (s, max) => {
  const all = new Set([s]);
  let frontier = [s];
  for (let d = 0; d < max; d++) {
    const next = [];
    for (const w of frontier) for (let i = 0; i < w.length; i++) {
      const v = w.slice(0, i) + w.slice(i + 1);
      if (!all.has(v)) { all.add(v); next.push(v); }
    }
    frontier = next;
  }
  return all;
};

export const distance = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};

// git: { tracked: [file names committed to git], unignored: [file names not covered by .gitignore] }
export function compare(files, { keysOnly = false, ignore = [], strict = false, git = {}, used = null, today } = {}) {
  const ignored = ignore.map(toRegex);
  const skip = (key) => ignored.some((re) => re.test(key));
  const parsed = files.map((f) => ({ name: f.name, text: f.text, ...parse(f.text) }));
  const all = [...new Set(parsed.flatMap((p) => [...p.vars.keys()]))].filter((k) => !skip(k)).sort();
  const missing = parsed.map((p) => ({ file: p.name, keys: all.filter((k) => !p.vars.has(k)) }));
  // "Did you mean": a missing key that looks like a typo of a key only this file has.
  const suggestions = [];
  for (const [i, m] of missing.entries()) {
    const own = [...parsed[i].vars.keys()].filter((k) => !skip(k) && parsed.some((p, j) => j !== i && !p.vars.has(k)));
    // Deletion index: two strings within edit distance 2 share a variant with <= 2 chars deleted,
    // so candidates are found by lookup instead of comparing every pair (fast with thousands of keys).
    const index = new Map();
    own.forEach((k, pos) => { for (const v of deletions(k, 2)) { if (!index.has(v)) index.set(v, []); index.get(v).push(pos); } });
    for (const key of m.keys) {
      if (key.length <= 3) continue;
      const max = key.length >= 8 ? 2 : 1;
      const candidates = new Set([...deletions(key, max)].flatMap((v) => index.get(v) ?? []));
      const pos = [...candidates].sort((a, b) => a - b).find((p) => distance(key, own[p]) <= max);
      if (pos !== undefined) suggestions.push({ file: m.file, missing: key, similar: own[pos] });
    }
  }
  const different = keysOnly ? [] : all.filter((k) => {
    const vals = parsed.filter((p) => p.vars.has(k) && !isTemplate(p.name)).map((p) => p.vars.get(k).value);
    return vals.length > 1 && new Set(vals).size > 1;
  });
  const warnings = [], leaks = [];
  for (const p of parsed) {
    if (!isTemplate(p.name) && git.tracked?.includes(p.name)) leaks.push({ file: p.name, type: 'tracked-by-git' });
    else if (!isTemplate(p.name) && git.unignored?.includes(p.name)) warnings.push({ file: p.name, type: 'not-gitignored' });
    for (const d of p.duplicates) if (!skip(d.key)) warnings.push({ file: p.name, key: d.key, type: 'duplicate', lines: d.lines });
    for (const x of lint(p.text, today)) if (!skip(x.key)) warnings.push({ file: p.name, key: x.key, type: x.date ? `${x.type} ${x.date}` : x.type, lines: [x.line] });
    for (const line of p.invalid) warnings.push({ file: p.name, type: 'invalid-line', lines: [line] });
    // Leak detection deliberately ignores --ignore: a real secret in a template is always reported.
    for (const [key, { value, line }] of p.vars) {
      if (value === '' && !isTemplate(p.name) && !skip(key)) warnings.push({ file: p.name, key, type: 'empty', lines: [line] });
      if (isTemplate(p.name) && looksSecret(value)) leaks.push({ file: p.name, key, type: 'secret-in-template', lines: [line] });
    }
  }
  // Per key, one cell per file: null = missing, otherwise a group number. Same number = same value.
  // Only equality is revealed (already implied by `different`), never the values.
  const table = all.map((key) => {
    const groups = [];
    const cells = parsed.map((p) => {
      if (!p.vars.has(key)) return null;
      if (keysOnly) return 0;
      if (isTemplate(p.name)) return -1; // template: present, value not compared (placeholders)
      const v = p.vars.get(key).value;
      if (!groups.includes(v)) groups.push(v);
      return groups.indexOf(v);
    });
    return { key, cells, lines: parsed.map((p) => p.vars.get(key)?.line ?? null) };
  });
  // used: Map<key, [{file, line}]> from scanCode(). Code needs a key no env file defines -> fail; defined but unused -> warn.
  const undefinedInCode = used ? [...used].filter(([k]) => !skip(k) && !parsed.some((p) => p.vars.has(k))).map(([key, refs]) => ({ key, refs })).sort((a, b) => a.key.localeCompare(b.key)) : [];
  if (used) for (const key of all) if (!used.has(key)) warnings.push({ file: parsed.find((p) => p.vars.has(key)).name, key, type: 'unused' });
  const ok = missing.every((m) => !m.keys.length) && !different.length && !leaks.length && !undefinedInCode.length && !(strict && warnings.length);
  return { files: parsed.map((p) => p.name), missing, suggestions, different, undefinedInCode, warnings, leaks, table, ok };
}

// Baseline: stable ids for known problems (no values, no line numbers so edits don't churn).
// Security problems (leaks, committed .env) are never baselined: they always show and fail.
export const problemIds = (r) => [
  ...r.missing.flatMap((m) => m.keys.map((k) => `missing|${m.file}|${k}`)),
  ...r.different.map((k) => `different|${k}`),
  ...(r.undefinedInCode || []).map((u) => `undefined|${u.key}`),
  ...r.warnings.filter((w) => w.type !== 'not-gitignored').map((w) => `warning|${w.file}|${w.type}|${w.key ?? ''}`),
].sort();

export function applyBaseline(r, known, { strict = false } = {}) {
  const set = new Set(known);
  const keep = (id) => !set.has(id);
  const missing = r.missing.map((m) => ({ ...m, keys: m.keys.filter((k) => keep(`missing|${m.file}|${k}`)) }));
  const different = r.different.filter((k) => keep(`different|${k}`));
  const undefinedInCode = (r.undefinedInCode || []).filter((u) => keep(`undefined|${u.key}`));
  const warnings = r.warnings.filter((w) => w.type === 'not-gitignored' || keep(`warning|${w.file}|${w.type}|${w.key ?? ''}`));
  const baselined = problemIds(r).length - problemIds({ missing, different, undefinedInCode, warnings }).length;
  const ok = missing.every((m) => !m.keys.length) && !different.length && !r.leaks.length && !undefinedInCode.length && !(strict && warnings.length);
  return { ...r, missing, different, undefinedInCode, warnings, baselined, ok };
}
